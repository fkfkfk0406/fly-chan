// 자극을 끈 뒤에도 활동이 스스로 유지되는지(폭주 상태) 확인한다.
import { LifEngine } from "../src/sim/lif-engine.ts";
import { loadAll } from "./node-data.ts";
import type { GroupName } from "../src/sim/data.ts";
const { meta, groups, conn } = loadAll();
const [g, rate, dt] = [process.argv[2] as GroupName, Number(process.argv[3]), Number(process.argv[4] ?? 0.25)];
const e = new LifEngine(conn, meta.lif, dt, 3);
e.setInput(g, groups[g], rate);
const t0 = performance.now();
e.run(Math.round(300 / dt));
const on = e.totalSpikes;
e.setInput(g, [], 0);
e.run(Math.round(300 / dt));
const off1 = e.totalSpikes - on;
e.run(Math.round(300 / dt));
console.log(`${g}@${rate} dt${dt}: on ${on}, off 0-300ms ${off1}, off 300-600ms ${e.totalSpikes - on - off1}, active ${e.activeNeurons}, wall ${(performance.now()-t0).toFixed(0)}ms / 900ms`);
