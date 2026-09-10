import { describe, expect, it, beforeEach } from "vitest";
import {
  PREVIEW_FRAME_INTERVAL_MS,
  previewPixelRatio,
  createAdaptiveRenderBudget,
  sampleAdaptivePixelRatio,
  shouldRenderPreviewFrame,
  getMaxPixelRatio,
  MAX_PIXEL_RATIO_KEY,
} from "./render-budget.ts";

describe("3D preview render budget", () => {
  // code review P3：previewPixelRatio 现经 getMaxPixelRatio 读 localStorage——
  // 清 key 使断言确定性（不依赖环境存储状态）
  beforeEach(() => {
    localStorage.removeItem(MAX_PIXEL_RATIO_KEY);
  });

  it("caps high-DPI rendering at 1.5x", () => {
    expect(previewPixelRatio(1)).toBe(1);
    expect(previewPixelRatio(1.25)).toBe(1.25);
    expect(previewPixelRatio(2)).toBe(1.5);
    expect(previewPixelRatio(3)).toBe(1.5);
  });

  it("getMaxPixelRatio：缺省 1.5 / 非法值回退 / clamp 到 [0.5, 2]", () => {
    expect(getMaxPixelRatio()).toBe(1.5); // 无 key → 缺省
    localStorage.setItem(MAX_PIXEL_RATIO_KEY, "abc");
    expect(getMaxPixelRatio()).toBe(1.5); // 非法 → 回退
    localStorage.setItem(MAX_PIXEL_RATIO_KEY, "0");
    expect(getMaxPixelRatio()).toBe(1.5); // 0 → 回退
    localStorage.setItem(MAX_PIXEL_RATIO_KEY, "-1");
    expect(getMaxPixelRatio()).toBe(1.5); // 负 → 回退
    localStorage.setItem(MAX_PIXEL_RATIO_KEY, "0.25");
    expect(getMaxPixelRatio()).toBe(0.5); // 低于下限 → clamp 0.5
    localStorage.setItem(MAX_PIXEL_RATIO_KEY, "100");
    expect(getMaxPixelRatio()).toBe(2); // 高于上限 → clamp 2
    localStorage.setItem(MAX_PIXEL_RATIO_KEY, "0.5");
    expect(getMaxPixelRatio()).toBe(0.5); // 下边界
    localStorage.setItem(MAX_PIXEL_RATIO_KEY, "2");
    expect(getMaxPixelRatio()).toBe(2); // 上边界
  });

  it("sampleAdaptivePixelRatio：FPS cap 帧间隔内不降级（code review P2）", () => {
    // 30fps cap → 帧间隔 ~33ms > SLOW_FRAME_MS(22ms)——avgFrameMs 33 <= 阈值 33 不降级
    const budget = createAdaptiveRenderBudget(1.5, 0);
    let changed: number | null = null;
    for (let frame = 1; frame <= 30; frame++) {
      changed = sampleAdaptivePixelRatio(budget, frame * 33, 33);
    }
    expect(changed).toBeNull();
    expect(budget.pixelRatio).toBe(1.5);
    // 无 cap（interval 0）→ 阈值退回 22ms——33ms 帧间隔仍降级（原行为）
    const budget2 = createAdaptiveRenderBudget(1.5, 0);
    let changed2: number | null = null;
    for (let frame = 1; frame <= 30; frame++) {
      changed2 = sampleAdaptivePixelRatio(budget2, frame * 33, 0);
    }
    expect(changed2).toBe(1.25);
  });

  it("caps rendering near 60fps and pauses while hidden", () => {
    expect(shouldRenderPreviewFrame(8, PREVIEW_FRAME_INTERVAL_MS, false)).toBe(false);
    expect(shouldRenderPreviewFrame(17, PREVIEW_FRAME_INTERVAL_MS, false)).toBe(true);
    expect(shouldRenderPreviewFrame(17, PREVIEW_FRAME_INTERVAL_MS, true)).toBe(false);
  });

  it("reduces resolution when frame delivery misses 60fps", () => {
    const budget = createAdaptiveRenderBudget(1.5, 0);
    let changed: number | null = null;
    for (let frame = 1; frame <= 30; frame++) {
      changed = sampleAdaptivePixelRatio(budget, frame * 34);
    }
    expect(changed).toBe(1.25);
  });

  it("keeps resolution stable for healthy frame delivery", () => {
    const budget = createAdaptiveRenderBudget(1.5, 0);
    let changed: number | null = null;
    for (let frame = 1; frame <= 30; frame++) {
      changed = sampleAdaptivePixelRatio(budget, frame * 16.7);
    }
    expect(changed).toBeNull();
    expect(budget.pixelRatio).toBe(1.5);
  });
});
