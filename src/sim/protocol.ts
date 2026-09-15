import type { Meta, MotorGroup, SensoryGroup } from "./data.ts";
import type { Adaptation } from "./lif-engine.ts";

export type ToWorker =
  | { type: "init"; dt: number; adaptation: Adaptation }
  | { type: "stim"; group: SensoryGroup; rate: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" };

export interface SimFrame {
  type: "frame";
  /** 시뮬레이션 시간 (ms) */
  simTime: number;
  /** 이번 프레임에서 진행한 시뮬 시간 (ms) */
  simDelta: number;
  /** 벽시계 대비 시뮬 속도 (1 = 실시간) */
  speed: number;
  activeNeurons: number;
  spikingNeurons: number;
  /** 전체 평균 발화율 (Hz) */
  meanRate: number;
  /** 운동 그룹별 평균 발화율 (Hz) */
  motor: Record<MotorGroup, number>;
  /** 가장 활발한 하강·운동 뉴런 [이름, Hz] */
  topLabeled: [string, number][];
  /** 뉴런별 시각화 밝기 0-255 */
  activity: Uint8Array;
}

export type FromWorker =
  | { type: "progress"; loaded: number; total: number; label: string }
  | { type: "ready"; meta: Meta; groupSizes: Record<string, number> }
  | SimFrame
  | { type: "error"; message: string };
