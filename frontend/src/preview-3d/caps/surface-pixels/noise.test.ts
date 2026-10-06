// @vitest-environment node
// ===== surface-pixels/noise — 纯噪声原语测试（零 three / 零 DOM）=====
// 锁：输出域 [0,1]、确定性（无 Math.random）、4D 环面嵌入的平铺无缝（u=0 与 u=1 严格同值）。
import { describe, it, expect } from "vitest";
import { smoothStep, valueNoise4D, tiledFbm, valueNoise2, fbm2 } from "./noise.ts";

describe("smoothStep", () => {
  it("端点与中点恒等", () => {
    expect(smoothStep(0)).toBe(0);
    expect(smoothStep(1)).toBe(1);
    expect(smoothStep(0.5)).toBe(0.5);
  });
});

describe("valueNoise4D", () => {
  it("输出恒在 [0,1]，且同参可复现（无随机）", () => {
    const pts: [number, number, number, number][] = [
      [0.3, 0.7, 0.1, 0.9],
      [1.5, -2.3, 4.1, 0.0],
      [100.7, 33.3, -0.5, 12.25],
      [0, 0, 0, 0],
    ];
    for (const p of pts) {
      const a = valueNoise4D(...p);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      expect(valueNoise4D(...p)).toBe(a);
    }
  });
});

describe("tiledFbm — 4D 环面无缝", () => {
  it("u=0 与 u=1 严格同值（环面点重合，无接缝）", () => {
    for (const v of [0.0, 0.25, 0.5, 0.75]) {
      expect(Math.abs(tiledFbm(0, v, 4, 4, 0.7) - tiledFbm(1, v, 4, 4, 0.7))).toBeLessThan(
        1e-12,
      );
    }
  });

  it("任意相位角仍严格无缝，且输出在 [0,1]", () => {
    for (const angle of [0, 0.3, 1.2, Math.PI]) {
      const a = tiledFbm(0.1, 0.6, 3, 5, angle);
      const b = tiledFbm(1.1, 0.6, 3, 5, angle);
      expect(Math.abs(a - b)).toBeLessThan(1e-12);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
});

describe("非周期噪声 valueNoise2 / fbm2", () => {
  it("valueNoise2 输出在 [0,1]、确定性、不同 seed 结果不同", () => {
    const a = valueNoise2(1.3, 2.7, 0);
    const b = valueNoise2(1.3, 2.7, 0);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
    expect(valueNoise2(1.3, 2.7, 99)).not.toBe(a);
  });

  it("fbm2 输出在 [0,1] 且同参可复现", () => {
    const a = fbm2(3.1, 4.2, 5, 7);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
    expect(fbm2(3.1, 4.2, 5, 7)).toBe(a);
  });
});