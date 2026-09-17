import { describe, expect, it } from "vitest";
import { SCRIPTS_BY_LANG, type Scene, type TalkContext } from "../src/story/scripts.ts";

const HANGUL = /[가-힣]/;
const { ko, en } = SCRIPTS_BY_LANG;

const texts = (scene: Scene) => [
  ...scene.lines.map((l) => l.text),
  ...(scene.choices ?? []).flatMap((c) => [c.label, ...c.reply.map((l) => l.text)]),
];
const shape = (scene: Scene) => ({
  id: scene.id,
  lines: scene.lines.length,
  choices: (scene.choices ?? []).map((c) => [c.mood ?? 0, c.affection ?? 0, c.sulk ?? 0]),
});

const ctx: TalkContext = {
  stage: 4,
  today: { day: "2026-09-17", feedSec: 3, groomSec: 2, scares: 1, pets: 2, meals: 1, talks: 0 },
  cleanliness: 0.4,
  hunger: 0.8,
};

describe("영어 대본", () => {
  it("한국어 대본과 장면·선택지 효과가 같다", () => {
    expect(Object.keys(en.STAGE_SCENES)).toEqual(Object.keys(ko.STAGE_SCENES));
    for (const k of Object.keys(ko.STAGE_SCENES)) expect(shape(en.STAGE_SCENES[+k])).toEqual(shape(ko.STAGE_SCENES[+k]));
    expect(shape(en.INTRO_SCENE)).toEqual(shape(ko.INTRO_SCENE));
    for (const [hour, away] of [[8, 0], [13, 0], [19, 0], [2, 0], [12, 30]]) {
      expect(shape(en.greetingScene(hour, away, 0.8))).toEqual(shape(ko.greetingScene(hour, away, 0.8)));
    }
    expect(en.TOPICS.map((t) => [t.id, t.minStage])).toEqual(ko.TOPICS.map((t) => [t.id, t.minStage]));
    for (let i = 0; i < ko.TOPICS.length; i++) expect(shape(en.TOPICS[i].build(ctx))).toEqual(shape(ko.TOPICS[i].build(ctx)));
    expect(en.MUTTER.map((m) => m.length)).toEqual(ko.MUTTER.map((m) => m.length));
  });

  it("영어 대사에는 한글과 한국어 조사 자리({me:이/가})가 없다", () => {
    const all = [
      ...Object.values(en.STAGE_SCENES).flatMap(texts),
      ...texts(en.INTRO_SCENE),
      ...texts(en.greetingScene(8, 30, 0.9)),
      ...en.TOPICS.flatMap((t) => texts(t.build(ctx))),
      ...en.MUTTER.flat(),
    ];
    for (const text of all) {
      expect(text).not.toMatch(HANGUL);
      expect(text).not.toMatch(/\{(name|me):/);
    }
  });
});
