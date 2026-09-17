// 시계 뉴런 최대 자극이 앱의 다른 입력(빛·딸기·설렘·접촉)과 겹쳐도 폭주하지 않는지
import { LifEngine } from "../src/sim/lif-engine.ts";
import { loadAll } from "./node-data.ts";
const { meta, groups, conn } = loadAll();
const G = groups as unknown as Record<string, number[]>;
const clock: [string, number][] = [["clock_lnv", 30], ["clock_lnd", 30], ["clock_dn1", 30]];
for (const extra of [[], [["light", 8]], [["sugar", 160]], [["pc1", 60]], [["jo_touch", 160]]] as [string, number][][]) {
  const e = new LifEngine(conn, meta.lif, 0.5, 4);
  for (const [g, r] of [...clock, ...extra]) e.setInput(g, G[g], r);
  e.run(2000);
  const feed = G.feed.reduce((a, i) => a + e.spikeCount[i], 0);
  for (const [g] of [...clock, ...extra]) e.setInput(g, [], 0);
  e.run(1000);
  const b = e.totalSpikes;
  e.run(1000);
  console.log(`시계 + ${extra.map(([g]) => g).join(",") || "없음"}: MN9 ${feed} Hz | 끊고 0.5~1초 발화 ${e.totalSpikes - b}`);
}
