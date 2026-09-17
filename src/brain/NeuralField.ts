import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// super_class 별 기본 색 (어두운 배경 위에서 은은하게). 활동은 밝기로 표시한다.
const CLASS_COLOR: Record<string, number> = {
  optic: 0x3d5a9e,
  visual_projection: 0x5a5fb0,
  visual_centrifugal: 0x5a5fb0,
  central: 0x7a64b8,
  sensory: 0x3c8f99,
  sensory_ascending: 0x3c8f99,
  ascending: 0x9a7b4f,
  descending: 0xd0607e,
  motor: 0xe0705a,
  endocrine: 0x8a8a8a,
  unknown: 0x6a6a7a,
};

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute float aActivity;
  attribute float aSize;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAct;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vAct = aActivity;
    vColor = aColor;
    gl_PointSize = uScale * (aSize + aActivity * 3.2) / -mv.z;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAct;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float core = smoothstep(0.5, 0.0, r);
    vec3 hot = mix(vec3(1.0, 0.55, 0.75), vec3(1.0, 0.97, 0.9), smoothstep(0.5, 1.0, vAct));
    vec3 col = mix(vColor * 0.9, hot, vAct);
    float alpha = (0.28 + vAct * 0.72) * core;
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

export class NeuralField {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private readonly controls: OrbitControls;
  private readonly activity: THREE.BufferAttribute;
  private readonly brain: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor(
    private readonly host: HTMLElement,
    positions: Float32Array,
    classCodes: Uint8Array,
    classNames: string[],
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    host.appendChild(this.renderer.domElement);

    const n = classCodes.length;
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const palette = classNames.map((name) => new THREE.Color(CLASS_COLOR[name] ?? CLASS_COLOR.unknown));
    for (let i = 0; i < n; i++) {
      const c = palette[classCodes[i]];
      colors.set([c.r, c.g, c.b], i * 3);
      const name = classNames[classCodes[i]];
      sizes[i] = name === "descending" || name === "motor" ? 2.6 : 1.3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    this.activity = new THREE.BufferAttribute(new Uint8Array(n), 1, true);
    this.activity.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aActivity", this.activity);

    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: { uScale: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.brain = new THREE.Points(geo, this.material);
    this.brain.frustumCulled = false;
    this.scene.add(this.brain);

    this.camera.position.set(0, 0.05, 4.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 8;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 좁은 패널에서도 뇌 전체(가로 2)가 들어오게
    const fitDist = 1.25 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.min(1, this.camera.aspect);
    this.camera.position.setLength(Math.max(2.5, fitDist));
    this.camera.updateProjectionMatrix();
    this.material.uniforms.uScale.value = h * this.renderer.getPixelRatio() * 0.012;
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on;
  }

  private flashUntil = 0;

  /** 모든 뉴런을 잠깐 최대 밝기로 (코나미 커맨드) */
  flash(ms = 1500): void {
    (this.activity.array as Uint8Array).fill(255);
    this.activity.needsUpdate = true;
    this.flashUntil = performance.now() + ms;
  }

  setActivity(values: Uint8Array): void {
    if (performance.now() < this.flashUntil) return;
    (this.activity.array as Uint8Array).set(values);
    this.activity.needsUpdate = true;
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
