// pC1 (각성·짝짓기 상태 뉴런) 조사:
//  1) 앱의 감각 입력이 pC1 을 얼마나 켜는가
//  2) pC1 을 직접 켜면 하강·운동 뉴런과 폭주 여부는 어떤가
import { LifEngine } from "../src/sim/lif-engine.ts";
import { loadAll } from "./node-data.ts";

const { meta, groups, labels, conn } = loadAll();
const G = groups as unknown as Record<string, number[]>;
const pc1 = G.pc1;
const rate = (e: LifEngine, idx: number[], ms: number) => idx.reduce((a, i) => a + e.spikeCount[i], 0) / idx.length / (ms / 1000);

console.log(`pC1 뉴런 ${pc1.length}개: ${pc1.map((i) => labels[String(i)] ?? i).join(", ")}`);
console.log("\n1) 감각 입력 → pC1 (1초, 앱 세기)");
const stims: [string, number][] = [
  ["sugar", 160], ["pharynx_sugar", 150], ["water", 200], ["ir94e", 100], ["bitter", 160],
  ["jo_touch", 160], ["looming", 220], ["light", 8],
];
for (const [g, r] of stims) {
  const e = new LifEngine(conn, meta.lif, 0.5, 3);
  e.setInput(g, G[g], r);
  e.run(2000);
  const perType = pc1.map((i) => e.spikeCount[i]).join("/");
  console.log(`  ${g.padEnd(14)} pC1 평균 ${rate(e, pc1, 1000).toFixed(1).padStart(5)} Hz  (뉴런별 스파이크 ${perType})`);
}

console.log("\n2) pC1 직접 자극 → 몸 반응");
for (const r of [50, 100, 200]) {
  const e = new LifEngine(conn, meta.lif, 0.5, 3);
  e.setInput("pc1", pc1, r);
  e.run(2000);
  const motor = ["forward", "backward", "turn_left", "turn_right", "escape", "groom", "feed"]
    .map((g) => `${g}=${rate(e, G[g], 1000).toFixed(0)}`).join(" ");
  const top = Object.entries(labels).map(([i, n]) => [n, e.spikeCount[Number(i)]] as [string, number])
    .filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => `${n}=${c}`).join(" ");
  e.setInput("pc1", [], 0);
  e.run(600);
  const before = e.totalSpikes;
  e.run(600);
  console.log(`  ${r} Hz: ${motor} | 활발 DN ${top || "-"} | 끊은 뒤 발화 ${e.totalSpikes - before}`);
}
