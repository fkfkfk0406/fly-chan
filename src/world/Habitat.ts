import type { SensoryGroup } from "../sim/data.ts";

export type FoodKind = "sweet" | "bitter";

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

  threat(now: number): void {
    this.threatUntil = now + 0.35;
  }

  pet(now: number): void {
    this.petUntil = now + 1.5;
  }

  wallDistance(pose: Pose): number {
    return ROOM_HALF - Math.max(Math.abs(pose.x), Math.abs(pose.z));
  }

  /** 현재 상황에서 감각 그룹별 Poisson 발화율 (Hz) */
  sense(pose: Pose, now: number, hunger: number, asleep: boolean): Record<SensoryGroup, number> {
    const contact = (kind: FoodKind) => {
      const n = asleep ? null : this.nearest(pose, kind);
      // MOUTH_REACH 안에서 1, 바깥 0.2 m 에 걸쳐 0 으로
      return n ? clamp((MOUTH_REACH + 0.2 - n.dist) / 0.2, 0, 1) : 0;
    };
    const wall = this.wallDistance(pose);
    if (!asleep && wall < WALL_TOUCH && this.wallArmed) {
      this.wallTouchUntil = now + WALL_TOUCH_SEC;
      this.wallArmed = false;
    } else if (wall > WALL_REARM) this.wallArmed = true;
    return {
      // 배고플수록 당에 민감 (포만이면 MN9 가 거의 반응하지 않는다)
      sugar: contact("sweet") * 160 * (0.25 + 0.75 * hunger),
      bitter: contact("bitter") * 160,
      jo_touch: now < this.petUntil ? 160 : now < this.wallTouchUntil ? 140 : 0,
      looming: now < this.threatUntil ? 220 : 0,
      // 눈을 감고 있거나 불이 꺼져 있으면 광수용체 입력 없음
      light: this.lightsOn && !asleep ? 8 : 0,
    };
  }

  /** 한 입 먹는다. 먹은 양(0-1)을 돌려주고, 다 먹으면 딸기를 없앤다 */
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
