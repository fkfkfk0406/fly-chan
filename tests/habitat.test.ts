import { describe, expect, it } from "vitest";
import { EAT_SECONDS, Habitat, PC1_MAX_HZ, SNACKS, type FoodKind } from "../src/world/Habitat.ts";

describe("Habitat 감각 입력", () => {
  const atWall = { x: 2.8, z: 0, heading: Math.PI / 2 };
  const center = { x: 0, z: 0, heading: 0 };

  it("벽에 붙어 서 있어도 접촉 입력은 잠깐만 들어간다 (무한 그루밍 방지)", () => {
    const h = new Habitat();
    expect(h.sense(atWall, 0, 0.5, false).jo_touch).toBeGreaterThan(0);
    expect(h.sense(atWall, 0.3, 0.5, false).jo_touch).toBeGreaterThan(0);
    for (let t = 1; t < 30; t++) expect(h.sense(atWall, t, 0.5, false).jo_touch).toBe(0);
  });

  it("벽에서 떨어졌다가 다시 닿으면 또 느낀다", () => {
    const h = new Habitat();
    h.sense(atWall, 0, 0.5, false);
    expect(h.sense(atWall, 5, 0.5, false).jo_touch).toBe(0);
    h.sense(center, 6, 0.5, false);
    expect(h.sense(atWall, 7, 0.5, false).jo_touch).toBeGreaterThan(0);
  });

  it("쓰다듬기는 1.5초 동안만 들어간다", () => {
    const h = new Habitat();
    h.pet(10);
    expect(h.sense(center, 11, 0.5, false).jo_touch).toBe(160);
    expect(h.sense(center, 11.6, 0.5, false).jo_touch).toBe(0);
  });

  it("자는 동안에는 빛·맛·벽 입력이 없다", () => {
    const h = new Habitat();
    h.addFood("sweet", 2.8, 0.3);
    const s = h.sense(atWall, 0, 1, true);
    expect(s.light).toBe(0);
    expect(s.sugar).toBe(0);
    expect(s.jo_touch).toBe(0);
  });
});

describe("Habitat 먹이", () => {
  it("딸기는 EAT_SECONDS 동안 먹으면 사라지고, 먹은 양을 돌려준다", () => {
    const h = new Habitat();
    const food = h.addFood("sweet", 0, 0);
    let eaten = 0;
    for (let t = 0; t < EAT_SECONDS + 0.5; t += 0.1) {
      const f = h.foods.find((x) => x.id === food.id);
      if (f) eaten += h.eat(f, 0.1);
    }
    expect(h.foods).toHaveLength(0);
    expect(eaten).toBeCloseTo(1, 5);
  });
});

describe("간식별 미각 뉴런", () => {
  const at = (x: number) => ({ x, z: 0, heading: 0 });

  it("간식마다 다른 미각 뉴런을 자극한다", () => {
    for (const [kind, snack] of Object.entries(SNACKS) as [FoodKind, (typeof SNACKS)[FoodKind]][]) {
      const h = new Habitat();
      h.addFood(kind, 0, 0);
      const rates = h.sense(at(0), 0, 1, false);
      expect(rates[snack.group], kind).toBeCloseTo(snack.rate, 5);
    }
  });

  it("두 간식이 같이 놓여도 가장 가까운 하나만 맛본다 (동시 자극은 전뇌 폭주를 일으킨다)", () => {
    const h = new Habitat();
    h.addFood("salty", 0, 0);
    h.addFood("bitter", 0.3, 0);
    const rates = h.sense(at(0), 0, 1, false);
    expect(rates.ir94e).toBeGreaterThan(0);
    expect(rates.bitter).toBe(0);
    const closerToBitter = h.sense(at(0.3), 0, 1, false);
    expect(closerToBitter.bitter).toBeGreaterThan(0);
    expect(closerToBitter.ir94e).toBe(0);
  });

  it("배고픔에 따라 달라지는 맛은 당 계열뿐이다", () => {
    const h = new Habitat();
    h.addFood("water", 0, 0);
    expect(h.sense(at(0), 0, 0, false).water).toBeCloseTo(SNACKS.water.rate, 5);
    const h2 = new Habitat();
    h2.addFood("sweet", 0, 0);
    expect(h2.sense(at(0), 0, 0, false).sugar).toBeCloseTo(SNACKS.sweet.rate * 0.25, 5);
  });
});

describe("설렘 → pC1", () => {
  it("설렘에 비례해 pC1 을 자극하고, 자는 동안은 0", () => {
    const h = new Habitat();
    const pose = { x: 0, z: 0, heading: 0 };
    expect(h.sense(pose, 0, 0.5, false, 0).pc1).toBe(0);
    expect(h.sense(pose, 0, 0.5, false, 0.5).pc1).toBeCloseTo(PC1_MAX_HZ / 2, 5);
    expect(h.sense(pose, 0, 0.5, false, 3).pc1).toBe(PC1_MAX_HZ); // 상한
    expect(h.sense(pose, 0, 0.5, true, 1).pc1).toBe(0);
  });
});
