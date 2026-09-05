// @vitest-environment node
// ===== 数值钳制工具测试（clamp.ts）=====
import { describe, it, expect } from "vitest";
import { clamp, clampInt, clamp01, lerp, lerpArray, clampPct } from "./clamp.ts";

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

describe("clampInt — 整数钳制", () => {
  it("浮点数四舍五入", () => {
    expect(clampInt(5.7, 0, 10)).toBe(6);
  });

  it("浮点数四舍五入（下取整）", () => {
    expect(clampInt(5.3, 0, 10)).toBe(5);
  });

  it("超出范围先钳制再取整", () => {
    expect(clampInt(15.9, 0, 10)).toBe(10);
  });

  it("负数四舍五入", () => {
    expect(clampInt(-3.6, -10, 0)).toBe(-4);
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

describe("lerp — 线性插值", () => {
  it("t=0 返回起点", () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it("t=1 返回终点", () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it("t=0.5 返回中点", () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it("t 超出 [0,1] 可外推", () => {
    expect(lerp(0, 10, 2)).toBe(20);
  });

  it("负值区间插值", () => {
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });
});

describe("lerpArray — 逐元素线性插值数组", () => {
  it("逐元素插值", () => {
    expect(lerpArray([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
  });

  it("t=0 返回起点数组", () => {
    expect(lerpArray([1, 2], [3, 4], 0)).toEqual([1, 2]);
  });

  it("t=1 返回终点数组", () => {
    expect(lerpArray([1, 2], [3, 4], 1)).toEqual([3, 4]);
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
