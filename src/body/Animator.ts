import * as THREE from "three";
import type { Behavior, BodyState } from "../behavior/Controller.ts";
import { BONES, type BoneName, type ExpressionName, type Rig } from "./Rig.ts";
import { FlyParts } from "./FlyParts.ts";
import type { Expr } from "../story/scripts.ts";

type Vec3 = [number, number, number];

interface Pose {
  bones: Partial<Record<BoneName, Vec3>>;
  /** hips 높이 대비 몸 전체 오프셋 (m) */
  rootY: number;
  rootPitch: number;
  rootRoll: number;
  expr: Partial<Record<ExpressionName, number>>;
  wingFlap: number;
  wingFreq: number;
  wingFold: number;
  twitch: number;
}

interface Ctx {
  t: number;
  phase: number;
  walkAmt: number;
  state: BodyState;
  hipsHeight: number;
}

const ARM_DOWN = 1.2;
/** 가끔 날개를 팔락이는 시간 (s) */
const FLUTTER_SEC = 0.8;

function base(c: Ctx): Pose {
  const breathe = Math.sin(c.t * 1.7) * 0.025;
  return {
    bones: {
      leftUpperArm: [0, 0, -ARM_DOWN], rightUpperArm: [0, 0, ARM_DOWN],
      leftLowerArm: [0, -0.15, 0], rightLowerArm: [0, 0.15, 0],
      chest: [breathe, 0, 0],
    },
    rootY: 0, rootPitch: 0, rootRoll: 0,
    expr: {},
    wingFlap: 0.02, wingFreq: 0.6, wingFold: 0.15, twitch: 0,
  };
}

const POSES: Record<"idle" | Exclude<Behavior, "idle">, (c: Ctx) => Pose> = {
  idle(c) {
    const p = base(c);
    Object.assign(p.bones, {
      head: [Math.sin(c.t * 0.31) * 0.08, Math.sin(c.t * 0.45) * 0.45, Math.sin(c.t * 0.7) * 0.06],
      hips: [0, 0, Math.sin(c.t * 0.5) * 0.03],
      leftUpperLeg: [0, 0, -Math.sin(c.t * 0.5) * 0.03],
      rightUpperLeg: [0, 0, -Math.sin(c.t * 0.5) * 0.03],
    });
    p.expr = { relaxed: 0.25 };
    return p;
  },

  walk(c) {
    const p = base(c);
    const f = c.phase;
    const a = Math.max(0.35, c.walkAmt);
    const dir = Math.sign(c.state.speed) || 1;
    const knee = (ph: number) => 0.15 + 0.75 * Math.max(0, Math.sin(ph + 0.9 * dir));
    Object.assign(p.bones, {
      leftUpperLeg: [-0.5 * a * Math.sin(f), 0, 0],
      rightUpperLeg: [0.5 * a * Math.sin(f), 0, 0],
      leftLowerLeg: [knee(f) * a, 0, 0],
      rightLowerLeg: [knee(f + Math.PI) * a, 0, 0],
      leftFoot: [-0.15 * a * Math.cos(f), 0, 0],
      rightFoot: [0.15 * a * Math.cos(f), 0, 0],
      leftUpperArm: [0.45 * a * Math.sin(f), 0, -ARM_DOWN],
      rightUpperArm: [-0.45 * a * Math.sin(f), 0, ARM_DOWN],
      leftLowerArm: [0, -0.35, 0],
      rightLowerArm: [0, 0.35, 0],
      spine: [0.06 * a, 0.08 * a * Math.sin(f), 0],
      head: [0, -0.06 * a * Math.sin(f), 0],
    });
    p.rootY = -0.025 * a * Math.abs(Math.sin(f)) - 0.01;
    p.expr = { happy: 0.3 };
    p.wingFlap = 0.04;
    p.wingFreq = 1.5;
    return p;
  },

  groom(c) {
    const p = base(c);
    const rub = Math.sin(c.t * 13);
    Object.assign(p.bones, {
      leftUpperArm: [0, -0.9, 1.1], rightUpperArm: [0, 0.9, -1.1],
      leftLowerArm: [0, -1.55 + rub * 0.25, 0.1 * rub], rightLowerArm: [0, 1.55 + rub * 0.25, 0.1 * rub],
      neck: [0.12, 0, 0],
      head: [0.22, Math.sin(c.t * 2) * 0.12, Math.sin(c.t * 3.2) * 0.1],
      spine: [0.05, 0, 0],
    });
    p.expr = { relaxed: 0.8, blink: 0.55 };
    p.twitch = 1;
    p.wingFlap = 0.08;
    p.wingFreq = 3;
    return p;
  },

  feed(c) {
    const p = base(c);
    const chew = 0.5 + 0.5 * Math.sin(c.t * 9);
    Object.assign(p.bones, {
      leftUpperLeg: [-1.35, 0.15, 0], rightUpperLeg: [-1.35, -0.15, 0],
      leftLowerLeg: [2.25, 0, 0], rightLowerLeg: [2.25, 0, 0],
      leftFoot: [-0.85, 0, 0], rightFoot: [-0.85, 0, 0],
      spine: [0.35, 0, 0], chest: [0.15, 0, 0], neck: [0.15, 0, 0], head: [0.2, 0, Math.sin(c.t * 1.5) * 0.06],
      leftUpperArm: [0, -0.9, -0.9], rightUpperArm: [0, 0.9, 0.9],
      leftLowerArm: [0, -1.25 - chew * 0.15, 0], rightLowerArm: [0, 1.25 + chew * 0.15, 0],
    });
    p.rootY = -c.hipsHeight * 0.48;
    p.expr = { happy: 0.7, aa: chew * 0.8 };
    p.twitch = 0.3;
    return p;
  },

  escape(c) {
    const p = base(c);
    const j = c.state.jump;
    const air = j < 0.75 ? Math.sin((j / 0.75) * Math.PI) : 0;
    const land = j >= 0.75 ? Math.sin(((j - 0.75) / 0.25) * Math.PI) : 0;
    Object.assign(p.bones, {
      leftUpperArm: [-0.3, 0, 1.25 * air - ARM_DOWN * (1 - air)],
      rightUpperArm: [-0.3, 0, -1.25 * air + ARM_DOWN * (1 - air)],
      leftUpperLeg: [-0.9 * air - 1.0 * land, 0, 0], rightUpperLeg: [-0.7 * air - 1.0 * land, 0, 0],
      leftLowerLeg: [1.4 * air + 1.7 * land, 0, 0], rightLowerLeg: [1.2 * air + 1.7 * land, 0, 0],
      spine: [-0.18 * air + 0.3 * land, 0, 0],
      head: [-0.15 * air, 0, 0],
    });
    p.rootY = 1.1 * air - c.hipsHeight * 0.35 * land;
    p.expr = { surprised: 1 };
    p.wingFlap = 0.75 * (air > 0 ? 1 : 0.3);
    p.wingFreq = 32;
    p.wingFold = 0;
    return p;
  },

  sleep(c) {
    const p = base(c);
    Object.assign(p.bones, {
      leftUpperLeg: [-0.9, 0, 0], rightUpperLeg: [-0.6, 0, 0],
      leftLowerLeg: [1.3, 0, 0], rightLowerLeg: [1.0, 0, 0],
      leftUpperArm: [0, -1.2, -0.5], rightUpperArm: [0, 1.0, 1.6],
      leftLowerArm: [0, -1.1, 0], rightLowerArm: [0, 1.6, 0],
      head: [0.25, 0, -0.25], spine: [0.15, 0, 0],
      chest: [Math.sin(c.t * 1.1) * 0.035, 0, 0],
    });
    p.rootRoll = Math.PI / 2;
    p.rootY = -(c.hipsHeight - 0.2);
    p.expr = { blink: 1, relaxed: 0.6 };
    p.wingFold = 1;
    p.wingFlap = 0;
    return p;
  },
};

const EXPRESSIONS: ExpressionName[] = ["aa", "happy", "surprised", "relaxed", "blink", "sad", "angry"];
const EMOTIONS: ExpressionName[] = ["happy", "surprised", "relaxed", "sad", "angry"];
type PoseKey = keyof typeof POSES;

/** 행동 상태 → 포즈 블렌딩 → 본 회전·표정·파츠 */
export class Animator {
  /** 몸 기울기·높이를 적용하는 노드 (hips 높이에 위치) */
  readonly poseRoot = new THREE.Group();
  private readonly weights: Record<PoseKey, number> = { idle: 1, walk: 0, groom: 0, feed: 0, escape: 0, sleep: 0 };
  private readonly parts: FlyParts;
  private phase = 0;
  private t = 0;
  private nextBlink = 2;
  private blinkStart = -1;
  private nextFlutter = 5;
  private flutterStart = -1;
  /** 대화 대사의 표정 (없으면 기분·행동으로 정함) */
  exprOverride: Expr | undefined;
  /** 대사가 찍히는 동안 입을 움직인다 */
  talking = false;

  constructor(private readonly rig: Rig) {
    this.parts = new FlyParts(rig);
    rig.object.position.y = -rig.hipsHeight;
    this.poseRoot.add(rig.object);
    this.poseRoot.position.y = rig.hipsHeight;
  }

  /** @param mood 0 우울 → 1 행복 (돌봄 상태). 포즈 표정 위에 덧입힌다 */
  update(dt: number, s: BodyState, mood = 0.5): void {
    this.t += dt;
    const t = this.t;
    this.phase += dt * s.speed * ((Math.PI * 2) / 1.0);

    // 목표 가중치
    const walkAmt = Math.min(1, Math.abs(s.speed) / 0.55);
    const target: Record<PoseKey, number> = { idle: 0, walk: 0, groom: 0, feed: 0, escape: 0, sleep: 0 };
    if (s.behavior === "walk" || s.behavior === "idle") {
      target.walk = walkAmt;
      target.idle = 1 - walkAmt;
    } else target[s.behavior] = 1;

    let sum = 0;
    for (const k of Object.keys(target) as PoseKey[]) {
      const rate = k === "sleep" || this.weights.sleep > 0.01 ? 1.6 : k === "escape" ? 14 : 6;
      this.weights[k] += (target[k] - this.weights[k]) * (1 - Math.exp(-dt * rate));
      sum += this.weights[k];
    }

    const ctx: Ctx = { t, phase: this.phase, walkAmt, state: s, hipsHeight: this.rig.hipsHeight };
    const acc: Record<string, Vec3> = {};
    const expr: Record<string, number> = {};
    let rootY = 0, pitch = 0, roll = 0, flap = 0, freq = 0, fold = 0, twitch = 0;

    for (const k of Object.keys(POSES) as PoseKey[]) {
      const w = this.weights[k] / sum;
      if (w < 1e-3) continue;
      const p = POSES[k](ctx);
      for (const b of BONES) {
        const v = p.bones[b];
        if (!v) continue;
        const a = (acc[b] ??= [0, 0, 0]);
        a[0] += v[0] * w;
        a[1] += v[1] * w;
        a[2] += v[2] * w;
      }
      for (const [e, v] of Object.entries(p.expr)) expr[e] = (expr[e] ?? 0) + v * w;
      rootY += p.rootY * w;
      pitch += p.rootPitch * w;
      roll += p.rootRoll * w;
      flap += p.wingFlap * w;
      freq += p.wingFreq * w;
      fold += p.wingFold * w;
      twitch += p.twitch * w;
    }

    // 회전 중에는 고개가 먼저 돈다
    const lead = Math.max(-0.5, Math.min(0.5, s.angVel * 0.22));
    (acc.head ??= [0, 0, 0])[1] += lead;
    (acc.spine ??= [0, 0, 0])[1] += lead * 0.3;

    const f = this.rig.flipXZ ? -1 : 1;
    for (const b of BONES) {
      const v = acc[b];
      this.rig.bone(b)?.rotation.set(f * (v?.[0] ?? 0), v?.[1] ?? 0, f * (v?.[2] ?? 0));
    }
    this.poseRoot.position.y = this.rig.hipsHeight + rootY;
    this.poseRoot.rotation.set(pitch, 0, roll);

    // 눈 깜빡임
    if (t > this.nextBlink) {
      this.blinkStart = t;
      this.nextBlink = t + 2.5 + Math.random() * 3;
    }
    const sinceBlink = t - this.blinkStart;
    const blink = sinceBlink < 0.15 ? Math.sin((sinceBlink / 0.15) * Math.PI) : 0;
    // 기분 덧입히기 (자는 중에는 편안한 얼굴만)
    const awake = s.behavior !== "sleep";
    expr.happy = Math.max(expr.happy ?? 0, awake ? (mood - 0.55) * 1.6 : 0);
    expr.sad = Math.max(expr.sad ?? 0, awake ? (0.35 - mood) * 2 : 0);
    if (this.exprOverride && awake) {
      for (const e of EMOTIONS) expr[e] = e === this.exprOverride ? 1 : Math.min(expr[e] ?? 0, 0.1);
    }
    if (this.talking && awake) expr.aa = Math.max(expr.aa ?? 0, 0.3 + 0.3 * Math.sin(t * 24));
    for (const e of EXPRESSIONS) {
      const v = e === "blink" ? Math.max(expr.blink ?? 0, blink) : expr[e] ?? 0;
      this.rig.setExpression(e, Math.min(1, Math.max(0, v)));
    }

    // 가끔 날개를 팔락인다 (깨어 있고 날개를 편 동안)
    if (t > this.nextFlutter) {
      if (s.behavior !== "sleep" && fold < 0.3) this.flutterStart = t;
      this.nextFlutter = t + 6 + Math.random() * 10;
    }
    const since = t - this.flutterStart;
    if (since < FLUTTER_SEC) {
      const env = Math.sin((since / FLUTTER_SEC) * Math.PI);
      flap = Math.max(flap, 0.3 * env);
      freq = Math.max(freq, 6);
    }

    this.parts.update(t, flap, freq, fold, twitch);
    this.rig.update(dt);
  }
}
