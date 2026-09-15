import { describe, expect, it } from "vitest";
import { STAGE_SCENES, TOPICS, greetingScene, pickTalk } from "../src/story/scripts.ts";
import type { TodayStats } from "../src/care/Care.ts";

const today = (over: Partial<TodayStats> = {}): TodayStats => ({
  day: "2026-09-15", feedSec: 0, groomSec: 0, scares: 0, pets: 0, meals: 0, talks: 0, ...over,
});

describe("대본", () => {
  it("시간대에 맞는 인사를 하고, 12시간 넘게 비우면 삐친다", () => {
    expect(greetingScene(8, 0, 0.3).lines[0].text).toContain("아침");
    expect(greetingScene(23, 0, 0.3).lines[0].text).toContain("이 시간까지");
    const away = greetingScene(14, 30, 0.3);
    expect(away.id).toBe("greet-away");
    expect(away.lines.map((l) => l.text).join()).toContain("30시간");
    expect(greetingScene(14, 0, 0.9).lines.at(-1)!.text).toContain("배고파");
  });

  it("관계 단계 1~4 이벤트가 모두 있고 선택지가 있다", () => {
    for (const k of [1, 2, 3, 4]) expect(STAGE_SCENES[k].choices!.length).toBeGreaterThan(0);
  });

  it("대화 주제는 현재 단계 이하에서만, 최근 주제는 피해서 고른다", () => {
    const ctx = { stage: 0, today: today(), cleanliness: 1, hunger: 0.3 };
    const stage0 = TOPICS.filter((t) => t.minStage === 0).map((t) => t.id);
    for (let k = 0; k < 30; k++) expect(stage0).toContain(pickTalk(ctx, [], Math.random).id);
    const recent = stage0.filter((id) => id !== "antenna");
    expect(pickTalk(ctx, recent, () => 0.99).id).toBe("antenna");
  });

  it("\"오늘\" 이야기는 실제 오늘 기록(뇌 출력 시간)을 말한다", () => {
    const ctx = { stage: 0, today: today({ meals: 2, feedSec: 7.6, pets: 3, groomSec: 4.2, scares: 1 }), cleanliness: 1, hunger: 0.3 };
    const scene = pickTalk(ctx, [], () => 0); // rand 0 → 오늘 이야기 우선
    const text = scene.lines.map((l) => l.text).join(" ");
    expect(scene.id).toBe("today");
    expect(text).toContain("딸기 2개");
    expect(text).toContain("8초");
    expect(text).toContain("1번이나 놀래켰");
  });
});
