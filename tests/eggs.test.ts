import { describe, expect, it } from "vitest";
import { KonamiDetector, is404, isScientificName, specialDay } from "../src/story/EasterEggs.ts";

describe("이스터에그", () => {
  it("코나미 커맨드는 끝까지 맞아야 한다", () => {
    const k = new KonamiDetector();
    const seq = ["ArrowUp", "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "B"];
    expect(seq.map((key) => k.push(key))).toEqual(Array(10).fill(false));
    expect(k.push("a")).toBe(true);
    expect(k.push("a")).toBe(false);
  });

  it("학명 이름", () => {
    expect(isScientificName("초파리")).toBe(true);
    expect(isScientificName(" Drosophila melanogaster ")).toBe(true);
    expect(isScientificName("온나")).toBe(false);
  });

  it("4시 4분", () => {
    expect(is404(new Date(2026, 0, 1, 4, 4))).toBe(true);
    expect(is404(new Date(2026, 0, 1, 16, 4))).toBe(false);
  });

  it("특별한 날", () => {
    expect(specialDay(new Date(2026, 11, 25), 3)?.id).toBe("xmas-2026");
    expect(specialDay(new Date(2026, 2, 14), 3)?.reward).toBe(31);
    expect(specialDay(new Date(2026, 5, 1), 100)?.id).toBe("together-100");
    expect(specialDay(new Date(2026, 5, 1), 99)).toBeNull();
  });
});
