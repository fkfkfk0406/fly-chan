// 적응 파라미터 탐색: 감각 적응 / 냄새 폭주 / 속도를 한 번에 잰다.
// 사용: node scripts/adapt.ts [tauW:b ...]   (예: 300:1 500:2)
import { LifEngine, type Adaptation } from "../src/sim/lif-engine.ts";
import { loadAll } from "./node-data.ts";

const { meta, groups, conn } = loadAll();
const DT = 0.5;
const configs: Adaptation[] = (process.argv.slice(2).length ? process.argv.slice(2) : ["1:0", "300:1", "500:2"])
  .map((a) => a.split(":").map(Number)).map(([tauW, b]) => ({ tauW, b }));
const g = groups as unknown as Record<string, number[]>;
const steps = (ms: number) => Math.round(ms / DT);
const rate = (e: LifEngine, idx: number[], ms: number) => idx.reduce((a, i) => a + e.spikeCount[i], 0) / idx.length / (ms / 1000);

for (const ad of configs) {
  const label = ad.b ? `τw ${ad.tauW} ms, b ${ad.b} mV` : "적응 없음";

  // 1) 당 150 Hz 3초 유지: MN9 초반 vs 후반
  let e = new LifEngine(conn, meta.lif, DT, 3, ad);
  e.setInput("sugar", g.sugar, 150);
  const bins: number[] = [];
  for (let k = 0; k < 6; k++) {
    e.clearSpikeCounts();
    e.run(steps(500));
    bins.push(rate(e, g.feed, 500));
  }

  // 2) 냄새 20 Hz 300 ms 후 끊기: 끊고 300-600 ms 사이 발화
  e = new LifEngine(conn, meta.lif, DT, 3, ad);
  e.setInput("odor", g.odor_left, 20);
  const t0 = performance.now();
  e.run(steps(300));
  e.setInput("odor", [], 0);
  e.run(steps(300));
  const before = e.totalSpikes;
  e.run(steps(300));
  const after = e.totalSpikes - before;
  const odorWall = performance.now() - t0;

  // 3) 속도: 빛 8 Hz + 당 106 Hz
  e = new LifEngine(conn, meta.lif, DT, 3, ad);
  e.setInput("light", g.light, 8);
  e.setInput("sugar", g.sugar, 106);
  e.run(steps(500));
  const t1 = performance.now();
  e.run(steps(2000));
  const speed = 2000 / (performance.now() - t1);

  console.log(`${label.padEnd(22)} MN9 ${bins.map((b) => b.toFixed(0)).join("→")} Hz | 냄새 끊고 300-600ms 발화 ${after} (활성 ${e.activeNeurons}, ${odorWall.toFixed(0)}ms) | 빛+당 ${speed.toFixed(2)}x`);
}
