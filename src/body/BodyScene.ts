import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BodyState } from "../behavior/Controller.ts";
import type { Mess } from "../care/Care.ts";
import type { Expr } from "../story/scripts.ts";
import { BED, CAMERA_HOME, ROOM_HALF, type Food } from "../world/Habitat.ts";
import { Animator } from "./Animator.ts";
import type { Rig } from "./Rig.ts";

const WALL_H = 2.6;
const DAY = { bg: 0xf4ede6, hemi: 1.5, sun: 1.7, lamp: 0.0, sky: 0xbfe3f5 };
const NIGHT = { bg: 0x1c1b2e, hemi: 0.22, sun: 0.0, lamp: 2.2, sky: 0x1f2a4d };

/** 아늑한 방 디오라마와 캐릭터 */
export class BodyScene {
  readonly renderer: THREE.WebGLRenderer;
  onPet: () => void = () => {};
  onCleanMess: (id: number) => void = () => {};

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  private readonly controls: OrbitControls;
  private readonly character = new THREE.Group();
  private readonly foodMeshes = new Map<number, THREE.Object3D>();
  private readonly messMeshes = new Map<number, THREE.Object3D>();
  private readonly messGroup = new THREE.Group();
  private readonly target = new THREE.Vector3(0, 0.8, 0);
  private readonly hemi = new THREE.HemisphereLight(0xfff6ee, 0xd8c6b8, DAY.hemi);
  private readonly sun = new THREE.DirectionalLight(0xfff1dd, DAY.sun);
  private readonly lamp = new THREE.PointLight(0xffb870, 0, 5, 1.6);
  private readonly skyMat = new THREE.MeshBasicMaterial({ color: DAY.sky });
  private readonly moon: THREE.Mesh;
  private readonly raycaster = new THREE.Raycaster();
  private lampShade!: THREE.MeshStandardMaterial;
  private wallMat!: THREE.MeshStandardMaterial;
  private daylight = 1;
  private animator?: Animator;
  private rig?: Rig;
  private focus = false;
  private returning = false;
  private readonly savedOffset = new THREE.Vector3();

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(DAY.bg);

    // 조명: 창으로 드는 햇빛 + 밤에 켜지는 스탠드
    this.sun.position.set(-1.5, 5, -6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
    this.sun.shadow.bias = -0.0008;
    this.lamp.position.set(BED.x + 0.9, 0.95, BED.z - 0.75);
    this.scene.add(this.hemi, this.sun, this.lamp);

    this.moon = new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), new THREE.MeshBasicMaterial({ color: 0xfff6c8 }));
    this.buildRoom();
    this.scene.add(this.character);

    this.camera.position.set(CAMERA_HOME.x, CAMERA_HOME.y, CAMERA_HOME.z);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, {
      enableDamping: true, enablePan: false, minDistance: 3, maxDistance: 11,
      minAzimuthAngle: -0.15, maxAzimuthAngle: 1.55, maxPolarAngle: 1.25, minPolarAngle: 0.35,
    });

    // 탭(드래그 아님): 캐릭터면 쓰다듬기, 얼룩이면 닦기
    this.scene.add(this.messGroup);
    let down: { x: number; y: number } | null = null;
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener("pointerup", (e) => {
      const tap = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
      down = null;
      if (!tap) return;
      this.aim(e);
      if (this.raycaster.intersectObject(this.character, true).length) return this.onPet();
      const hit = this.raycaster.intersectObject(this.messGroup, true)[0];
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && o.userData.messId === undefined) o = o.parent;
      if (o) this.onCleanMess(o.userData.messId);
    });

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  private buildRoom(): void {
    const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      return mesh;
    };
    const S = ROOM_HALF * 2;

    // 바닥: 나무 마루 결
    const floorTex = new THREE.CanvasTexture(woodCanvas());
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(3, 3);
    floorTex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(S, S), mat(0xffffff, { map: floorTex }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 벽 두 면 (뒤·왼쪽) + 걸레받이
    // 벽은 직사광을 받지 않아 어두워지므로 낮에는 은은하게 자체 발광
    const wallMat = mat(0xfbe9e7, { emissive: 0xf3d6d3, emissiveIntensity: 0.45 });
    this.wallMat = wallMat;
    box(S, WALL_H, 0.12, wallMat, 0, WALL_H / 2, -ROOM_HALF - 0.06);
    box(0.12, WALL_H, S, wallMat, -ROOM_HALF - 0.06, WALL_H / 2, 0);
    const trim = mat(0xe8c9c0);
    box(S, 0.12, 0.04, trim, 0, 0.06, -ROOM_HALF + 0.02);
    box(0.04, 0.12, S, trim, -ROOM_HALF + 0.02, 0.06, 0);

    // 뒷벽 창문
    const win = new THREE.Group();
    const frame = mat(0xffffff);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1), this.skyMat);
    win.add(glass);
    for (const [w, h, x, y] of [[1.64, 0.07, 0, 0.58], [1.64, 0.07, 0, -0.58], [0.07, 1.2, 0.79, 0], [0.07, 1.2, -0.79, 0], [0.05, 1.1, 0, 0], [1.5, 0.05, 0, 0]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), frame);
      bar.position.set(x, y, 0.02);
      win.add(bar);
    }
    this.moon.position.set(0.45, 0.25, 0.005);
    win.add(this.moon);
    win.position.set(0.6, 1.55, -ROOM_HALF + 0.01);
    this.scene.add(win);

    // 침대
    const bx = BED.x, bz = BED.z;
    box(BED.width + 0.1, 0.22, BED.length + 0.1, mat(0xd9b48f), bx, 0.11, bz);
    box(BED.width, 0.16, BED.length, mat(0xffffff), bx, BED.height - 0.08, bz);
    box(BED.width + 0.1, 0.7, 0.08, mat(0xd9b48f), bx, 0.35, bz - BED.length / 2 - 0.04);
    box(0.62, 0.12, 0.36, mat(0xfff4f6), bx, BED.height + 0.05, bz - BED.length / 2 + 0.3);
    box(BED.width + 0.04, 0.08, BED.length * 0.55, mat(0xf2a7b9), bx, BED.height + 0.01, bz + BED.length * 0.2);

    // 협탁 + 스탠드
    box(0.45, 0.5, 0.4, mat(0xd9b48f), bx + 0.9, 0.25, bz - 0.75);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.2, 20, 1, true), mat(0xfff0d6, { emissive: 0xffc27a, emissiveIntensity: 0.2, side: THREE.DoubleSide }));
    shade.position.set(bx + 0.9, 0.88, bz - 0.75);
    this.scene.add(shade);
    this.lampShade = shade.material as THREE.MeshStandardMaterial;

    // 러그, 화분, 선반
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), mat(0xf6c9d2));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.5, 0.005, 0.3);
    rug.receiveShadow = true;
    this.scene.add(rug);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.3, 20), mat(0xe8a27c));
    pot.position.set(2.5, 0.15, -2.5);
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.33, 1), mat(0x7fb77e, { flatShading: true }));
    leaves.position.set(2.5, 0.58, -2.5);
    for (const m of [pot, leaves]) {
      m.castShadow = true;
      this.scene.add(m);
    }
    box(1.2, 0.05, 0.28, mat(0xd9b48f), 1.9, 1.35, -ROOM_HALF + 0.14);
    box(0.18, 0.24, 0.16, mat(0x9ec9e8), 1.55, 1.5, -ROOM_HALF + 0.14);
    box(0.22, 0.16, 0.16, mat(0xf2d27a), 2.2, 1.46, -ROOM_HALF + 0.14);
  }

  setRig(rig: Rig): void {
    this.rig = rig;
    this.animator = new Animator(rig);
    this.character.add(this.animator.poseRoot);
    rig.object.traverse((o) => (o.castShadow = true));
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 세로 화면에서는 뒤로 물러나 방이 잘리지 않게
    this.camera.fov = w < h ? 44 : 32;
    this.camera.updateProjectionMatrix();
  }

  private aim(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  /** 대화 중 얼굴 클로즈업. 끄면 원래 각도로 돌아간다 */
  setFocus(on: boolean): void {
    if (on === this.focus) return;
    if (on && !this.returning) this.savedOffset.copy(this.camera.position).sub(this.target);
    this.focus = on;
    this.returning = !on;
    this.controls.enabled = !on && !this.returning;
  }

  setExpression(expr: Expr | undefined): void {
    if (this.animator) this.animator.exprOverride = expr;
  }

  setTalking(on: boolean): void {
    if (this.animator) this.animator.talking = on;
  }

  /** 말풍선을 띄울 화면 좌표 (머리 위) */
  bubbleAnchor(): { x: number; y: number } | null {
    const head = this.rig?.attachNode("head");
    if (!head) return null;
    const p = head.getWorldPosition(new THREE.Vector3());
    p.y += 0.32;
    p.project(this.camera);
    if (p.z > 1) return null;
    return { x: ((p.x + 1) / 2) * this.host.clientWidth, y: ((1 - p.y) / 2) * this.host.clientHeight };
  }

  private syncFoods(foods: Food[]): void {
    const alive = new Set(foods.map((f) => f.id));
    for (const [id, mesh] of this.foodMeshes) {
      if (!alive.has(id)) {
        this.scene.remove(mesh);
        this.foodMeshes.delete(id);
      }
    }
    for (const f of foods) {
      let m = this.foodMeshes.get(f.id);
      if (!m) {
        m = makeFood(f.kind);
        m.position.set(f.x, 0, f.z);
        m.userData.born = performance.now();
        this.scene.add(m);
        this.foodMeshes.set(f.id, m);
      }
      // 놓일 때 톡 떨어지는 효과
      const age = (performance.now() - m.userData.born) / 1000;
      m.position.y = age < 0.35 ? 0.6 * (1 - age / 0.35) ** 2 : 0;
      m.scale.setScalar(0.35 + 0.65 * Math.max(0, f.amount));
    }
  }

  private syncMesses(messes: Mess[], dt: number): void {
    const alive = new Set(messes.map((m) => m.id));
    for (const [id, obj] of this.messMeshes) {
      if (alive.has(id)) continue;
      // 치운 얼룩은 떠오르며 줄어들다 사라진다
      obj.userData.fading = (obj.userData.fading ?? 0) + dt / 0.35;
      obj.scale.setScalar(Math.max(0.001, 1 - obj.userData.fading));
      obj.position.y = obj.userData.fading * 0.3;
      if (obj.userData.fading >= 1) {
        this.messGroup.remove(obj);
        this.messMeshes.delete(id);
      }
    }
    for (const m of messes) {
      if (this.messMeshes.has(m.id)) continue;
      const obj = makeMess(m);
      this.messGroup.add(obj);
      this.messMeshes.set(m.id, obj);
    }
  }

  render(dt: number, state: BodyState, foods: Food[], messes: Mess[], lightsOn: boolean, mood: number): void {
    this.syncFoods(foods);
    this.syncMesses(messes, dt);
    this.character.position.set(state.x, state.elev, state.z);
    this.character.rotation.y = state.heading;
    this.animator?.update(dt, state, mood);

    // 낮/밤 전환
    this.daylight += ((lightsOn ? 1 : 0) - this.daylight) * (1 - Math.exp(-dt * 3));
    const k = this.daylight;
    const mix = (a: number, b: number) => b + (a - b) * k;
    (this.scene.background as THREE.Color).lerpColors(new THREE.Color(NIGHT.bg), new THREE.Color(DAY.bg), k);
    this.skyMat.color.lerpColors(new THREE.Color(NIGHT.sky), new THREE.Color(DAY.sky), k);
    this.hemi.intensity = mix(DAY.hemi, NIGHT.hemi);
    this.sun.intensity = mix(DAY.sun, NIGHT.sun);
    this.lamp.intensity = mix(DAY.lamp, NIGHT.lamp);
    this.lampShade.emissiveIntensity = 0.2 + (1 - k) * 1.2;
    this.wallMat.emissiveIntensity = 0.45 * k;
    this.moon.visible = k < 0.5;

    const ease = 1 - Math.exp(-dt * 3);
    const head = this.rig?.attachNode("head");
    if (this.focus && head) {
      // 얼굴 앞, 사용자 쪽에서 살짝 내려다보는 자리로
      const hp = head.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(CAMERA_HOME.x - hp.x, 0, CAMERA_HOME.z - hp.z).normalize();
      const eye = hp.clone().addScaledVector(dir, 1.8).add(new THREE.Vector3(0, 0.2, 0));
      this.target.lerp(hp.add(new THREE.Vector3(0, -0.12, 0)), ease);
      this.camera.position.lerp(eye, ease);
      this.camera.lookAt(this.target);
    } else {
      // 카메라가 캐릭터를 부드럽게 따라간다 (사용자가 돌린 각도는 유지)
      const air = state.behavior === "escape" && state.jump < 0.75 ? Math.sin((state.jump / 0.75) * Math.PI) : 0;
      const follow = new THREE.Vector3(state.x * 0.6, 0.7 + state.elev * 0.5 + air * 0.6, state.z * 0.6);
      if (this.returning) {
        this.target.lerp(follow, ease);
        const goal = follow.clone().add(this.savedOffset);
        this.camera.position.lerp(goal, ease);
        this.camera.lookAt(this.target);
        if (this.camera.position.distanceTo(goal) < 0.05) {
          this.returning = false;
          this.controls.enabled = true;
        }
      } else {
        const delta = follow.sub(this.target).multiplyScalar(ease);
        this.target.add(delta);
        this.camera.position.add(delta);
        this.controls.target.copy(this.target);
        this.controls.update();
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}

function makeFood(kind: Food["kind"]): THREE.Object3D {
  const g = new THREE.Group();
  const toon = (c: number) => new THREE.MeshToonMaterial({ color: c });
  if (kind === "sweet") {
    const berry = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 16), toon(0xe63950));
    berry.scale.set(1, 1.15, 1);
    berry.position.y = 0.13;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.05, 6), toon(0x4f9d57));
    leaf.position.y = 0.27;
    leaf.rotation.x = Math.PI;
    g.add(berry, leaf);
  } else {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x7b4fa8));
    cap.position.y = 0.14;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.14, 12), toon(0xe9e2d6));
    stem.position.y = 0.07;
    g.add(cap, stem);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function makeMess(m: Mess): THREE.Object3D {
  const g = new THREE.Group();
  g.userData.messId = m.id;
  g.position.set(m.x, 0, m.z);
  g.rotation.y = (m.id * 2.4) % (Math.PI * 2);
  if (m.kind === "stain") {
    // 과즙 얼룩: 겹친 원 몇 개
    const mat = new THREE.MeshBasicMaterial({ color: 0xc8455f, transparent: true, opacity: 0.5, depthWrite: false });
    for (const [x, z, r] of [[0, 0, 0.16], [0.12, 0.05, 0.08], [-0.08, 0.11, 0.06], [0.05, -0.13, 0.05]]) {
      const blot = new THREE.Mesh(new THREE.CircleGeometry(r, 20), mat);
      blot.rotation.x = -Math.PI / 2;
      blot.position.set(x, 0.007, z);
      g.add(blot);
    }
  } else {
    // 먼지 뭉치
    const mat = new THREE.MeshStandardMaterial({ color: 0xb8aea6, roughness: 1 });
    for (const [x, z, r] of [[0, 0, 0.09], [0.08, 0.03, 0.06], [-0.06, 0.05, 0.05], [0.02, -0.07, 0.05]]) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
      puff.scale.y = 0.45;
      puff.position.set(x, r * 0.35, z);
      g.add(puff);
    }
  }
  // 작은 얼룩도 탭하기 쉽게 보이지 않는 넓은 판정 원
  const hit = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  hit.rotation.x = -Math.PI / 2;
  hit.position.y = 0.01;
  g.add(hit);
  return g;
}

/** 마루 결 텍스처 */
function woodCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const tones = ["#e7cfb2", "#e2c7a8", "#ebd5ba", "#dfc3a2"];
  for (let row = 0; row < 8; row++) {
    const offset = (row % 2) * 64;
    for (let k = -1; k < 3; k++) {
      ctx.fillStyle = tones[(row * 3 + k + 4) % tones.length];
      ctx.fillRect(offset + k * 128, row * 32, 128, 32);
      ctx.fillStyle = "rgba(120, 80, 40, 0.18)";
      ctx.fillRect(offset + k * 128, row * 32, 2, 32);
    }
    ctx.fillStyle = "rgba(120, 80, 40, 0.22)";
    ctx.fillRect(0, row * 32, 256, 1.5);
  }
  return c;
}
