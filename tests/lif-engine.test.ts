import { describe, expect, it } from "vitest";
import { LifEngine, type Adaptation, type Connectome, type LifParams } from "../src/sim/lif-engine.ts";
import { hasData, loadAll } from "../scripts/node-data.ts";
import type { GroupName } from "../src/sim/data.ts";

const PARAMS: LifParams = {
  v0: -52, vReset: -52, vTh: -45, tauM: 20, tauSyn: 5, tRef: 2.2, tDelay: 1.8, wSyn: 0.275, fPoisson: 250,
};

describe("LifEngine (합성 네트워크)", () => {
  // 0 → 1 강한 흥분 연결 하나
  const chain: Connectome = {
    n: 2,
    offsets: Uint32Array.from([0, 1, 1]),
    targets: Uint32Array.from([1]),
    weights: Int16Array.from([200]),
  };

  it("입력이 없으면 발화하지 않는다", () => {
    const e = new LifEngine(chain, PARAMS, 0.1);
    e.run(5000);
    expect(e.totalSpikes).toBe(0);
    expect(e.activeNeurons).toBe(0);
  });

  it("발화는 tDelay 뒤에 post 뉴런에 도착한다", () => {
    const e = new LifEngine(chain, PARAMS, 0.1);
    e.inject(0, 100);
    e.run(1); // step 1 에서 0번 발화
    expect(e.spikeCount[0]).toBe(1);
    e.run(17);
    expect(e.g[1]).toBe(0); // 아직 도착 전
    e.run(1); // step 19 = 1 + 18
    expect(e.g[1]).toBeCloseTo(200 * PARAMS.wSyn, 3);
  });

  it("불응기 동안에는 다시 발화하지 않는다", () => {
    const e = new LifEngine({ n: 1, offsets: Uint32Array.from([0, 0]), targets: new Uint32Array(), weights: new Int16Array() }, PARAMS, 0.1);
    e.inject(0, 100);
    e.run(1);
    e.inject(0, 100);
    e.run(22); // tRef 2.2 ms = 22 스텝: 정지 상태
    expect(e.spikeCount[0]).toBe(1);
    e.run(1);
    expect(e.spikeCount[0]).toBe(2);
  });

  // 0 번(Poisson 400 Hz) → 1 번을 계속 흥분시킨다
  const driven: Connectome = {
    n: 2,
    offsets: Uint32Array.from([0, 1, 1]),
    targets: Uint32Array.from([1]),
    weights: Int16Array.from([30]),
  };
  const rateTrend = (adapt?: Adaptation) => {
    const e = new LifEngine(driven, PARAMS, 0.1, 9, adapt);
    e.setInput("drive", [0], 400);
    e.run(5000);
    const early = e.spikeCount[1];
    e.clearSpikeCounts();
    e.run(20000);
    e.clearSpikeCounts();
    e.run(5000);
    return { early, late: e.spikeCount[1] };
  };

  it("적응이 없으면 지속 자극에도 발화율이 유지된다", () => {
    const { early, late } = rateTrend();
    expect(early).toBeGreaterThan(5);
    expect(late).toBeGreaterThan(early * 0.7);
  });

  it("적응이 있으면 지속 자극에서 발화율이 떨어지고, 휴지 판정에 적응 전류가 포함된다", () => {
    const { early, late } = rateTrend({ tauW: 300, b: 1 });
    expect(late).toBeLessThan(early * 0.7);

    const e = new LifEngine(driven, PARAMS, 0.1, 9, { tauW: 300, b: 1 });
    e.inject(1, 100);
    e.run(1);
    e.run(100); // u, g 는 거의 0 이 되지만 w 는 아직 남아 있다
    expect(e.w[1]).toBeGreaterThan(0.5);
    expect(e.activeNeurons).toBe(1);
  });
});

const data = hasData() ? loadAll() : null!;

// 앱 기본 dt(0.5 ms)와 더 촘촘한 dt 에서 같은 결과가 나와야 한다
describe.skipIf(!hasData()).each([0.25, 0.5])("FlyWire 커넥톰 재현 (Shiu et al. 2024), dt %s ms", (DT) => {

  function rates(stim: Partial<Record<GroupName, number>>, ms = 500) {
    const e = new LifEngine(data.conn, data.meta.lif, DT, 11);
    for (const [g, r] of Object.entries(stim)) e.setInput(g, data.groups[g as GroupName], r);
    e.run(Math.round(ms / DT));
    const hz = (g: GroupName) =>
      data.groups[g].reduce((a, i) => a + e.spikeCount[i], 0) / data.groups[g].length / (ms / 1000);
    return { hz, engine: e };
  }

  it("자극이 없으면 전뇌가 조용하다", () => {
    const { engine } = rates({}, 200);
    expect(engine.totalSpikes).toBe(0);
  });

  it("당 GRN 자극 → MN9(섭식) 발화", () => {
    expect(rates({ sugar: 150 }).hz("feed")).toBeGreaterThan(30);
  });

  it("쓴맛 GRN 동시 자극 → MN9 억제", () => {
    expect(rates({ sugar: 150, bitter: 150 }).hz("feed")).toBeLessThan(5);
  });

  it("JO-F 더듬이 접촉 → 그루밍 DN", () => {
    const r = rates({ jo_touch: 150 });
    expect(r.hz("groom")).toBeGreaterThan(15);
    expect(r.hz("feed")).toBe(0);
  });

  it("LPLC2 루밍 → Giant Fiber(DNp01) 도약", () => {
    expect(rates({ looming: 200 }, 300).hz("escape")).toBeGreaterThan(50);
  });
}, 120_000);
