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

export const ARENA_HALF = 6; // m
export const MOUTH_REACH = 0.55; // m, 이 안이면 맛을 느낀다

/** 사육 공간: 먹이·위협·접촉 이벤트를 감각 뉴런 입력(Hz)으로 바꾼다. */
export class Habitat {
  foods: Food[] = [];
  ambientLight = true;
  private nextId = 1;
  private threatUntil = 0;
  private petUntil = 0;

  addFood(kind: FoodKind, x?: number, z?: number): Food {
    const r = ARENA_HALF - 1;
    const food = {
      id: this.nextId++,
      kind,
      x: x ?? (Math.random() * 2 - 1) * r,
      z: z ?? (Math.random() * 2 - 1) * r,
      amount: 1,
    };
    this.foods.push(food);
    return food;
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
    return ARENA_HALF - Math.max(Math.abs(pose.x), Math.abs(pose.z));
  }

  /** 현재 상황에서 감각 그룹별 Poisson 발화율 (Hz) */
  sense(pose: Pose, now: number, hunger: number): Record<SensoryGroup, number> {
    const contact = (kind: FoodKind) => {
      const n = this.nearest(pose, kind);
      // MOUTH_REACH 안에서 1, 바깥 0.2 m 에 걸쳐 0 으로
      return n ? Math.max(0, Math.min(1, (MOUTH_REACH + 0.2 - n.dist) / 0.2)) : 0;
    };
    const touchingWall = this.wallDistance(pose) < 0.35;
    return {
      // 배고플수록 당에 민감 (포만이면 MN9 가 거의 반응하지 않는다)
      sugar: contact("sweet") * 160 * (0.25 + 0.75 * hunger),
      bitter: contact("bitter") * 160,
      jo_touch: now < this.petUntil ? 160 : touchingWall ? 140 : 0,
      looming: now < this.threatUntil ? 220 : 0,
      light: this.ambientLight ? 8 : 0,
    };
  }

  eat(food: Food, dt: number): void {
    food.amount -= dt * 0.08;
    if (food.amount <= 0) this.foods = this.foods.filter((f) => f !== food);
  }

  reset(): void {
    this.foods = [];
    this.threatUntil = 0;
    this.petUntil = 0;
  }
}
