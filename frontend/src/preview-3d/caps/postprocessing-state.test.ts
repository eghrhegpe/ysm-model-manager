// @vitest-environment node
// ===== postprocessing-state 纯数据/纯函数层测试 =====
// 锁四件事：默认值、枚举白名单、持久化字段表与 PP_PARAMS_TO_ENV 与结构体双向互锁、
//           bloomThresholdToLinear 的曝光域换算。
import { describe, it, expect } from "vitest";
import {
  DEFAULT_POSTPROC_PARAMS,
  PP_PARAMS_TO_ENV,
  POSTPROC_PERSIST_FIELDS,
  REFLECTION_MODES,
  TONE_MAPPING_KEYS,
  bloomThresholdToLinear,
  type PostprocessingParams,
} from "./postprocessing-state.ts";

type FieldKind = "number" | "boolean" | { oneOf: readonly string[] };

describe("DEFAULT_POSTPROC_PARAMS — 默认值", () => {
  it("默认关闭整条管线，但 bloom 独立开关为开", () => {
    expect(DEFAULT_POSTPROC_PARAMS.enabled).toBe(false);
    expect(DEFAULT_POSTPROC_PARAMS.bloomEnabled).toBe(true);
    expect(DEFAULT_POSTPROC_PARAMS.ssaoEnabled).toBe(false);
  });

  it("默认 ACES 曝光 1.0 / envmap-only 反射 / SSR 半透明", () => {
    expect(DEFAULT_POSTPROC_PARAMS.toneMapping).toBe("aces");
    expect(DEFAULT_POSTPROC_PARAMS.exposure).toBe(1.0);
    expect(DEFAULT_POSTPROC_PARAMS.reflectionMode).toBe("envmap-only");
    expect(DEFAULT_POSTPROC_PARAMS.ssrOpacity).toBe(0.5);
    expect(DEFAULT_POSTPROC_PARAMS.ssrMaxDistance).toBe(180);
  });
});

describe("枚举白名单", () => {
  it("REFLECTION_MODES 恰含三档且互不重复", () => {
    expect([...REFLECTION_MODES]).toEqual(["envmap-only", "envmap+ssr", "ssr-only"]);
    expect(new Set(REFLECTION_MODES).size).toBe(REFLECTION_MODES.length);
  });

  it("TONE_MAPPING_KEYS 恰含五档", () => {
    expect([...TONE_MAPPING_KEYS]).toEqual(["none", "linear", "reinhard", "aces", "cineon"]);
    expect(new Set(TONE_MAPPING_KEYS).size).toBe(TONE_MAPPING_KEYS.length);
  });
});

describe("持久化字段表与结构体双向互锁", () => {
  const paramsKeys = Object.keys(DEFAULT_POSTPROC_PARAMS)
    .filter((k) => k !== "enabled")
    .sort();

  it("POSTPROC_PERSIST_FIELDS 键集 === params 全键（enabled 除外）", () => {
    expect(Object.keys(POSTPROC_PERSIST_FIELDS).sort()).toEqual(paramsKeys);
  });

  it("PP_PARAMS_TO_ENV 键集 === params 全键，且 env 键统一 pp 前缀", () => {
    expect(Object.keys(PP_PARAMS_TO_ENV).sort()).toEqual(paramsKeys);
    for (const k of paramsKeys) {
      expect(
        (PP_PARAMS_TO_ENV as Record<string, string>)[k],
        `${k} 的 env 键`,
      ).toMatch(/^pp/);
    }
  });

  it("持久化字段 kind 与 params 实际值类型一致", () => {
    for (const k of paramsKeys) {
      const kind: FieldKind = POSTPROC_PERSIST_FIELDS[
        k as Exclude<keyof PostprocessingParams, "enabled">
      ] as unknown as FieldKind;
      const value = (
        DEFAULT_POSTPROC_PARAMS as unknown as Record<string, unknown>
      )[k];
      if (kind === "number") {
        expect(typeof value, `${k} 应为 number`).toBe("number");
      } else if (kind === "boolean") {
        expect(typeof value, `${k} 应为 boolean`).toBe("boolean");
      } else {
        expect(kind.oneOf, `${k} 应声明 oneOf`).toBeDefined();
        expect(kind.oneOf, `${k} 默认值应在 oneOf 内`).toContain(value as string);
      }
    }
  });
});

describe("bloomThresholdToLinear — 曝光域换算", () => {
  it("exposure=1 时阈值不变", () => {
    expect(bloomThresholdToLinear(0.6, 1.0)).toBeCloseTo(0.6, 10);
  });

  it("低曝光放大阈值（linear = user / exposure）", () => {
    expect(bloomThresholdToLinear(0.6, 0.5)).toBeCloseTo(1.2, 10);
    expect(bloomThresholdToLinear(0.3, 2)).toBeCloseTo(0.15, 10);
  });

  it("零/负曝光钳到有限大（除数下限 1e-3，不产生 Infinity）", () => {
    const v = bloomThresholdToLinear(0.6, 0);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeCloseTo(600, 6);
  });

  it("阈值随曝光单调递减（曝光越高越不易起辉）", () => {
    const atLow = bloomThresholdToLinear(0.5, 0.4);
    const atHigh = bloomThresholdToLinear(0.5, 2.0);
    expect(atHigh).toBeLessThan(atLow);
  });
});