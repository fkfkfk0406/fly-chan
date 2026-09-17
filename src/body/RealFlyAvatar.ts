import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { BodyState } from "../behavior/Controller.ts";
import type { Expr } from "../story/scripts.ts";
import type { AccessoryAnchor, BoneName, ExpressionName, Rig } from "./Rig.ts";

// 실사 초파리 아바타. flybody(TuragaLab/flybody, Apache 2.0)의 해부학 모델을 pipeline/build_fly_model.py 로 줄인 것.
// 몸 마디마다 MuJoCo 관절(축·기본 자세)이 있어서, 뇌 출력(행동 상태)을 관절 각도로 바꿔 움직인다.

interface JointSpec {
  name: string;
  axis: [number, number, number];
  range: [number, number];
  ref: number;
}

/** 모델 단위(cm)를 방 크기에 맞춘 배율. 실제보다 훨씬 크게 */
const SCALE = 4.6;

type Side = "left" | "right";
const SIDES: Side[] = ["left", "right"];
const PAIRS = ["T1", "T2", "T3"] as const;

/** 부드럽게 따라가는 포즈 값 */
interface Params {
  lift: number;
  bodyPitch: number;
  head: number;
  proboscis: number;
  groom: number;
  fold: number;
  wings: number;
  antenna: number;
}
const REST: Params = { lift: 0, bodyPitch: 0, head: 0, proboscis: 0, groom: 0, fold: 0, wings: 0, antenna: 0 };

export class RealFlyAvatar implements Rig {
  readonly kind = "fly" as const;
  readonly poseRoot = new THREE.Group();
  readonly object = new THREE.Group();
  hipsHeight = 0.3;
  height = 0.6;
  exprOverride: Expr | undefined;
  talking = false;

  private readonly nodes = new Map<string, { node: THREE.Object3D; rest: THREE.Quaternion; joints: JointSpec[] }>();
  /** 관절 이름 → 기본 자세에서 더할 각도 */
  private readonly delta = new Map<string, number>();
  private readonly p: Params = { ...REST };
  private phase = 0;
  private t = 0;
  private readonly q = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();

  static async load(base = `${import.meta.env.BASE_URL}fly/`): Promise<RealFlyAvatar> {
    const [gltf, rig] = await Promise.all([
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${base}fly.glb`),
      fetch(`${base}rig.json`).then((r) => r.json() as Promise<Record<string, JointSpec[]>>),
    ]);
    return new RealFlyAvatar(gltf.scene, rig);
  }

  private constructor(model: THREE.Object3D, rig: Record<string, JointSpec[]>) {
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.transparent) {
        mat.depthWrite = false; // 날개막
        mesh.castShadow = false;
        mesh.renderOrder = 1;
      }
    });
    for (const [name, joints] of Object.entries(rig)) {
      const node = model.getObjectByName(name);
      if (node) this.nodes.set(name, { node, rest: node.quaternion.clone(), joints });
    }

    // MuJoCo 는 z 가 위, x 가 머리 쪽. 방은 y 가 위, 정면 +Z
    const upright = new THREE.Group();
    upright.rotation.set(-Math.PI / 2, 0, 0);
    upright.add(model);
    const facing = new THREE.Group();
    facing.rotation.y = -Math.PI / 2;
    facing.add(upright);
    facing.scale.setScalar(SCALE);
    this.object.add(facing);

    // 기본 자세에서 발끝이 바닥(y=0)에 닿게
    this.pose();
    this.object.updateMatrixWorld(true);
    const claws = [...this.nodes.keys()].filter((n) => n.startsWith("claw_")).map((n) => this.nodes.get(n)!.node);
    const minY = Math.min(...claws.map((c) => c.getWorldPosition(new THREE.Vector3()).y));
    facing.position.y = -minY;
    const box = new THREE.Box3().setFromObject(this.object);
    this.height = box.max.y - box.min.y;
    this.hipsHeight = this.height * 0.5;
    this.poseRoot.add(this.object);
  }

  private set(joint: string, value: number): void {
    this.delta.set(joint, value);
  }

  /** 관절 각도 = 기본 자세(springref) + delta, 범위 안으로 */
  private pose(): void {
    for (const { node, rest, joints } of this.nodes.values()) {
      node.quaternion.copy(rest);
      for (const j of joints) {
        const lo = Math.min(j.range[0], j.ref);
        const hi = Math.max(j.range[1], j.ref);
        const angle = THREE.MathUtils.clamp(j.ref + (this.delta.get(j.name) ?? 0), lo, hi);
        node.quaternion.multiply(this.q.setFromAxisAngle(this.axis.set(...j.axis), angle));
      }
    }
  }

  bone(_name: BoneName): THREE.Object3D | undefined {
    return undefined;
  }

  attachNode(name: "head" | "neck" | "upperChest"): THREE.Object3D | undefined {
    return this.nodes.get(name === "upperChest" ? "wing_left" : "head")?.node.parent ?? undefined;
  }

  /** 리본은 머리 위 옆쪽, 목도리는 머리와 가슴 사이. 모델 크기가 SCALE 배라 scale 은 그만큼 나눈다 */
  accessoryAnchors(): Record<"ribbon" | "scarf", AccessoryAnchor> {
    const head = this.nodes.get("head")!.node;
    const thorax = head.parent ?? undefined;
    this.object.updateMatrixWorld(true);
    const box = new THREE.Box3();
    // 압축된 GLB 에서는 메시가 "*_geom" 노드 아래에 있다 (몸 마디 자식은 빼고 머리 메시만)
    for (const child of head.children) if (child.name.endsWith("_geom")) box.expandByObject(child);
    const size = box.getSize(new THREE.Vector3());
    const neck = head.getWorldPosition(new THREE.Vector3());
    return {
      ribbon: {
        node: head,
        position: new THREE.Vector3(box.max.x - size.x * 0.3, box.max.y - size.y * 0.12, box.getCenter(new THREE.Vector3()).z - size.z * 0.1),
        rotation: new THREE.Euler(0, 0.4, -0.35),
        scale: 0.8 / SCALE,
      },
      scarf: { node: thorax, position: neck.add(new THREE.Vector3(0, -size.y * 0.1, -size.z * 0.05)), rotation: new THREE.Euler(1.5, 0, 0), scale: 1.5 / SCALE },
    };
  }

  setExpression(_name: ExpressionName, _weight: number): void {}

  update(dt: number, s?: BodyState, mood = 0.5): void {
    if (!s) return;
    this.t += dt;
    const t = this.t;
    const walkAmt = s.behavior === "walk" ? Math.min(1, Math.abs(s.speed) / 0.4) : 0;
    this.phase += dt * s.speed * Math.PI * 2 * 3.2;
    const air = s.behavior === "escape" && s.jump < 0.75 ? Math.sin((s.jump / 0.75) * Math.PI) : 0;

    const target: Params = { ...REST, antenna: (mood - 0.5) * 0.6 };
    switch (s.behavior) {
      case "groom":
        Object.assign(target, { groom: 1, head: 0.25, bodyPitch: -0.06 });
        break;
      case "feed":
        Object.assign(target, { proboscis: 1, head: 0.3, bodyPitch: 0.08 });
        break;
      case "escape":
        Object.assign(target, { lift: 0.7 * air, wings: air > 0 ? 1 : 0.4, bodyPitch: -0.2 * air, antenna: 0.4 });
        break;
      case "sleep":
        Object.assign(target, { fold: 1, lift: -0.1, antenna: -0.5, head: 0.2 });
        break;
    }
    if (this.exprOverride === "happy") target.antenna = 0.5;
    else if (this.exprOverride === "sad") target.antenna = -0.5;
    else if (this.exprOverride === "angry" || this.exprOverride === "surprised") target.wings = Math.max(target.wings, 0.3);

    const k = 1 - Math.exp(-dt * (s.behavior === "escape" ? 20 : 8));
    for (const key of Object.keys(REST) as (keyof Params)[]) this.p[key] += (target[key] - this.p[key]) * k;
    const p = this.p;

    this.poseRoot.position.y = p.lift;
    this.object.rotation.x = p.bodyPitch;
    this.set("head", -p.head);

    // 주둥이: 먹을 때 뻗어서 핥고, 말할 때 조금 움직인다
    const lick = p.proboscis * (0.5 + 0.5 * Math.sin(t * 7));
    const talk = this.talking ? 0.25 * (0.5 + 0.5 * Math.sin(t * 18)) : 0;
    // 확인한 방향: rostrum·haustellum 모두 음수가 아래로 뻗기
    this.set("rostrum", -(1.1 * p.proboscis + talk));
    this.set("haustellum", -(0.8 * p.proboscis + 0.5 * lick + talk));

    // 더듬이
    for (const side of SIDES) {
      const i = side === "left" ? 0 : 1;
      this.set(`antenna_${side}`, p.antenna * 0.5 + Math.sin(t * 2.3 + i) * 0.05 + (this.talking ? Math.sin(t * 17 + i) * 0.12 : 0));
    }

    // 날개: 평소엔 배 위에 접고, 도약·놀람 때 펴서 떤다
    const buzz = p.wings * Math.sin(t * Math.PI * 2 * 28);
    for (const side of SIDES) {
      this.set(`wing_yaw_${side}`, -1.4 * Math.min(1, p.wings * 1.4));
      this.set(`wing_pitch_${side}`, buzz * 1.2);
      this.set(`wing_roll_${side}`, buzz * 0.6);
    }

    // 배: 숨쉬듯 아주 조금
    this.set("abdomen", Math.sin(t * 1.3) * 0.03);

    // 다리: 삼각 보행 (L1·R2·L3 / R1·L2·R3)
    for (const pair of PAIRS) {
      for (const side of SIDES) {
        const tripodA = (pair === "T2") === (side === "right");
        const ph = this.phase + (tripodA ? 0 : Math.PI);
        // 확인한 방향: coxa + = 뒤로 젖힘, femur + = 접어 올림, tibia + = 펴기
        // 딛는 동안 뒤로 밀고(cos>0 구간), 드는 동안 접어 올려 앞으로 가져온다
        const swing = -Math.sin(ph) * walkAmt;
        const up = Math.max(0, -Math.cos(ph)) * walkAmt;
        let coxa = 0.3 * swing;
        let femur = 0.55 * up;
        let tibia = -0.3 * up;
        if (pair === "T1" && p.groom > 0.01) {
          // 앞다리를 머리 앞으로 접어 올려 서로 비빈다
          const rub = Math.sin(t * 14 + (side === "left" ? 0 : Math.PI));
          coxa = coxa * (1 - p.groom) - 0.25 * p.groom;
          femur = femur * (1 - p.groom) + (1.0 + 0.12 * rub) * p.groom;
          tibia = tibia * (1 - p.groom) + (0.2 + 0.45 * rub) * p.groom;
        }
        if (air > 0) {
          // 뛰어오르면 가운뎃다리·뒷다리를 펴고 앞다리는 늘어뜨린다
          tibia += (pair === "T1" ? 0.3 : 0.9) * air;
        }
        femur = femur * (1 - p.fold) + 1.0 * p.fold;
        tibia = tibia * (1 - p.fold) - 0.2 * p.fold;
        this.set(`coxa_${pair}_${side}`, coxa);
        this.set(`femur_${pair}_${side}`, femur);
        this.set(`tibia_${pair}_${side}`, tibia);
      }
    }
    this.pose();
  }
}
