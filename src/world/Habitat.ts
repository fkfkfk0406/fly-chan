import type { SensoryGroup } from "../sim/data.ts";
import { CLOCK_MAX_HZ, clockActivity } from "./Clock.ts";

export type FoodKind = "sweet" | "honey" | "water" | "salty" | "bitter";

/**
 * 간식마다 자극하는 미각 뉴런이 다르다 (scripts/taste_probe.ts 로 확인한 반응).
 * water 는 100 Hz 에서 반응이 없어 200 Hz, ir94e 는 200 Hz 에서 폭주해 100 Hz 로 제한한다.
 */
export const SNACKS: Record<FoodKind, {
  label: string;
  emoji: string;
  group: SensoryGroup;
  rate: number;
  /** 배고픔을 얼마나 채우는지 (하나를 다 먹었을 때) */
  fills: number;
  /** 배고플수록 더 민감하게 느끼는 맛인지 */
  byHunger: boolean;
}> = {
  sweet: { label: "딸기", emoji: "🍓", group: "sugar", rate: 160, fills: 0.35, byHunger: true },
  honey: { label: "꿀", emoji: "🍯", group: "pharynx_sugar", rate: 150, fills: 0.3, byHunger: true },
  water: { label: "물", emoji: "💧", group: "water", rate: 200, fills: 0.1, byHunger: false },
  salty: { label: "짠 과자", emoji: "🥨", group: "ir94e", rate: 100, fills: 0.05, byHunger: false },
  bitter: { label: "쓴 버섯", emoji: "🍄", group: "bitter", rate: 160, fills: 0, byHunger: false },
};
/** 굳이 찾아가서 먹는 간식 (쓴 버섯·짠 과자는 스스로 찾지 않는다) */
export const LIKED_SNACKS: FoodKind[] = ["sweet", "honey", "water"];

export interface Food {
  id: number;
  x: number;
  z: number;
  kind: FoodKind;
  /** 0-1, 0 이 되면 사라진다 */
  amount: number;
}

export interface Pose {
  x: number;
  z: number;
  /** 라디안. 전방 = (sin h, cos h), 증가 = 왼쪽 회전 */
  heading: number;
}

export const ROOM_HALF = 3; // m, 방은 6 x 6 m
export const MOUTH_REACH = 0.55; // m, 이 안이면 맛을 느낀다
const WALL_TOUCH = 0.25; // m, 이보다 가까우면 더듬이가 벽에 닿음
const WALL_REARM = 0.5; // m, 이만큼 떨어지면 다음 접촉을 다시 느낌
const WALL_TOUCH_SEC = 0.6;
/** 설렘 최대치에서 pC1 자극 (Hz). 다른 입력과 겹쳐도 폭주하지 않는 범위 (scripts/pc1-safety.ts) */
export const PC1_MAX_HZ = 60;
/** 딸기 하나를 다 먹는 데 걸리는 시간 (s) */
export const EAT_SECONDS = 4;

/** 침대: 왼쪽 안쪽 구석, 머리는 -z(벽) 쪽 */
export const BED = { x: -2.05, z: -1.75, width: 1.1, length: 2.1, height: 0.42 };
/** 침대 옆 서는 자리 */
export const BED_SIDE = { x: BED.x + BED.width / 2 + 0.45, z: BED.z + 0.2 };
/** 기본 카메라 위치 (캐릭터가 사용자 쪽을 볼 때 기준) */
export const CAMERA_HOME = { x: 4.6, y: 4.2, z: 6.4 };

/** 방: 먹이·위협·접촉·빛을 감각 뉴런 입력(Hz)으로 바꾼다. */
export class Habitat {
  foods: Food[] = [];
  lightsOn = true;
  private nextId = 1;
  private threatUntil = 0;
  private petUntil = 0;
  // 벽 접촉은 닿는 순간 짧게 한 번만. 그루밍하느라 벽에 붙어 서 있어도 계속 자극하지 않게,
  // 벽에서 충분히 떨어져야 다시 발동한다.
  private wallTouchUntil = 0;
  private wallArmed = true;

  addFood(kind: FoodKind, x: number, z: number): Food {
    const lim = ROOM_HALF - 0.4;
    const food = { id: this.nextId++, kind, x: clamp(x, -lim, lim), z: clamp(z, -lim, lim), amount: 1 };
    if (insideBed(food.x, food.z, 0.3)) food.x = BED.x + BED.width / 2 + 0.4;
    this.foods.push(food);
    return food;
  }

  /** 캐릭터 앞 d m 에 먹이를 놓는다 */
  addFoodInFront(pose: Pose, kind: FoodKind, d = 1): Food {
    return this.addFood(kind, pose.x + Math.sin(pose.heading) * d, pose.z + Math.cos(pose.heading) * d);
  }

  /** 가장 가까운 먹이와 거리 */
  nearest(pose: Pose, kind: FoodKind): { food: Food; dist: number } | null {
    let best: { food: Food; dist: number } | null = null;
    for (const food of this.foods) {
      if (food.kind !== kind) continue;
      const dist = Math.hypot(food.x - pose.x, food.z - pose.z);
      if (!best || dist < best.dist) best = { food, dist };
    }
    return best;
  }

  /** 주어진 종류들 중 가장 가까운 것 */
  nearestOf(pose: Pose, kinds: readonly FoodKind[]): { food: Food; dist: number } | null {
    let best: { food: Food; dist: number } | null = null;
    for (const kind of kinds) {
      const n = this.nearest(pose, kind);
      if (n && (!best || n.dist < best.dist)) best = n;
    }
    return best;
  }

  threat(now: number): void {
    this.threatUntil = now + 0.35;
  }

  pet(now: number): void {
    this.petUntil = now + 1.5;
  }

  wallDistance(pose: Pose): number {
    return ROOM_HALF - Math.max(Math.abs(pose.x), Math.abs(pose.z));
  }

  /** 입에 닿은 정도 (MOUTH_REACH 안에서 1, 바깥 0.2 m 에 걸쳐 0) */
  contact(pose: Pose, kind: FoodKind): number {
    const n = this.nearest(pose, kind);
    return n ? clamp((MOUTH_REACH + 0.2 - n.dist) / 0.2, 0, 1) : 0;
  }

  /** 지금 입에 닿아 맛보고 있는 간식 (가장 가까운 하나) */
  tasting(pose: Pose): FoodKind | null {
    const n = this.nearestOf(pose, Object.keys(SNACKS) as FoodKind[]);
    return n && n.dist <= MOUTH_REACH + 0.2 ? n.food.kind : null;
  }

  /** 현재 상황에서 감각 그룹별 Poisson 발화율 (Hz) */
  /**
   * @param thrill 설렘 0-1 (게임 상태). pC1 에 최대 PC1_MAX_HZ 로 들어간다.
   *   pC1 은 이 모델의 어떤 감각 입력으로도 켜지지 않아서(scripts/pc1-probe.ts, song-probe.ts),
   *   "마음은 게임 상태, 그 마음이 몸에 나타나는 방식은 뇌"로 연결한다 (CoTFly 의 신경 게인과 같은 발상)
   */
  sense(pose: Pose, now: number, hunger: number, asleep: boolean, thrill = 0, hour = 12): Record<SensoryGroup, number> {
    const wall = this.wallDistance(pose);
    if (!asleep && wall < WALL_TOUCH && this.wallArmed) {
      this.wallTouchUntil = now + WALL_TOUCH_SEC;
      this.wallArmed = false;
    } else if (wall > WALL_REARM) this.wallArmed = true;

    const rates: Record<SensoryGroup, number> = {
      sugar: 0, bitter: 0, water: 0, pharynx_sugar: 0, ir94e: 0,
      jo_touch: now < this.petUntil ? 160 : now < this.wallTouchUntil ? 140 : 0,
      looming: now < this.threatUntil ? 220 : 0,
      // 눈을 감고 있거나 불이 꺼져 있으면 광수용체 입력 없음
      light: this.lightsOn && !asleep ? 8 : 0,
      pc1: asleep ? 0 : clamp(thrill, 0, 1) * PC1_MAX_HZ,
      // 생체시계는 자는 동안에도 돈다
      ...(() => {
        const c = clockActivity(hour);
        return { clock_lnv: c.lnv * CLOCK_MAX_HZ, clock_lnd: c.lnd * CLOCK_MAX_HZ, clock_dn1: c.dn1 * CLOCK_MAX_HZ };
      })(),
    };
    if (asleep) return rates;
    // 입에 닿은 간식 중 가장 가까운 하나만 맛본다.
    // 두 가지 맛(특히 Ir94e + 쓴맛)을 동시에 넣으면 전뇌가 폭주한다 (scripts/snack-safety.ts)
    const tasted = this.nearestOf(pose, Object.keys(SNACKS) as FoodKind[]);
    const contact = tasted ? clamp((MOUTH_REACH + 0.2 - tasted.dist) / 0.2, 0, 1) : 0;
    if (tasted && contact > 0) {
      const snack = SNACKS[tasted.food.kind];
      // 배고플수록 당에 민감 (포만이면 MN9 가 거의 반응하지 않는다)
      const scale = snack.byHunger ? 0.25 + 0.75 * hunger : 1;
      rates[snack.group] = contact * snack.rate * scale;
    }
    return rates;
  }

  eat(food: Food, dt: number): number {
    const bite = Math.min(food.amount, dt / EAT_SECONDS);
    food.amount -= bite;
    if (food.amount <= 1e-3) this.remove(food.id);
    return bite;
  }

  remove(id: number): void {
    this.foods = this.foods.filter((f) => f.id !== id);
  }
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function insideBed(x: number, z: number, margin = 0): boolean {
  return Math.abs(x - BED.x) < BED.width / 2 + margin && Math.abs(z - BED.z) < BED.length / 2 + margin;
}
