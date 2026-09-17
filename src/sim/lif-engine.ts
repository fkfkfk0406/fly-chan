// FlyWire 커넥톰 LIF 엔진. Shiu et al. 2024 Brian2 모델과 같은 방정식:
//   dv/dt = (v0 - v + g) / tauM,  dg/dt = -g / tauSyn   (불응기 동안 정지)
//   발화: v > vTh → v = vReset, g = 0, 지연 tDelay 뒤 post 뉴런 g += w
// 대부분의 뉴런은 휴지 상태이므로, 휴지에서 벗어난 뉴런만 "활성 목록"으로 적분한다.
//
// 원 모델에 없는 확장: 발화 빈도 적응(spike-frequency adaptation)
//   dv/dt 에 −w/τm 항 추가, dw/dt = −w/τw, 발화 시 w += b
//   계속 발화하는 뉴런이 스스로 흥분도를 낮춘다. b = 0 이면 Shiu et al. 원 모델과 같다.

export interface Connectome {
  n: number;
  offsets: Uint32Array; // n + 1
  targets: Uint32Array;
  weights: Int16Array; // 시냅스 수 x 부호
}

export interface LifParams {
  v0: number;
  vReset: number;
  vTh: number;
  tauM: number;
  tauSyn: number;
  tRef: number;
  tDelay: number;
  wSyn: number;
  fPoisson: number;
}

const REST_EPS = 0.02; // mV, 이보다 작으면 휴지로 간주

export interface Adaptation {
  /** 적응 전류 감쇠 시간 상수 (ms) */
  tauW: number;
  /** 발화 1회당 적응 전류 증가량 (mV). 0 = 적응 없음 */
  b: number;
}

export const NO_ADAPTATION: Adaptation = { tauW: 1, b: 0 };

export class LifEngine {
  readonly n: number;
  readonly dt: number;
  step = 0;

  /** v - v0 (mV) */
  readonly u: Float32Array;
  readonly g: Float32Array;
  /** 적응 전류 (mV) */
  readonly w: Float32Array;
  /** 마지막 스냅샷 이후 뉴런별 발화 수 */
  readonly spikeCount: Uint16Array;
  totalSpikes = 0;

  private readonly conn: Connectome;
  private readonly refUntil: Int32Array;
  private readonly noRefractory: Uint8Array;
  private readonly active: Uint32Array;
  private readonly isActive: Uint8Array;
  private activeCount = 0;

  private readonly cvv: number;
  private readonly cvg: number;
  private readonly cgg: number;
  private readonly cvw: number;
  private readonly cww: number;
  private readonly bAdapt: number;
  private readonly uTh: number;
  /** 휴지 전위 (mV). u 에 더하면 막전위 */
  readonly v0: number;
  private readonly uReset: number;
  private readonly wSyn: number;
  private readonly wPoisson: number;
  private readonly refSteps: number;

  // 지연 링버퍼: 슬롯마다 발화한 pre 뉴런 인덱스
  private readonly delaySlots: Uint32Array[];
  private readonly delayCounts: Int32Array;

  private readonly inputs = new Map<string, { idx: Uint32Array; rate: number }>();
  private rng: number;

  constructor(conn: Connectome, p: LifParams, dt = 0.1, seed = 1, adapt: Adaptation = NO_ADAPTATION) {
    this.conn = conn;
    this.n = conn.n;
    this.dt = dt;
    const n = conn.n;
    this.u = new Float32Array(n);
    this.g = new Float32Array(n);
    this.w = new Float32Array(n);
    this.spikeCount = new Uint16Array(n);
    this.refUntil = new Int32Array(n);
    this.noRefractory = new Uint8Array(n);
    this.active = new Uint32Array(n);
    this.isActive = new Uint8Array(n);

    // 선형 ODE 정확해: u' = u e^{-dt/τm} + g τs/(τs-τm)(e^{-dt/τs} - e^{-dt/τm})
    const em = Math.exp(-dt / p.tauM);
    const es = Math.exp(-dt / p.tauSyn);
    this.cvv = em;
    this.cvg = (p.tauSyn / (p.tauSyn - p.tauM)) * (es - em);
    this.cgg = es;
    // w 도 g 와 같은 형태의 지수 감쇠 입력(부호만 반대)
    const ew = Math.exp(-dt / adapt.tauW);
    this.cvw = adapt.tauW === p.tauM ? (dt / p.tauM) * em : (adapt.tauW / (adapt.tauW - p.tauM)) * (ew - em);
    this.cww = ew;
    this.bAdapt = adapt.b;
    this.uTh = p.vTh - p.v0;
    this.v0 = p.v0;
    this.uReset = p.vReset - p.v0;
    this.wSyn = p.wSyn;
    this.wPoisson = p.wSyn * p.fPoisson;
    this.refSteps = Math.round(p.tRef / dt);

    const delaySteps = Math.max(1, Math.round(p.tDelay / dt));
    this.delaySlots = Array.from({ length: delaySteps + 1 }, () => new Uint32Array(256));
    this.delayCounts = new Int32Array(delaySteps + 1);
    this.rng = seed >>> 0 || 1;
  }

  get activeNeurons(): number {
    return this.activeCount;
  }

  /** 휴지 상태가 아닌 뉴런 인덱스 (다음 step 전까지만 유효한 뷰) */
  activeIndices(): Uint32Array {
    return this.active.subarray(0, this.activeCount);
  }

  hasInput(name: string): boolean {
    return this.inputs.has(name);
  }

  /** 막전위를 du(mV)만큼 직접 올린다. */
  inject(i: number, du: number): void {
    this.u[i] += du;
    this.activate(i);
  }

  /** 뉴런 그룹에 Poisson 입력(Hz)을 건다. 0 이면 해제. */
  setInput(name: string, idx: ArrayLike<number>, rateHz: number): void {
    if (rateHz > 0) this.inputs.set(name, { idx: Uint32Array.from(idx), rate: rateHz });
    else this.inputs.delete(name);
    this.noRefractory.fill(0);
    for (const { idx: ids } of this.inputs.values()) for (const i of ids) this.noRefractory[i] = 1;
  }

  setRate(name: string, rateHz: number): void {
    const input = this.inputs.get(name);
    if (input && rateHz > 0) input.rate = rateHz;
    else if (input) this.setInput(name, [], 0);
  }

  reset(): void {
    this.u.fill(0);
    this.g.fill(0);
    this.w.fill(0);
    this.refUntil.fill(0);
    this.isActive.fill(0);
    this.spikeCount.fill(0);
    this.delayCounts.fill(0);
    this.activeCount = 0;
    this.totalSpikes = 0;
    this.step = 0;
  }

  /** 슬롯 비우기 전에 스냅샷용 발화 수를 0 으로 */
  clearSpikeCounts(): void {
    this.spikeCount.fill(0);
  }

  run(steps: number): void {
    for (let s = 0; s < steps; s++) this.tick();
  }

  private random(): number {
    // xorshift32
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 4294967296;
  }

  private activate(i: number): void {
    if (!this.isActive[i]) {
      this.isActive[i] = 1;
      this.active[this.activeCount++] = i;
    }
  }

  private tick(): void {
    const t = ++this.step;
    const { u, g, w, refUntil, active, isActive, cvv, cvg, cgg, cvw, cww, bAdapt, uTh, uReset } = this;
    // 슬롯 수 = 지연 스텝 + 1 이므로 이번 스텝의 쓰기 슬롯과 읽기 슬롯이 겹치지 않는다
    const slotCount = this.delaySlots.length;
    const sendSlot = (t + slotCount - 1) % slotCount;

    // 1) 상태 적분 + 역치 + 리셋 (활성 뉴런만)
    for (let j = this.activeCount - 1; j >= 0; j--) {
      const i = active[j];
      if (refUntil[i] >= t) continue; // 불응기: 상태 정지
      const ui = u[i];
      const gi = g[i];
      const wi = w[i];
      let nu = ui * cvv + gi * cvg - wi * cvw;
      const ng = gi * cgg;
      const nw = wi * cww;
      if (nu > uTh) {
        nu = uReset;
        g[i] = 0;
        u[i] = nu;
        w[i] = nw + bAdapt;
        if (!this.noRefractory[i]) refUntil[i] = t + this.refSteps;
        if (this.spikeCount[i] < 65535) this.spikeCount[i]++;
        this.totalSpikes++;
        this.pushSpike(sendSlot, i);
        continue;
      }
      u[i] = nu;
      g[i] = ng;
      w[i] = nw;
      if (nu < REST_EPS && nu > -REST_EPS && ng < REST_EPS && ng > -REST_EPS && nw < REST_EPS) {
        u[i] = 0;
        g[i] = 0;
        w[i] = 0;
        isActive[i] = 0;
        active[j] = active[--this.activeCount];
      }
    }

    // 2) 지연이 끝난 발화를 post 뉴런에 전달
    const slot = t % slotCount;
    const pres = this.delaySlots[slot];
    const count = this.delayCounts[slot];
    this.delayCounts[slot] = 0;
    const { offsets, targets, weights } = this.conn;
    const wSyn = this.wSyn;
    let activeCount = this.activeCount;
    for (let k = 0; k < count; k++) {
      const pre = pres[k];
      for (let e = offsets[pre], end = offsets[pre + 1]; e < end; e++) {
        const post = targets[e];
        g[post] += weights[e] * wSyn;
        if (!isActive[post]) {
          isActive[post] = 1;
          active[activeCount++] = post;
        }
      }
    }
    this.activeCount = activeCount;

    // 3) Poisson 입력: 뉴런마다 난수를 뽑지 않고 다음 사건까지의 간격(기하분포)을 뽑는다
    const dtSec = this.dt / 1000;
    for (const { idx, rate } of this.inputs.values()) {
      const p = Math.min(rate * dtSec, 0.999);
      const logq = Math.log(1 - p);
      for (let k = this.skip(logq); k < idx.length; k += 1 + this.skip(logq)) {
        this.inject(idx[k], this.wPoisson);
      }
    }
  }

  /** 성공 확률 p 인 베르누이 시행에서 첫 성공 전 실패 횟수 */
  private skip(logq: number): number {
    return Math.floor(Math.log(1 - this.random()) / logq);
  }

  private pushSpike(slot: number, i: number): void {
    let buf = this.delaySlots[slot];
    const c = this.delayCounts[slot];
    if (c >= buf.length) {
      const grown = new Uint32Array(buf.length * 2);
      grown.set(buf);
      this.delaySlots[slot] = buf = grown;
    }
    buf[c] = i;
    this.delayCounts[slot] = c + 1;
  }
}
