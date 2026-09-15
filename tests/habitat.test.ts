import { describe, expect, it } from "vitest";
import { EAT_SECONDS, Habitat } from "../src/world/Habitat.ts";

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
