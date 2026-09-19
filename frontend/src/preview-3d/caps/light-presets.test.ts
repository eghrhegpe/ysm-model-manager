// ===== flattenLightParams 映射契约测试 =====
// 锁死「嵌套 LightParams 子字段 → 扁平 EnvState 键」的 30 条映射关系（唯一值断言可抓
// 目标键串位）+ undefined 不写出守卫（仅拷传入子集，缺字段不出现在输出）。
// 表驱动重构（FLATTEN_MAP）的行为基线，实现换法不变契约。
import { describe, it, expect } from "vitest";
import { flattenLightParams, type LightParams } from "./light-presets.ts";

describe("flattenLightParams 映射契约", () => {
  it("全量输入：30 条源字段各归其扁平 EnvState 键", () => {
    const full: LightParams = {
      key: { enabled: true, color: 0x111111, intensity: 1.1, azimuth: 11, elevation: 12 },
      fill: { enabled: false, color: 0x222222, intensity: 2.1, azimuth: 21, elevation: 22 },
      rim: { enabled: true, color: 0x333333, intensity: 3.1, azimuth: 31, elevation: 32 },
      ambient: { color: 0x444444, intensity: 4.1 },
      spotlight: {
        enabled: true,
        color: 0x555555,
        intensity: 5.1,
        angle: 51,
        penumbra: 0.52,
        distance: 53,
        decay: 5.4,
      },
      volumetric: {
        enabled: true,
        opacity: 6.1,
        fogPower: 6.2,
        edgeFade: 6.3,
        baseStrength: 6.4,
        tipStrength: 6.5,
      },
    };
    const out = flattenLightParams(full) as Record<string, unknown>;
    // key 组
    expect(out.lightKeyEnabled).toBe(true);
    expect(out.lightKeyColor).toBe(0x111111);
    expect(out.lightKeyIntensity).toBe(1.1);
    expect(out.lightKeyAzimuth).toBe(11);
    expect(out.lightKeyElevation).toBe(12);
    // fill 组
    expect(out.lightFillEnabled).toBe(false);
    expect(out.lightFillColor).toBe(0x222222);
    expect(out.lightFillIntensity).toBe(2.1);
    expect(out.lightFillAzimuth).toBe(21);
    expect(out.lightFillElevation).toBe(22);
    // rim 组
    expect(out.lightRimEnabled).toBe(true);
    expect(out.lightRimColor).toBe(0x333333);
    expect(out.lightRimIntensity).toBe(3.1);
    expect(out.lightRimAzimuth).toBe(31);
    expect(out.lightRimElevation).toBe(32);
    // ambient 组（无 enabled/azimuth/elevation）
    expect(out.lightAmbientColor).toBe(0x444444);
    expect(out.lightAmbientIntensity).toBe(4.1);
    // spotlight 组
    expect(out.lightSpotEnabled).toBe(true);
    expect(out.lightSpotColor).toBe(0x555555);
    expect(out.lightSpotIntensity).toBe(5.1);
    expect(out.lightSpotAngle).toBe(51);
    expect(out.lightSpotPenumbra).toBe(0.52);
    expect(out.lightSpotDistance).toBe(53);
    expect(out.lightSpotDecay).toBe(5.4);
    // volumetric 组
    expect(out.lightVolumetricEnabled).toBe(true);
    expect(out.lightVolumetricOpacity).toBe(6.1);
    expect(out.lightVolumetricFogPower).toBe(6.2);
    expect(out.lightVolumetricEdgeFade).toBe(6.3);
    expect(out.lightVolumetricBaseStrength).toBe(6.4);
    expect(out.lightVolumetricTipStrength).toBe(6.5);
    // 恰好 30 键，无多余
    expect(Object.keys(out).length).toBe(30);
  });

  it("部分输入：仅传子集，缺字段不写出（undefined 守卫）", () => {
    const out = flattenLightParams({
      key: { intensity: 0.7 },
      spotlight: { distance: 40 },
    }) as Record<string, unknown>;
    expect(out.lightKeyIntensity).toBe(0.7);
    expect(out.lightSpotDistance).toBe(40);
    // 未传的兄弟字段不得出现（enabled/color/azimuth/elevation 皆 undefined → 跳过）
    expect("lightKeyEnabled" in out).toBe(false);
    expect("lightKeyColor" in out).toBe(false);
    expect("lightSpotColor" in out).toBe(false);
    // 未传的整组不得出现
    expect("lightFillIntensity" in out).toBe(false);
    expect("lightAmbientColor" in out).toBe(false);
    expect(Object.keys(out).length).toBe(2);
  });

  it("空输入：返回空对象", () => {
    expect(flattenLightParams({})).toEqual({});
  });

  it("false / 0 等假值必须写出（守卫是 !== undefined 而非 truthy）", () => {
    const out = flattenLightParams({
      key: { enabled: false, intensity: 0 },
    }) as Record<string, unknown>;
    expect(out.lightKeyEnabled).toBe(false);
    expect(out.lightKeyIntensity).toBe(0);
    expect("lightKeyEnabled" in out).toBe(true);
    expect("lightKeyIntensity" in out).toBe(true);
  });
});
