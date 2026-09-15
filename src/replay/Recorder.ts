import type { BodyState } from "../behavior/Controller.ts";
import type { MotorGroup } from "../sim/data.ts";
import type { Food } from "../world/Habitat.ts";

export interface RecordFrame {
  /** 녹화 시작부터 초 */
  t: number;
  state: BodyState;
  foods: Food[];
  motor: Record<MotorGroup, number>;
  /** 밝기가 있는 뉴런만 [인덱스, 밝기] */
  activeIdx: Uint32Array;
  activeVal: Uint8Array;
  stats: { meanRate: number; spikingNeurons: number };
}

const HZ = 10;
const MAX_ACTIVE = 6000;

/** 최근 duration 초를 10 Hz 로 기록하는 링버퍼 */
export class Recorder {
  frames: RecordFrame[] = [];
  private lastT = -Infinity;

  constructor(readonly duration = 200) {}

  get start(): number {
    return this.frames[0]?.t ?? 0;
  }

  get end(): number {
    return this.frames[this.frames.length - 1]?.t ?? 0;
  }

  record(
    t: number, state: BodyState, foods: Food[], motor: Record<MotorGroup, number>,
    activity: Uint8Array, stats: RecordFrame["stats"],
  ): void {
    if (t - this.lastT < 1 / HZ) return;
    this.lastT = t;

    let count = 0;
    for (let i = 0; i < activity.length; i++) if (activity[i] > 24) count++;
    count = Math.min(count, MAX_ACTIVE);
    const activeIdx = new Uint32Array(count);
    const activeVal = new Uint8Array(count);
    for (let i = 0, k = 0; i < activity.length && k < count; i++) {
      if (activity[i] > 24) {
        activeIdx[k] = i;
        activeVal[k++] = activity[i];
      }
    }

    this.frames.push({
      t, state: { ...state }, foods: foods.map((f) => ({ ...f })), motor: { ...motor }, activeIdx, activeVal, stats,
    });
    while (this.frames.length && t - this.frames[0].t > this.duration) this.frames.shift();
  }

  /** t 이하의 가장 가까운 프레임 인덱스 (이진 탐색) */
  indexAt(t: number): number {
    let lo = 0;
    let hi = this.frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.frames[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  activityOf(frame: RecordFrame, n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let k = 0; k < frame.activeIdx.length; k++) out[frame.activeIdx[k]] = frame.activeVal[k];
    return out;
  }

  clear(): void {
    this.frames = [];
    this.lastT = -Infinity;
  }
}
