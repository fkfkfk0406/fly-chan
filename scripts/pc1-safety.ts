// 설렘(pC1) 자극이 앱의 다른 입력과 겹쳐도 폭주하지 않는지, 회전 DN 이 얼마나 켜지는지
import { LifEngine } from "../src/sim/lif-engine.ts";
import { loadAll } from "./node-data.ts";
const { meta, groups, conn } = loadAll();
const G = groups as unknown as Record<string, number[]>;
const hz = (e: LifEngine, g: string) => G[g].reduce((a, i) => a + e.spikeCount[i], 0) / G[g].length;
const extras: [string, number][] = [["light", 8], ["sugar", 160], ["jo_touch", 160], ["looming", 220], ["bitter", 160], ["ir94e", 100], ["water", 200]];
for (const pc1 of [40, 80]) for (const [g, r] of [["-", 0] as [string, number], ...extras]) {
  const e = new LifEngine(conn, meta.lif, 0.5, 5);
  e.setInput("pc1", G.pc1, pc1);
  if (g !== "-") e.setInput(g, G[g], r);
  e.run(2000);
  const turn = hz(e, "turn_left") + hz(e, "turn_right");
  e.setInput("pc1", [], 0);
  if (g !== "-") e.setInput(g, [], 0);
  e.run(600);
  const b = e.totalSpikes;
  e.run(600);
  console.log(`pC1 ${pc1} + ${g.padEnd(8)} 회전DN합 ${turn.toFixed(0).padStart(3)} Hz | escape ${hz(e, "escape").toFixed(0)} | 끊은 뒤 ${e.totalSpikes - b}`);
}
