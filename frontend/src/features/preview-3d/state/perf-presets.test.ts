// ===== perf-presets 测试（[doc:adr-126-p4] 性能档位薄壳版）=====
// 覆盖：档位表结构（三档 + 值类型）、get/set 持久化、apply 行为、custom 不套用、
// cap 缺席时派生路径静默跳过（套用无副作用）。
import { describe, it, expect, beforeEach } from "vitest";
import {
  PERF_PRESET_KEY,
  PERF_PRESET_DEFAULT,
  PERF_PRESETS,
  getPerfPreset,
  setPerfPreset,
  applyPerfPreset,
} from "./perf-presets.ts";
import { getMaxFps, invalidateMaxFpsCache, MAX_FPS_KEY } from "../render-budget.ts";

beforeEach(() => {
  localStorage.clear();
  invalidateMaxFpsCache();
});

describe("PERF_PRESETS 档位表结构", () => {
  it("三档齐全（low/medium/high），每档含 maxFps/maxPixelRatio 且值合法", () => {
    for (const level of ["low", "medium", "high"] as const) {
      const t = PERF_PRESETS[level];
      expect(t["render.maxFps"]).toBeTypeOf("number");
      expect((t["render.maxFps"] as number) >= 0).toBe(true);
      expect(t["render.maxPixelRatio"]).toBeTypeOf("number");
    }
  });

  it("bloom 为 boolean（cap 派生开关，走 cap 缺席静默跳过）", () => {
    expect(PERF_PRESETS.low["render.bloom"]).toBeTypeOf("boolean");
    expect(PERF_PRESETS.high["render.bloom"]).toBe(true);
  });

  it("档位表键全部落在 KNOWN_PATHS（编译期已守，运行期再断言无越界键）", () => {
    for (const level of ["low", "medium", "high"] as const) {
      for (const path of Object.keys(PERF_PRESETS[level])) {
        expect(path.startsWith("render.") || path.startsWith("env.")).toBe(true);
      }
    }
  });
});

describe("getPerfPreset / setPerfPreset", () => {
  it("无存档回默认 medium；未知存档值回默认", () => {
    expect(getPerfPreset()).toBe(PERF_PRESET_DEFAULT);
    localStorage.setItem(PERF_PRESET_KEY, "ultra");
    expect(getPerfPreset()).toBe(PERF_PRESET_DEFAULT);
  });

  it("setPerfPreset：持久化 + 套用（maxFps 落盘且 rAF 缓存失效）", () => {
    setPerfPreset("low");
    expect(localStorage.getItem(PERF_PRESET_KEY)).toBe("low");
    expect(localStorage.getItem(MAX_FPS_KEY)).toBe("30");
    expect(getMaxFps()).toBe(30);
  });

  it("合法档位值透传（high → 120）", () => {
    setPerfPreset("high");
    expect(getPerfPreset()).toBe("high");
    expect(getMaxFps()).toBe(120);
  });
});

describe("applyPerfPreset", () => {
  it("custom 不套用（保持用户手调，零副作用）", () => {
    applyPerfPreset("custom");
    expect(localStorage.getItem(MAX_FPS_KEY)).toBeNull();
    expect(getMaxFps()).toBe(60); // 无存档默认
  });

  it("cap 缺席时 render.bloom 派生路径静默跳过（不抛）", () => {
    // 测试环境无 postprocessing cap 实例——setStateValue 对不可用路径静默丢弃
    expect(() => applyPerfPreset("low")).not.toThrow();
  });
});
