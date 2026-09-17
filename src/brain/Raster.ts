import { L } from "../i18n.ts";
/** 핵심 뉴런 스파이크 래스터(최근 6초)와 막전위 표시 */
const WINDOW_MS = 6000;
const ROW = 16;
const LABEL_W = 78;
const VOLT_W = 44;

export class Raster {
  private readonly ctx: CanvasRenderingContext2D;
  private names: string[] = [];
  private spikes: number[][] = [];
  private volts: number[] = [];
  private now = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  setNames(names: string[]): void {
    this.names = names;
    this.spikes = names.map(() => []);
    this.volts = names.map(() => -52);
  }

  push(probes: { spikes: number[][]; v: number[] }, simTime: number): void {
    this.now = simTime;
    probes.spikes.forEach((times, k) => {
      const row = this.spikes[k];
      if (!row) return;
      row.push(...times);
      while (row.length && row[0] < simTime - WINDOW_MS) row.shift();
    });
    this.volts = probes.v;
  }

  draw(): void {
    const { canvas, ctx } = this;
    const w = canvas.clientWidth;
    const h = this.names.length * ROW + 14;
    const dpr = devicePixelRatio;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const plotW = w - LABEL_W - VOLT_W;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    this.names.forEach((name, k) => {
      const y = k * ROW + ROW / 2;
      ctx.fillStyle = "#9491b0";
      ctx.fillText(name, 0, y);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(LABEL_W, y - 5, plotW, 10);
      ctx.fillStyle = "#f08aa6";
      for (const t of this.spikes[k]) {
        const x = LABEL_W + ((t - (this.now - WINDOW_MS)) / WINDOW_MS) * plotW;
        ctx.fillRect(x, y - 5, 1.5, 10);
      }
      // 막전위: 휴지(-52) ~ 역치(-45) 를 막대 길이로
      const v = this.volts[k] ?? -52;
      const frac = Math.max(0, Math.min(1, (v + 52) / 7));
      ctx.fillStyle = frac > 0.02 ? "#e9e7f2" : "#5a5775";
      ctx.fillText(`${v.toFixed(0)}mV`, LABEL_W + plotW + 6, y);
      ctx.fillStyle = "#f6c3d0";
      ctx.fillRect(LABEL_W + plotW + 4, y + 5, (VOLT_W - 8) * frac, 2);
    });
    ctx.fillStyle = "#5a5775";
    ctx.fillText(L("-6초", "-6 s"), LABEL_W, h - 6);
    ctx.textAlign = "right";
    ctx.fillText(L("지금", "now"), LABEL_W + plotW, h - 6);
    ctx.textAlign = "left";
  }
}
