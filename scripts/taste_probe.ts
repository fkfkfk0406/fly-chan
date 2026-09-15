// 간식 후보 미각 그룹을 한꺼번에 자극해 MN9(feed)·하강 뉴런 반응과 자극 종료 후 잔류 활동을 표로 출력한다.
// 사용: node scripts/taste_probe.ts [--dt 0.5] [--ms 1000] [--seeds 3] [--only water,ir94e]
import { LifEngine } from "../src/sim/lif-engine.ts";
import { loadAll } from "./node-data.ts";
import type { GroupName } from "../src/sim/data.ts";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const dt = Number(opt("--dt", "0.5"));
const ms = Number(opt("--ms", "1000"));
const seeds = Number(opt("--seeds", "3"));

const { meta, groups, labels, conn } = loadAll();
const G = groups as unknown as Record<string, number[]>;

const TASTES = ["water", "ir94e", "low_salt", "high_salt", "taste_peg", "pharynx_sugar", "pharynx_water", "leg_taste"];
const only = opt("--only", "");
const tastes = only ? only.split(",") : TASTES;

type Stim = [string, number][];
const MOTOR = ["forward", "backward", "turn_left", "turn_right", "escape", "groom", "feed"];

function probe(stim: Stim) {
  const counts = new Float64Array(conn.n);
  let wall = 0;
  let spikes = 0;
  let off1 = 0;
  let off2 = 0;
  for (let s = 0; s < seeds; s++) {
    const e = new LifEngine(conn, meta.lif, dt, 7 + s);
    for (const [g, r] of stim) e.setInput(g, G[g], r);
    const steps = Math.round(ms / dt);
    const t0 = performance.now();
    for (let k = 0; k < steps; k += 100) {
      e.run(Math.min(100, steps - k));
      for (let i = 0; i < conn.n; i++) counts[i] += e.spikeCount[i];
      e.clearSpikeCounts();
    }
    wall += performance.now() - t0;
    spikes += e.totalSpikes;
    // 자극 종료 후 잔류 활동 (runaway 판정)
    for (const [g] of stim) e.setInput(g, [], 0);
    const before = e.totalSpikes;
    e.run(Math.round(300 / dt));
    const mid = e.totalSpikes;
    e.run(Math.round(300 / dt));
    off1 += mid - before;
    off2 += e.totalSpikes - mid;
  }
  const sec = (ms / 1000) * seeds;
  const active = counts.reduce((a, c) => a + (c > 0 ? 1 : 0), 0);
  const rate = (g: string) => G[g].reduce((a, i) => a + counts[i], 0) / G[g].length / sec;
  const top = Object.entries(labels)
    .map(([i, name]) => ({ name, rate: counts[Number(i)] / sec }))
    .filter((r) => r.rate >= 1)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 8)
    .map((r) => `${r.name}=${r.rate.toFixed(0)}`)
    .join(" ");
  const motor = MOTOR.filter((g) => g !== "feed" && rate(g) >= 1).map((g) => `${g}=${rate(g).toFixed(0)}`).join(" ");
  const name = stim.map(([g, r]) => `${g}@${r}`).join("+");
  console.log(
    `${name.padEnd(28)} MN9 ${rate("feed").toFixed(1).padStart(5)} Hz | active ${String(Math.round(active)).padStart(6)} | ` +
      `spikes/run ${String(Math.round(spikes / seeds)).padStart(7)} | wall ${(wall / seeds).toFixed(0).padStart(4)} ms | ` +
      `off 0-300 ${Math.round(off1 / seeds)} 300-600 ${Math.round(off2 / seeds)}` +
      (motor ? ` | motor ${motor}` : ""),
  );
  console.log(`${"".padEnd(28)} top: ${top || "-"}`);
}

console.log(`dt ${dt} ms, ${ms} ms stim, ${seeds} seeds (active = 모든 seed 합산 중 한 번이라도 발화한 뉴런)`);
console.log("# baseline");
for (const r of [100, 200]) probe([["sugar", r]]);
for (const r of [100, 200]) probe([["bitter", r]]);
probe([["sugar", 100], ["bitter", 100]]);
console.log("# single");
for (const t of tastes) for (const r of [100, 200]) probe([[t, r]]);
console.log("# + bitter@100");
for (const t of tastes) probe([[t, 100], ["bitter", 100]]);
console.log("# sugar@100 +");
for (const t of tastes) probe([["sugar", 100], [t, 100]]);
