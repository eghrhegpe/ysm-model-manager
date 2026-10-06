// @vitest-environment node
// ===== water-state 纯常数层测试 =====
// WATER_MODES / 波场守卫常数（WAVE_*）/ 水膜 alpha 基准。
// 守卫两件事：① 各常数域自洽（min < full、下界极小等）；
//            ② 与 ENV_STATE_SCHEMA 单一事实源对齐（WAVE_STEEP_SIZE_REF = waterSize.default）。
import { describe, it, expect } from "vitest";
import {
  WATER_MODES,
  WATER_WAVE_SEGMENTS,
  WAVE_DEGENERATE_WA,
  WAVE_STEEP_SUM_LIMIT,
  WAVE_STEEP_SIZE_REF,
  WAVE_AA_MIN_VERTS,
  WAVE_AA_FULL_VERTS,
  FILM_WETNESS_ALPHA_BASE,
  type WaterMode,
} from "./water-state.ts";
import { ENV_STATE_SCHEMA } from "@/preview-3d/state/env-state-schema.ts";

describe("WATER_MODES — 水面模式白名单", () => {
  it("恰为 film/pool 两档，且互不重复", () => {
    expect([...WATER_MODES]).toEqual(["film", "pool"]);
    expect(new Set<WaterMode>(WATER_MODES).size).toBe(WATER_MODES.length);
  });

  it("WATER_WAVE_SEGMENTS 为充分大的正整数（波场采样密度）", () => {
    expect(Number.isInteger(WATER_WAVE_SEGMENTS)).toBe(true);
    expect(WATER_WAVE_SEGMENTS).toBeGreaterThanOrEqual(8);
  });
});

describe("波场守卫常数 — 域自洽", () => {
  it("aa 阈值满足 0 < MIN < FULL（阈值区间非退化）", () => {
    expect(WAVE_AA_MIN_VERTS).toBeGreaterThan(0);
    expect(WAVE_AA_FULL_VERTS).toBeGreaterThan(WAVE_AA_MIN_VERTS);
  });

  it("WAVE_DEGENERATE_WA 是极小正下界（静水态跳过整波）", () => {
    expect(WAVE_DEGENERATE_WA).toBeGreaterThan(0);
    expect(WAVE_DEGENERATE_WA).toBeLessThan(WAVE_AA_FULL_VERTS);
    expect(WAVE_DEGENERATE_WA).toBeLessThan(1e-3);
  });

  it("WAVE_STEEP_SUM_LIMIT 是 (0,1] 内的纵深防御上界", () => {
    expect(WAVE_STEEP_SUM_LIMIT).toBeGreaterThan(0);
    expect(WAVE_STEEP_SUM_LIMIT).toBeLessThanOrEqual(1);
  });

  it("FILM_WETNESS_ALPHA_BASE 是 (0,1] 内的 alpha 基准", () => {
    expect(FILM_WETNESS_ALPHA_BASE).toBeGreaterThan(0);
    expect(FILM_WETNESS_ALPHA_BASE).toBeLessThanOrEqual(1);
  });
});

describe("与 ENV_STATE_SCHEMA 的单一事实源对齐", () => {
  it("WAVE_STEEP_SIZE_REF 与 waterSize 默认值同值（反归一基准口径）", () => {
    const waterSizeDefault = (
      ENV_STATE_SCHEMA.waterSize as { default: number }
    ).default;
    expect(waterSizeDefault).toBeDefined();
    expect(WAVE_STEEP_SIZE_REF).toBe(waterSizeDefault);
  });
});

describe("波幅抗锯齿惰性判据（D2 频谱锚定）", () => {
  it("六波最小 λ/spacing 不低于 FULL 阈值 ⇒ aa 恒 1（惰性保险）", () => {
    // λ/spacing = WATER_WAVE_SEGMENTS / (4 · 1.19^i)，i=5 时最小
    const minLambdaPerWavelength = WATER_WAVE_SEGMENTS / (4 * 1.19 ** 5);
    expect(minLambdaPerWavelength).toBeGreaterThanOrEqual(WAVE_AA_FULL_VERTS);
  });
});