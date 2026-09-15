// 앱의 대표 상황(빛 + 먹는 중)에서 시뮬 속도를 잰다.
import { LifEngine } from "../src/sim/lif-engine.ts";
import { loadAll } from "./node-data.ts";
const { meta, groups, conn } = loadAll();
const dt = Number(process.argv[2] ?? 0.25);
const cases: [string, Record<string, number>][] = [
  ["빛 8Hz", { light: 8 }],
  ["빛 8Hz + 당 106Hz", { light: 8, sugar: 106 }],
  ["접촉 140Hz", { jo_touch: 140 }],
  ["루밍 220Hz", { looming: 220 }],
];
for (const [name, stim] of cases) {
  const e = new LifEngine(conn, meta.lif, dt, 5);
  for (const [g, r] of Object.entries(stim)) e.setInput(g, groups[g as keyof typeof groups], r);
  e.run(Math.round(500 / dt)); // 워밍업
  const t0 = performance.now();
  e.run(Math.round(2000 / dt));
  const wall = performance.now() - t0;
  console.log(`${name.padEnd(18)} ${(2000 / wall).toFixed(2)}x  active ${e.activeNeurons}`);
}
