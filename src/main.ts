import "./style.css";
import { BEHAVIOR_LABEL, Controller } from "./behavior/Controller.ts";
import { BodyScene } from "./body/BodyScene.ts";
import { createFallbackRig, loadVrmRig } from "./body/Rig.ts";
import { NeuralField } from "./brain/NeuralField.ts";
import { Recorder } from "./replay/Recorder.ts";
import { MOTOR_GROUPS, SENSORY_GROUPS, type Meta, type MotorGroup, type SensoryGroup } from "./sim/data.ts";
import type { FromWorker, SimFrame, ToWorker } from "./sim/protocol.ts";
import { Habitat, type FoodKind } from "./world/Habitat.ts";
import { HabitatMap } from "./world/HabitatMap.ts";

// 적분 간격. ?dt=0.25 처럼 바꿀 수 있다 (작을수록 정확하지만 느림)
const DT_MS = Number(new URLSearchParams(location.search).get("dt")) || 0.5;
const BASE = import.meta.env.BASE_URL;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const MOTOR_LABEL: Record<MotorGroup, [string, string]> = {
  forward: ["P9 · 전진", "DNp09 (P9 하강뉴런), 전진 보행"],
  backward: ["MDN · 후진", "Moonwalker 하강뉴런, 후진 보행"],
  turn_left: ["DNa01/02 · 좌", "왼쪽 DNa01·DNa02, 왼쪽 회전"],
  turn_right: ["DNa01/02 · 우", "오른쪽 DNa01·DNa02, 오른쪽 회전"],
  escape: ["Giant Fiber", "DNp01, 도약 탈출"],
  groom: ["그루밍 DN", "DNg84·DNg29·DNg57, JO-F 접촉에 반응"],
  feed: ["MN9 · 섭식", "주둥이 운동뉴런 MN9"],
};
const SENSORY_LABEL: Record<SensoryGroup, string> = {
  sugar: "당 GRN", bitter: "쓴맛 GRN", jo_touch: "JO-F 접촉", looming: "LPLC2 루밍", light: "R7/R8 빛",
};
const METER_MAX_HZ = 150;

// ---------------------------------------------------------------- 상태
const habitat = new Habitat();
const controller = new Controller();
const recorder = new Recorder(200);
let meta: Meta | undefined;
let neural: NeuralField | undefined;
let ready = false;
let paused = false;
let mode: "live" | "replay" = "live";
let replayPlaying = false;
let playhead = 0;
let worldTime = 0;
let simSpeed = 0;
let lastFrame: SimFrame | undefined;
const sentStim: Record<SensoryGroup, number> = { sugar: 0, bitter: 0, jo_touch: 0, looming: 0, light: 0 };

// ---------------------------------------------------------------- 뷰
const body = new BodyScene($("body-view"));
const map = new HabitatMap($("map-view"), (kind, x, z) => placeFood(kind, x, z));

loadVrmRig(`${BASE}models/yumeka.vrm`)
  .catch((err) => {
    console.warn("VRM 로드 실패, 도형 인형으로 대체합니다:", err);
    return createFallbackRig();
  })
  .then((rig) => body.setRig(rig));

const meterEls = new Map<MotorGroup, { row: HTMLElement; fill: HTMLElement; val: HTMLElement }>();
for (const g of MOTOR_GROUPS) {
  const row = document.createElement("div");
  row.className = "meter";
  row.title = MOTOR_LABEL[g][1];
  row.innerHTML = `<span class="name">${MOTOR_LABEL[g][0]}</span><span class="track"><span class="fill"></span></span><span class="val">0 Hz</span>`;
  $("meters").appendChild(row);
  meterEls.set(g, { row, fill: row.querySelector(".fill")!, val: row.querySelector(".val")! });
}
const stimEls = new Map<SensoryGroup, HTMLElement>();
for (const g of SENSORY_GROUPS) {
  const chip = document.createElement("span");
  chip.textContent = SENSORY_LABEL[g];
  $("stim").appendChild(chip);
  stimEls.set(g, chip);
}

// ---------------------------------------------------------------- 워커
const worker = new Worker(new URL("./sim/sim.worker.ts", import.meta.url), { type: "module" });
const send = (msg: ToWorker) => worker.postMessage(msg);

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case "progress": {
      $("load-bar").style.width = `${(msg.loaded / msg.total) * 100}%`;
      $("load-label").textContent = `커넥톰 불러오는 중… ${(msg.loaded / 1e6).toFixed(0)} / ${(msg.total / 1e6).toFixed(0)} MB`;
      break;
    }
    case "ready": {
      meta = msg.meta;
      $("neuron-title").textContent = `${meta.neurons.toLocaleString()}개 전체 신경계`;
      $("source").textContent = `FlyWire v783 · 시냅스 ${(meta.synapses / 1e6).toFixed(1)}M · LIF dt ${DT_MS} ms`;
      loadNeuralField(meta).then(() => {
        $("overlay").hidden = true;
        ready = true;
        startScenario();
      });
      break;
    }
    case "frame":
      onFrame(msg);
      break;
    case "error": {
      $("overlay").hidden = false;
      $("overlay").querySelector(".loading")!.classList.add("error");
      $("load-label").textContent = msg.message;
      break;
    }
  }
};
send({ type: "init", dt: DT_MS });

async function loadNeuralField(m: Meta) {
  const [pos, cls] = await Promise.all([
    fetch(`${BASE}data/neurons_pos.f32`).then((r) => r.arrayBuffer()),
    fetch(`${BASE}data/neurons_class.u8`).then((r) => r.arrayBuffer()),
  ]);
  neural = new NeuralField($("neural-view"), new Float32Array(pos), new Uint8Array(cls), m.classes);
}

function onFrame(frame: SimFrame) {
  lastFrame = frame;
  simSpeed = frame.speed;
  if (mode !== "live" || !ready) return;
  controller.ingest(frame.motor, frame.simDelta);
  neural?.setActivity(frame.activity);
  recorder.record(worldTime, controller.state, habitat.foods, controller.rates, frame.activity, {
    meanRate: frame.meanRate, spikingNeurons: frame.spikingNeurons,
  });
}

// ---------------------------------------------------------------- 시나리오·조작
function startScenario() {
  habitat.addFood("sweet", 2.5, -1.5);
  habitat.addFood("sweet", -3, 3);
  habitat.addFood("bitter", -2.5, -3.5);
}

function placeFood(kind: FoodKind, x?: number, z?: number) {
  if (mode === "replay") goLive();
  habitat.addFood(kind, x, z);
}

function setPaused(p: boolean) {
  paused = p;
  if (mode === "live") send({ type: p ? "pause" : "resume" });
  if (mode === "replay") replayPlaying = !p;
  updatePlayButton();
}

function updatePlayButton() {
  const playing = mode === "live" ? !paused : replayPlaying;
  $("btn-play").textContent = playing ? "일시정지" : "재생";
}

function goLive() {
  mode = "live";
  replayPlaying = false;
  paused = false;
  send({ type: "resume" });
  $("mode-chip").textContent = "실시간";
  $("mode-chip").className = "chip live";
  $("btn-live").hidden = true;
  map.clearTrail();
  for (const f of recorder.frames) map.pushTrail(f.state.x, f.state.z);
  updatePlayButton();
}

function goReplay(t: number) {
  if (mode === "live") {
    send({ type: "pause" });
    for (const g of SENSORY_GROUPS) sendStim(g, 0);
  }
  mode = "replay";
  playhead = t;
  replayPlaying = false;
  $("mode-chip").textContent = "재시청";
  $("mode-chip").className = "chip replay";
  $("btn-live").hidden = false;
  updatePlayButton();
}

$("btn-play").onclick = () => {
  if (mode === "replay") {
    replayPlaying = !replayPlaying;
    updatePlayButton();
  } else setPaused(!paused);
};
$("btn-food").onclick = () => placeFood("sweet");
$("btn-bitter").onclick = () => placeFood("bitter");
$("btn-threat").onclick = () => {
  if (mode === "replay") goLive();
  habitat.threat(worldTime);
};
$("btn-pet").onclick = () => {
  if (mode === "replay") goLive();
  habitat.pet(worldTime);
};
$("btn-light").onclick = () => {
  habitat.ambientLight = !habitat.ambientLight;
  $("btn-light").setAttribute("aria-pressed", String(habitat.ambientLight));
};
$("btn-reset").onclick = () => {
  send({ type: "reset" });
  habitat.reset();
  controller.reset();
  recorder.clear();
  map.clearTrail();
  worldTime = 0;
  if (mode === "replay") goLive();
  startScenario();
};
$("btn-live").onclick = goLive;
$("rotate-toggle").onclick = () => {
  const btn = $("rotate-toggle");
  const on = btn.getAttribute("aria-pressed") !== "true";
  btn.setAttribute("aria-pressed", String(on));
  neural?.setAutoRotate(on);
};

const timeline = $<HTMLInputElement>("timeline");
timeline.addEventListener("input", () => {
  if (!recorder.frames.length) return;
  const t = recorder.start + (Number(timeline.value) / 1000) * (recorder.end - recorder.start);
  goReplay(t);
});

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === "Space") {
    e.preventDefault();
    $("btn-play").click();
  } else if (e.key === "f") placeFood("sweet");
  else if (e.key === "t") $("btn-threat").click();
  else if (e.key === "p") $("btn-pet").click();
});

function sendStim(group: SensoryGroup, rate: number) {
  const prev = sentStim[group];
  if (Math.abs(rate - prev) < 4 && (rate > 0) === (prev > 0)) return;
  sentStim[group] = rate;
  send({ type: "stim", group, rate });
}

// ---------------------------------------------------------------- 루프
let lastTime = performance.now();
let uiClock = 0;

function frameLoop(now: number) {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  if (mode === "live") {
    // 뇌 시뮬이 실시간보다 느리면 세계도 같은 비율로 느려진다
    const worldDt = ready && !paused ? dt * Math.min(simSpeed, 1) : 0;
    if (worldDt > 0) {
      controller.update(worldDt, worldTime, habitat);
      worldTime += worldDt;
      const rates = habitat.sense(controller.state, worldTime, controller.state.hunger);
      for (const g of SENSORY_GROUPS) sendStim(g, rates[g]);
      map.pushTrail(controller.state.x, controller.state.z);
    }
    body.render(worldDt, controller.state, habitat.foods);
    map.draw(controller.state, habitat.foods);
  } else {
    if (replayPlaying) {
      playhead += dt;
      if (playhead >= recorder.end) goLive();
    }
    const idx = recorder.indexAt(playhead);
    const f = recorder.frames[idx];
    if (f) {
      // 멈춰서 탐색할 때도 dt 를 줘야 포즈 블렌딩이 기록된 행동으로 수렴한다
      body.render(dt, f.state, f.foods);
      map.setTrail(recorder.frames.slice(Math.max(0, idx - 600), idx + 1).map((r) => [r.state.x, r.state.z]));
      map.draw(f.state, f.foods);
      if (meta && neural && idx !== replayIdx) {
        neural.setActivity(recorder.activityOf(f, meta.neurons));
        replayIdx = idx;
      }
    }
  }
  neural?.render();

  uiClock += dt;
  if (uiClock > 0.1) {
    uiClock = 0;
    updateUi();
  }
  requestAnimationFrame(frameLoop);
}
let replayIdx = -1;
requestAnimationFrame(frameLoop);

// 개발 중 콘솔에서 상태를 만져 볼 수 있게
if (import.meta.env.DEV) Object.assign(window, { yumeka: { controller, habitat, recorder } });

const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

function updateUi() {
  const live = mode === "live";
  const rec = live ? undefined : recorder.frames[recorder.indexAt(playhead)];
  const state = rec?.state ?? controller.state;
  const motor = rec?.motor ?? controller.rates;

  for (const g of MOTOR_GROUPS) {
    const el = meterEls.get(g)!;
    const hz = motor[g];
    el.fill.style.width = `${Math.min(100, (hz / METER_MAX_HZ) * 100)}%`;
    el.val.textContent = `${hz.toFixed(0)} Hz`;
    el.row.classList.toggle("on", hz >= 1);
  }
  for (const g of SENSORY_GROUPS) {
    const rate = live ? sentStim[g] : 0;
    const chip = stimEls.get(g)!;
    chip.classList.toggle("on", rate > 0);
    chip.textContent = rate > 0 ? `${SENSORY_LABEL[g]} ${rate.toFixed(0)} Hz` : SENSORY_LABEL[g];
  }

  if (live && lastFrame) {
    $("stat-mean").textContent = `${lastFrame.meanRate.toFixed(3)} Hz`;
    $("stat-spiking").textContent = lastFrame.spikingNeurons.toLocaleString();
    $("stat-active").textContent = lastFrame.activeNeurons.toLocaleString();
    $("stat-speed").textContent = paused ? "정지" : `${simSpeed.toFixed(2)}×`;
    $("top-dn").textContent = lastFrame.topLabeled.length
      ? `활발: ${lastFrame.topLabeled.map(([n, hz]) => `${n} ${hz.toFixed(0)}`).join(" · ")}`
      : "활발한 하강뉴런 없음";
  } else if (rec) {
    $("stat-mean").textContent = `${rec.stats.meanRate.toFixed(3)} Hz`;
    $("stat-spiking").textContent = rec.stats.spikingNeurons.toLocaleString();
    $("stat-active").textContent = "–";
    $("stat-speed").textContent = "재시청";
    $("top-dn").textContent = "기록된 발화 패턴을 다시 보는 중";
  }

  const shown = Controller.displayBehavior(state);
  $("behavior").textContent = BEHAVIOR_LABEL[shown];
  $("cause").textContent = state.cause || " ";
  $("stat-vel").textContent = `${state.speed.toFixed(2)} m/s`;
  $("stat-turn").textContent = `${((state.angVel * 180) / Math.PI).toFixed(0)}°/s`;
  $("g-hunger").style.width = `${state.hunger * 100}%`;
  $("g-fatigue").style.width = `${state.fatigue * 100}%`;
  $("pos").textContent = `위치 x ${state.x.toFixed(1)} m, z ${state.z.toFixed(1)} m · 방향 ${((state.heading * 180) / Math.PI).toFixed(0)}°`;

  const span = recorder.end - recorder.start;
  if (live) {
    timeline.value = "1000";
    $("time-label").textContent = `${fmt(span)} / ${recorder.duration} s`;
  } else {
    timeline.value = String(span > 0 ? ((playhead - recorder.start) / span) * 1000 : 1000);
    $("time-label").textContent = `${fmt(playhead - recorder.start)} / ${fmt(span)}`;
  }
}
