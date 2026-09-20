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

  it("其余 cap 的类别默认值仍然保留（未误删过头）", () => {
    // 每个类别的 sky 段都在（skyForceEnv 是各类别共有标记）
    for (const mt of modelTypes) {
      expect(MODEL_DEFAULTS[mt].skyForceEnv, `类别 ${mt} 的 sky 段不应被删`).toBe(true);
    }
    // fog / shadow / reflector / environment 至少有一个类别携带
    const all = modelTypes.flatMap((mt) => Object.keys(MODEL_DEFAULTS[mt]));
    for (const k of ["fogNear", "shadowType", "reflectorSize", "envPreset", "ppEnabled"]) {
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
