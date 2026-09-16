// 다마고치식 돌봄 상태. 뇌 시뮬레이션 밖의 "게임 상태"다.
// 배고픔만 뇌에 닿는다(배고플수록 당 GRN 입력이 세짐, Habitat.sense). 나머지는 행동 선택·표정·말풍선에 쓴다.
import { hasBatchim } from "../story/personalize.ts";
import { ROOM_HALF, SNACKS, insideBed, type FoodKind } from "../world/Habitat.ts";

export type CareEvent =
  | "ate" | "full" | "bitter" | "scared" | "petted" | "sleep" | "wake" | "woken";

export type MessKind = "dust" | "stain";

export interface Mess {
  id: number;
  kind: MessKind;
  x: number;
  z: number;
}

/**
 * 관계 단계. 초파리의 마음은 쉽게 열리지 않는다:
 * 애정(min) + 함께한 날(minDays)을 채우고, 그 순간 기분이 좋아야(MOOD_TO_ADVANCE) 다음 단계로 간다.
 */
export const STAGES = [
  { name: "낯섦", min: 0, minDays: 0 },
  { name: "친구", min: 0.2, minDays: 1 },
  { name: "호감", min: 0.45, minDays: 3 },
  { name: "두근두근", min: 0.7, minDays: 5 },
  { name: "연인", min: 0.92, minDays: 7 },
] as const;
export const MOOD_TO_ADVANCE = 0.6;
/** 하루(게임 시간 24h)에 오를 수 있는 애정 상한 */
export const DAILY_AFFECTION_CAP = 0.06;

/** 상점에서 파는 꾸미기 아이템 */
export const COSMETICS = {
  ribbon: { label: "리본", emoji: "🎀", price: 40, note: "머리에 다는 빨간 리본" },
  scarf: { label: "목도리", emoji: "🧣", price: 60, note: "포근한 목도리" },
  plant: { label: "화분", emoji: "🪴", price: 30, note: "창가에 두는 화분" },
  frame: { label: "액자", emoji: "🖼️", price: 50, note: "둘이 함께 찍은 듯한 액자" },
} as const;
export type CosmeticId = keyof typeof COSMETICS;

/** 간식 가격 (하트) */
export const SNACK_PRICE: Record<FoodKind, number> = {
  sweet: 5, honey: 9, water: 3, salty: 4, bitter: 2,
};
/** 선물: 하루 한 번, 애정을 조금 더 올린다 */
export const GIFT = { price: 35, affection: 0.02, mood: 0.2 };
/** 시간당 하트 적립 (애정·청결에 비례), 자리를 비운 동안 쌓이는 최대 시간 */
const HEART_RATE = { base: 3, byAffection: 12, maxIdleHours: 12 };
/** 돌봄으로 얻는 하트의 하루 상한 */
const HEART_CARE_CAP = 40;

/** 오늘 하루 기록 (뇌 출력 기반 대화에 쓴다) */
export interface TodayStats {
  day: string; // 로컬 날짜 YYYY-MM-DD
  feedSec: number; // MN9 가 섭식을 일으킨 시간
  groomSec: number; // 그루밍 DN 이 손질을 일으킨 시간
  scares: number;
  pets: number;
  meals: number;
  talks: number;
}

export interface DiaryEntry {
  t: number; // epoch ms
  text: string;
}

export interface CareState {
  hunger: number; // 0 배부름 → 1 배고픔
  sleepiness: number; // 0 개운함 → 1 졸림
  mood: number; // 0 우울 → 1 행복, 짧게 오르내림
  affection: number; // 0 → 1, 천천히 쌓임
  asleep: boolean;
  lightsOn: boolean;
  /** 방바닥의 먼지·얼룩. 청결도는 이 개수로 정해진다 */
  messes: Mess[];
  /** 다음 먼지가 생길 때까지 남은 게임 시간 (h) */
  dustIn: number;
  /** 캐릭터 이름과 캐릭터가 나를 부르는 호칭. 비어 있으면 아직 이름을 짓지 않음 */
  name: string;
  callMe: string;
  /** 첫 만남 장면을 봤는지 */
  introDone: boolean;
  /** 이벤트를 이미 본 가장 높은 관계 단계 */
  stageSeen: number;
  /** 함께 보낸 게임 시간 (h). 함께한 날 = 24h 단위 */
  gameHours: number;
  /** 애정 상한을 세는 게임 날짜와 그날 얻은 애정 */
  gainDay: number;
  gainToday: number;
  /** 마지막으로 시간대 인사를 한 날 */
  greetedDay: string;
  today: TodayStats;
  /** 하트: 상점 재화 */
  hearts: number;
  /** 자리를 비운 동안 모아 둔 하트 (돌아오면 받는다) */
  pendingHearts: number;
  /** 간식 재고 */
  stock: Record<FoodKind, number>;
  /** 산 꾸미기 아이템 */
  owned: CosmeticId[];
  /** 마지막으로 선물한 게임 날짜 */
  giftDay: number;
  /** 오늘 돌봄으로 얻은 하트 */
  heartsToday: number;
  /** 간식별로 관찰한 MN9 최고 발화율 (Hz). 뇌 반응으로 알아낸 취향 */
  tastes: Partial<Record<FoodKind, number>>;
  /** 최근에 한 대화 주제 id (반복 줄이기) */
  recentTalks: string[];
  bornAt: number;
  lastSeen: number;
  diary: DiaryEntry[];
}

// 난이도를 바꾸면서 저장 형식이 달라져 새로 시작한다
const KEY = "onna-care-v2";
const OLD_KEYS = ["onna-care-v1"];
const HOUR = 3600;
const OFFLINE_CAP_H = 72;
const DIARY_MAX = 60;

// 시간당 변화량 (게임 시간 기준)
const RATE = {
  hungerAwake: 0.3,
  hungerAsleep: 0.12,
  sleepyAwake: 0.2,
  sleepRecover: 4, // 15분이면 개운
  neglect: 0.05, // 배고픔이 한계일 때 애정 감소
  dirty: 0.01, // 방이 많이 지저분할 때 애정 감소
  dustEvery: 1.5, // 시간마다 먼지 한 뭉치
};
const LONELY_PER_DAY = 0.02; // 하루 넘게 안 오면 하루마다 애정 감소
const MESS_MAX = 6;
const MESS_WEIGHT = 0.18; // 얼룩 하나당 청결도 감소

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function localDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyToday(now: number): TodayStats {
  return { day: localDay(now), feedSec: 0, groomSec: 0, scares: 0, pets: 0, meals: 0, talks: 0 };
}

export class Care {
  s: CareState;
  /** 시간 배속 (?time=60 이면 1분이 1시간). 시연·테스트용 */
  readonly timeScale: number;
  private petTimes: number[] = [];
  /** 자리를 비운 시간을 흘려보내는 중인지 (하트가 pendingHearts 로 쌓인다) */
  private offline = false;
  /** 이번에 열었을 때 닫혀 있던 시간 (게임 시간, h) */
  awayHours = 0;

  private constructor(s: CareState, timeScale: number) {
    this.s = s;
    this.timeScale = timeScale;
  }

  static fresh(now: number): CareState {
    return {
      hunger: 0.45, sleepiness: 0.2, mood: 0.55, affection: 0.05,
      asleep: false, lightsOn: true, messes: [], dustIn: RATE.dustEvery,
      name: "", callMe: "", introDone: false,
      stageSeen: 0, gameHours: 0, gainDay: 0, gainToday: 0,
      hearts: 20, pendingHearts: 0, stock: { sweet: 3, honey: 0, water: 2, salty: 0, bitter: 1 },
      owned: [], giftDay: -1, heartsToday: 0,
      greetedDay: "", today: emptyToday(now), recentTalks: [], tastes: {},
      bornAt: now, lastSeen: now,
      diary: [],
    };
  }

  /** 저장된 상태를 불러오고, 닫혀 있던 시간만큼 흘려보낸다 */
  static load(now: number, timeScale = 1): Care {
    let saved: CareState | null = null;
    try {
      for (const k of OLD_KEYS) localStorage.removeItem(k);
      const raw = localStorage.getItem(KEY);
      if (raw) saved = { ...Care.fresh(now), ...JSON.parse(raw) };
    } catch {
      saved = null;
    }
    const care = new Care(saved ?? Care.fresh(now), timeScale);
    if (saved) care.catchUp(now);
    return care;
  }

  private catchUp(now: number): void {
    const hours = Math.min(OFFLINE_CAP_H, ((now - this.s.lastSeen) / 3.6e6) * this.timeScale);
    this.awayHours = hours;
    if (hours < 1 / 60) return;
    const wasAsleep = this.s.asleep;
    this.offline = true;
    // 1분 단위로 흘린다 (최대 72시간 = 4320 스텝)
    const steps = Math.ceil(hours * 60);
    for (let k = 0; k < steps; k++) {
      this.passTime((hours * HOUR) / steps / this.timeScale);
      if (this.s.asleep && this.s.sleepiness <= 0) this.s.asleep = false;
    }
    this.offline = false;
    const lonely = Math.max(0, hours - 24) / 24;
    this.s.affection = clamp01(this.s.affection - LONELY_PER_DAY * lonely);
    this.s.lastSeen = now;
    const away = hours >= 1 ? `${Math.floor(hours)}시간` : `${Math.round(hours * 60)}분`;
    const notes = [
      this.s.hunger > 0.85 && "배가 많이 고파 보여요.",
      this.cleanliness < 0.5 && "방에 먼지가 쌓였어요.",
      lonely > 0 && "오래 혼자 있어서 조금 서운해해요.",
      wasAsleep && !this.s.asleep && "그사이 푹 자고 일어났어요.",
    ].filter(Boolean);
    this.log(now, [`${away} 동안 기다렸어요.`, ...notes].join(" "));
  }

  /** realSec 초만큼 시간 경과 (배속 적용) */
  passTime(realSec: number): void {
    const h = (realSec * this.timeScale) / HOUR;
    const s = this.s;
    s.gameHours += h;
    if (s.asleep) {
      s.hunger = clamp01(s.hunger + RATE.hungerAsleep * h);
      s.sleepiness = clamp01(s.sleepiness - RATE.sleepRecover * h);
    } else {
      s.hunger = clamp01(s.hunger + RATE.hungerAwake * h);
      s.sleepiness = clamp01(s.sleepiness + RATE.sleepyAwake * h);
    }
    if (s.hunger >= 0.95) s.affection = clamp01(s.affection - RATE.neglect * h);
    if (this.cleanliness < 0.4) s.affection = clamp01(s.affection - RATE.dirty * h);

    // 하트 적립: 애정이 깊고 방이 깨끗할수록 많이 모인다
    const perHour = (HEART_RATE.base + HEART_RATE.byAffection * s.affection) * (0.5 + 0.5 * this.cleanliness);
    if (this.offline) s.pendingHearts = Math.min(s.pendingHearts + perHour * h, perHour * HEART_RATE.maxIdleHours);
    else s.hearts += perHour * h;

    s.dustIn -= h;
    if (s.dustIn <= 0) {
      s.dustIn += RATE.dustEvery;
      this.addMess("dust");
    }

    // 기분은 애정·배고픔·졸림·청결이 정하는 기준값으로 천천히(τ 2분) 돌아간다
    const target = clamp01(
      0.5 + 0.35 * (s.affection - 0.5) - 0.45 * Math.max(0, s.hunger - 0.6) -
        0.35 * Math.max(0, s.sleepiness - 0.75) - 0.3 * Math.max(0, 0.7 - this.cleanliness),
    );
    s.mood += (target - s.mood) * (1 - Math.exp(-realSec / 120));
  }

  /** 기다리는 동안 모은 하트를 받는다. 받은 개수를 돌려준다 */
  collectPending(now: number): number {
    const got = Math.floor(this.s.pendingHearts);
    if (got <= 0) return 0;
    this.s.hearts += got;
    this.s.pendingHearts -= got;
    this.log(now, `기다리는 동안 하트 ${got}개를 모아 뒀어요.`);
    return got;
  }

  /** 돌봄으로 하트를 얻는다 (하루 상한 있음) */
  earnHearts(amount: number): number {
    this.rollGainDay();
    const got = Math.min(amount, Math.max(0, HEART_CARE_CAP - this.s.heartsToday));
    this.s.heartsToday += got;
    this.s.hearts += got;
    return got;
  }

  spend(price: number): boolean {
    if (this.s.hearts < price) return false;
    this.s.hearts -= price;
    return true;
  }

  /** 간식 구매 */
  buySnack(kind: FoodKind, count = 1): boolean {
    if (!this.spend(SNACK_PRICE[kind] * count)) return false;
    this.s.stock[kind] += count;
    return true;
  }

  /** 꾸미기 구매 */
  buyCosmetic(id: CosmeticId, now: number): boolean {
    if (this.s.owned.includes(id) || !this.spend(COSMETICS[id].price)) return false;
    this.s.owned.push(id);
    this.log(now, `${COSMETICS[id].emoji} ${COSMETICS[id].label}${hasBatchim(COSMETICS[id].label) ? "을" : "를"} 샀어요.`);
    return true;
  }

  /** 선물하기: 하루 한 번 */
  giveGift(now: number): boolean {
    this.rollGainDay();
    const day = Math.floor(this.s.gameHours / 24);
    if (this.s.giftDay === day || !this.spend(GIFT.price)) return false;
    this.s.giftDay = day;
    this.bump(GIFT.mood, GIFT.affection);
    this.log(now, "선물을 줬어요. 아주 좋아했어요 🎁");
    return true;
  }

  get canGift(): boolean {
    return this.s.giftDay !== Math.floor(this.s.gameHours / 24) && this.s.hearts >= GIFT.price;
  }

  /** 간식을 하나 꺼낸다 (재고가 없으면 false) */
  takeSnack(kind: FoodKind): boolean {
    if (this.s.stock[kind] <= 0) return false;
    this.s.stock[kind]--;
    return true;
  }

  /** 함께한 날 (게임 시간 기준, 첫날 = 1) */
  daysTogether(): number {
    return Math.floor(this.s.gameHours / 24) + 1;
  }

  /** 애정 수치만으로 도달한 단계 (0-4) */
  get stage(): number {
    let k = 0;
    STAGES.forEach((st, i) => {
      if (this.s.affection >= st.min) k = i;
    });
    return k;
  }

  /** 다음 단계로 가기 위해 남은 조건 */
  nextStage(): { name: string; affection: number; days: number; moodOk: boolean } | null {
    const next = STAGES[this.s.stageSeen + 1];
    if (!next) return null;
    return {
      name: next.name,
      affection: Math.max(0, next.min - this.s.affection),
      days: Math.max(0, next.minDays - (this.daysTogether() - 1)),
      moodOk: this.s.mood >= MOOD_TO_ADVANCE,
    };
  }

  /** 모든 조건을 채운 다음 단계가 있으면 그 단계 */
  pendingStage(): number | null {
    const next = this.nextStage();
    if (!next || next.affection > 0 || next.days > 0 || !next.moodOk) return null;
    return this.s.stageSeen + 1;
  }

  markStageSeen(stage: number, now: number): void {
    if (stage <= this.s.stageSeen) return;
    this.s.stageSeen = stage;
    this.log(now, `관계가 '${STAGES[stage].name}'(으)로 깊어졌어요 💞`);
  }

  /** 오늘 기록. 날짜가 바뀌었으면 새로 시작 */
  todayStats(now: number): TodayStats {
    if (this.s.today.day !== localDay(now)) this.s.today = emptyToday(now);
    return this.s.today;
  }

  /** 오늘(게임 날짜) 더 얻을 수 있는 애정 */
  get affectionRoomToday(): number {
    this.rollGainDay();
    return Math.max(0, DAILY_AFFECTION_CAP - this.s.gainToday);
  }

  private rollGainDay(): void {
    const day = Math.floor(this.s.gameHours / 24);
    if (day !== this.s.gainDay) {
      this.s.gainDay = day;
      this.s.gainToday = 0;
      this.s.heartsToday = 0;
    }
  }

  /** 기분·애정 변화. 오르는 애정만 하루 상한이 걸리고, 깎이는 건 그대로 */
  bump(mood: number, affection = 0): void {
    this.s.mood = clamp01(this.s.mood + mood);
    if (affection > 0) {
      const gain = Math.min(affection, this.affectionRoomToday);
      this.s.gainToday += gain;
      this.s.affection = clamp01(this.s.affection + gain);
    } else {
      this.s.affection = clamp01(this.s.affection + affection);
    }
  }

  /** 0 엉망 → 1 깨끗 */
  get cleanliness(): number {
    return clamp01(1 - this.s.messes.length * MESS_WEIGHT);
  }

  /** 얼룩을 만든다. 위치를 주지 않으면 바닥의 빈 곳에 무작위로 */
  addMess(kind: MessKind, x?: number, z?: number): Mess | null {
    const s = this.s;
    if (s.messes.length >= MESS_MAX) return null;
    const lim = ROOM_HALF - 0.5;
    let px = x ?? 0;
    let pz = z ?? 0;
    for (let tries = 0; x === undefined && tries < 20; tries++) {
      px = (Math.random() * 2 - 1) * lim;
      pz = (Math.random() * 2 - 1) * lim;
      if (!insideBed(px, pz, 0.3)) break;
    }
    const mess = { id: Math.max(0, ...s.messes.map((m) => m.id)) + 1, kind, x: px, z: pz };
    s.messes.push(mess);
    return mess;
  }

  /** 청소. id 를 주면 그 얼룩만, 없으면 전부 */
  clean(now: number, id?: number): string {
    const s = this.s;
    const before = s.messes.length;
    s.messes = id === undefined ? [] : s.messes.filter((m) => m.id !== id);
    const removed = before - s.messes.length;
    if (!removed) return "이미 깨끗해!";
    this.bump(0.04 * removed, 0.004 * removed);
    if (!s.messes.length) {
      this.log(now, "방을 깨끗하게 청소해 줬어요.");
      return "반짝반짝✨";
    }
    return "고마워~";
  }

  /** 간식을 amount 개(0-1) 만큼 먹음. 채워지는 양은 간식마다 다르다 */
  eat(amount: number, kind: FoodKind): void {
    this.s.hunger = clamp01(this.s.hunger - amount * SNACKS[kind].fills);
  }

  /** 먹는 동안 관찰한 MN9 발화율을 간식별 최고치로 기록한다 (뇌가 알려 주는 취향) */
  noteTaste(kind: FoodKind, mn9Hz: number): void {
    const best = this.s.tastes[kind] ?? 0;
    if (mn9Hz > best) this.s.tastes[kind] = mn9Hz;
    else if (this.s.tastes[kind] === undefined) this.s.tastes[kind] = 0;
  }

  /** 돌봄 이벤트 반영. 말풍선에 띄울 짧은 대사를 돌려준다 */
  on(event: CareEvent, now: number): string | null {
    const s = this.s;
    const today = this.todayStats(now);
    if (event === "ate") today.meals++;
    if (event === "scared") today.scares++;
    if (event === "petted") today.pets++;
    switch (event) {
      case "ate":
        // 배고플 때 준 밥이어야 마음이 움직인다. 무엇을 먹었는지는 부르는 쪽이 일기에 남긴다
        this.bump(0.15, s.hunger > 0.5 ? 0.012 : 0);
        return "냠냠";
      case "full":
        return "배불러~";
      case "bitter":
        this.bump(-0.25, -0.04);
        this.log(now, "쓴 버섯을 맛보고 뒷걸음쳤어요. 조금 원망하는 눈치예요.");
        return "우웩…";
      case "scared":
        this.bump(-0.3, -0.05);
        this.log(now, "깜짝 놀라서 뛰어올랐어요. 한동안 경계할 것 같아요.");
        return "꺅!";
      case "woken":
        s.asleep = false;
        this.bump(-0.2, -0.03);
        this.log(now, "자다가 깼어요. 기분이 좋지 않아요.");
        return "으응… 왜 깨워";
      case "petted": {
        this.petTimes = [...this.petTimes.filter((t) => now - t < 20_000), now];
        if (this.petTimes.length > 3) {
          this.bump(-0.08, -0.02);
          return "그만 좀 해!";
        }
        // 기분이 나쁠 때는 손을 탄다
        if (s.mood < 0.4) {
          this.bump(-0.02);
          return "흥…";
        }
        this.bump(0.08, 0.006);
        if (this.petTimes.length === 1) this.log(now, "쓰다듬어 줬어요.");
        return this.s.stageSeen >= 3 ? "헤헤♡" : this.s.stageSeen >= 1 ? "헤헤" : "…";
      }
      case "sleep":
        s.asleep = true;
        this.log(now, "침대에서 잠들었어요.");
        return "💤";
      case "wake":
        s.asleep = false;
        this.log(now, "잘 자고 일어났어요.");
        return "잘 잤다~";
    }
  }

  get named(): boolean {
    return this.s.name !== "";
  }

  setNames(name: string, callMe: string, now: number): void {
    const first = !this.named;
    this.s.name = name;
    this.s.callMe = callMe;
    if (first) this.log(now, `낯선 방에 ${name}${hasBatchim(name) ? "이" : "가"} 왔어요. 아직 경계하는 눈치예요.`);
  }

  setLights(on: boolean, now: number): void {
    if (this.s.lightsOn === on) return;
    this.s.lightsOn = on;
    this.log(now, on ? "불을 켰어요." : "불을 껐어요.");
  }

  log(now: number, text: string): void {
    this.s.diary.unshift({ t: now, text });
    this.s.diary.length = Math.min(this.s.diary.length, DIARY_MAX);
  }

  save(now: number): void {
    this.s.lastSeen = now;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      // 저장 불가(사생활 보호 모드 등): 이번 방문 동안만 유지
    }
  }

  reset(now: number): void {
    this.s = Care.fresh(now);
    this.save(now);
  }
}
