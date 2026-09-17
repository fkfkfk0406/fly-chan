import "./style.css";
import { BEHAVIOR_LABEL, Controller } from "./behavior/Controller.ts";
import { BodyScene } from "./body/BodyScene.ts";
import { FlyAvatar } from "./body/FlyAvatar.ts";
import { createFallbackRig, loadVrmRig } from "./body/Rig.ts";
import { delBlob, getBlob, putBlob } from "./util/blobStore.ts";
import { ATTEND_REWARDS, checkIn, claimQuests, questStatus } from "./care/Daily.ts";
import { MEMORIES } from "./story/memories.ts";
import { MiniGames, type GameResult } from "./ui/MiniGames.ts";
import { NeuralField } from "./brain/NeuralField.ts";
import { Raster } from "./brain/Raster.ts";
import {
  ACHIEVEMENTS, COSMETICS, Care, DAILY_AFFECTION_CAP, GIFT, SNACK_PRICE, STAGES, localDay,
  type Achievement, type CosmeticId, type Totals,
} from "./care/Care.ts";
import { DEFAULT_NAMES, cleanName, hasBatchim, personalize } from "./story/personalize.ts";
import { mutter } from "./story/scripts.ts";
import { burst } from "./fx/Hearts.ts";
import { Sfx } from "./fx/Sfx.ts";
import { Director } from "./story/Director.ts";
import { KonamiDetector, SCIENTIFIC_NAME_SCENE, is404, isScientificName, specialDay } from "./story/EasterEggs.ts";
import { DialogBox } from "./ui/DialogBox.ts";
import { MOTOR_GROUPS, SENSORY_GROUPS, type Meta, type MotorGroup, type SensoryGroup } from "./sim/data.ts";
import { NO_ADAPTATION } from "./sim/lif-engine.ts";
import type { FromWorker, SimFrame, ToWorker } from "./sim/protocol.ts";
import { hourOf } from "./world/Clock.ts";
import { Habitat, SNACKS, type FoodKind } from "./world/Habitat.ts";

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
  sugar: "당 GRN", bitter: "쓴맛 GRN", water: "물 GRN", pharynx_sugar: "인두 당 GRN", ir94e: "Ir94e(짠맛)",
  jo_touch: "JO-F 접촉", looming: "LPLC2 루밍", light: "R7/R8 빛", pc1: "pC1 설렘",
  clock_lnv: "시계 LNv(아침)", clock_lnd: "시계 LNd(저녁)", clock_dn1: "시계 DN1(새벽·해질녘)",
};
const METER_MAX_HZ = 150;

// ---------------------------------------------------------------- 상태
const care = Care.load(Date.now(), TIME_SCALE);
// 테스트용: ?hearts=999 로 하트를 채운다
if (params.has("hearts")) care.s.hearts = Math.max(0, Number(params.get("hearts")) || 0);
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
const sentStim = Object.fromEntries(SENSORY_GROUPS.map((g) => [g, 0])) as Record<SensoryGroup, number>;

// ---------------------------------------------------------------- 연출
const sfx = new Sfx();
const body = new BodyScene($("room"));

/** 캐릭터 머리 위 화면 좌표 (없으면 화면 가운데) */
const anchor = () => body.bubbleAnchor() ?? { x: innerWidth / 2, y: innerHeight / 2 };

let bubbleUntil = 0;
let nextAmbient = 4;
function say(text: string | null, seconds = 2.2, silent = false) {
  if (!text) return;
  if (!silent && $("bubble").textContent !== text) sfx.pop();
  $("bubble").textContent = text;
  $("bubble").hidden = false;
  bubbleUntil = performance.now() / 1000 + seconds;
}

/** 몸에 걸칠 것: 산 꾸미기 + 이스터에그 장식 */
const worn = () => (care.s.title ? [...care.s.owned, "berryhat"] : care.s.owned);

/** 이스터에그: 대사는 매번, 하트 보상과 일기는 처음 한 번만 */
function egg(id: string, reward: number, note: string, line?: string) {
  if (line) say(line, 4);
  if (care.findEgg(id, Date.now(), reward, note)) {
    sfx.levelUp();
    burst(innerWidth / 2, innerHeight * 0.42, 10, ["🥚", "✨", "💖"]);
  }
}

/** 새로 달성한 업적을 알린다 */
function celebrate(list: Achievement[]) {
  list.forEach((a, k) =>
    setTimeout(() => {
      say(`업적 달성! ${a.emoji} ${a.name} (+${a.reward}💖)`, 3.5);
      sfx.levelUp();
      burst(innerWidth / 2, innerHeight * 0.4, 10, [a.emoji, "✨", "💖"]);
    }, k * 1800),
  );
}
/** 돌봄 기록을 남기고 업적을 확인한다 (amount 0 이면 확인만) */
const rec = (kind: keyof Totals, amount = 1) => {
  celebrate(care.record(kind, Date.now(), amount));
  finishQuests();
};

/** 오늘의 부탁을 끝냈으면 알린다 */
function finishQuests() {
  const { done, bonus } = claimQuests(care, Date.now());
  if (!done.length) return;
  sfx.levelUp();
  say(bonus ? "오늘 부탁 다 들어줬네! 고마워♡" : `부탁 들어줘서 고마워! (${done.map((q) => q.label).join(", ")})`, 3);
  burst(innerWidth / 2, innerHeight * 0.45, bonus ? 12 : 5, ["📋", "💖"]);
}

controller.onEvent = (e) => {
  // 손 뻗기 게임에서 도망가는 건 벌점 없이 게임 결과로만 친다
  if (e === "scared" && games.active) return sfx.jump();
  say(care.on(e, Date.now()));
  const at = anchor();
  switch (e) {
    case "ate": {
      earn(2);
      rec("meals");
      care.s.sweetStreak = (controller.eatingKind ?? "sweet") === "sweet" ? care.s.sweetStreak + 1 : 0;
      if (care.s.sweetStreak >= 10 && !care.s.title) {
        care.s.title = "딸기 요정";
        body.setCosmetics(worn());
        egg("berry-fairy", 30, "딸기 연속 10개", "딸기 10개 연속…! 오늘부터 난 🍓딸기 요정이야!");
      }
      sfx.chew();
      burst(at.x, at.y, 2, ["♪"]);
      const kind = controller.eatingKind ?? "sweet";
      if ((kind === "sweet" || kind === "honey") && care.soothe(0.35, Date.now())) setTimeout(() => say("…맛있으니까 봐줄게", 3), 1200);
      const label = SNACKS[kind].label;
      care.log(Date.now(), `${label}${hasBatchim(label) ? "을" : "를"} ${kind === "water" ? "마셨어요" : "먹었어요"}.`);
      // 달콤한 간식은 먹은 자리에 끈적한 얼룩을 남긴다
      const food = kind === "sweet" || kind === "honey" ? habitat.nearest(controller.state, kind) : null;
      if (food) care.addMess("stain", food.food.x + 0.15, food.food.z + 0.1);
      break;
    }
    case "scared":
      rec("scares");
      sfx.jump();
      burst(at.x, at.y, 3, ["!", "💦"]);
      break;
    case "bitter":
      sfx.sad();
      if (care.s.avatar === "fly") egg("fly-bitter", 10, "초파리 모습으로 쓴 버섯", "초파리여도 쓴 건 싫거든?");
      break;
    case "woken":
      sfx.sad();
      break;
    case "wake":
      director.greetIfNeeded(Date.now());
      break;
    case "sleep":
      rec("sleeps");
      break;
  }
};

function cleanUp(id?: number) {
  const before = care.s.messes.length;
  say(care.clean(Date.now(), id));
  if (care.s.messes.length < before) {
    earn((before - care.s.messes.length) * 2);
    rec("cleans", before - care.s.messes.length);
    sfx.sparkle();
    const at = anchor();
    burst(at.x, at.y, id === undefined ? 8 : 3, ["✨", "✦"]);
  }
}

// ---------------------------------------------------------------- 대화
const dialog = new DialogBox($("dialog"), {
  onOpen: () => {
    setSnackMenu(false);
    document.body.classList.add("talking");
    controller.talking = true;
    body.setFocus(true);
    setPrank(false);
  },
  onClose: () => {
    document.body.classList.remove("talking");
    controller.talking = false;
    body.setFocus(false);
    body.setTalking(false);
  },
  onExpr: (expr) => body.setExpression(expr),
  onTyping: (typing) => body.setTalking(typing),
  onTick: () => sfx.tick(),
  onChoice: (choice) => {
    earn(1);
    sfx.choice();
    // 대화로 오르는 애정은 하루 다섯 번까지만
    const talks = care.todayStats(Date.now()).talks;
    care.bump(choice.mood ?? 0, talks <= 5 ? choice.affection ?? 0 : 0); // 하루 상한은 Care 가 한 번 더 건다
    if ((choice.affection ?? 0) > 0) care.thrillUp(0.25);
    if (choice.sulk && care.soothe(choice.sulk, Date.now())) sfx.sparkle();
    if ((choice.affection ?? 0) > 0 || (choice.mood ?? 0) > 0) {
      const at = anchor();
      burst(at.x, at.y, 4);
    }
  },
});
const director = new Director(care, dialog);
director.onStageUp = (stage) => {
  care.thrillUp(1);
  sfx.levelUp();
  burst(innerWidth / 2, innerHeight * 0.45, 14, ["♥", "💕", "✨"]);
  $("stage").textContent = `💞 ${STAGES[stage].name}`;
  setTimeout(() => rec("talks", 0), 4000); // 관계 단계 업적
};

// ---------------------------------------------------------------- 방
body.onPet = () => pet();
body.onCleanMess = (id) => cleanUp(id);

// ---------------------------------------------------------------- 외형
type AvatarKind = "girl" | "fly" | "custom";
let avatarLoading = false;

async function applyAvatar(kind: AvatarKind): Promise<boolean> {
  if (avatarLoading) return false;
  avatarLoading = true;
  try {
    if (body.hasAvatar(kind)) body.useAvatar(kind);
    else if (kind === "fly") body.setRig(new FlyAvatar(), "fly");
    else if (kind === "custom") {
      const blob = await getBlob("custom-vrm");
      if (!blob) throw new Error("저장된 VRM 이 없어요");
      const url = URL.createObjectURL(blob);
      body.setRig(await loadVrmRig(url), "custom");
      URL.revokeObjectURL(url);
    } else {
      const rig = await loadVrmRig(`${BASE}models/onna.vrm`).catch((err) => {
        console.warn("VRM 로드 실패, 도형 인형으로 대체합니다:", err);
        return createFallbackRig();
      });
      body.setRig(rig, "girl");
    }
    care.s.avatar = kind;
    body.setCosmetics(worn()); // 산 꾸미기 아이템 복원
    if (care.s.photo) body.setPhoto(care.s.photo);
    return true;
  } catch (err) {
    console.warn("외형을 바꾸지 못했어요:", err);
    say("그 모습은 불러올 수 없어…");
    return false;
  } finally {
    avatarLoading = false;
  }
}

void applyAvatar(care.s.avatar).then((ok) => {
  if (!ok) void applyAvatar("girl");
});

$<HTMLInputElement>("vrm-file").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  await putBlob("custom-vrm", file);
  body.forgetAvatar("custom");
  if (await applyAvatar("custom")) {
    care.log(Date.now(), `새 모습(${file.name})으로 바꿨어요.`);
    sfx.sparkle();
  }
  renderShop();
});

// ---------------------------------------------------------------- 뇌 패널 요소
const meterEls = new Map<MotorGroup, { row: HTMLElement; fill: HTMLElement; val: HTMLElement }>();
for (const g of MOTOR_GROUPS) {
  const row = document.createElement("div");
  row.className = "meter";
  row.title = MOTOR_LABEL[g][1];
  row.innerHTML = `<span class="name">${MOTOR_LABEL[g][0]}</span><span class="track"><span class="fill"></span></span><span class="val">0 Hz</span>`;
  $("meters").appendChild(row);
  meterEls.set(g, { row, fill: row.querySelector(".fill")!, val: row.querySelector(".val")! });
  if (g === "feed") {
    let taps: number[] = [];
    row.addEventListener("click", () => {
      const t = performance.now();
      taps = [...taps.filter((x) => t - x < 3000), t];
      if (taps.length >= 5) {
        taps = [];
        egg("mn9", 15, "MN9 연타", "MN9 그만 눌러… 배고파지잖아!");
      }
    });
  }
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
      raster.setNames(msg.probeNames);
      meta = msg.meta;
      applyNames();
      $("source").textContent =
        `FlyWire v783 · 시냅스 ${(meta.synapses / 1e6).toFixed(1)}M · LIF dt ${DT_MS} ms` +
        (ADAPTATION.b ? ` · 적응 ${ADAPTATION.tauW} ms/${ADAPTATION.b} mV` : "") +
        (TIME_SCALE !== 1 ? ` · 시간 ${TIME_SCALE}배속` : "");
      ready = true;
      $("load-label").textContent = care.named ? "" : "이름을 지어 주면 깨어나요";
      if (care.named) wakeUp();
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

const raster = new Raster($<HTMLCanvasElement>("raster"));

function onFrame(frame: SimFrame) {
  raster.push(frame.probes, frame.simTime);
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

// ---------------------------------------------------------------- 이름·첫 만남
const charName = () => care.s.name || DEFAULT_NAMES.name;

function applyNames() {
  const name = charName();
  for (const el of document.querySelectorAll("[data-name]")) el.textContent = name;
  for (const el of document.querySelectorAll("[data-name-upper]")) el.textContent = name.toUpperCase();
  document.title = `${name} · 초파리 뇌를 가진 소녀`;
  if (meta) $("neuron-title").textContent = `${name}의 뇌 · 뉴런 ${meta.neurons.toLocaleString()}개`;
}

/** 뇌가 준비되고 이름도 지었으면 방을 보여 준다 */
function wakeUp() {
  if (!ready || !care.named) return;
  $("overlay").hidden = true;
  setTimeout(() => rec("photos", 0), 6000); // 함께한 날 등 시간으로 달성하는 업적
  const got = care.collectPending(Date.now());
  if (got > 0) {
    say(`기다리면서 하트 ${got}개 모았어!`, 3);
    setTimeout(() => burst(innerWidth / 2, innerHeight * 0.5, Math.min(10, got), ["💖"]), 400);
  }
  const stamp = checkIn(care, Date.now());
  if (stamp) {
    setTimeout(() => {
      say(`출석 ${stamp.streak}일째! 하트 ${stamp.reward}개 줄게`, 3);
      burst(innerWidth / 2, innerHeight * 0.5, stamp.streak % 7 === 0 ? 14 : 5, ["📅", "💖"]);
    }, 1800);
  }
  showLetter(greet);
}

/** 자리를 비운 동안 남긴 편지를 보여 주고, 닫으면 then */
function showLetter(then: () => void) {
  const letter = care.s.letter;
  if (!letter) return then();
  const names = { name: charName(), me: care.s.callMe || DEFAULT_NAMES.me };
  const box = document.createElement("section");
  box.className = "letter";
  box.setAttribute("role", "dialog");
  for (const line of letter.lines) {
    const p = document.createElement("p");
    p.textContent = personalize(line, names);
    box.append(p);
  }
  const ok = document.createElement("button");
  ok.textContent = letter.gift ? `${SNACKS[letter.gift].emoji} 받고 닫기` : "고마워";
  ok.onclick = () => {
    if (letter.gift) care.s.stock[letter.gift]++;
    care.log(Date.now(), `✉️ ${charName()}의 편지를 읽었어요${letter.gift ? ` (${SNACKS[letter.gift].label} 선물)` : ""}.`);
    care.s.letter = null;
    box.remove();
    sfx.choice();
    then();
  };
  box.append(ok);
  document.body.append(box);
  sfx.sparkle();
}

/** 돌아왔을 때 인사 (특별한 날·이스터에그 포함) */
function greet() {
  const now = new Date();
  if (care.s.asleep) say("💤", 2, true);
  else if (is404(now)) {
    egg("404", 44, "새벽 4시 4분", "404… 뇌를 찾을 수 없어요… zzZ");
    setTimeout(() => director.greetIfNeeded(Date.now()), 4000);
  } else director.greetIfNeeded(Date.now());
  const special = specialDay(now, care.daysTogether());
  if (special && !care.s.eggs.includes(special.id)) {
    director.queueScene(special.scene);
    egg(special.id, special.reward, special.scene.id === "xmas" ? "크리스마스" : special.scene.id === "pi" ? "파이데이" : `함께한 지 ${care.daysTogether()}일`);
  }
  if (isScientificName(care.s.name) && !care.s.eggs.includes("name")) {
    director.queueScene(SCIENTIFIC_NAME_SCENE);
    egg("name", 20, "학명으로 이름 짓기");
  }
}

function showNaming() {
  $("overlay").hidden = false;
  $("naming").hidden = false;
  $<HTMLInputElement>("input-name").value = "";
  $<HTMLInputElement>("input-me").value = "";
  $("load-label").textContent = ready ? "" : "뇌를 깨우는 중…";
  $<HTMLInputElement>("input-name").focus();
}

$("naming").addEventListener("submit", (e) => {
  e.preventDefault();
  const now = Date.now();
  care.setNames(
    cleanName($<HTMLInputElement>("input-name").value, DEFAULT_NAMES.name),
    cleanName($<HTMLInputElement>("input-me").value, DEFAULT_NAMES.me),
    now,
  );
  care.save(now);
  $("naming").hidden = true;
  applyNames();
  if (!ready) $("load-label").textContent = `${charName()}의 뇌를 깨우는 중…`;
  wakeUp();
});
if (!care.named) showNaming();
applyNames();

// ---------------------------------------------------------------- 돌봄
function giveFood(kind: FoodKind) {
  if (!ready || dialog.open) return;
  if (care.s.asleep) return say("쿨쿨…");
  if (!care.takeSnack(kind)) {
    const label = SNACKS[kind].label;
    say(`${label}${hasBatchim(label) ? "이" : "가"} 없어…`);
    togglePanel("shop-panel", true);
    return;
  }
  if (habitat.foods.length >= MAX_FOODS) habitat.foods.shift();
  habitat.addFoodInFront(controller.state, kind, 1);
  const snack = SNACKS[kind];
  if (kind === "bitter" || kind === "salty") care.log(Date.now(), `${snack.label}${hasBatchim(snack.label) ? "을" : "를"} 줘 봤어요.`);
}

/** 돌봄으로 하트를 얻고, 얻었으면 하트 파티클 */
function earn(amount: number) {
  const got = care.earnHearts(amount);
  if (got > 0) {
    const at = anchor();
    burst(at.x, at.y + 20, 1, ["💖"]);
  }
}

function pet() {
  if (!ready || dialog.open) return;
  habitat.pet(worldTime);
  if (controller.wakeUp()) return;
  const line = care.on("petted", Date.now());
  say(line);
  if (line !== "그만 좀 해!" && line !== "흥…") {
    earn(1);
    care.thrillUp(0.2 + 0.3 * care.s.affection);
    rec("pets");
    if (care.s.totals.pets === 42) {
      egg("pet-42", 42, "42번째 쓰다듬기", "삶, 우주, 그리고 모든 것의 답… 42번째 쓰다듬기야!");
      burst(innerWidth / 2, innerHeight * 0.45, 20, ["💖"]);
    }
  }
  if (line !== "그만~") {
    sfx.pet();
    const at = anchor();
    burst(at.x, at.y, 3);
  }
}

function talk() {
  if (!ready || dialog.open) return;
  if (care.s.asleep) return say("쿨쿨…");
  if (controller.state.behavior === "escape") return;
  director.talk(Date.now());
  rec("talks");
}

const ALBUM_MAX = 12;

/** 📷 지금 화면을 저장하고, 작게 줄여 액자에 건다 */
function takePhoto() {
  if (!ready) return;
  const url = body.capture();
  const link = document.createElement("a");
  link.href = url;
  link.download = `${charName()}-${localDay(Date.now())}.png`;
  link.click();
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = Math.round((320 * img.height) / img.width);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    care.s.photo = c.toDataURL("image/jpeg", 0.75);
    body.setPhoto(care.s.photo);
    const t = Date.now();
    c.toBlob((blob) => {
      if (!blob) return;
      void putBlob(`photo-${t}`, blob);
      for (const old of care.s.album.slice(ALBUM_MAX - 1)) void delBlob(`photo-${old}`);
      care.s.album = [t, ...care.s.album].slice(0, ALBUM_MAX);
    }, "image/jpeg", 0.8);
  };
  img.src = url;
  document.body.classList.remove("flash");
  void document.body.offsetWidth; // 애니메이션 다시 시작
  document.body.classList.add("flash");
  sfx.sparkle();
  say("찰칵! 📷");
  rec("photos");
}

function toggleLights() {
  care.setLights(!care.s.lightsOn, Date.now());
  habitat.lightsOn = care.s.lightsOn;
  updateLightButton();
}

function updateLightButton() {
  $("btn-light").querySelector("em")!.textContent = care.s.lightsOn ? "불 끄기" : "불 켜기";
}

type PanelId = "brain-panel" | "diary-panel" | "shop-panel" | "album-panel";

function togglePanel(id: PanelId, open?: boolean) {
  const panel = $(id);
  const show = open ?? panel.hidden;
  // 서랍은 한 번에 하나만
  if (show) for (const other of ["brain-panel", "diary-panel", "shop-panel", "album-panel"] as PanelId[]) if (other !== id) $(other).hidden = true;
  panel.hidden = !show;
  if (id === "brain-panel") {
    $("btn-brain").setAttribute("aria-expanded", String(show));
    if (show) openBrain();
  } else if (show) {
    if (id === "diary-panel") renderDiary();
    else if (id === "album-panel") renderAlbum();
    else renderShop();
  }
}

const prankMenu = $("prank-menu");
const setPrank = (open: boolean) => {
  prankMenu.hidden = !open;
  $("btn-prank").setAttribute("aria-expanded", String(open));
};

const snackMenu = $("snack-menu");
const setSnackMenu = (open: boolean) => {
  snackMenu.hidden = !open;
  $("btn-feed").setAttribute("aria-expanded", String(open));
};
$("btn-feed").onclick = () => {
  setPrank(false);
  setSnackMenu(snackMenu.hidden !== false);
};
for (const btn of document.querySelectorAll<HTMLElement>("[data-snack]")) {
  btn.onclick = () => {
    setSnackMenu(false);
    giveFood(btn.dataset.snack as FoodKind);
  };
}
$("btn-pet").onclick = pet;
$("btn-clean").onclick = () => cleanUp();
$("btn-talk").onclick = talk;
const updateMute = () => {
  $("btn-mute").textContent = sfx.muted ? "🔇" : "🔊";
  $("btn-mute").setAttribute("aria-label", sfx.muted ? "소리 켜기" : "소리 끄기");
};
$("btn-mute").onclick = () => {
  sfx.setMuted(!sfx.muted);
  updateMute();
};
updateMute();
$("btn-prank").onclick = () => {
  setSnackMenu(false);
  setPrank(prankMenu.hidden !== false);
};
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
$("btn-album").onclick = () => togglePanel("album-panel");
$("btn-reach").onclick = () => startGame("reach");
$("btn-catch").onclick = () => startGame("catch");
$("btn-shop").onclick = () => togglePanel("shop-panel");
$("btn-photo").onclick = takePhoto;
for (const btn of document.querySelectorAll<HTMLElement>("[data-close]")) {
  btn.onclick = () => togglePanel(btn.dataset.close as PanelId, false);
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
  togglePanel("diary-panel", false);
  showNaming();
  controller.state = Controller.initialState();
  habitat.foods = [];
  habitat.lightsOn = true;
  send({ type: "reset" });
  updateLightButton();
  applyNames();
};
updateLightButton();

const konami = new KonamiDetector();
window.addEventListener("keydown", (e) => {
  if (konami.push(e.key) && ready) {
    togglePanel("brain-panel", true);
    setTimeout(() => neural?.flash(), 400);
    egg("konami", 30, "코나미 커맨드", "지금 내 뉴런… 13만 8천 개 다 켜졌어?!");
    return;
  }
  if (dialog.open || games.active) return;
  if (e.key === "Escape") {
    togglePanel("brain-panel", false);
    togglePanel("diary-panel", false);
    togglePanel("shop-panel", false);
    setPrank(false);
    setSnackMenu(false);
  } else if (e.key === "f") giveFood("sweet");
  else if (e.key === "p") pet();
  else if (e.key === "c") cleanUp();
  else if (e.key === "t") talk();
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
let lastBehavior = controller.state.behavior;
let uiClock = 0;

function frameLoop(now: number) {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  const hour = hourOf(Date.now());
  care.passTime(dt, hour);
  controller.sulking = care.s.sulk > 0 && !dialog.open;
  games.update(dt);
  // 뇌 시뮬이 실시간보다 느리면 몸도 같은 비율로 느려진다
  const worldDt = ready && simRunning ? dt * Math.min(simSpeed, 1) : 0;
  if (worldDt > 0) {
    controller.update(worldDt, worldTime, habitat, care);
    worldTime += worldDt;
    // 오늘 기록: 뇌 출력으로 먹거나 손질한 시간
    const b = controller.state.behavior;
    if (b === "groom" && lastBehavior !== "groom") rec("grooms");
    lastBehavior = b;
    if (b === "feed") care.todayStats(Date.now()).feedSec += worldDt;
    // 입에 닿은 간식의 MN9 반응을 기록한다 (안 먹어도 "맛은 봤다"로 남는다)
    const tasting = controller.eatingKind ?? habitat.tasting(controller.state);
    if (tasting && !care.s.asleep) care.noteTaste(tasting, controller.rates.feed);
    if (b === "groom") care.todayStats(Date.now()).groomSec += worldDt;
    const rates = habitat.sense(controller.state, worldTime, care.s.hunger, care.s.asleep, care.thrill, hour);
    for (const g of SENSORY_GROUPS) sendStim(g, rates[g]);
  }
  body.render(dt, controller.state, habitat.foods, care.s.messes, care.s.lightsOn, care.s.mood);
  const panelsOpen = !$("brain-panel").hidden || !$("diary-panel").hidden || !$("album-panel").hidden || games.active;
  director.update(Date.now(), ready && !care.s.asleep && !panelsOpen && controller.state.behavior === "walk");
  if (!$("brain-panel").hidden) {
    neural?.render();
    raster.draw();
  }

  // 말풍선: 이벤트 대사가 없으면 가끔 속마음
  const t = now / 1000;
  if (ready && t > bubbleUntil) {
    if (care.s.asleep) say("💤", 0.2, true);
    else if (t > nextAmbient) {
      nextAmbient = t + 7 + Math.random() * 6;
      const s = care.s;
      say(s.sulk > 0 ? (s.sulkWhy === "jealous" ? "…흥, 누구랑 있었는데" : "흥…") : s.hunger > 0.75 ? "배고파…" : s.sleepiness > 0.8 ? "졸려…" : care.cleanliness < 0.5 ? "방이 지저분해…" : s.mood < 0.3 ? "흥…" : s.mood > 0.5 && Math.random() < 0.6 ? personalize(mutter(s.stageSeen), { name: charName(), me: s.callMe || DEFAULT_NAMES.me }) : null);
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
if (import.meta.env.DEV) Object.assign(window, { onna: { controller, habitat, care, director, dialog } });

// ---------------------------------------------------------------- 상점
function shopItem(
  emoji: string, name: string, note: string, price: number | null, disabled: boolean, onBuy: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "shop-item";
  btn.disabled = disabled;
  const icon = document.createElement("span");
  icon.className = "icon";
  icon.textContent = emoji;
  const label = document.createElement("span");
  label.className = "name";
  const strong = document.createElement("strong");
  strong.textContent = name;
  const small = document.createElement("small");
  small.textContent = note;
  label.append(strong, small);
  const tag = document.createElement("span");
  tag.className = "price";
  tag.textContent = price === null ? "보유 중" : `💖 ${price}`;
  btn.append(icon, label, tag);
  btn.onclick = () => {
    onBuy();
    renderShop();
    updateUi();
  };
  return btn;
}

function renderShop() {
  const s = care.s;
  const hearts = Math.floor(s.hearts);
  $("shop-hearts").textContent = `💖 ${hearts}`;

  $("shop-snacks").replaceChildren(
    ...(Object.keys(SNACKS) as FoodKind[]).map((kind) => {
      const snack = SNACKS[kind];
      const price = SNACK_PRICE[kind];
      return shopItem(snack.emoji, snack.label, `가진 개수 ${s.stock[kind]}개`, price, hearts < price, () => {
        if (care.buySnack(kind)) sfx.choice();
      });
    }),
  );

  $("shop-cosmetics").replaceChildren(
    ...(Object.keys(COSMETICS) as CosmeticId[]).map((id) => {
      const item = COSMETICS[id];
      const owned = s.owned.includes(id);
      return shopItem(item.emoji, item.label, `${item.note} · 하트 적립 +${Math.round(item.bonus * 100)}%`, owned ? null : item.price, owned || hearts < item.price, () => {
        if (care.buyCosmetic(id, Date.now())) {
          sfx.sparkle();
          body.setCosmetics(worn());
          const at = anchor();
          burst(at.x, at.y, 5, ["✨"]);
        }
      });
    }),
  );

  const avatars: [AvatarKind, string, string, string][] = [
    ["girl", "🧑", "미소녀", "기본 VRM 모습"],
    ["fly", "🪰", "진짜 초파리", "다리 6개로 걷고 앞다리로 그루밍해요"],
    ["custom", "📁", "내 VRM 불러오기", "가진 VRM 파일로 모습 바꾸기"],
  ];
  $("shop-avatar").replaceChildren(
    ...avatars.map(([kind, emoji, name, note]) => {
      const current = s.avatar === kind;
      const item = shopItem(emoji, name, note, null, false, () => {
        if (kind === "custom") $<HTMLInputElement>("vrm-file").click();
        else void applyAvatar(kind).then(() => renderShop());
      });
      item.querySelector(".price")!.textContent = current ? "사용 중" : kind === "custom" ? "파일 선택" : "바꾸기";
      return item;
    }),
  );

  const giftNote = s.giftDay === Math.floor(s.gameHours / 24) ? "오늘은 이미 선물했어요" : "하루 한 번, 애정이 조금 더 오릅니다";
  $("shop-gift").replaceChildren(
    shopItem("🎁", "선물 상자", giftNote, GIFT.price, !care.canGift, () => {
      if (care.giveGift(Date.now())) {
        care.thrillUp(0.8);
        sfx.levelUp();
        say("이거… 나 주는 거야? 헤헤♡", 3);
        burst(innerWidth / 2, innerHeight * 0.5, 8, ["♥", "🎁"]);
      }
    }),
  );
}

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
  $("days").textContent = `함께한 지 ${care.daysTogether()}일`;
  $("heart-count").textContent = String(Math.floor(care.s.hearts));
  $("stage").textContent = `💞 ${STAGES[care.s.stageSeen].name}${care.s.title ? ` · 🍓${care.s.title}` : ""}${care.s.sulk > 0 ? " · 💢삐짐" : ""}`;

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
    ["함께한 날", `${care.daysTogether()}일`],
    ["관계", STAGES[s.stageSeen].name],
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
  for (const old of document.querySelectorAll("#diary-panel .note")) old.remove();

  // 오늘 모은 마음과 다음 단계 조건
  const room = care.affectionRoomToday;
  const hearts = Math.round(((DAILY_AFFECTION_CAP - room) / DAILY_AFFECTION_CAP) * 5);
  const next = care.nextStage();
  const hint = document.createElement("p");
  hint.className = "note";
  hint.textContent =
    `오늘 모은 마음 ${"♥".repeat(hearts)}${"♡".repeat(5 - hearts)}` +
    (next
      ? ` · 다음 단계 '${next.name}': ` +
        [
          next.affection > 0 ? `애정 ${Math.ceil(next.affection * 100)}% 더` : "애정 충분",
          next.days > 0 ? `함께한 날 ${next.days}일 더` : "함께한 날 충분",
          next.moodOk ? "기분 좋음" : "기분이 좋을 때",
        ].join(", ")
      : " · 이미 연인이에요 💞");
  $("diary-stats").after(hint);

  const tastes = Object.entries(care.s.tastes) as [FoodKind, number][];
  const taste = document.createElement("p");
  taste.className = "note";
  taste.textContent = tastes.length
    ? "뇌가 알려 준 취향 (먹는 동안 MN9 최고 발화율) · " +
      tastes.sort((a, b) => b[1] - a[1])
        .map(([kind, hz]) => `${SNACKS[kind].emoji} ${SNACKS[kind].label} ${hz.toFixed(0)} Hz${hz >= 60 ? " ♥" : hz >= 20 ? " ♡" : " ✖"}`)
        .join(" · ")
    : "아직 아무 간식도 맛보지 않았어요. 간식을 주면 뇌 반응으로 취향을 알 수 있어요.";
  $("diary-stats").after(taste);

  const list = document.createElement("ul");
  list.className = "achievements note";
  list.replaceChildren(
    ...ACHIEVEMENTS.map((a) => {
      const done = s.unlocked.includes(a.id);
      const li = document.createElement("li");
      li.className = done ? "" : "locked";
      const emoji = document.createElement("span");
      emoji.className = "emoji";
      emoji.textContent = a.emoji;
      const text = document.createElement("span");
      text.textContent = `${a.name} `;
      const small = document.createElement("small");
      small.textContent = a.note;
      text.append(small);
      const reward = document.createElement("small");
      reward.textContent = done ? "✔" : `+${a.reward}💖`;
      li.append(emoji, text, reward);
      return li;
    }),
  );
  const heading = document.createElement("p");
  heading.className = "note";
  heading.textContent = `업적 ${s.unlocked.length}/${ACHIEVEMENTS.length} · 하트 적립 ×${care.heartBonus.toFixed(2)}`;
  $("diary-stats").after(heading, list);

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

// ---------------------------------------------------------------- 질투
const JEALOUS_AFTER_MS = 30 * 60_000;
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  const now = Date.now();
  if (document.hidden) {
    hiddenAt = now;
    return;
  }
  const away = now - hiddenAt;
  // 창을 닫아 둔 긴 시간은 "자리 비움"이지 질투가 아니다
  if (!ready || !hiddenAt || away < JEALOUS_AFTER_MS || away > 6 * 3.6e6) return;
  if (care.s.asleep || care.s.stageSeen < 2 || care.s.sulk > 0) return;
  care.sulkUp(0.5, now, "jealous");
  setTimeout(() => say("…다른 창에서 누구 만나고 왔어?", 4), 600);
});

// ---------------------------------------------------------------- 미니게임
const games = new MiniGames({
  anchor: () => anchor(),
  setLooming: (hz) => (habitat.loomHz = hz),
  giantFiber: () => controller.rates.escape,
  escaped: () => controller.state.behavior === "escape",
  onEnd: endGame,
});
const PAID_GAMES_PER_DAY = 3;

function startGame(which: "reach" | "catch") {
  setPrank(false);
  if (!ready || dialog.open || games.active) return;
  if (care.s.asleep) return say("쿨쿨…");
  for (const id of ["brain-panel", "diary-panel", "shop-panel", "album-panel"] as PanelId[]) togglePanel(id, false);
  if (which === "reach") games.startReach();
  else games.startCatch();
}

function endGame(r: GameResult) {
  const now = Date.now();
  const today = care.todayStats(now);
  const paid = (today.games ?? 0) < PAID_GAMES_PER_DAY;
  const center = () => [innerWidth / 2, innerHeight * 0.45] as const;
  if (r.game === "reach") {
    if (r.reason === "win") {
      today.games = (today.games ?? 0) + 1;
      const reward = paid ? 15 : 0;
      care.s.hearts += reward;
      care.bump(0.15, 0.008);
      care.thrillUp(0.6);
      sfx.levelUp();
      burst(...center(), 12, ["💓", "💖"]);
      say(care.s.stageSeen >= 3 ? "잡혔다… 헤헤, 두근거렸어♡" : "앗, 잡혔다! …생각보다 조심스럽네.", 3);
      care.log(now, `🤚 살금살금 손 뻗기 성공! Giant Fiber를 참아 냈어요${reward ? ` (+${reward} 하트)` : ""}.`);
      rec("pets");
    } else if (r.reason === "escaped") {
      care.bump(-0.05);
      say("휙! 너무 빨랐어!", 3);
      care.log(now, "🤚 손을 뻗었더니 Giant Fiber가 켜져서 도망갔어요.");
    } else say("…손은 왜 멈춘 거야?", 3);
  } else {
    today.games = (today.games ?? 0) + 1;
    const reward = paid ? Math.min(20, r.berries) : 0;
    const kept = Math.floor(r.berries / 10);
    care.s.hearts += reward;
    care.s.stock.sweet += kept;
    if (r.berries > 0) burst(...center(), Math.min(12, r.berries), ["🍓"]);
    say(r.berries >= 10 ? `딸기 ${r.berries}개! 나 주는 거지?` : r.berries > 0 ? `딸기 ${r.berries}개 받았다!` : "하나도 못 받았어…", 3);
    care.log(now, `🧺 딸기 받기: ${r.berries}개${reward ? ` (+${reward} 하트)` : ""}${kept ? `, 딸기 ${kept}개 보관` : ""}.`);
  }
}

// ---------------------------------------------------------------- 추억과 오늘
function renderAlbum() {
  const now = Date.now();
  const s = care.s;
  const yesterday = localDay(now - 86_400_000);
  const streak = s.attend.last === localDay(now) || s.attend.last === yesterday ? s.attend.streak : 0;
  const stamped = s.attend.last === localDay(now) ? ((streak - 1) % ATTEND_REWARDS.length) + 1 : streak % ATTEND_REWARDS.length;
  $("album-streak").textContent = `연속 ${streak}일`;
  $("album-attend").replaceChildren(
    ...ATTEND_REWARDS.map((reward, i) => {
      const span = document.createElement("span");
      span.className = i < stamped ? "on" : "";
      span.textContent = i < stamped ? "✔" : `${reward}💖`;
      span.title = `${i + 1}일째`;
      return span;
    }),
  );

  $("album-quests").replaceChildren(
    ...questStatus(care, now).map(({ quest, progress, done }) => {
      const li = document.createElement("li");
      li.className = done ? "done" : "";
      const name = document.createElement("span");
      name.textContent = quest.label;
      const reward = document.createElement("small");
      reward.textContent = done ? "✔" : `${progress}/${quest.goal} · +${quest.reward}💖`;
      const bar = document.createElement("progress");
      bar.max = quest.goal;
      bar.value = progress;
      li.append(name, reward, bar);
      return li;
    }),
  );

  $("album-memories").replaceChildren(
    ...MEMORIES.map((m) => {
      const seen = s.memories.includes(m.id);
      const item = shopItem(seen ? m.emoji : "🔒", seen ? m.title : "???", seen ? "눌러서 다시 보기" : "아직 보지 못한 장면", null, !seen, () => {
        togglePanel("album-panel", false);
        director.replay(m.id);
      });
      item.querySelector(".price")!.textContent = seen ? "▶" : "";
      return item;
    }),
  );

  const photos = $("album-photos");
  photos.replaceChildren();
  if (!s.album.length) photos.textContent = "아직 찍은 사진이 없어요. 📷 버튼으로 찍어 보세요.";
  for (const t of s.album) {
    const img = new Image();
    img.alt = new Date(t).toLocaleString("ko-KR");
    img.title = img.alt;
    img.onload = () => URL.revokeObjectURL(img.src);
    photos.append(img);
    void getBlob(`photo-${t}`).then((blob) => {
      if (blob) img.src = URL.createObjectURL(blob);
      else img.remove();
    });
  }
}
