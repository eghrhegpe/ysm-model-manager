// ===== 氛围预设 ATMOSPHERE_PRESETS（ADR-196 刀4）=====
// 取代 environment-state.ts 的 ENV_PRESET_LINKAGE（硬编码 if(link.sky) 联动）。
// 每个氛围 = 一个 Partial<EnvState>（氛围相关字段全集），应用 = setEnvState(snapshot,
// { source: 'auto-atmosphere' })——由 env-dispatcher 统一广播到各 cap callback。
//
// 语义边界（氛围相关字段，无关字段不出现——用户对无关字段的偏好不被意外覆盖）：
//   ✅ sky 时间/云量、fog 开关/模式/密度/范围、env 贴图 preset/intensity、
//      light 各灯强度（色温后续扩充）、postprocessing exposure
//   ❌ shadow 类型（技术质量档）、reflector 尺寸（场景布置）、renderMode（调试工具）、
//      ground 材质（场景内容）——这些保持用户当前值。
//
// 守卫：lastWriteSource auto-atmosphere < manual——用户手动调过的字段不被氛围覆盖。

import type { EnvPresetId } from "../caps/environment-state.ts";
import type { EnvState } from "./env-state-schema.ts";

export type AtmospherePresetId = Exclude<EnvPresetId, "custom">;

/**
 * 氛围 → 场景状态快照（Partial<EnvState>）。
 * skyTimeOfDay/skyCloudCoverage 带 skyForceEnv=true：氛围切换是离散动作，
 * 云量/时间变化应触发 PMREM 环境重建（callback 门控读 skyForceEnv）。
 */
export const ATMOSPHERE_PRESETS: Record<AtmospherePresetId, Partial<EnvState>> = {
  sky: {
    envPreset: "sky",
    envIntensity: 1.0,
    skyTimeOfDay: 9,
    skyCloudCoverage: 0.1,
    skyForceEnv: true,
    fogEnabled: false,
  },
  studio: {
    envPreset: "studio",
    envIntensity: 1.6,
    skyTimeOfDay: 12,
    skyCloudCoverage: 0,
    skyForceEnv: true,
    fogEnabled: false,
  },
  sunset: {
    envPreset: "sunset",
    envIntensity: 1.4,
    skyTimeOfDay: 18,
    skyCloudCoverage: 0.6,
    skyForceEnv: true,
    fogEnabled: true,
    fogMode: "linear",
    fogDensity: 0.02,
    fogNear: 50,
    fogFar: 800,
  },
  night: {
    envPreset: "night",
    envIntensity: 0.7,
    skyTimeOfDay: 22,
    skyCloudCoverage: 0,
    skyForceEnv: true,
    fogEnabled: true,
    fogMode: "exp2",
    fogDensity: 0.015,
  },
  forest: {
    envPreset: "forest",
    envIntensity: 1.1,
    skyTimeOfDay: 10,
    skyCloudCoverage: 0.4,
    skyForceEnv: true,
    fogEnabled: true,
    fogMode: "exp2",
    fogDensity: 0.03,
  },
};
