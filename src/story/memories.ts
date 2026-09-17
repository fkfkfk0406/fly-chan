// 추억 앨범에서 다시 볼 수 있는 장면
import { L as tr } from "../i18n.ts";
import { SCIENTIFIC_NAME_SCENE, specialDay } from "./EasterEggs.ts";
import { INTRO_SCENE, STAGE_SCENES, type Scene } from "./scripts.ts";

export interface Memory {
  id: string;
  emoji: string;
  title: string;
  scene: Scene;
}

const special = (month: number, day: number, days = 0) => specialDay(new Date(2000, month - 1, day), days)!.scene;

export const MEMORIES: Memory[] = [
  { id: "intro", emoji: "🌱", title: tr("첫 만남", "First meeting"), scene: INTRO_SCENE },
  { id: "stage-1", emoji: "🤝", title: tr("친구가 된 날", "The day we became friends"), scene: STAGE_SCENES[1] },
  { id: "stage-2", emoji: "🌸", title: tr("호감이 생긴 날", "The day of the crush"), scene: STAGE_SCENES[2] },
  { id: "stage-3", emoji: "💓", title: tr("두근두근한 날", "The heart-fluttering day"), scene: STAGE_SCENES[3] },
  { id: "stage-4", emoji: "💖", title: tr("연인이 된 날", "The day we became lovers"), scene: STAGE_SCENES[4] },
  { id: "together-100", emoji: "💯", title: tr("함께한 지 100일", "100 days together"), scene: special(6, 1, 100) },
  { id: "together-365", emoji: "🎂", title: tr("함께한 지 1년", "One year together"), scene: special(6, 1, 365) },
  { id: "xmas", emoji: "🎄", title: tr("크리스마스", "Christmas"), scene: special(12, 25) },
  { id: "pi", emoji: "🥧", title: tr("파이데이", "Pi Day"), scene: special(3, 14) },
  { id: "egg-name", emoji: "🔬", title: tr("학명으로 불린 날", "Called by her scientific name"), scene: SCIENTIFIC_NAME_SCENE },
];

export const memoryOf = (id: string) => MEMORIES.find((m) => m.id === id);

/** 다시 볼 때는 선택지가 기분·애정·삐짐을 바꾸지 않는다 */
export function replayable(scene: Scene): Scene {
  return { ...scene, choices: scene.choices?.map((c) => ({ ...c, mood: 0, affection: 0, sulk: 0 })) };
}
