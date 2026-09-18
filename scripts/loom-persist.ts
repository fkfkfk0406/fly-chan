// 손 뻗기 게임을 여러 판 한 것처럼 루밍을 반복해서 준 뒤, 자극을 끊고도 그루밍 DN 이 계속 켜져 있는지 본다
import { LifEngine } from "../src/sim/lif-engine.ts";
import { loadAll } from "./node-data.ts";

const { meta, groups, conn } = loadAll();
const G = groups as unknown as Record<string, number[]>;
const DT = 0.5;
const e = new LifEngine(conn, meta.lif, DT, 11);
const rate = (idx: number[], ms: number) => idx.reduce((a, i) => a + e.spikeCount[i], 0) / idx.length / (ms / 1000);
const window = (label: string, ms: number) => {
  e.clearSpikeCounts();
  const before = e.totalSpikes;
  e.run(ms / DT);
  console.log(`${label.padEnd(18)} groom ${rate(G.groom, ms).toFixed(0).padStart(4)} Hz · escape ${rate(G.escape, ms).toFixed(0).padStart(4)} Hz · 전체 발화 ${e.totalSpikes - before} · 활성 뉴런 ${e.activeNeurons}`);
};
window("처음 (자극 없음)", 1000);
for (let game = 1; game <= 8; game++) {
  // 한 판: 약 4초 동안 루밍 3→9 Hz 로 오르내림
  for (let k = 0; k < 8; k++) {
    e.setInput("looming", G.looming, 3 + 6 * Math.abs(Math.sin(k / 2)));
    e.run(500 / DT);
  }
  e.setInput("looming", [], 0);
  window(`${game}판 뒤 1초`, 1000);
}
window("쉬고 3초 뒤", 3000);
