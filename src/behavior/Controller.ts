// 하강뉴런(DN) 발화율 → 행동.
// FlyWire 커넥톰은 뇌만 포함하고 보행 패턴 생성기가 있는 복수신경삭(VNC)은 없다.
// 그래서 여기서는 VNC 역할을 절차적으로 흉내 낸다: 보행 리듬·벽 회피·먹이/침대/사용자에게 가기는
// 코드로, 섭식(MN9)·그루밍·도약(Giant Fiber)·전진/후진/회전 DN 은 뇌 시뮬 출력으로 결정한다.
import type { Care, CareEvent } from "../care/Care.ts";
import type { MotorGroup } from "../sim/data.ts";
import {
  BED, BED_SIDE, CAMERA_HOME, LIKED_SNACKS, MOUTH_REACH, ROOM_HALF, SNACKS, clamp, insideBed,
  type FoodKind, type Habitat, type Pose,
} from "../world/Habitat.ts";

export type Behavior = "idle" | "walk" | "groom" | "feed" | "escape" | "sleep";

export const BEHAVIOR_LABEL: Record<Behavior, string> = {
  idle: "두리번",
  walk: "걷는 중",
  groom: "더듬이 손질",
  feed: "냠냠 먹는 중",
  escape: "깜짝 도약",
  sleep: "쿨쿨 자는 중",
};

export interface BodyState extends Pose {
  speed: number; // m/s, 음수 = 후진
  angVel: number; // rad/s, 양수 = 왼쪽
  behavior: Behavior;
  behaviorTime: number;
  jump: number; // 0-1 도약 진행
  /** 바닥에서 몸 기준점 높이 (침대 위면 매트리스 높이) */
  elev: number;
  /** 행동을 결정한 근거 (UI 표시) */
  cause: string;
}

const THRESH = { escape: 30, feed: 15, groom: 8 }; // Hz
const HOLD = { escape: 1.1, feed: 0.8, groom: 0.9 }; // s, 발화가 끊겨도 유지
const SMOOTH_TAU = 0.12; // s
/** 사용자에게 다가와 서는 자리 (카메라 쪽 방 앞) */
const USER_SPOT = { x: 1.2, z: 1.7 };
const SLEEP_HEADING = -Math.PI / 2; // 옆으로 누우면 머리가 -z(침대 머리맡)

export class Controller {
  readonly rates: Record<MotorGroup, number> = {
    forward: 0, backward: 0, turn_left: 0, turn_right: 0, escape: 0, groom: 0, feed: 0,
  };
  state: BodyState = Controller.initialState();
  onEvent: (e: CareEvent) => void = () => {};
  /** 대화창이 열려 있으면 제자리에서 사용자 쪽을 본다 */
  talking = false;

  private wanderTurn = 0;
  private pauseUntil = 0;
  private nextPause = 6;
  private visitUntil = 0;
  private lastFired: Record<"escape" | "feed" | "groom", number> = { escape: -99, feed: -99, groom: -99 };
  private escapeDir = 1;
  private avoidUntil = 0;
  private tastingBitter = false;
  private atFoodSince = -1;
  private refusedFood = -1;
  /** 지금 먹고 있는 간식 */
  private eatingFood = -1;
  eatingKind: FoodKind | null = null;

  static initialState(): BodyState {
    return {
      x: 0.6, z: 0.4, heading: Math.PI * 0.2, speed: 0, angVel: 0,
      behavior: "walk", behaviorTime: 0, jump: 0, elev: 0, cause: "",
    };
  }

  /** 저장된 상태가 자는 중이면 침대 위에서 시작 */
  placeAsleep(): void {
    Object.assign(this.state, { x: BED.x, z: BED.z, heading: SLEEP_HEADING, behavior: "sleep", elev: BED.height });
  }

  /** 워커 프레임이 올 때마다 DN 발화율을 평활 */
  ingest(motor: Record<MotorGroup, number>, simDeltaMs: number): void {
    const a = 1 - Math.exp(-simDeltaMs / 1000 / SMOOTH_TAU);
    for (const k of Object.keys(motor) as MotorGroup[]) this.rates[k] += (motor[k] - this.rates[k]) * a;
  }

  /** 자고 있으면 깨운다 (쓰다듬기 등). 깨웠으면 true */
  wakeUp(): boolean {
    if (this.state.behavior !== "sleep") return false;
    this.onEvent("woken");
    this.leaveBed();
    return true;
  }

  private leaveBed(): void {
    const s = this.state;
    Object.assign(s, { x: BED_SIDE.x, z: BED_SIDE.z, heading: Math.PI / 2, behavior: "walk", behaviorTime: 0 });
    this.pauseUntil = 0;
  }

  update(dt: number, now: number, habitat: Habitat, care: Care): void {
    const s = this.state;
    const r = this.rates;
    const c = care.s;
    if (dt <= 0) return;

    for (const k of ["escape", "feed", "groom"] as const) if (r[k] > THRESH[k]) this.lastFired[k] = now;
    const holding = (k: "escape" | "feed" | "groom") => now - this.lastFired[k] < HOLD[k];

    // --- 행동 선택 (우선순위: 도약 > 수면 > 섭식 > 그루밍 > 이동)
    let next: Behavior;
    if (s.behavior === "escape" && s.jump < 1) next = "escape";
    else if (holding("escape")) next = "escape";
    else if (c.asleep) next = "sleep";
    else if (holding("feed")) next = "feed";
    else if (holding("groom")) next = "groom";
    else next = "walk";

    if (next !== s.behavior) {
      // 먹다가 멈췄을 때 30% 넘게 먹었으면 남은 조각까지 다 먹은 것으로
      if (s.behavior === "feed") {
        const food = habitat.foods.find((f) => f.id === this.eatingFood);
        if (food && food.amount < 0.7) habitat.remove(food.id);
        this.eatingFood = -1;
        this.eatingKind = null;
      }
      if (s.behavior === "sleep") {
        if (next === "escape") this.onEvent("woken");
        this.leaveBed();
      }
      if (next === "escape") {
        s.jump = 0;
        this.escapeDir = Math.random() < 0.5 ? -1 : 1;
        this.onEvent("scared");
      }
      if (next === "feed") {
        // 무엇을 먹기 시작했는지 먼저 정하고 알린다 (일기·말풍선이 간식 이름을 쓴다)
        this.eatingKind = habitat.nearestOf(s, Object.keys(SNACKS) as FoodKind[])?.food.kind ?? null;
        this.onEvent("ate");
      }
      s.behavior = next;
      s.behaviorTime = 0;
    }
    s.behaviorTime += dt;

    // --- 목표 속도·각속도
    let targetSpeed = 0;
    let targetTurn = 0;
    let targetElev = 0;
    const goingToBed = s.behavior === "walk" && (c.sleepiness >= 1 || (!habitat.lightsOn && c.sleepiness > 0.3));
    const steerTo = (x: number, z: number, stopAt: number, speed: number) => {
      const dist = Math.hypot(x - s.x, z - s.z);
      targetTurn = wrapAngle(Math.atan2(x - s.x, z - s.z) - s.heading) * 2.5;
      targetSpeed = dist > stopAt ? speed : 0;
      return dist;
    };
    const meal = habitat.nearestOf(s, LIKED_SNACKS); // 스스로 찾아가서 먹는 간식
    const mouth = habitat.nearestOf(s, Object.keys(SNACKS) as FoodKind[]); // 입에 닿은 간식
    const bitter = habitat.nearest(s, "bitter");

    switch (s.behavior) {
      case "escape": {
        s.jump = Math.min(1, s.jump + dt / HOLD.escape);
        targetSpeed = s.jump < 0.8 ? 2 : 0;
        targetTurn = this.escapeDir * 2.5 * (1 - s.jump);
        s.cause = `Giant Fiber(DNp01) ${r.escape.toFixed(0)} Hz ← LPLC2 루밍`;
        break;
      }
      case "feed": {
        if (mouth && mouth.dist < MOUTH_REACH + 0.2) {
          this.eatingFood = mouth.food.id;
          this.eatingKind = mouth.food.kind;
          care.eat(habitat.eat(mouth.food, dt), mouth.food.kind);
        }
        const snack = this.eatingKind ? SNACKS[this.eatingKind] : null;
        s.cause = `MN9 ${r.feed.toFixed(0)} Hz ← ${snack ? snack.label : "당"} 맛 뉴런`;
        break;
      }
      case "groom":
        s.cause = `그루밍 DN ${r.groom.toFixed(0)} Hz ← JO-F 접촉`;
        break;
      case "sleep": {
        s.x += (BED.x - s.x) * (1 - Math.exp(-dt * 4));
        s.z += (BED.z - s.z) * (1 - Math.exp(-dt * 4));
        s.heading = SLEEP_HEADING;
        targetElev = BED.height;
        s.cause = "졸림 (게임 상태)";
        if (c.sleepiness <= 0 || (habitat.lightsOn && c.sleepiness < 0.6 && s.behaviorTime > 3)) {
          this.onEvent("wake");
          this.leaveBed();
        }
        break;
      }
      case "walk": {
        // 쓴맛 접촉: 뒤로 물러나며 돌아서기 (국소 반사)
        const tasting = !!bitter && bitter.dist < MOUTH_REACH + 0.2;
        if (tasting && !this.tastingBitter) this.onEvent("bitter");
        this.tastingBitter = tasting;
        if (tasting) this.avoidUntil = now + 0.9;
        if (now < this.avoidUntil) {
          targetSpeed = -0.5;
          targetTurn = 1.8;
          s.cause = "쓴맛 GRN → 회피 반사";
          break;
        }

        if (this.talking) {
          targetTurn = wrapAngle(Math.atan2(CAMERA_HOME.x - s.x, CAMERA_HOME.z - s.z) - s.heading) * 3;
          s.cause = "대화 중";
          break;
        }

        if (goingToBed) {
          const dist = steerTo(BED_SIDE.x, BED_SIDE.z, 0.2, 0.45);
          s.cause = "졸려서 침대로";
          if (dist < 0.3) {
            this.onEvent("sleep");
            s.behavior = "sleep";
            s.behaviorTime = 0;
          }
          break;
        }

        // 처음 보는 간식은 배가 불러도 호기심에 한 번 다가가 맛본다
        const unknown = habitat.foods.find((f) => care.s.tastes[f.kind] === undefined && f.id !== this.refusedFood);
        if (unknown) {
          const label = SNACKS[unknown.kind].label;
          const dist = steerTo(unknown.x, unknown.z, MOUTH_REACH * 0.8, 0.6);
          s.cause = dist > MOUTH_REACH ? `처음 보는 ${label}…` : `${label} 맛보는 중`;
          if (dist < MOUTH_REACH) {
            if (this.atFoodSince < 0) this.atFoodSince = now;
            if (now - this.atFoodSince > 2.5) this.refusedFood = unknown.id; // 맛만 보고 반응은 뇌가 정한다
          } else this.atFoodSince = -1;
          break;
        }

        if (meal && meal.food.id !== this.refusedFood && c.hunger > 0.15) {
          const label = SNACKS[meal.food.kind].label;
          const dist = steerTo(meal.food.x, meal.food.z, MOUTH_REACH * 0.8, 0.7);
          s.cause = dist > MOUTH_REACH ? `배고파서 ${label} 쪽으로` : `${label} 맛보는 중`;
          if (dist < MOUTH_REACH) {
            if (this.atFoodSince < 0) this.atFoodSince = now;
            // 맛을 봤는데 MN9 가 반응하지 않으면(배부름) 거절
            if (now - this.atFoodSince > 2 && c.hunger < 0.35) {
              this.onEvent("full");
              this.refusedFood = meal.food.id;
            }
          } else this.atFoodSince = -1;
          break;
        }
        this.atFoodSince = -1;
        if (this.refusedFood >= 0 && c.hunger > 0.45) this.refusedFood = -1;

        if (now < this.visitUntil) {
          const dist = steerTo(USER_SPOT.x, USER_SPOT.z, 0.2, 0.55);
          if (dist < 0.3) {
            targetTurn = wrapAngle(Math.atan2(CAMERA_HOME.x - s.x, CAMERA_HOME.z - s.z) - s.heading) * 3;
            s.cause = "애정 → 나를 보러 옴";
          } else s.cause = "애정 → 다가오는 중";
          break;
        }

        if (now > this.nextPause) {
          this.pauseUntil = now + 2 + Math.random() * 3;
          this.nextPause = this.pauseUntil + 6 + Math.random() * 8;
          // 애정이 높으면 가끔 사용자 쪽으로 온다
          if (Math.random() < c.affection * 0.6) this.visitUntil = now + 9;
        }
        this.wanderTurn += (-this.wanderTurn * 0.5 + (Math.random() - 0.5) * 3) * dt;
        targetTurn = this.wanderTurn;
        targetSpeed = now < this.pauseUntil ? 0 : 0.4;
        s.cause = targetSpeed ? "산책 (VNC 드라이브)" : "두리번";
        break;
      }
    }

    if (s.behavior === "walk") {
      // 벽·침대 피하기 (침대로 가는 중에는 침대를 피하지 않는다)
      const wall = habitat.wallDistance(s);
      if (wall < 0.9) targetTurn += wrapAngle(Math.atan2(-s.x, -s.z) - s.heading) * (0.9 - wall) * 3;
      if (!goingToBed && insideBed(s.x, s.z, 0.6)) targetTurn += wrapAngle(Math.atan2(s.x - BED.x, s.z - BED.z) - s.heading) * 2;
      // DN 직접 기여: P9·MDN 은 속도, DNa01/02 좌우 차이는 회전
      targetSpeed += clamp((r.forward - r.backward) * 0.015, -0.8, 0.8);
      targetTurn += clamp((r.turn_left - r.turn_right) * 0.05, -2, 2);
      // 좌우 회전 DN 이 같이 켜지면(주로 pC1 설렘) 제자리에서 몸을 좌우로 흔든다
      const turnSum = r.turn_left + r.turn_right;
      const fidget = clamp((turnSum - 10) / 30, 0, 1);
      if (fidget > 0 && Math.abs(targetSpeed) < 0.25) {
        targetTurn += Math.sin(now * 5) * 2.4 * fidget;
        if (fidget > 0.3) s.cause = `pC1 설렘 → 회전 DN ${turnSum.toFixed(0)} Hz (안절부절)`;
      }
    }

    s.elev += (targetElev - s.elev) * (1 - Math.exp(-dt * 6));
    if (s.behavior === "sleep") {
      s.speed = 0;
      s.angVel = 0;
      return;
    }
    s.speed += (targetSpeed - s.speed) * (1 - Math.exp(-dt * 4));
    s.angVel += (targetTurn - s.angVel) * (1 - Math.exp(-dt * 5));
    s.heading = wrapAngle(s.heading + s.angVel * dt);
    s.x += Math.sin(s.heading) * s.speed * dt;
    s.z += Math.cos(s.heading) * s.speed * dt;
    const lim = ROOM_HALF - 0.2;
    s.x = clamp(s.x, -lim, lim);
    s.z = clamp(s.z, -lim, lim);
    // 침대 속으로 들어가지 않게 밖으로 밀어낸다
    if (insideBed(s.x, s.z, 0.15)) s.x = Math.max(s.x, BED.x + BED.width / 2 + 0.15);
  }

  /** 걷기 상태라도 거의 멈춰 있으면 "두리번"으로 표시 */
  static displayBehavior(s: BodyState): Behavior {
    return s.behavior === "walk" && Math.abs(s.speed) < 0.08 ? "idle" : s.behavior;
  }
}

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
