// 빛 없이 pC1 만 줬다가 끊은 뒤, 잔여 발화가 사라지는지 (1초 구간별)
import { LifEngine } from "../src/sim/lif-engine.ts";
import { loadAll } from "./node-data.ts";
const { meta, groups, conn } = loadAll();
const G = groups as unknown as Record<string, number[]>;
for (const [pc1, sec] of [[40, 2], [20, 2], [40, 0.5]] as [number, number][]) {
  const e = new LifEngine(conn, meta.lif, 0.5, 5);
  e.setInput("pc1", G.pc1, pc1);
  e.run(sec * 2000);
  e.setInput("pc1", [], 0);
  const bins: number[] = [];
  for (let k = 0; k < 5; k++) {
    const b = e.totalSpikes;
    e.run(2000);
    bins.push(e.totalSpikes - b);
  }
  console.log(`pC1 ${pc1} Hz ${sec}초 후 끊음 → 1초 구간별 발화 ${bins.join(" → ")} | 활성 ${e.activeNeurons}`);
}
