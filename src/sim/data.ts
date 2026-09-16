import type { Connectome, LifParams } from "./lif-engine.ts";

export type GroupName =
  | "sugar" | "bitter" | "water" | "pharynx_sugar" | "ir94e" | "jo_touch" | "looming" | "light"
  | "forward" | "backward" | "turn_left" | "turn_right" | "escape" | "groom" | "feed";

export type Groups = Record<GroupName, number[]>;

export interface Meta {
  neurons: number;
  connections: number;
  synapses: number;
  classes: string[];
  lif: LifParams;
  source: string;
}

export const SENSORY_GROUPS = [
  "sugar", "bitter", "water", "pharynx_sugar", "ir94e", "jo_touch", "looming", "light",
] as const satisfies readonly GroupName[];

export const MOTOR_GROUPS = [
  "forward", "backward", "turn_left", "turn_right", "escape", "groom", "feed",
] as const satisfies readonly GroupName[];

export type SensoryGroup = (typeof SENSORY_GROUPS)[number];
export type MotorGroup = (typeof MOTOR_GROUPS)[number];

export const CONNECTOME_FILES = ["csr_offsets.u32", "csr_targets.u32", "csr_weights.i16"] as const;

export function parseConnectome(meta: Meta, [offsets, targets, weights]: ArrayBuffer[]): Connectome {
  const conn = {
    n: meta.neurons,
    offsets: new Uint32Array(offsets),
    targets: new Uint32Array(targets),
    weights: new Int16Array(weights),
  };
  if (conn.offsets.length !== conn.n + 1 || conn.targets.length !== meta.connections) {
    throw new Error("커넥톰 파일 크기가 meta.json 과 맞지 않습니다. npm run data 를 다시 실행하세요.");
  }
  return conn;
}
