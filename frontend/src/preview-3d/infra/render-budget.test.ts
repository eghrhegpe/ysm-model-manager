import { describe, expect, it, beforeEach } from "vitest";
import { GPU_BUDGET_CALIBRATION_KEY } from "./gpu-load-calibrate.ts";
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

// ===== P2：GPU 饱和反压像素比（2026 锐评「自适应像素比不盯 GPU 负载」）=====
// 语义边界：降像素比只减填充率压力，不减 draw calls / 三角面本身——
// 这是**预防性**降质（GPU 已高位时提前减负），不是对已发生卡顿的根治。
describe("sampleAdaptivePixelRatio GPU 饱和反压", () => {
  const HEALTHY_FRAME_MS = 16.7; // 健康帧时（远低于 SLOW_FRAME_MS=22）

  beforeEach(() => {
    // 软线现经 resolveGpuLoadLimits 读 localStorage，清 key 保阈值断言确定性
    localStorage.removeItem(GPU_BUDGET_CALIBRATION_KEY);
  });

  /** 驱动 N 帧（每 30 帧一次采样窗口），返回本轮所有降级结果 */
  const drive = (
    budget: ReturnType<typeof createAdaptiveRenderBudget>,
    frames: number,
    gpu?: { drawCalls: number; triangles: number },
  ): (number | null)[] => {
    const results: (number | null)[] = [];
    let now = 0;
    for (let i = 0; i < frames; i++) {
      now += HEALTHY_FRAME_MS;
      const r = sampleAdaptivePixelRatio(budget, now, 0, gpu);
      if (r !== null) results.push(r);
    }
    return results;
  };

  it("CPU 帧时健康 + draw calls 超软线 → 仍降一档（原实现漏掉的场景）", () => {
    const budget = createAdaptiveRenderBudget(1.5, 0);
    expect(drive(budget, 30, { drawCalls: 900, triangles: 1000 })).toEqual([1.25]);
  });

  it("CPU 帧时健康 + 三角面超软线 → 仍降一档", () => {
    const budget = createAdaptiveRenderBudget(1.5, 0);
    expect(drive(budget, 30, { drawCalls: 10, triangles: 600_000 })).toEqual([1.25]);
  });

  it("CPU 帧时健康 + GPU 低位 → 不降", () => {
    const budget = createAdaptiveRenderBudget(1.5, 0);
    expect(drive(budget, 30, { drawCalls: 100, triangles: 10_000 })).toEqual([]);
    expect(budget.pixelRatio).toBe(1.5);
  });

  it("不传 gpu → 退回纯 CPU 帧时判定（既有调用方语义不变）", () => {
    const budget = createAdaptiveRenderBudget(1.5, 0);
    expect(drive(budget, 30)).toEqual([]);
    expect(budget.pixelRatio).toBe(1.5);
  });

  it("软线 = 硬顶 50%：恰好等于软线不降（严格 >），超过才降", () => {
    // drawCalls 硬顶 1600 → 软线 800
    const atLine = createAdaptiveRenderBudget(1.5, 0);
    expect(drive(atLine, 30, { drawCalls: 800, triangles: 0 })).toEqual([]);
    const overLine = createAdaptiveRenderBudget(1.5, 0);
    expect(drive(overLine, 30, { drawCalls: 801, triangles: 0 })).toEqual([1.25]);
  });

  it("GPU 高位持续 → 逐档下探至 0.75 地板后停（不再降）", () => {
    const budget = createAdaptiveRenderBudget(1.5, 0);
    expect(drive(budget, 300, { drawCalls: 900, triangles: 0 })).toEqual([1.25, 1, 0.75]);
    expect(budget.pixelRatio).toBe(0.75);
  });

  it("FPS cap 下 GPU 高位仍降级（cap 只豁免 CPU 帧时误判，不豁免 GPU 饱和）", () => {
    const budget = createAdaptiveRenderBudget(1.5, 0);
    let changed: number | null = null;
    for (let frame = 1; frame <= 30; frame++) {
      changed = sampleAdaptivePixelRatio(budget, frame * 33, 33, { drawCalls: 900, triangles: 0 });
    }
    expect(changed).toBe(1.25);
  });

  it("软线跟随真机标定：硬顶放宽后同一负载不再判饱和（消除软/硬线双源）", () => {
    // 默认硬顶 1600 → 软线 800：900 判饱和
    const before = createAdaptiveRenderBudget(1.5, 0);
    expect(drive(before, 30, { drawCalls: 900, triangles: 0 })).toEqual([1.25]);
    // 标定放宽硬顶到 5000 → 软线 2500：900 不再饱和（若软线写死默认常量，此处会误降级）
    localStorage.setItem(GPU_BUDGET_CALIBRATION_KEY, JSON.stringify({ drawCalls: 5000 }));
    const after = createAdaptiveRenderBudget(1.5, 0);
    expect(drive(after, 30, { drawCalls: 900, triangles: 0 })).toEqual([]);
    expect(after.pixelRatio).toBe(1.5);
  });
});
