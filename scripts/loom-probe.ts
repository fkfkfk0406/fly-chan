// 미니게임 "살금살금 손 뻗기" 보정: LPLC2 루밍 세기(Hz)별 Giant Fiber(DNp01) 발화율
import { LifEngine } from "../src/sim/lif-engine.ts";
import { loadAll } from "./node-data.ts";

const { meta, groups, conn } = loadAll();
const G = groups as unknown as Record<string, number[]>;
const DT = 0.5;
for (const hz of [2, 4, 6, 8, 10, 14]) {
  const e = new LifEngine(conn, meta.lif, DT, 7);
  e.setInput("looming", G.looming, hz);
  const windows: number[] = [];
  for (let w = 0; w < 10; w++) {
    e.clearSpikeCounts();
    e.run(200 / DT);
    windows.push(G.escape.reduce((a, i) => a + e.spikeCount[i], 0) / G.escape.length / 0.2);
  }
  console.log(`looming ${String(hz).padStart(3)} Hz → escape 200ms창 ${windows.map((r) => r.toFixed(0)).join(" ")}`);
}
