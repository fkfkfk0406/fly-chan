// 앱에서 실제로 쓰는 간식 자극 세기 조합이 폭주하지 않는지 확인한다.
import { LifEngine } from "../src/sim/lif-engine.ts";
import { loadAll } from "./node-data.ts";

const { meta, groups, conn } = loadAll();
const G = groups as unknown as Record<string, number[]>;
const combos: [string, [string, number][]][] = [
  ["짠 과자", [["ir94e", 100]]],
  ["짠 과자 + 쓴 버섯", [["ir94e", 100], ["bitter", 160]]],
  ["짠 과자 + 딸기", [["ir94e", 100], ["sugar", 160]]],
  ["짠 과자 70 + 쓴 버섯", [["ir94e", 70], ["bitter", 160]]],
  ["짠 과자 50 + 쓴 버섯", [["ir94e", 50], ["bitter", 160]]],
  ["물 + 딸기 + 꿀", [["water", 200], ["sugar", 160], ["pharynx_sugar", 150]]],
  ["전부 (빛 포함)", [["ir94e", 100], ["bitter", 160], ["sugar", 160], ["water", 200], ["pharynx_sugar", 150], ["light", 8]]],
];
for (const [name, stim] of combos) {
  const e = new LifEngine(conn, meta.lif, 0.5, 7);
  for (const [g, r] of stim) e.setInput(g, G[g], r);
  e.run(2000); // 1초 자극
  const mn9 = G.feed.reduce((a, i) => a + e.spikeCount[i], 0);
  for (const [g] of stim) e.setInput(g, [], 0);
  e.run(600);
  const before = e.totalSpikes;
  e.run(600); // 끊고 300-600 ms
  console.log(`${name.padEnd(22)} MN9 ${mn9.toString().padStart(3)} Hz | 끊은 뒤 발화 ${e.totalSpikes - before} | 활성 ${e.activeNeurons}`);
}
