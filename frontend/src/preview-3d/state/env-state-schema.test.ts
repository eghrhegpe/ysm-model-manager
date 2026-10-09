// ===== env-state-schema 单元测试 =====
// 锁定 deriveDefaultEnvState（全键 + tuple3 深拷贝独立）与 getPresetKeys（分组键派发）。
import { describe, expect, it } from "vitest";
import {
  ENV_STATE_SCHEMA,
  clampFieldValue,
  deriveDefaultEnvState,
  getParamRange,
  getPresetKeys,
} from "./env-state-schema.ts";

describe("env-state-schema", () => {
  it("deriveDefaultEnvState 覆盖 schema 全部键", () => {
    const defs = Object.keys(ENV_STATE_SCHEMA);
    const state = deriveDefaultEnvState();
    for (const k of defs) {
      expect(state, `缺默认键 ${k}`).toHaveProperty(k);
    }
  });

  it("tuple3 默认值返回独立副本（避免跨实例共享可变数组）", () => {
    // 当前 schema 已无 tuple3 使用者（原 ground 三死键 2026-09-21 锐评清理删除），
    // 本用例经临时注入锁定「深拷贝独立」这一通用能力不回归——若未来再有 tuple3
    // 字段，直接换用其键名即可。
    const key = "__tuple3_probe__";
    (ENV_STATE_SCHEMA as Record<string, unknown>)[key] = {
      type: "tuple3",
      default: [1, 2, 3],
      group: "test",
    };
    try {
      const a = deriveDefaultEnvState() as unknown as Record<string, number[]>;
      const b = deriveDefaultEnvState() as unknown as Record<string, number[]>;
      expect(a[key]).toBeDefined();
      expect(a[key]).not.toBe(b[key]); // 不同引用
      expect(a[key]).toEqual(b[key]); // 同值
      a[key][0] = 999;
      expect(b[key][0]).not.toBe(999); // 互不影响
    } finally {
      delete (ENV_STATE_SCHEMA as Record<string, unknown>)[key];
    }
  });

  it("getPresetKeys 返回分组下全部键", () => {
    const sky = getPresetKeys("sky");
    expect(sky.length).toBeGreaterThan(0);
    expect(sky).toContain("skyTimeOfDay");
    expect(sky).toContain("skyAutoRotate");

    const none = getPresetKeys("__no_such_group__");
    expect(none).toEqual([]);
  });
});

describe("值域描述符（ADR-283：range / uiRange）", () => {
  it("凡声明 range 的字段：min ≤ default ≤ max（值域自洽）", () => {
    for (const [key, def] of Object.entries(ENV_STATE_SCHEMA)) {
      const range = (def as { range?: { min: number; max: number } }).range;
      if (!range) continue;
      const dflt = (def as { default: unknown }).default;
      expect(typeof dflt, `${key} 声明了 range 却非 number`).toBe("number");
      expect(range.min, `${key} min ≤ default`).toBeLessThanOrEqual(dflt as number);
      expect(dflt as number, `${key} default ≤ max`).toBeLessThanOrEqual(range.max);
      expect(range.min, `${key} min ≤ max`).toBeLessThanOrEqual(range.max);
    }
  });

  it("water 组全部滑杆字段都声明了 range（描述符完备性守卫）", () => {
    const sliders = [
      "waterLevel",
      "waterWetness",
      "waterOpacity",
      "waterNormalStrength",
      "waterClarity",
      "waterWaveSpeed",
      "waterChoppiness",
      "waterPoolHeight",
      "waterPoolWallThickness",
      "waterPoolRoundness",
      "waterSize",
    ] as const;
    for (const k of sliders) {
      const def = ENV_STATE_SCHEMA[k] as { range?: unknown };
      expect(def.range, `${k} 缺 range`).toBeDefined();
    }
  });

  it("getParamRange：uiRange 优先，否则回退 range", () => {
    expect(getParamRange("waterSize")).toEqual({ min: 10, max: 300, step: 1, unit: "m" });
    expect(getParamRange("waterOpacity")).toEqual({ min: 0, max: 1, step: 0.05 });
  });

  it("clampFieldValue：越界钳制、NaN 落 min、无 range 原样", () => {
    expect(clampFieldValue("waterLevel", 99)).toBe(5);
    expect(clampFieldValue("waterLevel", -3)).toBe(0);
    expect(clampFieldValue("waterSize", Number.NaN)).toBe(1);
    expect(clampFieldValue("waterColor", 0xffffff)).toBe(0xffffff);
  });
});

// ===== 锐评 2026-10-09 补钳制批 =====
// 病史：skyTurbidity/skyMieDirectionalG/skyExposure/envResolution/reflectorClipBias/
// lightVolumetric{Base,Tip}Strength 原无 range，clampFieldValue 原样透传 ⇒ 脏档 NaN/
// 物理超界值直进 three shader/RT/锥体，零报错。shadowMapSize **有意豁免**（离散档位，
// 守卫在 shadow-capability.ts|normalizeShadowMapSize），本块锁「补了不回归 + 豁免不被误补」。
describe("值域补钳制（锐评 2026-10-09）", () => {
  const clampedKeys = [
    "skyTimeOfDay",
    "skyTurbidity",
    "skyRayleigh",
    "skyMieCoefficient",
    "skyMieDirectionalG",
    "skyExposure",
    "envResolution",
    "reflectorClipBias",
    "lightVolumetricBaseStrength",
    "lightVolumetricTipStrength",
  ] as const;

  it("本轮 10 个原无钳制键均已声明 range（防误删）", () => {
    for (const k of clampedKeys) {
      const def = ENV_STATE_SCHEMA[k] as { range?: unknown };
      expect(def.range, `${k} 缺 range（锐评 2026-10-09 已补）`).toBeDefined();
    }
  });

  it("skyMieDirectionalG 钳到 hgPhase 硬边界（|g|>1 出负光强，非纯理论）", () => {
    expect(clampFieldValue("skyMieDirectionalG", 1.5)).toBe(1);
    expect(clampFieldValue("skyMieDirectionalG", -1.5)).toBe(-1);
    expect(clampFieldValue("skyMieDirectionalG", 0.8)).toBe(0.8); // 默认值不被钳
  });

  it("脏档 NaN 落 min、超域钳到边界（零报错洞闭合）", () => {
    expect(clampFieldValue("skyTurbidity", Number.NaN)).toBe(1);
    expect(clampFieldValue("skyExposure", Number.NaN)).toBe(0);
    expect(clampFieldValue("envResolution", 999999)).toBe(4096);
    expect(clampFieldValue("reflectorClipBias", Number.NaN)).toBe(-0.1);
    expect(clampFieldValue("lightVolumetricTipStrength", 99)).toBe(2);
  });

  it("skyTimeOfDay 域 [0,24]：昼夜循环 mod 24 恒在域内，clamp 零漂移", () => {
    expect(clampFieldValue("skyTimeOfDay", 9)).toBe(9); // 默认
    expect(clampFieldValue("skyTimeOfDay", 23.5)).toBe(23.5);
    expect(clampFieldValue("skyTimeOfDay", -5)).toBe(0); // 脏档负值兜底
    expect(clampFieldValue("skyTimeOfDay", 48)).toBe(24); // 超一昼夜兜底
  });

  it("shadowMapSize 豁免锁定：仍无 range（离散档位，白名单守卫在外）", () => {
    expect((ENV_STATE_SCHEMA.shadowMapSize as { range?: unknown }).range).toBeUndefined();
  });

  it("颜色键豁免不受影响：仍无 range（无值域语义，schema 设计声明）", () => {
    expect((ENV_STATE_SCHEMA.waterColor as { range?: unknown }).range).toBeUndefined();
    expect(clampFieldValue("waterColor", 0x123456)).toBe(0x123456);
  });
});
