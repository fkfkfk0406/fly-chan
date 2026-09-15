import type { BodyState } from "../behavior/Controller.ts";
import { ARENA_HALF, type Food, type FoodKind } from "./Habitat.ts";

const TRAIL_MAX = 600;

/** 위에서 내려다본 사육 공간. 클릭 = 달콤한 먹이, Shift+클릭 = 쓴 먹이 */
export class HabitatMap {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d")!;
  private trail: [number, number][] = [];
  private size = 0;

  constructor(
    private readonly host: HTMLElement,
    onPlace: (kind: FoodKind, x: number, z: number) => void,
  ) {
    host.appendChild(this.canvas);
    this.canvas.addEventListener("click", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const pad = this.pad(rect.width);
      const scale = (rect.width - pad * 2) / (ARENA_HALF * 2);
      const x = (e.clientX - rect.left - pad) / scale - ARENA_HALF;
      const z = (e.clientY - rect.top - pad) / scale - ARENA_HALF;
      if (Math.abs(x) < ARENA_HALF - 0.2 && Math.abs(z) < ARENA_HALF - 0.2) {
        onPlace(e.shiftKey ? "bitter" : "sweet", x, z);
      }
    });
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  private pad(w: number) {
    return Math.max(10, w * 0.04);
  }

  private resize(): void {
    const s = Math.min(this.host.clientWidth, this.host.clientHeight);
    if (!s) return;
    this.size = s;
    const dpr = devicePixelRatio;
    this.canvas.width = s * dpr;
    this.canvas.height = s * dpr;
    this.canvas.style.width = `${s}px`;
    this.canvas.style.height = `${s}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clearTrail(): void {
    this.trail = [];
  }

  setTrail(points: [number, number][]): void {
    this.trail = points.slice(-TRAIL_MAX);
  }

  pushTrail(x: number, z: number): void {
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last[0] - x, last[1] - z) > 0.08) {
      this.trail.push([x, z]);
      if (this.trail.length > TRAIL_MAX) this.trail.shift();
    }
  }

  draw(state: BodyState, foods: Food[]): void {
    const { ctx, size } = this;
    if (!size) return;
    const pad = this.pad(size);
    const scale = (size - pad * 2) / (ARENA_HALF * 2);
    // 지도: 위 = -z, 오른쪽 = +x
    const px = (x: number) => pad + (x + ARENA_HALF) * scale;
    const pz = (z: number) => pad + (z + ARENA_HALF) * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(pad, pad, size - pad * 2, size - pad * 2);
    ctx.strokeStyle = "#ebe8e2";
    ctx.lineWidth = 1;
    for (let k = -ARENA_HALF; k <= ARENA_HALF; k += 1) {
      ctx.beginPath();
      ctx.moveTo(px(k), pz(-ARENA_HALF));
      ctx.lineTo(px(k), pz(ARENA_HALF));
      ctx.moveTo(px(-ARENA_HALF), pz(k));
      ctx.lineTo(px(ARENA_HALF), pz(k));
      ctx.stroke();
    }
    ctx.strokeStyle = "#8f887d";
    ctx.lineWidth = Math.max(3, scale * 0.12);
    ctx.strokeRect(pad, pad, size - pad * 2, size - pad * 2);

    // 궤적
    if (this.trail.length > 1) {
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      for (let k = 1; k < this.trail.length; k++) {
        const a = k / this.trail.length;
        ctx.strokeStyle = `rgba(208, 96, 126, ${0.05 + a * 0.4})`;
        ctx.beginPath();
        ctx.moveTo(px(this.trail[k - 1][0]), pz(this.trail[k - 1][1]));
        ctx.lineTo(px(this.trail[k][0]), pz(this.trail[k][1]));
        ctx.stroke();
      }
    }

    for (const f of foods) {
      const r = Math.max(3, scale * 0.14) * (0.5 + 0.5 * f.amount);
      ctx.fillStyle = f.kind === "sweet" ? "#e63950" : "#7b4fa8";
      ctx.beginPath();
      ctx.arc(px(f.x), pz(f.z), r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 캐릭터: 점 + 향하는 방향
    const cx = px(state.x);
    const cz = pz(state.z);
    const r = Math.max(4, scale * 0.16);
    ctx.strokeStyle = "#2b2733";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cz);
    ctx.lineTo(cx + Math.sin(state.heading) * r * 2.4, cz + Math.cos(state.heading) * r * 2.4);
    ctx.stroke();
    ctx.fillStyle = "#d0607e";
    ctx.beginPath();
    ctx.arc(cx, cz, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }
}
