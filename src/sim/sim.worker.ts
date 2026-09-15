import { LifEngine } from "./lif-engine.ts";
import {
  CONNECTOME_FILES, MOTOR_GROUPS, parseConnectome, type Groups, type Meta, type MotorGroup,
} from "./data.ts";
import type { FromWorker, ToWorker } from "./protocol.ts";

const FRAME_MS = 33; // 스냅샷 주기
const BUDGET_MS = 22; // 프레임당 계산 예산
const MAX_LAG_MS = 100; // 이보다 밀리면 따라잡기를 포기 (슬로모션)
const TRACE_DECAY = 0.82;

// DOM 타입과 섞이지 않게 워커 전역에서 쓰는 부분만 선언
const scope = self as unknown as {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};
const post = (msg: FromWorker, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

let engine: LifEngine;
let groups: Groups;
let labels: [number, string][];
let trace: Float32Array;
let running = true;
let lastWall = 0;
let debt = 0;
let speedEma = 1;

async function fetchBuffer(name: string, loaded: { bytes: number; total: number }): Promise<ArrayBuffer> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok || !res.body) throw new Error(`${name} 을 불러오지 못했습니다 (${res.status}). npm run data 를 먼저 실행하세요.`);
  const reader = res.body.getReader();
  const size = Number(res.headers.get("content-length")) || 0;
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    loaded.bytes += value.length;
    post({ type: "progress", loaded: loaded.bytes, total: loaded.total, label: name });
  }
  if (size && got !== size) throw new Error(`${name} 다운로드가 중간에 끊겼습니다`);
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out.buffer;
}

async function init(dt: number) {
  const base = `${import.meta.env.BASE_URL}data/`;
  const [meta, groupJson, labelJson] = await Promise.all([
    fetch(`${base}meta.json`).then((r) => r.json() as Promise<Meta>),
    fetch(`${base}groups.json`).then((r) => r.json() as Promise<Groups>),
    fetch(`${base}labels.json`).then((r) => r.json() as Promise<Record<string, string>>),
  ]);
  groups = groupJson;
  labels = Object.entries(labelJson).map(([i, name]) => [Number(i), name]);

  const loaded = { bytes: 0, total: (meta.neurons + 1) * 4 + meta.connections * 6 };
  const buffers: ArrayBuffer[] = [];
  for (const f of CONNECTOME_FILES) buffers.push(await fetchBuffer(f, loaded));

  engine = new LifEngine(parseConnectome(meta, buffers), meta.lif, dt, (Math.random() * 2 ** 31) | 0);
  trace = new Float32Array(meta.neurons);
  const groupSizes = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]));
  post({ type: "ready", meta, groupSizes });
  lastWall = performance.now();
  loop();
}

function loop() {
  const frameStart = performance.now();
  const wallDelta = frameStart - lastWall;
  lastWall = frameStart;
  const simBefore = engine.step * engine.dt;

  if (running) {
    debt = Math.min(debt + wallDelta, MAX_LAG_MS);
    const chunk = Math.max(1, Math.round(1 / engine.dt)); // ≈1 ms 단위로 끊어 예산 확인
    while (debt >= engine.dt * chunk && performance.now() - frameStart < BUDGET_MS) {
      engine.run(chunk);
      debt -= engine.dt * chunk;
    }
  }

  const simDelta = engine.step * engine.dt - simBefore;
  if (running && wallDelta > 0) speedEma += (Math.min(simDelta / wallDelta, 4) - speedEma) * 0.1;
  sendFrame(simDelta);
  setTimeout(loop, Math.max(0, FRAME_MS - (performance.now() - frameStart)));
}

function sendFrame(simDelta: number) {
  const { spikeCount } = engine;
  const n = engine.n;
  const activity = new Uint8Array(n);
  const windowSec = Math.max(simDelta, 1e-6) / 1000;
  let spikes = 0;
  let spiking = 0;
  for (let i = 0; i < n; i++) {
    const c = spikeCount[i];
    const tr = trace[i] * TRACE_DECAY + c;
    trace[i] = tr;
    if (c) {
      spikes += c;
      spiking++;
    }
    if (tr > 0.01) activity[i] = tr > 2.8 ? 255 : tr * 90;
  }
  // 역치 아래 탈분극도 은은하게
  const { u } = engine;
  for (const i of engine.activeIndices()) {
    const sub = u[i] > 0 ? Math.min(u[i] / 7, 1) * 70 : 0;
    if (sub > activity[i]) activity[i] = sub;
  }

  const motor = {} as Record<MotorGroup, number>;
  for (const g of MOTOR_GROUPS) {
    let s = 0;
    for (const i of groups[g]) s += spikeCount[i];
    motor[g] = simDelta > 0 ? s / groups[g].length / windowSec : 0;
  }
  const topLabeled: [string, number][] = [];
  if (simDelta > 0) {
    for (const [i, name] of labels) if (spikeCount[i]) topLabeled.push([name, spikeCount[i] / windowSec]);
    topLabeled.sort((a, b) => b[1] - a[1]).splice(6);
  }

  engine.clearSpikeCounts();
  post(
    {
      type: "frame",
      simTime: engine.step * engine.dt,
      simDelta,
      speed: running ? speedEma : 0,
      activeNeurons: engine.activeNeurons,
      spikingNeurons: spiking,
      meanRate: simDelta > 0 ? spikes / n / windowSec : 0,
      motor,
      topLabeled,
      activity,
    },
    [activity.buffer],
  );
}

scope.onmessage = (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init":
        init(msg.dt).catch((err) => post({ type: "error", message: String(err?.message ?? err) }));
        break;
      case "stim":
        if (!engine) break;
        if (msg.rate > 0 && engine.hasInput(msg.group)) engine.setRate(msg.group, msg.rate);
        else if (msg.rate > 0 || engine.hasInput(msg.group)) engine.setInput(msg.group, msg.rate > 0 ? groups[msg.group] : [], msg.rate);
        break;
      case "pause":
        running = false;
        break;
      case "resume":
        running = true;
        debt = 0;
        break;
      case "reset":
        engine?.reset();
        trace?.fill(0);
        break;
    }
  } catch (err) {
    post({ type: "error", message: String((err as Error)?.message ?? err) });
  }
};
