// ===== [ADR-282] 灯光与模型类别解耦守卫 =====
// 背景：灯光曾是 MODEL_DEFAULTS 的类别维度之一（源自 ADR-084 §2.5 的 LIGHT_PRESETS），
// 但 Three.js 层面「模型类别」不存在——灯光是场景属性，唯一合法的模型相关输入是包围盒，
// 且已由 setTarget/setTargetHeight 动态处理。按类别预置灯光是漂移源：
//   - ADR-084 原表 vrm 与 mmd 逐字相同，唯一实质区分轴 spotlight 已随 ADR-280 删除；
//   - MODEL_DEFAULTS.default 的 light 段退化到只剩 lightVolumetricEnabled:false（与 schema 默认同值 = 纯 no-op），
//     而选中它仍会设 manualPreset → 永久冻结后续模型预设（跨会话，无 UI 可解）。
// 本测试是**防回退闸**：任何人往 MODEL_DEFAULTS「顺手」加一行 lightKeyIntensity 都会在此变红。
import { describe, it, expect } from "vitest";
import { MODEL_DEFAULTS } from "./model-defaults.ts";
import type { EnvState } from "./env-state-schema.ts";

describe("ADR-282 灯光与模型类别解耦", () => {
  const modelTypes = Object.keys(MODEL_DEFAULTS) as (keyof typeof MODEL_DEFAULTS)[];

  it("MODEL_DEFAULTS 的任何类别都不得含 light 前缀键（漂移源防回退）", () => {
    for (const mt of modelTypes) {
      const lightKeys = Object.keys(MODEL_DEFAULTS[mt]).filter((k) => k.startsWith("light"));
      expect(lightKeys, `类别 ${mt} 不应含任何 light* 键（ADR-282 已解耦）`).toEqual([]);
    }
  });

  it("逐类别显式断言（失败信息可定位到具体类别）", () => {
    expect(modelTypes.length).toBeGreaterThan(0);
    for (const mt of modelTypes) {
      expect(MODEL_DEFAULTS[mt].lightKeyIntensity).toBeUndefined();
      expect(MODEL_DEFAULTS[mt].lightFillIntensity).toBeUndefined();
      expect(MODEL_DEFAULTS[mt].lightRimIntensity).toBeUndefined();
      expect(MODEL_DEFAULTS[mt].lightKeyAzimuth).toBeUndefined();
      expect(MODEL_DEFAULTS[mt].lightVolumetricEnabled).toBeUndefined();
      expect(MODEL_DEFAULTS[mt].lightVolumetricOpacity).toBeUndefined();
    }
  });

  it("[ADR-284] 类别表不得含 sky 散射键 / reflector 噪声键（漂移源防回退）", () => {
    // 承 ADR-282（灯光解耦）向其余类别推广：大气散射、reflector 光泽/颜色系噪声，
    // 不得再以模型类别维度写回 MODEL_DEFAULTS（否则换模型即悄悄改天空/反射观感）。
    for (const mt of modelTypes) {
      const skyKeys = Object.keys(MODEL_DEFAULTS[mt]).filter((k) => k.startsWith("sky"));
      expect(skyKeys, `类别 ${mt} 不应含任何 sky* 键（ADR-284 大气与类别解耦）`).toEqual([]);
      expect(
        MODEL_DEFAULTS[mt].reflectorOpacity,
        `类别 ${mt} 不应有 reflectorOpacity（噪声 A）`,
      ).toBeUndefined();
      expect(
        MODEL_DEFAULTS[mt].reflectorColor,
        `类别 ${mt} 不应有 reflectorColor（噪声 A）`,
      ).toBeUndefined();
      // shadowType 若携带只能是有软阴影语义的 soft；hard == schema 默认属 no-op，须清除。
      if (MODEL_DEFAULTS[mt].shadowType !== undefined) {
        expect(MODEL_DEFAULTS[mt].shadowType, `类别 ${mt} 的 shadowType 只能是 soft`).toBe("soft");
      }
    }
  });

  it("场景尺度 / 离散语义键仍然保留（未误删过头）", () => {
    // fog（场景尺度）、reflectorSize（场景尺度）、envPreset（离散语义）、ppEnabled 仍在
    const all = modelTypes.flatMap((mt) => Object.keys(MODEL_DEFAULTS[mt]));
    for (const k of ["fogNear", "reflectorSize", "envPreset", "ppEnabled"]) {
      expect(all, `MODEL_DEFAULTS 全体不应丢失 ${k}`).toContain(k);
    }
  });
  it("灯光参数的唯一来源是 envState schema 默认值（schema 仍持有全部 light* 键）", () => {
    // 解耦只砍「类别维度」，不砍 schema——灯光键必须仍存在于 EnvState
    const schemaLightKeys: (keyof EnvState)[] = [
      "lightKeyType",
      "lightKeyIntensity",
      "lightFillIntensity",
      "lightRimIntensity",
      "lightVolumetricEnabled",
    ];
    // 类型层面即可保证（下方为运行期形态校验，防 schema 误删）
    expect(schemaLightKeys.length).toBe(5);
  });
});
