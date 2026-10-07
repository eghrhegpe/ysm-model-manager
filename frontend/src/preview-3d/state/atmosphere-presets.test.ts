// @vitest-environment node
// ===== atmosphere-presets 纯预设数据测试 =====
// ATMOSPHERE_PRESETS 是「氛围 → EnvState 快照」的单一事实源（ADR-196 刀4）。
// 锁三件事：预设覆盖、语义边界（无关字段不出现，用户偏好不被覆盖）、各氛围的光/雾/曝光倾向。
import { describe, it, expect } from "vitest";
import { ATMOSPHERE_PRESETS } from "./atmosphere-presets.ts";

const PRESET_IDS = Object.keys(ATMOSPHERE_PRESETS) as (keyof typeof ATMOSPHERE_PRESETS)[];

/** 头注声明的「❌ 不覆盖」字段——氛围不得写入，以免抹掉用户对无关字段的偏好 */
const FORBIDDEN_KEYS = [
  "renderMode",
  "ppEnabled",
  "ppSsaoEnabled",
  "ppBloomEnabled",
  "shadowType",
  "groundMatSource",
  "reflectorSize",
  // [2026-10-07 补] sky 能力级两开关亦禁入：除「不覆盖用户偏好」外，还有一层**来源纪律**——
  // sky 构造期显式 opts.enabled 走 setEnvState(source:'manual') 打手改足迹，此后
  // auto-atmosphere 写同键被 shouldOverwrite 拒绝（sky-capability.ts 构造器「⚠️ 来源纪律」）。
  // 若日后确要让氛围切换天空能力开关，须同步改按来源传参（或让预设走 force/skipMiddleware），
  // 勿只加预设项——本列表即该前提的机器守卫（原为逐档人工核实）。
  "skyEnabled",
  "skyGodRaysEnabled",
];

describe("ATMOSPHERE_PRESETS — 预设集合自洽", () => {
  it("覆盖 sky/studio/sunset/night/forest 五个氛围（不含 custom）", () => {
    expect(PRESET_IDS.sort()).toEqual(["forest", "night", "sky", "studio", "sunset"]);
  });

  it("每条预设 envPreset 与自身键一致，且 envIntensity/ppExposure 为正值", () => {
    for (const id of PRESET_IDS) {
      const s = ATMOSPHERE_PRESETS[id];
      expect(s.envPreset, `${id}.envPreset`).toBe(id);
      expect(s.envIntensity!, `${id}.envIntensity`).toBeGreaterThan(0);
      expect(s.ppExposure!, `${id}.ppExposure`).toBeGreaterThan(0);
    }
  });

  it("每条预设 skyForceEnv=true（离散动作触发 PMREM 重建）", () => {
    for (const id of PRESET_IDS) {
      expect(ATMOSPHERE_PRESETS[id].skyForceEnv, `${id}.skyForceEnv`).toBe(true);
    }
  });
});

describe("ATMOSPHERE_PRESETS — 语义边界（无关字段不覆盖）", () => {
  it("任一快照都不写入被排除的无关字段", () => {
    for (const id of PRESET_IDS) {
      for (const key of FORBIDDEN_KEYS) {
        expect(
          ATMOSPHERE_PRESETS[id],
          `${id} 不应包含被排除字段 ${key}`,
        ).not.toHaveProperty(key);
      }
    }
  });

  it("雾开关按氛围语义分布：户外（sunset/night/forest）开，天空/室内关", () => {
    expect(ATMOSPHERE_PRESETS.sky.fogEnabled).toBe(false);
    expect(ATMOSPHERE_PRESETS.studio.fogEnabled).toBe(false);
    expect(ATMOSPHERE_PRESETS.sunset.fogEnabled).toBe(true);
    expect(ATMOSPHERE_PRESETS.night.fogEnabled).toBe(true);
    expect(ATMOSPHERE_PRESETS.forest.fogEnabled).toBe(true);
  });
});

describe("ATMOSPHERE_PRESETS — 色温/曝光倾向", () => {
  it("仅 sunset/night 带主光色温，白天/森林用默认白光", () => {
    expect(ATMOSPHERE_PRESETS.sunset.lightKeyColor).toBeDefined();
    expect(ATMOSPHERE_PRESETS.night.lightKeyColor).toBeDefined();
    expect(ATMOSPHERE_PRESETS.sky.lightKeyColor).toBeUndefined();
    expect(ATMOSPHERE_PRESETS.studio.lightKeyColor).toBeUndefined();
    expect(ATMOSPHERE_PRESETS.forest.lightKeyColor).toBeUndefined();
  });

  it("夜景曝光最低、白天/森林曝光默认（氛围语义单调）", () => {
    const nightExp = ATMOSPHERE_PRESETS.night.ppExposure!;
    expect(nightExp).toBeLessThan(ATMOSPHERE_PRESETS.sky.ppExposure!);
    expect(nightExp).toBeLessThan(ATMOSPHERE_PRESETS.forest.ppExposure!);
    expect(ATMOSPHERE_PRESETS.night.lightKeyIntensity!).toBeLessThan(
      ATMOSPHERE_PRESETS.sky.lightKeyIntensity!,
    );
  });

  it("日落为暖色温（R 通道高于 B），夜景为冷色温（B 高于 R）", () => {
    const warm = ATMOSPHERE_PRESETS.sunset.lightKeyColor!;
    expect((warm >> 16) & 0xff).toBeGreaterThan(warm & 0xff);
    const cool = ATMOSPHERE_PRESETS.night.lightKeyColor!;
    expect(cool & 0xff).toBeGreaterThan((cool >> 16) & 0xff);
  });
});