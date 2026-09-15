import { describe, expect, it } from "vitest";
import { STAGE_SCENES, TOPICS, greetingScene, mutter, pickTalk } from "../src/story/scripts.ts";
import type { TodayStats } from "../src/care/Care.ts";
import { cleanName, personalize } from "../src/story/personalize.ts";

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

describe("이름 넣기", () => {
  it("받침에 맞춰 조사를 고른다", () => {
    const names = { name: "온나", me: "민준" };
    expect(personalize("{me:을/를} 좋아해", names)).toBe("민준을 좋아해");
    expect(personalize("{me:을/를} 좋아해", { ...names, me: "너" })).toBe("너를 좋아해");
    expect(personalize("{name:이/가} 왔어", names)).toBe("온나가 왔어");
    expect(personalize("{me:이랑/랑}이면", { ...names, me: "주인님" })).toBe("주인님이랑이면");
    expect(personalize("{name}…?", names)).toBe("온나…?");
    expect(personalize("Alex{me:이/가}", { ...names, me: "Alex" })).toBe("AlexAlex가");
  });

  it("이름 입력은 공백을 정리하고 8자로 자르고, 비면 기본값", () => {
    expect(cleanName("  초파리   공주님입니다요  ", "온나")).toBe("초파리 공주님입");
    expect(cleanName("   ", "온나")).toBe("온나");
  });
});

describe("친밀도별 대화", () => {
  it("관계 단계마다 대화 주제가 3개 이상 있고 혼잣말도 있다", () => {
    for (let stage = 0; stage <= 4; stage++) {
      expect(TOPICS.filter((t) => t.minStage === stage).length).toBeGreaterThanOrEqual(3);
      expect(mutter(stage, () => 0)).toBeTruthy();
    }
  });

  it("지금 단계에서 새로 열린 주제를 우선한다", () => {
    const ctx = { stage: 3, today: today(), cleanliness: 1, hunger: 0.3 };
    const stage3 = TOPICS.filter((t) => t.minStage === 3).map((t) => t.id);
    let hits = 0;
    for (let k = 0; k < 200; k++) if (stage3.includes(pickTalk(ctx, []).id)) hits++;
    // 전체 주제 중 단계 3 비율보다 확실히 높게 나온다
    const share = stage3.length / TOPICS.filter((t) => t.minStage <= 3).length;
    expect(hits / 200).toBeGreaterThan(share + 0.15);
  });

  it("모든 대사의 이름 자리 표시자가 올바르게 채워진다", () => {
    const ctx = { stage: 4, today: today({ meals: 1, pets: 1 }), cleanliness: 0.3, hunger: 0.3 };
    const names = { name: "민트", me: "주인님" };
    const scenes = [...TOPICS.map((t) => t.build(ctx)), ...Object.values(STAGE_SCENES)];
    for (const scene of scenes) {
      const texts = [...scene.lines, ...(scene.choices ?? []).flatMap((c) => c.reply)].map((l) => personalize(l.text, names));
      for (const text of texts) expect(text).not.toMatch(/[{}]/);
    }
  });
});
