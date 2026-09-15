import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";

export const BONES = [
  "hips", "spine", "chest", "upperChest", "neck", "head",
  "leftUpperArm", "leftLowerArm", "rightUpperArm", "rightLowerArm",
  "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot",
] as const;
export type BoneName = (typeof BONES)[number];

export type ExpressionName = "aa" | "happy" | "surprised" | "relaxed" | "blink" | "sad";

/**
 * 애니메이터가 조작하는 캐릭터 골격.
 * 규약(VRM 1.0 normalized humanoid): 휴지 = T 포즈, 정면 +Z, 왼팔 +X, 본 회전 0 = 휴지.
 */
export interface Rig {
  readonly object: THREE.Object3D;
  /** 바닥에서 hips 까지 높이 (m) */
  readonly hipsHeight: number;
  /** 모델 전체 키 (m) */
  readonly height: number;
  bone(name: BoneName): THREE.Object3D | undefined;
  /** 액세서리를 붙일 실제 렌더 노드 */
  attachNode(name: "head" | "upperChest"): THREE.Object3D | undefined;
  setExpression(name: ExpressionName, weight: number): void;
  update(dt: number): void;
}

export async function loadVrmRig(url: string, onProgress?: (ratio: number) => void): Promise<Rig> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error("VRM 데이터가 없는 파일입니다");

  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm); // VRM 0.x 는 정면이 -Z 라 돌려 맞춘다
  vrm.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
    }
  });

  vrm.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const hips = vrm.humanoid.getNormalizedBoneNode("hips")!;
  const hipsHeight = hips.getWorldPosition(new THREE.Vector3()).y - box.min.y;

  return {
    object: vrm.scene,
    hipsHeight,
    height: box.max.y - box.min.y,
    bone: (name) => vrm.humanoid.getNormalizedBoneNode(name) ?? undefined,
    attachNode: (name) => vrm.humanoid.getRawBoneNode(name) ?? undefined,
    setExpression: (name, w) => vrm.expressionManager?.setValue(name, w),
    update: (dt) => vrm.update(dt),
  };
}

/** VRM 을 못 불러올 때 쓰는 도형 인형. 같은 본 규약을 따른다. */
export function createFallbackRig(): Rig {
  const skin = new THREE.MeshToonMaterial({ color: 0xffe3d3 });
  const hair = new THREE.MeshToonMaterial({ color: 0x5b4a6e });
  const cloth = new THREE.MeshToonMaterial({ color: 0x2e2a3a });
  const accent = new THREE.MeshToonMaterial({ color: 0xe8577a });
  const eye = new THREE.MeshBasicMaterial({ color: 0x2b1b3a });

  const bones = {} as Record<BoneName, THREE.Object3D>;
  const node = (name: BoneName, parent: THREE.Object3D | null, x: number, y: number, z = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent?.add(g);
    bones[name] = g;
    return g;
  };
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const limb = (len: number, r: number, mat: THREE.Material, parent: THREE.Object3D, axis: "x" | "-x" | "-y") => {
    const geo = new THREE.CapsuleGeometry(r, len - 2 * r, 4, 10);
    const m = mesh(geo, mat, parent);
    if (axis === "-y") m.position.y = -len / 2;
    else {
      m.rotation.z = Math.PI / 2;
      m.position.x = axis === "x" ? len / 2 : -len / 2;
    }
  };

  const root = new THREE.Group();
  const hips = node("hips", root, 0, 0.78);
  const spine = node("spine", hips, 0, 0.08);
  const chest = node("chest", spine, 0, 0.12);
  const upperChest = node("upperChest", chest, 0, 0.12);
  const neck = node("neck", upperChest, 0, 0.12);
  const head = node("head", neck, 0, 0.06);

  mesh(new THREE.ConeGeometry(0.2, 0.3, 16, 1, true), accent, hips, 0, -0.08).material.side = THREE.DoubleSide;
  mesh(new THREE.CapsuleGeometry(0.1, 0.22, 4, 12), cloth, chest, 0, 0.02);
  mesh(new THREE.SphereGeometry(0.15, 24, 16), skin, head, 0, 0.13);
  mesh(new THREE.SphereGeometry(0.165, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), hair, head, 0, 0.15, -0.01);
  for (const s of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.024, 10, 8), eye, head, s * 0.055, 0.12, 0.135).scale.set(1, 1.4, 0.5);
    const tail = mesh(new THREE.CapsuleGeometry(0.05, 0.35, 4, 8), hair, head, s * 0.19, 0.02, -0.04);
    tail.rotation.z = s * 0.25;
  }

  for (const [side, s] of [["left", 1], ["right", -1]] as const) {
    const ua = node(`${side}UpperArm`, upperChest, s * 0.13, 0.07);
    limb(0.24, 0.035, skin, ua, s > 0 ? "x" : "-x");
    const la = node(`${side}LowerArm`, ua, s * 0.24, 0);
    limb(0.22, 0.03, skin, la, s > 0 ? "x" : "-x");
    const ul = node(`${side}UpperLeg`, hips, s * 0.08, -0.05);
    limb(0.36, 0.05, skin, ul, "-y");
    const ll = node(`${side}LowerLeg`, ul, 0, -0.36);
    limb(0.34, 0.04, skin, ll, "-y");
    const ft = node(`${side}Foot`, ll, 0, -0.34);
    mesh(new THREE.BoxGeometry(0.08, 0.05, 0.16), cloth, ft, 0, -0.02, 0.04);
  }

  return {
    object: root,
    hipsHeight: 0.78,
    height: 1.45,
    bone: (name) => bones[name],
    attachNode: (name) => bones[name],
    setExpression: () => {},
    update: () => {},
  };
}
