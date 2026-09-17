// 생체시계 뉴런을 켜면 몸(하강·운동 뉴런)과 뇌 전체에 무슨 일이 생기는지, 폭주는 없는지
import { LifEngine } from "../src/sim/lif-engine.ts";
import { loadAll } from "./node-data.ts";
const { meta, groups, labels, conn } = loadAll();
const G = groups as unknown as Record<string, number[]>;
const hz = (e: LifEngine, g: string) => G[g].reduce((a, i) => a + e.spikeCount[i], 0) / G[g].length;
const MOTOR = ["forward", "backward", "turn_left", "turn_right", "escape", "groom", "feed", "pc1"];
for (const g of ["clock_lnv", "clock_lnd", "clock_dn1"]) for (const r of [30, 80]) {
  const e = new LifEngine(conn, meta.lif, 0.5, 9);
  e.setInput("light", G.light, 8);
  e.setInput(g, G[g], r);
  e.run(2000);
  const motor = MOTOR.map((m) => `${m}=${hz(e, m).toFixed(0)}`).join(" ");
  const top = Object.entries(labels).map(([i, n]) => [n, e.spikeCount[Number(i)]] as [string, number])
    .filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => `${n}=${c}`).join(" ");
  const spiking = e.spikeCount.reduce((a, c) => a + (c > 0 ? 1 : 0), 0);
  e.setInput(g, [], 0);
  e.run(600);
  const b = e.totalSpikes;
  e.run(600);
  console.log(`${g} ${r}Hz | ${motor} | 발화 뉴런 ${spiking} | DN ${top || "-"} | 끊은 뒤 ${e.totalSpikes - b}`);
}
