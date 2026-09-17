// 청각 JO(노래) → pC1 이 켜지는지, 폭주는 없는지
import { LifEngine } from "../src/sim/lif-engine.ts";
import { loadAll } from "./node-data.ts";
const { meta, groups, conn } = loadAll();
const G = groups as unknown as Record<string, number[]>;
const hz = (e: LifEngine, idx: number[], s: number) => idx.reduce((a, i) => a + e.spikeCount[i], 0) / idx.length / s;
for (const r of [20, 50, 100, 150]) {
  const e = new LifEngine(conn, meta.lif, 0.5, 3);
  e.setInput("song", G.jo_song, r);
  const t0 = performance.now();
  e.run(2000);
  const wall = performance.now() - t0;
  const pc1 = hz(e, G.pc1, 1);
  const per = G.pc1.map((i) => e.spikeCount[i]).join("/");
  const motor = ["turn_left", "turn_right", "escape", "groom", "feed"].map((g) => `${g}=${hz(e, G[g], 1).toFixed(0)}`).join(" ");
  const active = e.activeNeurons;
  e.setInput("song", [], 0);
  e.run(600);
  const before = e.totalSpikes;
  e.run(600);
  console.log(`노래 ${String(r).padStart(3)} Hz: pC1 ${pc1.toFixed(1)} Hz (${per}) | ${motor} | 활성 ${active} | 속도 ${(1000 / wall).toFixed(2)}x | 끊은 뒤 발화 ${e.totalSpikes - before}`);
}
