import * as THREE from "three";
import type { BodyState } from "../behavior/Controller.ts";
import type { Expr } from "../story/scripts.ts";
import type { AccessoryAnchor, BoneName, ExpressionName, Rig } from "./Rig.ts";

type Side = 1 | -1;

/** 방 안에서 잘 보이도록 실제 비율보다 크게 */
const SIZE = 1.4;

interface Leg {
  side: Side;
  /** 0 앞다리, 1 가운뎃다리, 2 뒷다리 */
  pair: 0 | 1 | 2;
  hip: THREE.Group;
  femur: THREE.Group;
  knee: THREE.Group;
  /** 삼각 보행에서 같이 움직이는 조 */
  tripodA: boolean;
}

/** 부드럽게 따라가는 포즈 값들 */
interface Params {
  lift: number; // 몸 높이 오프셋
  bodyPitch: number;
  headPitch: number;
  proboscis: number; // 주둥이 길이 배율
  frontRaise: number; // 앞다리 들어올림 (그루밍)
  fold: number; // 다리 접기 (수면)
  wingBuzz: number; // 날갯짓 진폭
  antenna: number; // 더듬이 세움(+)/처짐(-)
}

const REST: Params = { lift: 0, bodyPitch: 0, headPitch: 0, proboscis: 1, frontRaise: 0, fold: 0, wingBuzz: 0, antenna: 0 };

/**
 * 진짜 초파리 모양 아바타. 사람 모양 VRM 과 같은 뇌 출력(행동 상태)을 받아
 * 삼각 보행·앞다리 그루밍·주둥이 섭식·날갯짓 도약·다리 접고 수면으로 표현한다.
 */
export class FlyAvatar implements Rig {
  readonly kind = "fly" as const;
  readonly poseRoot = new THREE.Group();
  readonly object = new THREE.Group();
  readonly hipsHeight = 0.3 * SIZE;
  readonly height = 0.55 * SIZE;
  exprOverride: Expr | undefined;
  talking = false;

  private readonly head = new THREE.Group();
  private readonly thorax = new THREE.Group();
  private readonly proboscis = new THREE.Group();
  private readonly antennae: THREE.Group[] = [];
  private readonly wings: THREE.Group[] = [];
  private readonly legs: Leg[] = [];
  private readonly p: Params = { ...REST };
  private phase = 0;
  private t = 0;

  constructor() {
    const toon = (c: number) => new THREE.MeshToonMaterial({ color: c });
    const body = toon(0xc08440);
    const dark = toon(0x3a2412);
    const leg = toon(0x4d3119);
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, pos: [number, number, number], scale?: [number, number, number]) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...pos);
      if (scale) m.scale.set(...scale);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // 가슴·머리·배
    this.thorax.position.set(0, 0.34, 0.02);
    mesh(new THREE.SphereGeometry(0.16, 20, 16), body, this.thorax, [0, 0, 0], [1, 0.9, 1.15]);
    this.object.add(this.thorax);

    this.head.position.set(0, 0.03, 0.22);
    this.thorax.add(this.head);
    mesh(new THREE.SphereGeometry(0.12, 20, 16), toon(0xb5824a), this.head, [0, 0, 0]);
    for (const s of [1, -1] as Side[]) {
      const eye = new THREE.MeshPhongMaterial({ color: 0xd32f2f, emissive: 0x4a0a0a, shininess: 80, specular: 0xffc0c0 });
      mesh(new THREE.SphereGeometry(0.075, 20, 16), eye, this.head, [s * 0.085, 0.02, 0.03], [0.7, 1, 0.9]);
      const antenna = new THREE.Group();
      antenna.position.set(s * 0.03, 0.09, 0.08);
      mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.11, 8), dark, antenna, [0, 0.055, 0]);
      mesh(new THREE.SphereGeometry(0.026, 10, 8), dark, antenna, [0, 0.115, 0]);
      antenna.rotation.set(0.5, 0, s * -0.3);
      this.head.add(antenna);
      this.antennae.push(antenna);
    }
    this.proboscis.position.set(0, -0.09, 0.07);
    mesh(new THREE.CylinderGeometry(0.018, 0.028, 0.08, 8), dark, this.proboscis, [0, -0.04, 0]);
    this.head.add(this.proboscis);

    const abdomen = new THREE.Group();
    abdomen.position.set(0, -0.02, -0.27);
    abdomen.rotation.x = 0.2;
    mesh(new THREE.SphereGeometry(0.15, 20, 16), toon(0xc49a5c), abdomen, [0, 0, 0], [0.9, 0.8, 1.5]);
    for (const z of [0.08, -0.05, -0.16]) {
      const ring = mesh(new THREE.TorusGeometry(0.12 - Math.abs(z) * 0.25, 0.018, 6, 20), dark, abdomen, [0, 0.01, z]);
      ring.scale.set(1.05, 0.95, 1);
    }
    this.thorax.add(abdomen);

    // 날개: 배 위로 접혀 있다가 떤다
    const membrane = new THREE.MeshPhysicalMaterial({
      color: 0xe8f6ff, transparent: true, opacity: 0.35, roughness: 0.15, iridescence: 1, side: THREE.DoubleSide, depthWrite: false,
    });
    for (const s of [1, -1] as Side[]) {
      const wing = new THREE.Group();
      wing.position.set(s * 0.05, 0.12, -0.02);
      const blade = mesh(new THREE.CircleGeometry(0.5, 24), membrane, wing, [s * 0.05, 0, -0.22], [0.14, 0.45, 1]);
      blade.rotation.x = -Math.PI / 2;
      blade.castShadow = false;
      wing.rotation.y = s * 0.2;
      this.thorax.add(wing);
      this.wings.push(wing);
    }

    // 다리 6개: 엉덩이(좌우 흔들기) → 넓적다리(들기) → 무릎(굽히기)
    for (const pair of [0, 1, 2] as const) {
      for (const side of [1, -1] as Side[]) {
        const hip = new THREE.Group();
        hip.position.set(side * 0.1, -0.06, 0.1 - pair * 0.1);
        const femur = new THREE.Group();
        const knee = new THREE.Group();
        knee.position.y = -0.2;
        mesh(new THREE.SphereGeometry(0.024, 10, 8), leg, femur, [0, 0, 0]);
        mesh(new THREE.CylinderGeometry(0.019, 0.024, 0.2, 10), leg, femur, [0, -0.1, 0]);
        mesh(new THREE.SphereGeometry(0.021, 10, 8), leg, knee, [0, 0, 0]);
        mesh(new THREE.CylinderGeometry(0.011, 0.018, 0.36, 10), leg, knee, [0, -0.18, 0]);
        mesh(new THREE.SphereGeometry(0.016, 8, 6), leg, knee, [0, -0.36, 0]);
        femur.add(knee);
        hip.add(femur);
        this.thorax.add(hip);
        // L1·R2·L3 가 한 조, R1·L2·R3 가 다른 조
        const tripodA = (pair === 1) === (side === -1);
        this.legs.push({ side, pair, hip, femur, knee, tripodA });
      }
    }

    this.object.scale.setScalar(SIZE);
    this.poseRoot.add(this.object);
  }

  bone(_name: BoneName): THREE.Object3D | undefined {
    return undefined;
  }

  attachNode(name: "head" | "neck" | "upperChest"): THREE.Object3D | undefined {
    return name === "upperChest" ? this.thorax : this.head;
  }

  /** 리본은 더듬이 옆 정수리, 목도리는 머리와 가슴 사이 */
  accessoryAnchors(): Record<"ribbon" | "scarf", AccessoryAnchor> {
    return {
      ribbon: { node: this.head, position: new THREE.Vector3(0.11, 0.47, 0.25).multiplyScalar(SIZE), rotation: new THREE.Euler(0, 0.4, -0.35), scale: 1.1 },
      scarf: { node: this.thorax, position: new THREE.Vector3(0, 0.36, 0.13).multiplyScalar(SIZE), rotation: new THREE.Euler(1.35, 0, 0), scale: 1.65 },
    };
  }

  setExpression(_name: ExpressionName, _weight: number): void {}

  update(dt: number, s?: BodyState, mood = 0.5): void {
    if (!s) return;
    this.t += dt;
    const t = this.t;
    const walkAmt = s.behavior === "walk" ? Math.min(1, Math.abs(s.speed) / 0.4) : 0;
    // 초파리 보행은 사람보다 훨씬 빠르다
    this.phase += dt * s.speed * Math.PI * 2 * 3.2;

    const air = s.behavior === "escape" && s.jump < 0.75 ? Math.sin((s.jump / 0.75) * Math.PI) : 0;
    const target: Params = { ...REST, antenna: (mood - 0.5) * 0.6 };
    switch (s.behavior) {
      case "groom":
        Object.assign(target, { frontRaise: 1, headPitch: 0.35, bodyPitch: -0.08 });
        break;
      case "feed":
        Object.assign(target, { proboscis: 2.2 + 0.8 * Math.sin(t * 6), headPitch: 0.45, lift: -0.04, bodyPitch: 0.1 });
        break;
      case "escape":
        Object.assign(target, { lift: 0.7 * air, wingBuzz: air > 0 ? 0.9 : 0.3, bodyPitch: -0.2 * air, antenna: 0.4 });
        break;
      case "sleep":
        Object.assign(target, { fold: 1, lift: -0.13, antenna: -0.5, headPitch: 0.25 });
        break;
    }
    if (this.exprOverride === "happy") target.antenna = 0.5;
    else if (this.exprOverride === "sad") target.antenna = -0.5;
    else if (this.exprOverride === "angry" || this.exprOverride === "surprised") target.wingBuzz = Math.max(target.wingBuzz, 0.25);
    if (this.talking) target.proboscis = Math.max(target.proboscis, 1.3 + 0.3 * Math.sin(t * 20));

    const k = 1 - Math.exp(-dt * (s.behavior === "escape" ? 20 : 8));
    for (const key of Object.keys(REST) as (keyof Params)[]) this.p[key] += (target[key] - this.p[key]) * k;
    const p = this.p;

    this.poseRoot.position.y = p.lift * SIZE;
    this.object.rotation.x = p.bodyPitch;
    this.head.rotation.x = p.headPitch;
    this.proboscis.scale.y = p.proboscis;

    this.antennae.forEach((a, i) => {
      const s2 = i === 0 ? 1 : -1;
      a.rotation.x = 0.5 - p.antenna + Math.sin(t * 2.3 + i) * 0.06 + (this.talking ? Math.sin(t * 17 + i) * 0.15 : 0);
      a.rotation.z = s2 * (-0.3 - Math.sin(t * 1.4 + i) * 0.05);
    });

    const buzz = p.wingBuzz * Math.sin(t * Math.PI * 2 * 30);
    this.wings.forEach((w, i) => {
      const s2 = i === 0 ? 1 : -1;
      w.rotation.z = s2 * (0.05 + buzz * 0.8 + p.wingBuzz * 0.4);
      w.rotation.y = s2 * (0.2 + p.wingBuzz * 0.6);
    });

    for (const leg of this.legs) {
      const { side, pair } = leg;
      const legPhase = this.phase + (leg.tripodA ? 0 : Math.PI);
      const baseYaw = [-0.6, 0, 0.6][pair] * side;
      let yaw = baseYaw + side * 0.35 * Math.sin(legPhase) * walkAmt;
      let femurZ = side * (2.0 + 0.3 * Math.max(0, Math.cos(legPhase)) * walkAmt);
      let kneeZ = -side * 1.9;
      if (pair === 0 && p.frontRaise > 0.01) {
        // 앞다리를 들어 서로 비빈다
        const rub = Math.sin(t * 14);
        yaw = baseYaw * (1 - p.frontRaise) + -1.2 * side * p.frontRaise;
        femurZ = femurZ * (1 - p.frontRaise) + side * 2.7 * p.frontRaise;
        kneeZ = kneeZ * (1 - p.frontRaise) + -side * (2.3 + 0.35 * rub) * p.frontRaise;
      }
      if (air > 0) kneeZ *= 1 - 0.4 * air; // 뛰어오를 때 다리를 편다
      femurZ = femurZ * (1 - p.fold) + side * 2.6 * p.fold;
      kneeZ = kneeZ * (1 - p.fold) + -side * 2.8 * p.fold;
      leg.hip.rotation.y = yaw;
      leg.femur.rotation.z = femurZ;
      leg.knee.rotation.z = kneeZ;
    }
  }
}
