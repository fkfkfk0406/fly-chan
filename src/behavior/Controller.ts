// 하강뉴런(DN) 발화율 → 행동.
// FlyWire 커넥톰은 뇌만 포함하고 보행 패턴 생성기가 있는 복수신경삭(VNC)은 없다.
// 그래서 여기서는 VNC 역할을 절차적으로 흉내 낸다: 보행 리듬·벽 회피·탐색/먹이 찾기 드라이브는
// 코드로, 섭식(MN9)·그루밍·도약(Giant Fiber)·전진/후진/회전 DN 은 뇌 시뮬 출력으로 결정한다.
import type { MotorGroup } from "../sim/data.ts";
import { ARENA_HALF, MOUTH_REACH, type Habitat, type Pose } from "../world/Habitat.ts";

export type Behavior = "idle" | "walk" | "groom" | "feed" | "escape" | "rest";

export const BEHAVIOR_LABEL: Record<Behavior, string> = {
  idle: "두리번",
  walk: "걷기",
  groom: "더듬이 손질",
  feed: "섭식",
  escape: "도약 회피",
  rest: "휴식",
};

export interface BodyState extends Pose {
  speed: number; // m/s, 음수 = 후진
  angVel: number; // rad/s, 양수 = 왼쪽
  behavior: Behavior;
  behaviorTime: number;
  jump: number; // 0-1 도약 진행
  hunger: number;
  fatigue: number;
  /** 행동을 결정한 근거 (UI 표시) */
  cause: string;
}

const THRESH = { escape: 30, feed: 15, groom: 8 }; // Hz
const HOLD = { escape: 1.1, feed: 0.8, groom: 0.9 }; // s, 발화가 끊겨도 유지
const SMOOTH_TAU = 0.12; // s

export class Controller {
  readonly rates: Record<MotorGroup, number> = {
    forward: 0, backward: 0, turn_left: 0, turn_right: 0, escape: 0, groom: 0, feed: 0,
  };
  state: BodyState = Controller.initialState();

  private wanderTurn = 0;
  private pauseUntil = 0;
  private nextPause = 10;
  private lastFired: Record<"escape" | "feed" | "groom", number> = { escape: -99, feed: -99, groom: -99 };
  private escapeDir = 1;
  private avoidUntil = 0;

  static initialState(): BodyState {
    return {
      x: 0, z: 0, heading: Math.PI, speed: 0, angVel: 0,
      behavior: "idle", behaviorTime: 0, jump: 0, hunger: 0.6, fatigue: 0.2, cause: "",
    };
  }

  reset(): void {
    this.state = Controller.initialState();
    for (const k of Object.keys(this.rates) as MotorGroup[]) this.rates[k] = 0;
    this.lastFired = { escape: -99, feed: -99, groom: -99 };
  }

  /** 워커 프레임이 올 때마다 DN 발화율을 평활 */
  ingest(motor: Record<MotorGroup, number>, simDeltaMs: number): void {
    const a = 1 - Math.exp(-simDeltaMs / 1000 / SMOOTH_TAU);
    for (const k of Object.keys(motor) as MotorGroup[]) this.rates[k] += (motor[k] - this.rates[k]) * a;
  }

  update(dt: number, now: number, habitat: Habitat): void {
    const s = this.state;
    const r = this.rates;
    if (dt <= 0) return;

    for (const k of ["escape", "feed", "groom"] as const) if (r[k] > THRESH[k]) this.lastFired[k] = now;
    const holding = (k: "escape" | "feed" | "groom") => now - this.lastFired[k] < HOLD[k];

    // --- 행동 선택 (우선순위: 도약 > 섭식 > 그루밍 > 휴식 > 이동)
    let next: Behavior;
    if (s.behavior === "escape" && s.jump < 1) next = "escape";
    else if (holding("escape")) next = "escape";
    else if (holding("feed")) next = "feed";
    else if (holding("groom")) next = "groom";
    else if (s.behavior === "rest" ? s.fatigue > 0.15 : s.fatigue >= 1) next = "rest";
    else next = "walk";

    if (next !== s.behavior) {
      if (next === "escape") {
        s.jump = 0;
        this.escapeDir = Math.random() < 0.5 ? -1 : 1;
      }
      s.behavior = next;
      s.behaviorTime = 0;
    }
    s.behaviorTime += dt;

    // --- 목표 속도·각속도
    let targetSpeed = 0;
    let targetTurn = 0;
    const sweet = habitat.nearest(s, "sweet");
    const bitter = habitat.nearest(s, "bitter");

    switch (s.behavior) {
      case "escape": {
        s.jump = Math.min(1, s.jump + dt / HOLD.escape);
        targetSpeed = s.jump < 0.8 ? 2.6 : 0;
        targetTurn = this.escapeDir * 2.5 * (1 - s.jump);
        s.cause = `Giant Fiber(DNp01) ${r.escape.toFixed(0)} Hz`;
        break;
      }
      case "feed": {
        s.hunger = Math.max(0, s.hunger - dt * 0.1);
        if (sweet && sweet.dist < MOUTH_REACH + 0.2) habitat.eat(sweet.food, dt);
        s.cause = `MN9 ${r.feed.toFixed(0)} Hz ← 당 GRN`;
        break;
      }
      case "groom":
        s.cause = `그루밍 DN ${r.groom.toFixed(0)} Hz ← JO-F 접촉`;
        break;
      case "rest":
        s.fatigue = Math.max(0, s.fatigue - dt * 0.06);
        s.cause = "피로 (VNC 드라이브)";
        break;
      case "walk": {
        // 쓴맛 접촉: 뒤로 물러나며 돌아서기 (국소 반사)
        if (bitter && bitter.dist < MOUTH_REACH + 0.2) this.avoidUntil = now + 0.9;
        if (now < this.avoidUntil) {
          targetSpeed = -0.5;
          targetTurn = 1.8;
          s.cause = "쓴맛 GRN → 회피 반사";
          break;
        }
        if (now > this.nextPause) {
          this.pauseUntil = now + 1.5 + Math.random() * 3;
          this.nextPause = this.pauseUntil + 8 + Math.random() * 10;
        }
        // 탐색: 느리게 변하는 무작위 회전
        this.wanderTurn += (-this.wanderTurn * 0.5 + (Math.random() - 0.5) * 3) * dt;
        targetTurn = this.wanderTurn;
        targetSpeed = now < this.pauseUntil ? 0 : 0.55;
        s.cause = targetSpeed ? "탐색 (VNC 드라이브)" : "두리번";

        if (sweet && s.hunger > 0.3) {
          const want = Math.atan2(sweet.food.x - s.x, sweet.food.z - s.z);
          targetTurn = wrapAngle(want - s.heading) * 2.5;
          targetSpeed = sweet.dist > MOUTH_REACH * 0.8 ? 0.85 : 0;
          s.cause = sweet.dist > MOUTH_REACH ? "배고픔 → 먹이로 이동" : "먹이 앞 · 맛보는 중";
        }
        // 벽 회피
        const wall = habitat.wallDistance(s);
        if (wall < 1.2) {
          const toCenter = Math.atan2(-s.x, -s.z);
          targetTurn += wrapAngle(toCenter - s.heading) * (1.2 - wall) * 2;
        }
        break;
      }
    }

    // DN 직접 기여: P9·MDN 은 속도, DNa01/02 좌우 차이는 회전
    if (s.behavior === "walk") {
      targetSpeed += clamp((r.forward - r.backward) * 0.015, -0.8, 0.8);
      targetTurn += clamp((r.turn_left - r.turn_right) * 0.05, -2, 2);
    }

    s.speed += (targetSpeed - s.speed) * (1 - Math.exp(-dt * 4));
    s.angVel += (targetTurn - s.angVel) * (1 - Math.exp(-dt * 5));
    s.heading = wrapAngle(s.heading + s.angVel * dt);
    s.x += Math.sin(s.heading) * s.speed * dt;
    s.z += Math.cos(s.heading) * s.speed * dt;
    const lim = ARENA_HALF - 0.25;
    s.x = clamp(s.x, -lim, lim);
    s.z = clamp(s.z, -lim, lim);

    s.hunger = Math.min(1, s.hunger + dt * 0.006);
    if (s.behavior !== "rest") s.fatigue = Math.min(1, s.fatigue + dt * (0.004 + 0.012 * Math.abs(s.speed)));
  }

  /** 걷기 상태라도 거의 멈춰 있으면 "두리번"으로 표시 */
  static displayBehavior(s: BodyState): Behavior {
    return s.behavior === "walk" && Math.abs(s.speed) < 0.08 ? "idle" : s.behavior;
  }
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
