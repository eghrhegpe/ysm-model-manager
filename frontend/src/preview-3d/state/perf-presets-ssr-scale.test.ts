// ===== SSR 反射缓冲缩放（档位派生）：上游 resolutionScale 在本仓的启用（2026-10-12）=====
//
// 背景：`SSRPass` 上游本就提供 `resolutionScale`（`SSRPass.js:140` 默认 1 = 全分辨率），
// 本仓此前**从未设置** → 恒按全分辨率跑。它只缩 SSR **自己的**三张缓冲
// （ssrRenderTarget / prevRenderTarget / blurRenderTarget×2），beauty/normal/metalness
// 保持全分辨率——**主渲染不受影响**。
//
// 为何精准：`SSRPass.setSize` 内 `MAX_STEP = √(w² + h²)`（步进数 ∝ 屏幕对角线），
// 故分辨率是 SSR 成本主因子；缩放同时砍步进数与三张缓冲显存。
//
// 归口决策：SSR 是近似反射，缩放属「可接受的精度取舍」而非功能开关 → 与
// maxFps/maxPixelRatio 同归**性能档位表**，不另立用户旋钮（避免七处接线）。
// custom（用户手调）取 1.0：不擅自替用户降质。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSsrScaleCacheForTest,
  getSsrResolutionScale,
  PERF_PRESET_KEY,
  setPerfPreset,
} from "./perf-presets.ts";

beforeEach(() => {
  localStorage.clear();
  __resetSsrScaleCacheForTest();
});
afterEach(() => {
  localStorage.clear();
  __resetSsrScaleCacheForTest();
});

describe("getSsrResolutionScale — 档位派生", () => {
  it("默认档（medium）→ 0.75（保守降幅，非极端）", () => {
    expect(getSsrResolutionScale()).toBe(0.75);
  });

  it("low → 0.5（最大降幅）", () => {
    localStorage.setItem(PERF_PRESET_KEY, "low");
    __resetSsrScaleCacheForTest();
    expect(getSsrResolutionScale()).toBe(0.5);
  });

  it("high → 1（全分辨率，不降质）", () => {
    localStorage.setItem(PERF_PRESET_KEY, "high");
    __resetSsrScaleCacheForTest();
    expect(getSsrResolutionScale()).toBe(1);
  });

  it("custom（用户手调）→ 1：不擅自替用户降质", () => {
    localStorage.setItem(PERF_PRESET_KEY, "custom");
    __resetSsrScaleCacheForTest();
    expect(getSsrResolutionScale(), "custom 档位不得被静默降质").toBe(1);
  });

  it("缩放值恒落在 (0, 1]——0 会让 effectiveWidth 归零、SSR 缓冲尺寸非法", () => {
    for (const level of ["low", "medium", "high", "custom"] as const) {
      localStorage.setItem(PERF_PRESET_KEY, level);
      __resetSsrScaleCacheForTest();
      const v = getSsrResolutionScale();
      expect(v, `${level} 档位值须 > 0（0 会让 SSR 缓冲尺寸归零）`).toBeGreaterThan(0);
      expect(v, `${level} 档位值须 ≤ 1（>1 是超采样，非本项意图）`).toBeLessThanOrEqual(1);
    }
  });
});

describe("getSsrResolutionScale — 模块级缓存纪律", () => {
  it("同档位重复调用返回同一值且命中缓存（不重复读 localStorage）", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem");
    getSsrResolutionScale(); // 第一次：读盘 + 落缓存
    const afterFirst = spy.mock.calls.length;
    getSsrResolutionScale(); // 第二次：应命中缓存
    getSsrResolutionScale();
    expect(spy.mock.calls.length, "二次起不得再读 localStorage（rAF 侧消费纪律）").toBe(afterFirst);
    spy.mockRestore();
  });

  it("setPerfPreset 切档 → 缓存失效，新值立即生效", () => {
    expect(getSsrResolutionScale()).toBe(0.75); // 默认 medium，落缓存
    setPerfPreset("low");
    expect(getSsrResolutionScale(), "切档后缓存须失效并读到新档位值").toBe(0.5);
    setPerfPreset("high");
    expect(getSsrResolutionScale()).toBe(1);
  });
});
