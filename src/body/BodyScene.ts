import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BodyState } from "../behavior/Controller.ts";
import { ARENA_HALF, type Food } from "../world/Habitat.ts";
import { Animator } from "./Animator.ts";
import type { Rig } from "./Rig.ts";

export class BodyScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
  private readonly controls: OrbitControls;
  private readonly character = new THREE.Group();
  private readonly shadow: THREE.Mesh;
  private readonly foodMeshes = new Map<number, THREE.Object3D>();
  private readonly target = new THREE.Vector3();
  private readonly sun: THREE.DirectionalLight;
  private animator?: Animator;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xf7f6f3);
    this.scene.fog = new THREE.Fog(0xf7f6f3, 9, 26);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d4cc, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(3, 7, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -2.5;
    sc.right = sc.top = 2.5;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    // 바닥·그리드·벽
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0xf3f1ed, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(ARENA_HALF * 2, ARENA_HALF * 2, 0xc9c4bb, 0xdedad3);
    grid.position.y = 0.002;
    this.scene.add(grid);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xbfb8ad, transparent: true, opacity: 0.55 });
    for (const [x, z, w, d] of [
      [0, ARENA_HALF, ARENA_HALF * 2, 0.08], [0, -ARENA_HALF, ARENA_HALF * 2, 0.08],
      [ARENA_HALF, 0, 0.08, ARENA_HALF * 2], [-ARENA_HALF, 0, 0.08, ARENA_HALF * 2],
    ]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, d), wallMat);
      wall.position.set(x, 0.125, z);
      this.scene.add(wall);
    }

    // 캐릭터 발밑 원형 그림자(모델 로드 전에도 위치 표시)
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.35, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.004;
    this.scene.add(this.character, this.shadow);

    this.camera.position.set(2.2, 1.7, 3.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 9;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  setRig(rig: Rig): void {
    this.animator = new Animator(rig);
    this.character.add(this.animator.poseRoot);
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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
        this.scene.add(m);
        this.foodMeshes.set(f.id, m);
      }
      m.scale.setScalar(0.35 + 0.65 * Math.max(0, f.amount));
    }
  }

  render(dt: number, state: BodyState, foods: Food[]): void {
    this.syncFoods(foods);
    this.character.position.set(state.x, 0, state.z);
    this.character.rotation.y = state.heading;
    this.shadow.position.x = state.x;
    this.shadow.position.z = state.z;
    this.animator?.update(dt, state);

    // 카메라가 캐릭터를 따라간다 (사용자가 돌린 각도는 유지)
    const air = state.behavior === "escape" && state.jump < 0.75 ? Math.sin((state.jump / 0.75) * Math.PI) : 0;
    const next = new THREE.Vector3(state.x, (state.behavior === "rest" ? 0.35 : 0.85) + air * 0.8, state.z);
    const delta = next.sub(this.target).multiplyScalar(1 - Math.exp(-dt * 4));
    this.target.add(delta);
    this.camera.position.add(delta);
    this.controls.target.copy(this.target);
    this.controls.update();
    this.sun.position.set(state.x + 3, 7, state.z + 4);
    this.sun.target.position.set(state.x, 0, state.z);

    this.renderer.render(this.scene, this.camera);
  }
}

function makeFood(kind: Food["kind"]): THREE.Object3D {
  const g = new THREE.Group();
  const toon = (c: number) => new THREE.MeshToonMaterial({ color: c });
  if (kind === "sweet") {
    // 딸기
    const berry = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 16), toon(0xe63950));
    berry.scale.set(1, 1.15, 1);
    berry.position.y = 0.13;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.05, 6), toon(0x4f9d57));
    leaf.position.y = 0.27;
    leaf.rotation.x = Math.PI;
    g.add(berry, leaf);
  } else {
    // 쓴 버섯
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x7b4fa8));
    cap.position.y = 0.14;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.14, 12), toon(0xe9e2d6));
    stem.position.y = 0.07;
    g.add(cap, stem);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}
