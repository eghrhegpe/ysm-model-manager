// ===== 模型类别默认值 MODEL_DEFAULTS（ADR-196 刀5）=====
// 统一数据源替代各 cap 散落的 *_PRESETS 表。每个模型 = Partial<EnvState>，
// 各 cap 的 setPreset 读自己关注的键 + 保留守卫/副作用。
//
// 来源合并：MODEL_SKY_PRESETS + FOG_PRESETS + ENV_PRESET_BY_MODEL +
// LIGHT_PRESETS + REFLECTOR_PRESETS + POSTPROC_PRESETS + SHADOW_PRESET_BY_MODEL。
//
// 注意：
//   - skyForceEnv: true 标记「模型切换是离散动作，应触发 PMREM 重建」
//   - 参数字段（fogDensity/lightIntensity 等）走 auto-model source，
//     用户手动调参（manual source）后不被覆盖

import type { EnvState } from "./env-state-schema.ts";

export type ModelType =
  | "default"
  | "ysm"
  | "vrm"
  | "mmd"
  | "mmd-scene"
  | "litematic"
  | "resourcepack";

export const MODEL_DEFAULTS: Record<ModelType, Partial<EnvState>> = {
  default: {
    // --- sky (来自 MODEL_SKY_PRESETS.default) ---
    skyTurbidity: 7.5,
    skyRayleigh: 2.5,
    skyMieCoefficient: 0.005,
    skyMieDirectionalG: 0.8,
    skyExposure: 0.5,
    skySunIntensityScale: 0.75,
    skySunDiscScale: 0.5,
    skyForceEnv: true,
    // --- fog (来自 FOG_PRESETS.default = 空，仅关闭) ---
    fogEnabled: false,
    // --- environment ---
    envPreset: "sky",
    envIntensity: 1.0,
    // --- light (来自 LIGHT_PRESETS.default) ---
    lightSpotEnabled: false,
    lightVolumetricEnabled: false,
    // --- shadow (来自 SHADOW_PRESET_BY_MODEL.default → hard) ---
    shadowType: "hard",
    // --- reflector (来自 REFLECTOR_PRESETS.default = 空) ---
    // --- postprocessing (来自 POSTPROC_PRESETS.default = 空，总闸外) ---
  },
  ysm: {
    // sky (MODEL_SKY_PRESETS.ysm)
    skyTurbidity: 8.5,
    skyRayleigh: 2.6,
    skyMieCoefficient: 0.005,
    skyMieDirectionalG: 0.8,
    skyExposure: 0.6,
    skySunIntensityScale: 0.75,
    skySunDiscScale: 0.5,
    skyForceEnv: true,
    // fog (FOG_PRESETS.ysm 未显式定义 → 关)
    fogEnabled: false,
    // environment (ENV_PRESET_BY_MODEL.ysm)
    envPreset: "sky",
    envIntensity: 1.0,
    // light (LIGHT_PRESETS.ysm)
    lightKeyIntensity: 1.3,
    lightFillIntensity: 0.5,
    lightRimIntensity: 0.45,
    lightSpotEnabled: false,
    lightSpotIntensity: 1.8,
    lightSpotAngle: 30,
    lightSpotPenumbra: 0.4,
    lightVolumetricEnabled: false,
    lightVolumetricOpacity: 0.4,
    lightVolumetricFogPower: 1.2,
    // shadow (SHADOW_PRESET_BY_MODEL.ysm = "default" → hard)
    shadowType: "hard",
    // reflector (REFLECTOR_PRESETS.ysm)
    reflectorOpacity: 0.25,
    reflectorSize: 200,
    reflectorResolution: 512,
    reflectorColor: 0xf0f4fa,
    // postprocessing (POSTPROC_PRESETS.ysm = {enabled: false})
    // → 由 cap 侧 this.enabled 副作用处理
  },
  vrm: {
    // sky (MODEL_SKY_PRESETS.vrm)
    skyTurbidity: 6,
    skyRayleigh: 2.3,
    skyMieCoefficient: 0.004,
    skyMieDirectionalG: 0.85,
    skyExposure: 0.55,
    skySunIntensityScale: 0.78,
    skySunDiscScale: 0.55,
    skyForceEnv: true,
    // fog
    fogEnabled: false,
    // environment (ENV_PRESET_BY_MODEL.vrm)
    envPreset: "studio",
    envIntensity: 1.6,
    // light (LIGHT_PRESETS.vrm)
    lightKeyIntensity: 1.0,
    lightFillIntensity: 0.5,
    lightRimIntensity: 0.6,
    lightSpotEnabled: false,
    lightSpotIntensity: 1.5,
    lightSpotAngle: 28,
    lightVolumetricEnabled: false,
    // shadow (SHADOW_PRESET_BY_MODEL.vrm = "soft")
    shadowType: "soft",
    // reflector (REFLECTOR_PRESETS.vrm)
    reflectorOpacity: 0.5,
    reflectorSize: 60,
    reflectorResolution: 1024,
    reflectorColor: 0xf8efe2,
    // postprocessing (POSTPROC_PRESETS.vrm = {enabled: true})
  },
  mmd: {
    // sky (MODEL_SKY_PRESETS.mmd)
    skyTurbidity: 7.5,
    skyRayleigh: 2.3,
    skyMieCoefficient: 0.006,
    skyMieDirectionalG: 0.8,
    skyExposure: 0.55,
    skySunIntensityScale: 0.72,
    skySunDiscScale: 0.45,
    skyForceEnv: true,
    // fog
    fogEnabled: false,
    // environment (ENV_PRESET_BY_MODEL.mmd = studio)
    envPreset: "studio",
    envIntensity: 1.6,
    // light (LIGHT_PRESETS.mmd)
    lightKeyIntensity: 0.85,
    lightFillIntensity: 0.3,
    lightRimIntensity: 0.25,
    lightSpotEnabled: false,
    lightSpotIntensity: 1.4,
    lightVolumetricEnabled: false,
    // shadow (SHADOW_PRESET_BY_MODEL.mmd = "soft")
    shadowType: "soft",
    // reflector (REFLECTOR_PRESETS.mmd)
    reflectorOpacity: 0.2,
    reflectorSize: 80,
    reflectorResolution: 1024,
    reflectorColor: 0xfafcff,
    // postprocessing (POSTPROC_PRESETS.mmd = {enabled: true})
  },
  "mmd-scene": {
    // sky (MODEL_SKY_PRESETS.mmd-scene)
    skyTurbidity: 10,
    skyRayleigh: 2.0,
    skyMieCoefficient: 0.008,
    skyMieDirectionalG: 0.75,
    skyExposure: 0.55,
    skySunIntensityScale: 0.7,
    skySunDiscScale: 0.45,
    skyForceEnv: true,
    // fog
    fogEnabled: false,
    // environment (ENV_PRESET_BY_MODEL.mmd-scene = sky)
    envPreset: "sky",
    envIntensity: 1.1,
    // light (LIGHT_PRESETS.mmd-scene)
    lightKeyIntensity: 1.2,
    lightFillIntensity: 0.55,
    lightRimIntensity: 0.4,
    lightSpotEnabled: false,
    lightSpotIntensity: 1.6,
    lightSpotAngle: 40,
    lightSpotPenumbra: 0.6,
    lightVolumetricEnabled: false,
    lightVolumetricOpacity: 0.35,
    lightVolumetricFogPower: 1.0,
    // shadow (SHADOW_PRESET_BY_MODEL.mmd-scene = "soft")
    shadowType: "soft",
    // reflector (REFLECTOR_PRESETS 无 mmd-scene → 同 default = 空)
    // postprocessing (POSTPROC_PRESETS.mmd-scene = {enabled: false})
  },
  litematic: {
    // sky (MODEL_SKY_PRESETS.litematic)
    skyTurbidity: 7.5,
    skyRayleigh: 2.5,
    skyMieCoefficient: 0.005,
    skyMieDirectionalG: 0.8,
    skyExposure: 0.5,
    skySunIntensityScale: 0.75,
    skySunDiscScale: 0.5,
    skyForceEnv: true,
    // fog
    fogEnabled: false,
    // environment (ENV_PRESET_BY_MODEL.litematic = forest)
    envPreset: "forest",
    envIntensity: 1.1,
    // light (LIGHT_PRESETS.litematic)
    lightKeyIntensity: 1.0,
    lightKeyAzimuth: 45,
    lightKeyElevation: 60,
    lightFillIntensity: 0.4,
    lightFillAzimuth: -45,
    lightFillElevation: 30,
    lightRimIntensity: 0.3,
    lightRimAzimuth: 135,
    lightRimElevation: 30,
    lightSpotEnabled: false,
    lightVolumetricEnabled: false,
    // shadow (SHADOW_PRESET_BY_MODEL.litematic = "default" → hard)
    shadowType: "hard",
    // reflector (REFLECTOR_PRESETS.litematic)
    reflectorOpacity: 0.25,
    reflectorSize: 500,
    reflectorResolution: 512,
    reflectorColor: 0xeaf1fb,
    // postprocessing (POSTPROC_PRESETS.litematic = {enabled: false})
  },
  resourcepack: {
    // sky (MODEL_SKY_PRESETS 无 resourcepack → 同 default)
    skyTurbidity: 7.5,
    skyRayleigh: 2.5,
    skyMieCoefficient: 0.005,
    skyMieDirectionalG: 0.8,
    skyExposure: 0.5,
    skySunIntensityScale: 0.75,
    skySunDiscScale: 0.5,
    skyForceEnv: true,
    // fog
    fogEnabled: false,
    // environment (ENV_PRESET_BY_MODEL.resourcepack = sky)
    envPreset: "sky",
    envIntensity: 1.0,
    // light (LIGHT_PRESETS.resourcepack)
    lightKeyIntensity: 1.3,
    lightFillIntensity: 0.4,
    lightRimIntensity: 0.35,
    lightSpotEnabled: false,
    lightSpotIntensity: 1.8,
    lightSpotAngle: 30,
    lightVolumetricEnabled: false,
    lightVolumetricOpacity: 0.4,
    // shadow (SHADOW_PRESET_BY_MODEL.resourcepack = "default" → hard)
    shadowType: "hard",
    // reflector (REFLECTOR_PRESETS.resourcepack = 同 ysm)
    reflectorOpacity: 0.25,
    reflectorSize: 200,
    reflectorResolution: 512,
    reflectorColor: 0xf0f4fa,
    // postprocessing (POSTPROC_PRESETS.resourcepack = {enabled: false})
  },
};
