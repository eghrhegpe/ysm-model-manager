// ===== 氛围预设 ATMOSPHERE_PRESETS（ADR-196 刀4）=====
// 取代 environment-state.ts 的 ENV_PRESET_LINKAGE（硬编码 if(link.sky) 联动）。
// 每个氛围 = 一个 Partial<EnvState>（氛围相关字段全集），应用 = setEnvState(snapshot,
// { source: 'auto-atmosphere' })——由 env-dispatcher 统一广播到各 cap callback。
//
// 语义边界（氛围相关字段完整快照；无关字段不出现——用户对无关字段的偏好不被意外覆盖）：
//   ✅ sky 时间/云量、fog 开关/模式/密度/范围、env 贴图 preset/intensity、
//      light 各灯强度（色温仅 sunset/night 调整——有明确氛围语义）、
//      postprocessing exposure/bloom（有明确氛围语义时调整）
//   ❌ shadow 类型（技术质量档）、reflector 尺寸（场景布置）、renderMode（调试工具）、
//      ground 材质（场景内容）——这些保持用户当前值。
//
// 守卫：lastWriteSource auto-atmosphere < manual——用户手动调过的字段不被氛围覆盖。

import type { EnvPresetId } from "@/preview-3d/caps/environment-state.ts";
import type { EnvState } from "./env-state-schema.ts";

export type AtmospherePresetId = Exclude<EnvPresetId, "custom">;

/**
 * 氛围 → 场景状态快照（Partial<EnvState> 完整快照）。
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
    // 白天：默认白光 + 默认曝光
    lightKeyIntensity: 1.2,
    lightFillIntensity: 0.4,
    lightRimIntensity: 0.3,
    lightAmbientIntensity: 0.5,
    ppExposure: 1.0,
  },
  studio: {
    envPreset: "studio",
    envIntensity: 1.6,
    skyTimeOfDay: 12,
    skyCloudCoverage: 0,
    skyForceEnv: true,
    fogEnabled: false,
    // 室内柔光：降主光、升补光/轮廓、升曝光
    lightKeyIntensity: 1.0,
    lightFillIntensity: 0.6,
    lightRimIntensity: 0.4,
    lightAmbientIntensity: 0.6,
    ppExposure: 1.2,
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
    // 暖色温：低主光（太阳西沉）、高轮廓（逆光勾边）、降曝光、强 bloom
    lightKeyColor: 0xffe8c0,
    lightKeyIntensity: 0.8,
    lightFillColor: 0xfff0d0,
    lightFillIntensity: 0.3,
    lightRimColor: 0xffcc88,
    lightRimIntensity: 0.6,
    lightAmbientIntensity: 0.3,
    ppExposure: 0.9,
    ppBloomStrength: 1.0,
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
    // 冷色温：低主光/低补光/弱轮廓、降曝光、弱 bloom
    lightKeyColor: 0x99aacc,
    lightKeyIntensity: 0.4,
    lightFillColor: 0x8899bb,
    lightFillIntensity: 0.2,
    lightRimColor: 0x7788aa,
    lightRimIntensity: 0.15,
    lightAmbientIntensity: 0.2,
    ppExposure: 0.6,
    ppBloomStrength: 0.3,
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
    // 林间：中等主光、较高补光（漫反射强）、默认曝光
    lightKeyIntensity: 1.0,
    lightFillIntensity: 0.5,
    lightRimIntensity: 0.35,
    lightAmbientIntensity: 0.5,
    ppExposure: 1.0,
  },
};
