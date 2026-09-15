import { beforeEach, describe, expect, it } from "vitest";
import { Care, DAILY_AFFECTION_CAP } from "../src/care/Care.ts";

// Node 에는 localStorage 가 없으니 메모리 구현을 붙인다
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

const H = 3.6e6;

describe("Care", () => {
  beforeEach(() => store.clear());

  it("처음 열면 이름 없는 새 상태로 시작하고, 이름을 지으면 일기에 남는다", () => {
    const care = Care.load(0);
    expect(care.named).toBe(false);
    expect(care.s.affection).toBeCloseTo(0.05);
    care.setNames("민트", "주인님", 0);
    expect(care.named).toBe(true);
    expect(care.s.diary[0].text).toContain("민트가 왔어요");
    care.setNames("별", "너", 0);
    expect(care.s.diary[0].text).toContain("민트가 왔어요"); // 이미 지었으면 일기는 그대로
    expect(care.s.name).toBe("별");
  });

  it("예전 저장 형식(v1)은 지우고 새로 시작한다", () => {
    store.set("onna-care-v1", JSON.stringify({ affection: 1, stageSeen: 4 }));
    const care = Care.load(0);
    expect(store.has("onna-care-v1")).toBe(false);
    expect(care.s.stageSeen).toBe(0);
  });

  it("닫아 둔 시간만큼 배고픔·졸림이 늘고 일기에 남는다", () => {
    const now = 1_000 * H;
    Care.load(now).save(now);
    const later = Care.load(now + 1 * H);
    expect(later.s.hunger).toBeCloseTo(0.45 + 0.3, 5); // 0.3/h × 1h
    expect(later.s.sleepiness).toBeCloseTo(0.2 + 0.2, 5);
    expect(later.s.diary[0].text).toContain("1시간 동안 기다렸어요");
  });

  it("자는 동안 닫아 두면 졸림이 회복되고 저절로 깬다", () => {
    const now = 1_000 * H;
    const care = Care.load(now);
    care.s.sleepiness = 0.9;
    care.on("sleep", now);
    care.save(now);
    const later = Care.load(now + 1 * H);
    expect(later.s.asleep).toBe(false);
    expect(later.s.sleepiness).toBeLessThan(0.3);
  });

  it("오래 방치하면 최대 72시간까지만 반영하고 애정이 줄어든다", () => {
    const now = 1_000 * H;
    const care = Care.load(now);
    const affection = care.s.affection;
    care.save(now);
    const later = Care.load(now + 500 * H);
    expect(later.s.hunger).toBe(1);
    expect(later.s.affection).toBeLessThan(affection);
    expect(later.s.diary[0].text).toContain("72시간");
  });

  it("쓰다듬기는 기분·애정을 올리지만, 연달아 너무 많이 하면 싫어한다", () => {
    const care = Care.load(0);
    const mood = care.s.mood;
    expect(care.on("petted", 0)).toBe("…"); // 낯섦 단계에서는 아직 말이 없다
    expect(care.s.mood).toBeGreaterThan(mood);
    for (let k = 1; k <= 2; k++) care.on("petted", k * 1000);
    const affection = care.s.affection;
    expect(care.on("petted", 3000)).toBe("그만 좀 해!");
    expect(care.s.affection).toBeLessThan(affection);
  });

  it("기분이 나쁘면 쓰다듬어도 애정이 오르지 않는다", () => {
    const care = Care.load(0);
    care.s.mood = 0.2;
    const affection = care.s.affection;
    expect(care.on("petted", 0)).toBe("흥…");
    expect(care.s.affection).toBe(affection);
  });

  it("놀래키기·쓴 버섯은 기분과 애정을 깎는다", () => {
    const care = Care.load(0);
    const { mood, affection } = care.s;
    care.on("scared", 0);
    care.on("bitter", 0);
    expect(care.s.mood).toBeLessThan(mood);
    expect(care.s.affection).toBeLessThan(affection);
  });

  it("?time 배속은 시간 경과에 곱해진다", () => {
    const care = Care.load(0, 60);
    const hunger = care.s.hunger;
    care.passTime(60); // 실제 1분 = 게임 1시간
    expect(care.s.hunger - hunger).toBeCloseTo(0.3, 5);
  });
});

describe("Care 청소", () => {
  beforeEach(() => store.clear());

  it("시간이 지나면 먼지가 쌓이고 청결도가 떨어진다 (최대 6개)", () => {
    const now = 1_000 * H;
    const care = Care.load(now);
    expect(care.cleanliness).toBe(1);
    care.save(now);
    const later = Care.load(now + 4 * H); // 1.5h 마다 하나 → 2개
    expect(later.s.messes.length).toBe(2);
    expect(later.cleanliness).toBeCloseTo(1 - 2 * 0.18, 5);
    const muchLater = Care.load(now + 60 * H);
    expect(muchLater.s.messes.length).toBe(6);
    expect(muchLater.s.diary[0].text).toContain("먼지");
  });

  it("얼룩을 하나씩 또는 한 번에 치울 수 있고, 치우면 기분이 오른다", () => {
    const care = Care.load(0);
    const a = care.addMess("stain", 1, 1)!;
    care.addMess("dust");
    care.addMess("dust");
    const mood = care.s.mood;
    expect(care.clean(0, a.id)).toBe("고마워~");
    expect(care.s.messes.length).toBe(2);
    expect(care.clean(0)).toBe("반짝반짝✨");
    expect(care.s.messes.length).toBe(0);
    expect(care.s.mood).toBeGreaterThan(mood);
    expect(care.clean(0)).toBe("이미 깨끗해!");
  });

  it("지저분하면 기분의 기준값이 낮아진다", () => {
    const clean = Care.load(0);
    const dirty = Care.load(0);
    for (let k = 0; k < 6; k++) dirty.addMess("dust");
    clean.passTime(3600);
    dirty.passTime(3600);
    expect(dirty.s.mood).toBeLessThan(clean.s.mood - 0.05);
  });
});

describe("Care 관계 단계", () => {
  beforeEach(() => store.clear());

  it("단계는 애정·함께한 날·좋은 기분을 모두 채워야 오르고, 한 단계씩만 오른다", () => {
    const care = Care.load(0);
    care.s.affection = 0.8;
    care.s.mood = 0.9;
    expect(care.pendingStage()).toBeNull(); // 첫날: 친구(1일) 조건 미달
    care.s.gameHours = 24;
    expect(care.pendingStage()).toBe(1);
    care.markStageSeen(1, 0);
    expect(care.pendingStage()).toBeNull(); // 호감은 3일
    care.s.gameHours = 24 * 3;
    care.s.mood = 0.4;
    expect(care.pendingStage()).toBeNull(); // 기분이 나쁘면 안 오른다
    expect(care.nextStage()).toMatchObject({ name: "호감", affection: 0, days: 0, moodOk: false });
    care.s.mood = 0.7;
    expect(care.pendingStage()).toBe(2);
    care.markStageSeen(2, 0);
    expect(care.s.diary[0].text).toContain("호감");
  });

  it("애정은 하루에 정해진 만큼만 오르고, 다음 날 다시 오른다", () => {
    const care = Care.load(0);
    const start = care.s.affection;
    for (let k = 0; k < 20; k++) care.bump(0, 0.02);
    expect(care.s.affection - start).toBeCloseTo(DAILY_AFFECTION_CAP, 5);
    care.bump(0, -0.03); // 깎이는 건 상한과 무관
    expect(care.s.affection - start).toBeCloseTo(DAILY_AFFECTION_CAP - 0.03, 5);
    care.passTime(24 * 3600);
    care.bump(0, 0.02);
    expect(care.affectionRoomToday).toBeCloseTo(DAILY_AFFECTION_CAP - 0.02, 5);
  });

  it("오늘 기록은 날짜가 바뀌면 새로 시작한다", () => {
    const day1 = new Date(2026, 8, 15, 10).getTime();
    const care = Care.load(day1);
    care.on("petted", day1);
    care.on("ate", day1);
    expect(care.todayStats(day1)).toMatchObject({ pets: 1, meals: 1 });
    const day2 = new Date(2026, 8, 16, 9).getTime();
    expect(care.todayStats(day2)).toMatchObject({ pets: 0, meals: 0 });
  });
});
