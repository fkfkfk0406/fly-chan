import * as THREE from "three";
import type { Rig } from "./Rig.ts";

/** 초파리 파츠: 더듬이 한 쌍과 반투명 날개 한 쌍 */
export class FlyParts {
  private readonly antennae: THREE.Group[] = [];
  private readonly wings: THREE.Group[] = [];

  constructor(rig: Rig) {
    rig.object.updateMatrixWorld(true);
    const head = rig.attachNode("head");
    const chest = rig.attachNode("upperChest");
    const headPos = head?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, rig.height * 0.85, 0);
    const chestPos = chest?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, rig.height * 0.7, 0);
    const minY = new THREE.Box3().setFromObject(rig.object).min.y;
    const top = minY + rig.height;

    // 더듬이: 정수리 약간 앞, 바깥·앞으로 휘어진 곡선
    const stalk = new THREE.MeshToonMaterial({ color: 0x3a2a3f });
    const tipMat = new THREE.MeshToonMaterial({ color: 0xff5d7a, emissive: 0x6a1020 });
    const headScale = top - headPos.y;
    for (const s of [1, -1]) {
      const g = new THREE.Group();
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(s * 0.03, 0.08, 0.02),
        new THREE.Vector3(s * 0.08, 0.15, 0.07),
        new THREE.Vector3(s * 0.14, 0.18, 0.13),
      ].map((v) => v.multiplyScalar(headScale / 0.28)));
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.0045, 6), stalk));
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.016 * (headScale / 0.28), 12, 10), tipMat);
      tip.position.copy(curve.getPoint(1));
      g.add(tip);
      this.attach(g, head, rig, new THREE.Vector3(s * 0.035, top - headScale * 0.12, headPos.z + headScale * 0.12));
      this.antennae.push(g);
    }

    // 날개: 등 뒤 XY 평면, 뿌리를 축으로 퍼덕임
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.12, 0.09, 0.42, 0.13, 0.56, 0.05);
    shape.bezierCurveTo(0.6, 0.0, 0.5, -0.1, 0.3, -0.08);
    shape.bezierCurveTo(0.15, -0.06, 0.05, -0.03, 0, 0);
    const wingGeo = new THREE.ShapeGeometry(shape, 24);
    const membrane = new THREE.MeshPhysicalMaterial({
      color: 0xe8f6ff, transparent: true, opacity: 0.32, roughness: 0.15,
      iridescence: 1, iridescenceIOR: 1.35, side: THREE.DoubleSide, depthWrite: false,
    });
    const veinMat = new THREE.LineBasicMaterial({ color: 0x8c7aa8, transparent: true, opacity: 0.55 });
    const veins = new THREE.BufferGeometry().setFromPoints([
      [0, 0, 0.55, 0.05], [0, 0, 0.45, -0.07], [0.1, 0.02, 0.5, 0.1], [0.2, -0.02, 0.35, -0.08], [0.3, 0.06, 0.32, -0.08],
    ].flatMap(([x1, y1, x2, y2]) => [new THREE.Vector3(x1, y1, 0.001), new THREE.Vector3(x2, y2, 0.001)]));
    const outline = new THREE.BufferGeometry().setFromPoints(shape.getPoints(40).map((p) => new THREE.Vector3(p.x, p.y, 0.001)));

    const wingScale = rig.height / 1.45;
    for (const s of [1, -1]) {
      const pivot = new THREE.Group();
      const blade = new THREE.Group();
      blade.add(new THREE.Mesh(wingGeo, membrane), new THREE.LineSegments(veins, veinMat), new THREE.Line(outline, veinMat));
      blade.scale.set(s * wingScale, wingScale, wingScale);
      blade.rotation.z = s * 0.45; // 바깥 위로
      blade.renderOrder = 2;
      pivot.add(blade);
      this.attach(pivot, chest, rig, new THREE.Vector3(s * 0.03, chestPos.y + 0.04 * wingScale, chestPos.z - 0.11 * wingScale));
      this.wings.push(pivot);
    }
  }

  /** 모델 공간 위치·방향으로 노드에 붙인다 (노드의 휴지 회전 보정) */
  private attach(part: THREE.Object3D, node: THREE.Object3D | undefined, rig: Rig, modelPos: THREE.Vector3): void {
    const parent = node ?? rig.object;
    parent.add(part);
    part.position.copy(parent.worldToLocal(modelPos.clone()));
    part.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    part.userData.rest = part.quaternion.clone();
  }

  /**
   * @param flap 퍼덕임 진폭(rad) @param freq Hz @param fold 0 펼침 → 1 등에 접음 @param twitch 더듬이 떨림 0-1
   */
  update(t: number, flap: number, freq: number, fold: number, twitch: number): void {
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    this.wings.forEach((w, k) => {
      const s = k === 0 ? 1 : -1;
      const beat = Math.sin(t * freq * Math.PI * 2) * flap;
      e.set(0, s * (0.35 + beat), s * -fold * 1.1);
      w.quaternion.copy(w.userData.rest).multiply(q.setFromEuler(e));
    });
    this.antennae.forEach((a, k) => {
      const s = k === 0 ? 1 : -1;
      const wobble = Math.sin(t * 2.1 + k) * 0.08 + Math.sin(t * 23 + k * 2) * 0.25 * twitch;
      e.set(wobble - 0.1 * twitch, 0, s * Math.sin(t * 1.3 + k) * 0.06);
      a.quaternion.copy(a.userData.rest).multiply(q.setFromEuler(e));
    });
  }
}
