import { describe, it, expect } from "vitest";
import { stagger } from "./stagger.js";

describe("stagger", () => {
  it("index 0 returns 0", () => expect(stagger(0)).toBe(0));
  it("index 1 with default step=30 returns 30", () => expect(stagger(1)).toBe(30));
  it("index 20 capped at 300", () => expect(stagger(20)).toBe(300));
  it("custom step", () => expect(stagger(3, 50)).toBe(150));
  it("custom max", () => expect(stagger(100, 10, 500)).toBe(500));
  it("negative index stays negative", () => expect(stagger(-1)).toBe(-30));
});
