// 다마고치식 돌봄 상태. 뇌 시뮬레이션 밖의 "게임 상태"다.
// 배고픔만 뇌에 닿는다(배고플수록 당 GRN 입력이 세짐, Habitat.sense). 나머지는 행동 선택·표정·말풍선에 쓴다.
import { ROOM_HALF, insideBed } from "../world/Habitat.ts";

export type CareEvent =
  | "ate" | "full" | "bitter" | "scared" | "petted" | "sleep" | "wake" | "woken";

export type MessKind = "dust" | "stain";

export interface Mess {
  id: number;
  kind: MessKind;
  x: number;
  z: number;
}

/** 관계 단계. 애정이 min 이상이면 그 단계 */
export const STAGES = [
  { name: "낯섦", min: 0 },
  { name: "친구", min: 0.35 },
  { name: "호감", min: 0.55 },
  { name: "두근두근", min: 0.75 },
  { name: "연인", min: 0.92 },
] as const;

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
  /** 이벤트를 이미 본 가장 높은 관계 단계 */
  stageSeen: number;
  /** 마지막으로 시간대 인사를 한 날 */
  greetedDay: string;
  today: TodayStats;
  /** 최근에 한 대화 주제 id (반복 줄이기) */
  recentTalks: string[];
  bornAt: number;
  lastSeen: number;
  diary: DiaryEntry[];
}

const KEY = "onna-care-v1";
const HOUR = 3600;
const OFFLINE_CAP_H = 72;
const DIARY_MAX = 60;

// 시간당 변화량 (실제 시간 기준)
const RATE = {
  hungerAwake: 0.3,
  hungerAsleep: 0.12,
  sleepyAwake: 0.2,
  sleepRecover: 4, // 15분이면 개운
  neglect: 0.05, // 배고픔이 한계일 때 애정 감소
  dustEvery: 1.5, // 시간마다 먼지 한 뭉치
};
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
  /** 이번에 열었을 때 닫혀 있던 시간 (게임 시간, h) */
  awayHours = 0;

  private constructor(s: CareState, timeScale: number) {
    this.s = s;
    this.timeScale = timeScale;
  }

  static fresh(now: number): CareState {
    return {
      hunger: 0.45, sleepiness: 0.2, mood: 0.6, affection: 0.3,
      asleep: false, lightsOn: true, messes: [], dustIn: RATE.dustEvery,
      stageSeen: 0, greetedDay: "", today: emptyToday(now), recentTalks: [],
      bornAt: now, lastSeen: now,
      diary: [{ t: now, text: "온나가 방에 왔어요." }],
    };
  }

  /** 저장된 상태를 불러오고, 닫혀 있던 시간만큼 흘려보낸다 */
  static load(now: number, timeScale = 1): Care {
    let saved: CareState | null = null;
    try {
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
    // 1분 단위로 흘린다 (최대 72시간 = 4320 스텝)
    const steps = Math.ceil(hours * 60);
    for (let k = 0; k < steps; k++) {
      this.passTime((hours * HOUR) / steps / this.timeScale);
      if (this.s.asleep && this.s.sleepiness <= 0) this.s.asleep = false;
    }
    this.s.lastSeen = now;
    const away = hours >= 1 ? `${Math.floor(hours)}시간` : `${Math.round(hours * 60)}분`;
    const notes = [
      this.s.hunger > 0.85 && "배가 많이 고파 보여요.",
      this.cleanliness < 0.5 && "방에 먼지가 쌓였어요.",
      wasAsleep && !this.s.asleep && "그사이 푹 자고 일어났어요.",
    ].filter(Boolean);
    this.log(now, [`${away} 동안 기다렸어요.`, ...notes].join(" "));
  }

  /** realSec 초만큼 시간 경과 (배속 적용) */
  passTime(realSec: number): void {
    const h = (realSec * this.timeScale) / HOUR;
    const s = this.s;
    if (s.asleep) {
      s.hunger = clamp01(s.hunger + RATE.hungerAsleep * h);
      s.sleepiness = clamp01(s.sleepiness - RATE.sleepRecover * h);
    } else {
      s.hunger = clamp01(s.hunger + RATE.hungerAwake * h);
      s.sleepiness = clamp01(s.sleepiness + RATE.sleepyAwake * h);
    }
    if (s.hunger >= 0.95) s.affection = clamp01(s.affection - RATE.neglect * h);

    s.dustIn -= h;
    if (s.dustIn <= 0) {
      s.dustIn += RATE.dustEvery;
      this.addMess("dust");
    }

    // 기분은 애정·배고픔·졸림·청결이 정하는 기준값으로 천천히(τ 2분) 돌아간다
    const target = clamp01(
      0.55 + 0.35 * (s.affection - 0.5) - 0.45 * Math.max(0, s.hunger - 0.6) -
        0.35 * Math.max(0, s.sleepiness - 0.75) - 0.3 * Math.max(0, 0.7 - this.cleanliness),
    );
    s.mood += (target - s.mood) * (1 - Math.exp(-realSec / 120));
  }

  /** 현재 애정으로 정해지는 관계 단계 (0-4) */
  get stage(): number {
    let k = 0;
    STAGES.forEach((st, i) => {
      if (this.s.affection >= st.min) k = i;
    });
    return k;
  }

  /** 아직 이벤트를 보지 않은 새 단계가 있으면 그 단계 */
  pendingStage(): number | null {
    return this.stage > this.s.stageSeen ? this.s.stageSeen + 1 : null;
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

  bump(mood: number, affection = 0): void {
    this.s.mood = clamp01(this.s.mood + mood);
    this.s.affection = clamp01(this.s.affection + affection);
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
    s.mood = clamp01(s.mood + 0.04 * removed);
    s.affection = clamp01(s.affection + 0.01 * removed);
    if (!s.messes.length) {
      this.log(now, "방을 깨끗하게 청소해 줬어요.");
      return "반짝반짝✨";
    }
    return "고마워~";
  }

  /** 딸기를 amount 개(0-1) 만큼 먹음. 딸기 하나 = 배고픔 0.35 */
  eat(amount: number): void {
    this.s.hunger = clamp01(this.s.hunger - amount * 0.35);
  }

  /** 돌봄 이벤트 반영. 말풍선에 띄울 짧은 대사를 돌려준다 */
  on(event: CareEvent, now: number): string | null {
    const s = this.s;
    const bump = (mood: number, affection = 0) => this.bump(mood, affection);
    const today = this.todayStats(now);
    if (event === "ate") today.meals++;
    if (event === "scared") today.scares++;
    if (event === "petted") today.pets++;
    switch (event) {
      case "ate":
        bump(0.15, s.hunger > 0.2 ? 0.03 : 0.01);
        this.log(now, "딸기를 먹었어요.");
        return "냠냠";
      case "full":
        return "배불러~";
      case "bitter":
        bump(-0.2, -0.02);
        this.log(now, "쓴 버섯을 맛보고 뒷걸음쳤어요.");
        return "우웩";
      case "scared":
        bump(-0.25, -0.03);
        this.log(now, "깜짝 놀라서 뛰어올랐어요.");
        return "꺅!";
      case "woken":
        s.asleep = false;
        bump(-0.15);
        this.log(now, "자다가 깼어요.");
        return "으응…";
      case "petted": {
        this.petTimes = [...this.petTimes.filter((t) => now - t < 20_000), now];
        if (this.petTimes.length > 4) {
          bump(-0.05);
          return "그만~";
        }
        bump(0.12, 0.015);
        if (this.petTimes.length === 1) this.log(now, "쓰다듬어 줬어요.");
        return s.affection > 0.7 ? "헤헤♡" : "헤헤";
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

  setLights(on: boolean, now: number): void {
    if (this.s.lightsOn === on) return;
    this.s.lightsOn = on;
    this.log(now, on ? "불을 켰어요." : "불을 껐어요.");
  }

  log(now: number, text: string): void {
    this.s.diary.unshift({ t: now, text });
    this.s.diary.length = Math.min(this.s.diary.length, DIARY_MAX);
  }

  daysTogether(now: number): number {
    return Math.floor((now - this.s.bornAt) / 86_400_000) + 1;
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
