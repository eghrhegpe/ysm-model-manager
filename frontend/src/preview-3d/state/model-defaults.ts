// ===== 模型类别默认值 MODEL_DEFAULTS（ADR-196 刀5）=====
// 统一数据源替代各 cap 散落的 *_PRESETS 表。每个模型 = Partial<EnvState>，
// 各 cap 的 applyModelPreset 读自己关注的键 + 保留守卫/副作用。
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

/**
 * 从 MODEL_DEFAULTS[modelType] 中挑选指定键，构建 Partial<EnvState>。
 * 替代各 cap 内逐字段 `if (src.x !== undefined) mapped.x = src.x as T` 样板。
 *
 * @param modelType 模型类别（编译期收窄，拼错直接报错）
 * @param keys      本 cap 关注的键集（只挑存在的键，undefined 跳过）
 *
 * @example
 * // sky-capability:
 * const preset = pickModelDefaultFields(modelType, [
 *   "skyTurbidity", "skyRayleigh", "skyMieCoefficient",
 *   "skyMieDirectionalG", "skyExposure", "skySunIntensityScale", "skySunDiscScale",
 * ]);
 * if (Object.keys(preset).length > 0) {
 *   setEnvState({ ...preset, skyForceEnv: true }, { source: "auto-model" });
 * }
 */
export function pickModelDefaultFields<K extends keyof EnvState>(
  modelType: ModelType,
  keys: readonly K[],
): Pick<EnvState, K> {
  const preset = MODEL_DEFAULTS[modelType];
  const out = {} as Pick<EnvState, K>;
  const src = preset as Record<string, unknown>;
  for (const key of keys) {
    if (src[key as string] !== undefined) {
      (out as Record<string, unknown>)[key as string] = src[key as string];
    }
  }
  return out;
}

/**
 * 运行时校验/收窄任意字符串到 ModelType（localStorage 恢复、adapter.id 等运行时
 * 字符串入口的唯一合法通道）；未知值回退 "default"，脏数据不致静默丢预设。
 */
export function toModelType(v: string): ModelType {
  // Object.hasOwn 走自身属性判定——裸索引 MODEL_DEFAULTS[v] 会走原型链，
  // "constructor"/"toString" 等 Object.prototype 成员非 undefined 会被误判为合法模型类别，
  // 后续 pickModelDefaultFields 读到 undefined 字段 → 预设静默 no-op（锐评 P2 行为 bug）。
  return Object.hasOwn(MODEL_DEFAULTS, v) ? (v as ModelType) : "default";
}

const DEFAULT_MODEL_STATE: Partial<EnvState> = {
  // --- sky (来自 MODEL_SKY_PRESETS.default) ---
  skyTurbidity: 7.5,
  skyRayleigh: 2.5,
  skyMieCoefficient: 0.005,
  skyMieDirectionalG: 0.8,
  skyExposure: 0.5,
  skySunIntensityScale: 0.75,
  skySunDiscScale: 0.5,
  skyForceEnv: true,
  // --- fog (来自 FOG_PRESETS.default = 空 → 不写任何 fog 键，不打扰用户已开雾) ---
  // default 回退不强制关雾（旧 FOG_PRESETS.default={} 空语义）
  // --- environment ---
  envPreset: "sky",
  envIntensity: 1.0,
  // --- light：[ADR-282] 灯光与模型类别解耦，不再有任何 light* 类别默认值 ---
  // 灯光参数唯一来源 = envState schema 默认值（DEFAULT_LIGHT_PARAMS）+ 用户手动修改。
  // 曾经的 `lightVolumetricEnabled: false`（源自 LIGHT_PRESETS.default）与 schema 默认同值，
  // 属纯 no-op，却会在选中「默认」时夺取手动所有权并永久冻结后续模型预设——已删。
  // --- shadow (来自 SHADOW_PRESET_BY_MODEL.default → hard) ---
  shadowType: "hard",
  // --- reflector (来自 REFLECTOR_PRESETS.default = 空) ---
  // --- postprocessing (来自 POSTPROC_PRESETS.default = 空) ---
  // [ADR-250] 原 POSTPROC_PRESETS 表已删除；per-type「默认是否开后处理」改写 `ppEnabled`
  // 参数（与其余 cap 同构）。default 不写该键 → 继承 envState 默认（false）。
};

export const MODEL_DEFAULTS: Record<ModelType, Partial<EnvState>> = {
  default: DEFAULT_MODEL_STATE,
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
    // fog (FOG_PRESETS.ysm：线性雾 ysm 蓝，20~600 远距)
    fogEnabled: false,
    fogMode: "linear",
    fogColor: 0xb8d0ec,
    fogNear: 20,
    fogFar: 600,
    fogDensity: 0.006,
    // environment (ENV_PRESET_BY_MODEL.ysm)
    envPreset: "sky",
    envIntensity: 1.0,
    // light：[ADR-282] 已解耦（原 LIGHT_PRESETS.ysm：key 1.3 / fill 0.5 / rim 0.45 + vol 0.4/1.2）
    // shadow (SHADOW_PRESET_BY_MODEL.ysm = "default" → hard)
    shadowType: "hard",
    // reflector (REFLECTOR_PRESETS.ysm)
    reflectorOpacity: 0.25,
    reflectorSize: 200,
    reflectorResolution: 512,
    reflectorColor: 0xf0f4fa,
    // postprocessing (原 POSTPROC_PRESETS.ysm = {enabled: false})
    // [ADR-250] 方块/车万女仆：满亮材质 + 发光骨，默认关后处理避免爆亮。
    // 与 envState 默认同值（false），显式写下以表达意图（用户可覆盖）。
    ppEnabled: false,
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
    // fog (FOG_PRESETS.vrm：线性雾冷色调，50~400)
    fogEnabled: false,
    fogMode: "linear",
    fogColor: 0xc5d4e8,
    fogNear: 50,
    fogFar: 400,
    fogDensity: 0.008,
    // environment (ENV_PRESET_BY_MODEL.vrm)
    envPreset: "studio",
    envIntensity: 1.6,
    // light：[ADR-282] 已解耦（原 LIGHT_PRESETS.vrm：key 1.0 / fill 0.5 / rim 0.6）
    // shadow (SHADOW_PRESET_BY_MODEL.vrm = "soft")
    shadowType: "soft",
    // reflector (REFLECTOR_PRESETS.vrm)
    reflectorOpacity: 0.5,
    reflectorSize: 60,
    reflectorResolution: 1024,
    reflectorColor: 0xf8efe2,
    // postprocessing (原 POSTPROC_PRESETS.vrm = {enabled: true})
    // [ADR-250] PBR 角色：开柔光。
    ppEnabled: true,
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
    // fog (FOG_PRESETS.mmd：线性雾暖白，80~500)
    fogEnabled: false,
    fogMode: "linear",
    fogColor: 0xd6e0f0,
    fogNear: 80,
    fogFar: 500,
    fogDensity: 0.005,
    // environment (ENV_PRESET_BY_MODEL.mmd = studio)
    envPreset: "studio",
    envIntensity: 1.6,
    // light：[ADR-282] 已解耦（原 LIGHT_PRESETS.mmd：key 0.85 / fill 0.3 / rim 0.25）
    // shadow (SHADOW_PRESET_BY_MODEL.mmd = "soft")
    shadowType: "soft",
    // reflector (REFLECTOR_PRESETS.mmd)
    reflectorOpacity: 0.2,
    reflectorSize: 80,
    reflectorResolution: 1024,
    reflectorColor: 0xfafcff,
    // postprocessing (原 POSTPROC_PRESETS.mmd = {enabled: true})
    // [ADR-250] toon：开辉光。注意：此前「MMD 亮瞎」并非本行所致——亮度轴无 per-type 值，
    // 真因是后处理一开即夺走 exposure 属主（skyExposure 0.55 → ppExposure 1.0）。
    ppEnabled: true,
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
    // fog (FOG_PRESETS.mmd-scene：线性雾远距 100~1500，大场景专用)
    fogEnabled: false,
    fogMode: "linear",
    fogColor: 0xd0daed,
    fogNear: 100,
    fogFar: 1500,
    fogDensity: 0.003,
    // environment (ENV_PRESET_BY_MODEL.mmd-scene = sky)
    envPreset: "sky",
    envIntensity: 1.1,
    // light：[ADR-282] 已解耦（原 LIGHT_PRESETS.mmd-scene：key 1.2 / fill 0.55 / rim 0.4 + vol 0.35/1.0）
    // shadow (SHADOW_PRESET_BY_MODEL.mmd-scene = "soft")
    shadowType: "soft",
    // reflector (REFLECTOR_PRESETS 无 mmd-scene → 同 default = 空)
    // postprocessing (原 POSTPROC_PRESETS.mmd-scene = {enabled: false})
    ppEnabled: false,
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
    // fog (FOG_PRESETS.litematic：线性雾蓝白 30~800)
    fogEnabled: false,
    fogMode: "linear",
    fogColor: 0xc0d4f0,
    fogNear: 30,
    fogFar: 800,
    fogDensity: 0.004,
    // environment (ENV_PRESET_BY_MODEL.litematic = forest)
    envPreset: "forest",
    envIntensity: 1.1,
    // light：[ADR-282] 已解耦（原 LIGHT_PRESETS.litematic：key 1.0@45/60 + fill 0.4@-45/30 + rim 0.3@135/30）
    shadowType: "hard",
    // reflector (REFLECTOR_PRESETS.litematic)
    reflectorOpacity: 0.25,
    reflectorSize: 500,
    reflectorResolution: 512,
    reflectorColor: 0xeaf1fb,
    // postprocessing (原 POSTPROC_PRESETS.litematic = {enabled: false})
    ppEnabled: false,
  },
  resourcepack: {
    // sky/shadow/reflector/environment 与 default 逐字段相同 → 直接 spread，
    // 仅覆盖差异：fog（FOG_PRESETS.resourcepack：与 ysm 同调 20~600）
    // （light 段据 ADR-282 已从全部类别删除，不再覆盖）
    ...DEFAULT_MODEL_STATE,
    fogEnabled: false,
    fogMode: "linear",
    fogColor: 0xb8d0ec,
    fogNear: 20,
    fogFar: 600,
    fogDensity: 0.006,
    // light：[ADR-282] 已解耦（原 LIGHT_PRESETS.resourcepack：key 1.3 / fill 0.4 / rim 0.35 + vol 0.4）
    reflectorOpacity: 0.25,
    reflectorSize: 200,
    reflectorResolution: 512,
    reflectorColor: 0xf0f4fa,
    // postprocessing (原 POSTPROC_PRESETS.resourcepack = {enabled: false})
    ppEnabled: false,
  },
};
