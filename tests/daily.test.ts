import { beforeEach, describe, expect, it } from "vitest";
import { Care } from "../src/care/Care.ts";
import { ALL_QUESTS_BONUS, QUEST_POOL, checkIn, claimQuests, questStatus } from "../src/care/Daily.ts";
import { sulkScene, writeLetter } from "../src/story/away.ts";
import { MEMORIES, replayable } from "../src/story/memories.ts";
import { loomingHz } from "../src/ui/MiniGames.ts";

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

const H = 3.6e6;
const NOON = new Date(2026, 8, 17, 12).getTime();

describe("출석과 오늘의 부탁", () => {
  beforeEach(() => store.clear());

  it("하루에 한 번만 출석하고, 이어지면 연속, 끊기면 1일부터", () => {
    const care = Care.load(NOON);
    const hearts = care.s.hearts;
    expect(checkIn(care, NOON)).toEqual({ streak: 1, reward: 5 });
    expect(checkIn(care, NOON + 2 * H)).toBeNull();
    expect(checkIn(care, NOON + 24 * H)?.streak).toBe(2);
    expect(checkIn(care, NOON + 72 * H)?.streak).toBe(1);
    expect(care.s.hearts).toBe(hearts + 15);
  });

  it("부탁은 날짜마다 3개이고, 끝내면 한 번만 보상, 셋 다면 보너스", () => {
    const care = Care.load(NOON);
    const list = questStatus(care, NOON);
    expect(list).toHaveLength(3);
    expect(new Set(list.map((q) => q.quest.id)).size).toBe(3);
    expect(questStatus(care, NOON + H).map((q) => q.quest.id)).toEqual(list.map((q) => q.quest.id));

    const hearts = care.s.hearts;
    for (const { quest } of list) care.s.totals[quest.id] += quest.goal;
    const got = claimQuests(care, NOON);
    expect(got.done).toHaveLength(3);
    expect(got.bonus).toBe(ALL_QUESTS_BONUS);
    const sum = list.reduce((a, q) => a + q.quest.reward, 0);
    expect(care.s.hearts).toBe(hearts + sum + ALL_QUESTS_BONUS);
    expect(claimQuests(care, NOON).done).toHaveLength(0);
    // 다음 날은 새 부탁, 어제 기록은 세지 않는다
    expect(questStatus(care, NOON + 24 * H).every((q) => q.progress === 0)).toBe(true);
    expect(QUEST_POOL.length).toBeGreaterThanOrEqual(3);
  });
});

describe("삐짐·편지", () => {
  beforeEach(() => store.clear());

  it("친구 이상에서 하루 넘게 비우면 삐지고 편지를 남긴다", () => {
    const care = Care.load(NOON);
    care.setNames("온나", "너", NOON);
    care.s.stageSeen = 1;
    care.save(NOON);
    const back = Care.load(NOON + 30 * H);
    expect(back.s.sulk).toBeGreaterThan(0.4);
    expect(back.s.letter?.lines.at(-1)).toContain("{name}");
  });

  it("쓰다듬기로 조금씩, 선물로 한 번에 풀린다", () => {
    const care = Care.load(NOON);
    care.sulkUp(0.5, NOON, "away");
    expect(care.on("petted", NOON)).toBe("흥, 그런다고 안 풀려");
    expect(care.s.sulk).toBeCloseTo(0.3);
    care.s.hearts = 100;
    expect(care.giveGift(NOON)).toBe(true);
    expect(care.s.sulk).toBe(0);
  });

  it("편지와 삐짐 장면", () => {
    const letter = writeLetter({ stage: 3, hours: 30, hungry: true, dirty: false, slept: true }, 0, () => 0.1);
    expect(letter.lines.join(" ")).toContain("배고파");
    expect(letter.gift).not.toBeNull();
    expect(sulkScene(true).choices?.every((c) => (c.sulk ?? 0) > 0)).toBe(true);
  });
});

describe("추억·미니게임", () => {
  it("추억 장면은 모두 있고, 다시 볼 때 선택지는 효과가 없다", () => {
    for (const m of MEMORIES) expect(m.scene.lines.length).toBeGreaterThan(0);
    const again = replayable(MEMORIES[0].scene);
    expect(again.choices?.every((c) => !c.mood && !c.affection && !c.sulk)).toBe(true);
  });

  it("손 뻗기: 멀리서 천천히는 안전(<6 Hz), 가까이서 빠르면 도망 영역", () => {
    expect(loomingHz(0.45, 1)).toBeLessThan(6);
    expect(loomingHz(0.1, 0.2)).toBeLessThan(8);
    expect(loomingHz(0.45, 0.1)).toBeGreaterThan(30);
  });
});
