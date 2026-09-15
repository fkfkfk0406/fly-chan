import "./style.css";
import { BEHAVIOR_LABEL, Controller } from "./behavior/Controller.ts";
import { BodyScene } from "./body/BodyScene.ts";
import { createFallbackRig, loadVrmRig } from "./body/Rig.ts";
import { NeuralField } from "./brain/NeuralField.ts";
import { Care } from "./care/Care.ts";
import { MOTOR_GROUPS, SENSORY_GROUPS, type Meta, type MotorGroup, type SensoryGroup } from "./sim/data.ts";
import { NO_ADAPTATION } from "./sim/lif-engine.ts";
import type { FromWorker, SimFrame, ToWorker } from "./sim/protocol.ts";
import { Habitat, type FoodKind } from "./world/Habitat.ts";

const params = new URLSearchParams(location.search);
// 적분 간격. ?dt=0.25 처럼 바꿀 수 있다 (작을수록 정확하지만 느림)
const DT_MS = Number(params.get("dt")) || 0.5;
// 발화 빈도 적응 (원 모델에 없음). ?adapt=300:1 → τw 300 ms, 발화당 1 mV. 기본은 끔
const [TAU_W, B_ADAPT] = (params.get("adapt") ?? "").split(":").map(Number);
const ADAPTATION = TAU_W > 0 && B_ADAPT > 0 ? { tauW: TAU_W, b: B_ADAPT } : NO_ADAPTATION;
// 돌봄 시간 배속. ?time=60 이면 1분이 1시간
const TIME_SCALE = Number(params.get("time")) || 1;
const BASE = import.meta.env.BASE_URL;
const MAX_FOODS = 3;

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
const care = Care.load(Date.now(), TIME_SCALE);
const habitat = new Habitat();
habitat.lightsOn = care.s.lightsOn;
const controller = new Controller();
if (care.s.asleep) controller.placeAsleep();
let meta: Meta | undefined;
let neural: NeuralField | undefined;
let ready = false;
let simRunning = true;
let worldTime = 0;
let simSpeed = 0;
let lastFrame: SimFrame | undefined;
const sentStim: Record<SensoryGroup, number> = { sugar: 0, bitter: 0, jo_touch: 0, looming: 0, light: 0 };

// ---------------------------------------------------------------- 말풍선
let bubbleUntil = 0;
let nextAmbient = 4;
function say(text: string | null, seconds = 2.2) {
  if (!text) return;
  $("bubble").textContent = text;
  $("bubble").hidden = false;
  bubbleUntil = performance.now() / 1000 + seconds;
}
controller.onEvent = (e) => {
  say(care.on(e, Date.now()));
  // 먹고 나면 딸기 자리에 과즙 얼룩이 남는다
  const food = e === "ate" ? habitat.nearest(controller.state, "sweet") : null;
  if (food) care.addMess("stain", food.food.x + 0.15, food.food.z + 0.1);
};

// ---------------------------------------------------------------- 방
const body = new BodyScene($("room"));
body.onPet = () => pet();
body.onCleanMess = (id) => say(care.clean(Date.now(), id));

loadVrmRig(`${BASE}models/onna.vrm`)
  .catch((err) => {
    console.warn("VRM 로드 실패, 도형 인형으로 대체합니다:", err);
    return createFallbackRig();
  })
  .then((rig) => body.setRig(rig));

// ---------------------------------------------------------------- 뇌 패널 요소
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
  $("stim").appendChild(chip);
  stimEls.set(g, chip);
}

// ---------------------------------------------------------------- 워커
const worker = new Worker(new URL("./sim/sim.worker.ts", import.meta.url), { type: "module" });
const send = (msg: ToWorker) => worker.postMessage(msg);

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case "progress":
      $("load-bar").style.width = `${(msg.loaded / msg.total) * 100}%`;
      $("load-label").textContent = `온나의 뇌를 깨우는 중… ${(msg.loaded / 1e6).toFixed(0)} / ${(msg.total / 1e6).toFixed(0)} MB`;
      break;
    case "ready":
      meta = msg.meta;
      $("neuron-title").textContent = `온나의 뇌 · 뉴런 ${meta.neurons.toLocaleString()}개`;
      $("source").textContent =
        `FlyWire v783 · 시냅스 ${(meta.synapses / 1e6).toFixed(1)}M · LIF dt ${DT_MS} ms` +
        (ADAPTATION.b ? ` · 적응 ${ADAPTATION.tauW} ms/${ADAPTATION.b} mV` : "") +
        (TIME_SCALE !== 1 ? ` · 시간 ${TIME_SCALE}배속` : "");
      $("overlay").hidden = true;
      ready = true;
      say(care.s.asleep ? "💤" : care.s.hunger > 0.75 ? "배고파…" : "안녕!");
      break;
    case "frame":
      onFrame(msg);
      break;
    case "error":
      $("overlay").hidden = false;
      $("overlay").querySelector(".loading")!.classList.add("error");
      $("load-label").textContent = msg.message;
      break;
  }
};
send({ type: "init", dt: DT_MS, adaptation: ADAPTATION });

function onFrame(frame: SimFrame) {
  lastFrame = frame;
  simSpeed = frame.speed;
  if (!ready) return;
  controller.ingest(frame.motor, frame.simDelta);
  if (neural) neural.setActivity(frame.activity);
}

async function openBrain() {
  if (!meta || neural) return;
  const [pos, cls] = await Promise.all([
    fetch(`${BASE}data/neurons_pos.f32`).then((r) => r.arrayBuffer()),
    fetch(`${BASE}data/neurons_class.u8`).then((r) => r.arrayBuffer()),
  ]);
  neural = new NeuralField($("neural-view"), new Float32Array(pos), new Uint8Array(cls), meta.classes);
}

// ---------------------------------------------------------------- 돌봄
function giveFood(kind: FoodKind) {
  if (!ready) return;
  if (care.s.asleep) return say("쿨쿨…");
  if (habitat.foods.length >= MAX_FOODS) habitat.foods.shift();
  habitat.addFoodInFront(controller.state, kind, 1);
  if (kind === "bitter") care.log(Date.now(), "쓴 버섯을 줘 봤어요.");
}

function pet() {
  if (!ready) return;
  habitat.pet(worldTime);
  if (!controller.wakeUp()) say(care.on("petted", Date.now()));
}

function toggleLights() {
  care.setLights(!care.s.lightsOn, Date.now());
  habitat.lightsOn = care.s.lightsOn;
  updateLightButton();
}

function updateLightButton() {
  $("btn-light").querySelector("em")!.textContent = care.s.lightsOn ? "불 끄기" : "불 켜기";
}

function togglePanel(id: "brain-panel" | "diary-panel", open?: boolean) {
  const panel = $(id);
  const show = open ?? panel.hidden;
  panel.hidden = !show;
  if (id === "brain-panel") {
    $("btn-brain").setAttribute("aria-expanded", String(show));
    if (show) openBrain();
  } else if (show) renderDiary();
}

const prankMenu = $("prank-menu");
const setPrank = (open: boolean) => {
  prankMenu.hidden = !open;
  $("btn-prank").setAttribute("aria-expanded", String(open));
};

$("btn-feed").onclick = () => giveFood("sweet");
$("btn-pet").onclick = pet;
$("btn-clean").onclick = () => say(care.clean(Date.now()));
$("btn-prank").onclick = () => setPrank(prankMenu.hidden !== false);
$("btn-bitter").onclick = () => {
  setPrank(false);
  giveFood("bitter");
};
$("btn-scare").onclick = () => {
  setPrank(false);
  if (ready) habitat.threat(worldTime);
};
$("btn-light").onclick = toggleLights;
$("btn-brain").onclick = () => togglePanel("brain-panel");
$("btn-diary").onclick = () => togglePanel("diary-panel");
for (const btn of document.querySelectorAll<HTMLElement>("[data-close]")) {
  btn.onclick = () => togglePanel(btn.dataset.close as "brain-panel" | "diary-panel", false);
}
$("rotate-toggle").onclick = () => {
  const on = $("rotate-toggle").getAttribute("aria-pressed") !== "true";
  $("rotate-toggle").setAttribute("aria-pressed", String(on));
  neural?.setAutoRotate(on);
};
$("sim-toggle").onclick = () => {
  simRunning = !simRunning;
  send({ type: simRunning ? "resume" : "pause" });
  $("sim-toggle").setAttribute("aria-pressed", String(simRunning));
  $("sim-toggle").textContent = simRunning ? "시뮬 실행 중" : "시뮬 멈춤";
};
$("btn-restart").onclick = () => {
  if (!confirm("지금까지의 애정과 일기가 모두 사라져요. 처음부터 다시 키울까요?")) return;
  care.reset(Date.now());
  controller.state = Controller.initialState();
  habitat.foods = [];
  habitat.lightsOn = true;
  send({ type: "reset" });
  updateLightButton();
  renderDiary();
  say("안녕!");
};
updateLightButton();

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    togglePanel("brain-panel", false);
    togglePanel("diary-panel", false);
    setPrank(false);
  } else if (e.key === "f") giveFood("sweet");
  else if (e.key === "p") pet();
  else if (e.key === "c") say(care.clean(Date.now()));
  else if (e.key === "l") toggleLights();
  else if (e.key === "b") togglePanel("brain-panel");
});

function sendStim(group: SensoryGroup, rate: number) {
  const prev = sentStim[group];
  if (Math.abs(rate - prev) < 4 && (rate > 0) === (prev > 0)) return;
  sentStim[group] = rate;
  send({ type: "stim", group, rate });
}

// ---------------------------------------------------------------- 저장
const save = () => care.save(Date.now());
setInterval(save, 10_000);
window.addEventListener("pagehide", save);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) save();
});

// ---------------------------------------------------------------- 루프
let lastTime = performance.now();
let uiClock = 0;

function frameLoop(now: number) {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  care.passTime(dt);
  // 뇌 시뮬이 실시간보다 느리면 몸도 같은 비율로 느려진다
  const worldDt = ready && simRunning ? dt * Math.min(simSpeed, 1) : 0;
  if (worldDt > 0) {
    controller.update(worldDt, worldTime, habitat, care);
    worldTime += worldDt;
    const rates = habitat.sense(controller.state, worldTime, care.s.hunger, care.s.asleep);
    for (const g of SENSORY_GROUPS) sendStim(g, rates[g]);
  }
  body.render(dt, controller.state, habitat.foods, care.s.messes, care.s.lightsOn, care.s.mood);
  if (!$("brain-panel").hidden) neural?.render();

  // 말풍선: 이벤트 대사가 없으면 가끔 속마음
  const t = now / 1000;
  if (ready && t > bubbleUntil) {
    if (care.s.asleep) say("💤", 0.2);
    else if (t > nextAmbient) {
      nextAmbient = t + 7 + Math.random() * 6;
      const s = care.s;
      say(s.hunger > 0.75 ? "배고파…" : s.sleepiness > 0.8 ? "졸려…" : care.cleanliness < 0.5 ? "방이 지저분해…" : s.mood < 0.3 ? "흥…" : s.mood > 0.8 ? "♪" : null);
    } else $("bubble").hidden = true;
  }
  const anchor = $("bubble").hidden ? null : body.bubbleAnchor();
  if (anchor) Object.assign($("bubble").style, { left: `${anchor.x}px`, top: `${anchor.y}px` });

  uiClock += dt;
  if (uiClock > 0.1) {
    uiClock = 0;
    updateUi();
  }
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);

// 개발 중 콘솔에서 상태를 만져 볼 수 있게
if (import.meta.env.DEV) Object.assign(window, { onna: { controller, habitat, care } });

// ---------------------------------------------------------------- UI 갱신
function setGauge(id: string, value: number) {
  const bar = $(id);
  bar.style.width = `${Math.round(value * 100)}%`;
  bar.classList.toggle("low", value < 0.25);
  bar.closest("li")!.title = `${Math.round(value * 100)}%`;
}

function updateUi() {
  const s = care.s;
  setGauge("g-full", 1 - s.hunger);
  setGauge("g-energy", 1 - s.sleepiness);
  setGauge("g-mood", s.mood);
  setGauge("g-clean", care.cleanliness);
  setGauge("g-love", s.affection);
  $("days").textContent = `함께한 지 ${care.daysTogether(Date.now())}일`;

  const state = controller.state;
  const label = BEHAVIOR_LABEL[Controller.displayBehavior(state)];
  const status = $("status");
  if (ready) {
    const strong = document.createElement("strong");
    strong.textContent = label;
    status.replaceChildren(strong, state.cause);
  }

  if ($("brain-panel").hidden) return;
  $("now-behavior").textContent = label;
  $("now-cause").textContent = state.cause || " ";
  for (const g of MOTOR_GROUPS) {
    const el = meterEls.get(g)!;
    const hz = controller.rates[g];
    el.fill.style.width = `${Math.min(100, (hz / METER_MAX_HZ) * 100)}%`;
    el.val.textContent = `${hz.toFixed(0)} Hz`;
    el.row.classList.toggle("on", hz >= 1);
  }
  for (const g of SENSORY_GROUPS) {
    const rate = sentStim[g];
    const chip = stimEls.get(g)!;
    chip.classList.toggle("on", rate > 0);
    chip.textContent = rate > 0 ? `${SENSORY_LABEL[g]} ${rate.toFixed(0)} Hz` : SENSORY_LABEL[g];
  }
  if (lastFrame) {
    $("stat-mean").textContent = `${lastFrame.meanRate.toFixed(3)} Hz`;
    $("stat-spiking").textContent = lastFrame.spikingNeurons.toLocaleString();
    $("stat-active").textContent = lastFrame.activeNeurons.toLocaleString();
    $("stat-speed").textContent = simRunning ? `${simSpeed.toFixed(2)}×` : "멈춤";
    $("top-dn").textContent = lastFrame.topLabeled.length
      ? `활발: ${lastFrame.topLabeled.map(([n, hz]) => `${n} ${hz.toFixed(0)}`).join(" · ")}`
      : "활발한 하강뉴런 없음";
  }
}

function renderDiary() {
  const now = Date.now();
  const s = care.s;
  const stats = [
    ["함께한 날", `${care.daysTogether(now)}일`],
    ["애정", `${Math.round(s.affection * 100)}%`],
    ["기분", `${Math.round(s.mood * 100)}%`],
    ["청결", `${Math.round(care.cleanliness * 100)}%`],
  ].map(([k, v]) => {
    const div = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = k;
    dd.textContent = v;
    div.append(dt, dd);
    return div;
  });
  $("diary-stats").replaceChildren(...stats);

  const today = new Date(now).toDateString();
  $("diary-list").replaceChildren(
    ...s.diary.map(({ t, text }) => {
      const d = new Date(t);
      const hm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
      const li = document.createElement("li");
      const time = document.createElement("time");
      time.dateTime = d.toISOString();
      time.textContent = d.toDateString() === today ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
      const span = document.createElement("span");
      span.textContent = text;
      li.append(time, span);
      return li;
    }),
  );
}
