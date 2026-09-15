// 감각 그룹을 자극하고 가장 많이 발화한 하강·운동 뉴런을 출력한다.
// 사용: node scripts/probe.ts sugar:100 [bitter:100] [--ms 1000] [--dt 0.1]
import { LifEngine } from "../src/sim/lif-engine.ts";
import { loadAll } from "./node-data.ts";
import type { GroupName } from "../src/sim/data.ts";

const args = process.argv.slice(2);
const opt = (k: string, d: number) => {
  const i = args.indexOf(k);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const ms = opt("--ms", 1000);
const dt = opt("--dt", 0.1);
const stims = args.filter((a) => a.includes(":")).map((a) => a.split(":") as [GroupName, string]);

const { meta, groups, labels, conn } = loadAll();
const engine = new LifEngine(conn, meta.lif, dt, 7);
for (const [g, rate] of stims) engine.setInput(g, groups[g], Number(rate));

const counts = new Float64Array(conn.n);
const steps = Math.round(ms / dt);
const t0 = performance.now();
for (let s = 0; s < steps; s += 100) {
  engine.run(Math.min(100, steps - s));
  for (let i = 0; i < conn.n; i++) counts[i] += engine.spikeCount[i];
  engine.clearSpikeCounts();
}
const wall = performance.now() - t0;

const sec = ms / 1000;
const active = counts.reduce((a, c) => a + (c > 0 ? 1 : 0), 0);
console.log(`${stims.map((s) => s.join("@")).join(" + ")}  ${ms} ms, dt ${dt} → wall ${wall.toFixed(0)} ms (${(ms / wall).toFixed(2)}x)`);
console.log(`spiking neurons ${active}, total spikes ${engine.totalSpikes}`);

const ranked = Object.entries(labels)
  .map(([i, name]) => ({ name, rate: counts[Number(i)] / sec }))
  .filter((r) => r.rate > 0)
  .sort((a, b) => b.rate - a.rate)
  .slice(0, 25);
console.log("top descending/motor:", ranked.map((r) => `${r.name}=${r.rate.toFixed(0)}`).join(" "));

for (const g of ["forward", "backward", "turn_left", "turn_right", "escape", "groom", "feed"] as const) {
  const rate = groups[g].reduce((a, i) => a + counts[i], 0) / groups[g].length / sec;
  console.log(`  ${g.padEnd(10)} ${rate.toFixed(1)} Hz`);
}
