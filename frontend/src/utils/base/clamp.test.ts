// @vitest-environment node
// ===== 数值钳制工具测试（clamp.ts）=====
import { describe, it, expect } from "vitest";
import { clamp, clamp01, clampPct } from "./clamp.ts";

describe("clamp — 数值钳制", () => {
  it("值在范围内原样返回", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("值小于下界返回下界", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("值大于上界返回上界", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("值等于下界", () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it("值等于上界", () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it("上下界相等时返回该值", () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });
});

describe("clamp01 — [0,1] 钳制", () => {
  it("0.5 返回 0.5", () => {
    expect(clamp01(0.5)).toBe(0.5);
  });

  it("负值返回 0", () => {
    expect(clamp01(-0.1)).toBe(0);
  });

  it("超过 1 返回 1", () => {
    expect(clamp01(1.1)).toBe(1);
  });

  it("0 返回 0", () => {
    expect(clamp01(0)).toBe(0);
  });

  it("1 返回 1", () => {
    expect(clamp01(1)).toBe(1);
  });
});

describe("clampPct — 百分比钳制 [0,100]", () => {
  it("正常百分比不变", () => {
    expect(clampPct(50)).toBe(50);
  });

  it("负值返回 0", () => {
    expect(clampPct(-10)).toBe(0);
  });

  it("超过 100 返回 100", () => {
    expect(clampPct(150)).toBe(100);
  });

  it("0 返回 0", () => {
    expect(clampPct(0)).toBe(0);
  });

  it("100 返回 100", () => {
    expect(clampPct(100)).toBe(100);
  });
});
