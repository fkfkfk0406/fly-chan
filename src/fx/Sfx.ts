// 효과음. 음원 파일 없이 WebAudio 로 짧게 합성한다.
const MUTE_KEY = "onna-muted";

type Wave = OscillatorType;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted: boolean;

  constructor() {
    let muted = false;
    try {
      muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      // 저장소를 못 쓰면 기본값
    }
    this.muted = muted;
    // 브라우저 정책상 사용자 입력이 있어야 소리를 낼 수 있다
    const unlock = () => this.ensure()?.resume();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // 무시
    }
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    return this.ctx;
  }

  private tone(freq: number, start: number, dur: number, wave: Wave = "sine", vol = 0.5, slideTo?: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted || ctx.state !== "running") return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  pop(): void {
    this.tone(660, 0, 0.09, "sine", 0.35, 990);
  }

  pet(): void {
    this.tone(784, 0, 0.12, "triangle", 0.4);
    this.tone(1046, 0.09, 0.16, "triangle", 0.35);
  }

  chew(): void {
    for (let k = 0; k < 3; k++) this.tone(220 + k * 30, k * 0.12, 0.06, "square", 0.12, 160);
  }

  sparkle(): void {
    [1318, 1568, 2093, 2637].forEach((f, k) => this.tone(f, k * 0.06, 0.18, "triangle", 0.25));
  }

  jump(): void {
    this.tone(880, 0, 0.18, "square", 0.15, 1760);
  }

  sad(): void {
    this.tone(440, 0, 0.25, "sine", 0.3, 330);
  }

  levelUp(): void {
    [523, 659, 784, 1046, 1318].forEach((f, k) => this.tone(f, k * 0.1, 0.3, "triangle", 0.35));
  }

  tick(): void {
    this.tone(1200 + Math.random() * 200, 0, 0.025, "square", 0.04);
  }

  choice(): void {
    this.tone(988, 0, 0.08, "sine", 0.3);
  }
}
