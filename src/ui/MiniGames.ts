// 미니게임. 화면 위에 얇은 레이어를 띄우고 frameLoop 에서 update 를 부른다.
//  - 살금살금 손 뻗기: 손이 다가오는 속도가 LPLC2(루밍) 입력이 되고, 진짜 Giant Fiber 가 켜지면 도망간다
//  - 딸기 받기: 떨어지는 딸기를 바구니로 받는다

/** 보정 (scripts/loom-probe.ts): 루밍 6 Hz 까지는 대체로 버티고, 8 Hz 부터 Giant Fiber 가 30 Hz 를 넘는다 */
import { L } from "../i18n.ts";

export const LOOM_GAIN = 20;
const REACH = { vMax: 0.45, accel: 1.2, brake: 3, limit: 25 };
const CATCH = { seconds: 20, spawnEvery: 0.55 };

export type GameResult =
  | { game: "reach"; reason: "win" | "escaped" | "timeout" }
  | { game: "catch"; berries: number };

export interface GameHooks {
  /** 캐릭터 머리의 화면 좌표 */
  anchor(): { x: number; y: number };
  setLooming(hz: number): void;
  /** Giant Fiber 발화율 (Hz) */
  giantFiber(): number;
  escaped(): boolean;
  onEnd(result: GameResult): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

/** 다가오는 물체의 시야각 팽창률 ∝ 속도 / 거리² (가까울수록 같은 속도도 더 무섭다) */
export const loomingHz = (speed: number, distance: number) => (LOOM_GAIN * speed) / (0.35 + distance) ** 2;

export class MiniGames {
  private layer: HTMLDivElement | null = null;
  private info!: HTMLDivElement;
  private meter!: HTMLDivElement;
  private step: ((dt: number) => void) | null = null;
  private cleanup: (() => void) | null = null;

  constructor(private readonly hooks: GameHooks) {}

  get active(): boolean {
    return this.layer !== null;
  }

  update(dt: number): void {
    this.step?.(dt);
  }

  private open(title: string, help: string): HTMLDivElement {
    const layer = el("div", "game");
    const head = el("div", "game-head");
    this.info = el("div", "game-info", help);
    const bar = el("div", "game-meter");
    this.meter = el("div", "fill");
    bar.append(this.meter);
    const quit = el("button", "game-quit", L("그만하기", "Quit"));
    quit.addEventListener("pointerdown", (e) => e.stopPropagation());
    quit.onclick = () => this.close();
    head.append(el("b", "", title), this.info, bar, quit);
    layer.append(head);
    document.body.append(layer);
    this.layer = layer;
    return layer;
  }

  private close(): void {
    this.hooks.setLooming(0);
    this.cleanup?.();
    this.cleanup = null;
    this.layer?.remove();
    this.layer = null;
    this.step = null;
  }

  startReach(): void {
    if (this.active) return;
    const layer = this.open(L("🤚 살금살금 손 뻗기", "🤚 Sneaky hand"), L("꾹 누르고 있으면(스페이스도 돼요) 손이 다가가요. 너무 빨리 다가가면 도망가요!", "Hold down (or Space) to move your hand closer. Too fast and she escapes!"));
    const hand = el("div", "game-hand", "🤚");
    layer.append(hand);
    let d = 1;
    let v = 0;
    let t = 0;
    let holding = false;
    layer.addEventListener("pointerdown", () => (holding = true));
    layer.addEventListener("pointerup", () => (holding = false));
    layer.addEventListener("pointercancel", () => (holding = false));
    const key = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      holding = e.type === "keydown";
    };
    addEventListener("keydown", key);
    addEventListener("keyup", key);
    this.cleanup = () => {
      removeEventListener("keydown", key);
      removeEventListener("keyup", key);
    };
    const finish = (reason: "win" | "escaped" | "timeout") => {
      this.close();
      this.hooks.onEnd({ game: "reach", reason });
    };
    this.step = (dt) => {
      t += dt;
      v = holding ? Math.min(REACH.vMax, v + REACH.accel * dt) : Math.max(0, v - REACH.brake * dt);
      d = Math.max(0, d - v * dt);
      const hz = loomingHz(v, d);
      this.hooks.setLooming(hz);
      const gf = this.hooks.giantFiber();
      this.meter.style.width = `${Math.min(100, (gf / 30) * 100)}%`;
      this.meter.classList.toggle("danger", gf > 20);
      this.info.textContent = L(`거리 ${Math.round(d * 100)}% · LPLC2 루밍 ${hz.toFixed(1)} Hz · Giant Fiber ${gf.toFixed(0)}/30 Hz`, `Distance ${Math.round(d * 100)}% · LPLC2 looming ${hz.toFixed(1)} Hz · Giant Fiber ${gf.toFixed(0)}/30 Hz`);
      const a = this.hooks.anchor();
      const sx = innerWidth * 0.92;
      const sy = innerHeight * 1.05;
      Object.assign(hand.style, {
        left: `${a.x + (sx - a.x) * d}px`,
        top: `${a.y + 40 + (sy - a.y - 40) * d}px`,
        fontSize: `${48 + 110 * (1 - d)}px`,
      });
      if (this.hooks.escaped()) finish("escaped");
      else if (d <= 0) finish("win");
      else if (t > REACH.limit) finish("timeout");
    };
  }

  startCatch(): void {
    if (this.active) return;
    const layer = this.open(L("🧺 딸기 받기", "🧺 Strawberry catch"), L("바구니를 움직여 딸기를 받아요. 🍄은 피하기!", "Move the basket to catch strawberries. Dodge the 🍄!"));
    const basket = el("div", "game-basket", "🧺");
    layer.append(basket);
    let x = innerWidth / 2;
    let dir = 0;
    let t = 0;
    let spawn = 0;
    let berries = 0;
    const items: { e: HTMLDivElement; x: number; y: number; vy: number; bad: boolean }[] = [];
    layer.addEventListener("pointermove", (e) => (x = e.clientX));
    layer.addEventListener("pointerdown", (e) => (x = e.clientX));
    const key = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      dir = e.type === "keyup" ? 0 : e.key === "ArrowLeft" ? -1 : 1;
    };
    addEventListener("keydown", key);
    addEventListener("keyup", key);
    this.cleanup = () => {
      removeEventListener("keydown", key);
      removeEventListener("keyup", key);
    };
    this.step = (dt) => {
      t += dt;
      const baseY = innerHeight - 160; // 아래 버튼 줄 위
      x = Math.min(innerWidth - 30, Math.max(30, x + dir * 700 * dt));
      Object.assign(basket.style, { left: `${x}px`, top: `${baseY}px` });
      spawn -= dt;
      if (spawn <= 0) {
        spawn = CATCH.spawnEvery * (0.6 + Math.random() * 0.8);
        const bad = Math.random() < 0.18;
        const e = el("div", "game-item", bad ? "🍄" : "🍓");
        layer.append(e);
        items.push({ e, x: 30 + Math.random() * (innerWidth - 60), y: 110, vy: 220 + Math.random() * 180 + t * 8, bad });
      }
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.y += it.vy * dt;
        Object.assign(it.e.style, { left: `${it.x}px`, top: `${it.y}px` });
        const caught = Math.abs(it.y - baseY) < 28 && Math.abs(it.x - x) < 46;
        if (caught) berries = Math.max(0, berries + (it.bad ? -3 : 1));
        if (caught || it.y > innerHeight) {
          it.e.remove();
          items.splice(i, 1);
        }
      }
      const left = Math.max(0, CATCH.seconds - t);
      this.meter.style.width = `${(left / CATCH.seconds) * 100}%`;
      this.info.textContent = L(`🍓 ${berries}개 · 남은 시간 ${Math.ceil(left)}초`, `🍓 ${berries} · ${Math.ceil(left)} s left`);
      if (left <= 0) {
        this.close();
        this.hooks.onEnd({ game: "catch", berries });
      }
    };
  }
}
