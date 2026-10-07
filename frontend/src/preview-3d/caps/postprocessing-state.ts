import type { FieldKind } from "./persist-utils.ts";

// ===== 后处理能力状态/序列化层（拆轴自 postprocessing-capability.ts）=====
// 本文件收敛纯数据 + 纯类型轴：ReflectionMode / PostprocessingParams / 默认值 / 键表，
// 零 THREE 依赖、无顶层副作用；渲染轴（composer、各 pass 装配、惰性 THREE 枚举求值）
// 留在 postprocessing-capability.ts。
// 注意：THREE.ToneMapping 枚举值不在本文件求值（verbatimModuleSyntax + 测试 mock 约束），
// 运行时映射统一走 postprocessing-capability.ts 的 toneMappingValue()。

/** 反射模式三档：envmap-only 纯环境贴图、envmap+ssr SSR+屏外 fallback、ssr-only 纯 SSR（屏外会变黑） */
export type ReflectionMode = "envmap-only" | "envmap+ssr" | "ssr-only";

/** ReflectionMode 合法值白名单（loadState 枚举校验用） */
export const REFLECTION_MODES = [
  "envmap-only",
  "envmap+ssr",
  "ssr-only",
] as const satisfies readonly ReflectionMode[];

export interface PostprocessingParams {
  enabled: boolean;
  /** Bloom 强度（0~3）*/
  bloomStrength: number;
  /** Bloom 阈值（0~1；低于此亮度的像素不参与 bloom） */
  bloomThreshold: number;
  /** Bloom 半径（0~2） */
  bloomRadius: number;
  /** 是否让 Bloom 参数跟随 LightCapability 体积光联动（开启后用 opacity/edgeFade 调 bloom） */
  bloomFollowVolumetric: boolean;
  /** 独立辉光开关：false 时旁路 bloomPass，不影响 SSAO/SSR（与整条管线开关 `ppEnabled` 正交） */
  bloomEnabled: boolean;
  /** SSAO 开关 */
  ssaoEnabled: boolean;
  /** SSAO 采样半径（控制 AO 扩散范围） */
  ssaoRadius: number;
  /** SSAO 最小生效距离 */
  ssaoMinDist: number;
  /** SSAO 最大生效距离 */
  ssaoMaxDist: number;
  /** 后处理输出色彩映射（默认 ACES Filmic） */
  toneMapping: "none" | "linear" | "reinhard" | "aces" | "cineon";
  /** 曝光值（toneMapping≠none 时生效） */
  exposure: number;
  /** 反射模式：envmap-only 纯环境贴图 / envmap+ssr SSR 叠 envmap 屏外 fallback / ssr-only 纯 SSR */
  reflectionMode: ReflectionMode;
  /** SSR 透明度（SSR 叠 envmap 时的混合强度，0.5 默认） */
  ssrOpacity: number;
  /** SSR 最大反射距离（越大越吃性能，180 默认） */
  ssrMaxDistance: number;
  /** SSR 厚度判定（越大越不易漏反射，0.018 默认） */
  ssrThickness: number;
  /** SSR 模糊开关（真=两通高斯模糊镜面） */
  ssrBlur: boolean;
  /** SSR 距离衰减（真=远处反射变淡） */
  ssrDistanceAttenuation: boolean;
  /** SSR 菲涅尔（真=斜反射强，正反射弱） */
  ssrFresnel: boolean;
  /** SSR 多重弹射（真=上帧结果做迭代，细节更好但更慢） */
  ssrBouncing: boolean;
  /** SSR 开启时，自动禁用 ReflectorCapability 单平面镜面（省 draw call + 防 z-fighting） */
  reflectorDisableWhenSSR: boolean;
}

/**
 * tone mapping 档位 → THREE 枚举值的静态键表（仅字符串，供运行时校验）。
 * ⚠️ 勿在模块级求值 THREE 枚举：verbatimModuleSyntax 下未用值导入不再被擦除，全量 mock
 * three 的测试（如 screenshot-render.test）会在收集期因 mock 缺枚举导出而炸。
 * 枚举取值统一走 postprocessing-capability.ts 的 toneMappingValue()。
 */
export const TONE_MAPPING_KEYS = ["none", "linear", "reinhard", "aces", "cineon"] as const;

/**
 * 持久化字段种别表：键集与 `PostprocessingParams` 全键（除 `enabled`）**编译期双向互锁**
 * ——params 加字段没进表、或表里写了 params 没有的字段，`satisfies` 均报错。
 * save/load 直接读写 envState（键名沿用旧 params 名以兼容已有存档），不依赖 this.params。
 */
export const POSTPROC_PERSIST_FIELDS = {
  bloomStrength: "number",
  bloomThreshold: "number",
  bloomRadius: "number",
  bloomFollowVolumetric: "boolean",
  bloomEnabled: "boolean",
  ssaoEnabled: "boolean",
  ssaoRadius: "number",
  ssaoMinDist: "number",
  ssaoMaxDist: "number",
  toneMapping: { oneOf: TONE_MAPPING_KEYS },
  exposure: "number",
  reflectionMode: { oneOf: REFLECTION_MODES },
  ssrOpacity: "number",
  ssrMaxDistance: "number",
  ssrThickness: "number",
  ssrBlur: "boolean",
  ssrDistanceAttenuation: "boolean",
  ssrFresnel: "boolean",
  ssrBouncing: "boolean",
  reflectorDisableWhenSSR: "boolean",
} as const satisfies Record<Exclude<keyof PostprocessingParams, "enabled">, FieldKind>;

/**
 * `params 键 → envState 键` 映射（ADR-196 刀2）：构造 seed / 测试 seed / save→load 共用。
 *
 * 排除 `enabled` 的原因：它是 `PostprocessingParams` 上的**只读视图**（真值在 envState 的
 * `ppEnabled`，见 ENV_STATE_SCHEMA），不参与 params→env 搬运，故不在此表。
 * 即：这里排除的是 **params 结构体上的同名键**，不是「schema 里没有 ppEnabled」。
 */
export const PP_PARAMS_TO_ENV: Record<Exclude<keyof PostprocessingParams, "enabled">, string> = {
  bloomStrength: "ppBloomStrength",
  bloomThreshold: "ppBloomThreshold",
  bloomRadius: "ppBloomRadius",
  bloomFollowVolumetric: "ppBloomFollowVolumetric",
  bloomEnabled: "ppBloomEnabled",
  ssaoEnabled: "ppSsaoEnabled",
  ssaoRadius: "ppSsaoRadius",
  ssaoMinDist: "ppSsaoMinDist",
  ssaoMaxDist: "ppSsaoMaxDist",
  toneMapping: "ppToneMapping",
  exposure: "ppExposure",
  reflectionMode: "ppReflectionMode",
  ssrOpacity: "ppSsrOpacity",
  ssrMaxDistance: "ppSsrMaxDistance",
  ssrThickness: "ppSsrThickness",
  ssrBlur: "ppSsrBlur",
  ssrDistanceAttenuation: "ppSsrDistanceAttenuation",
  ssrFresnel: "ppSsrFresnel",
  ssrBouncing: "ppSsrBouncing",
  reflectorDisableWhenSSR: "ppReflectorDisableWhenSSR",
} as const;

export const DEFAULT_POSTPROC_PARAMS: PostprocessingParams = {
  enabled: false,
  bloomStrength: 0.6,
  bloomThreshold: 0.6,
  bloomRadius: 0.5,
  bloomFollowVolumetric: true,
  bloomEnabled: true,
  ssaoEnabled: false,
  ssaoRadius: 8,
  ssaoMinDist: 0.005,
  ssaoMaxDist: 0.1,
  toneMapping: "aces",
  exposure: 1.0,
  reflectionMode: "envmap-only",
  ssrOpacity: 0.5,
  ssrMaxDistance: 180,
  ssrThickness: 0.018,
  ssrBlur: true,
  ssrDistanceAttenuation: true,
  ssrFresnel: true,
  ssrBouncing: false,
  reflectorDisableWhenSSR: true,
};

/**
 * [2026-10 bloom 域修复] 用户阈值（「曝光后可见亮度」语义，0~1）→ UnrealBloomPass
 * 实际消费的阈值（「曝光前线性 HDR」域）。
 *
 * 病根：pass 序 RenderPass → (SSR/SSAO) → UnrealBloom → **OutputPass**——three 在渲染进
 * render target 时材质**不做** tone mapping（曝光/ACES 全部压在 OutputPass，即 bloom 之后），
 * 所以 bloom 的 luminosityThreshold 比的是未乘曝光的线性值。用户拿滑杆校准的是屏幕上的
 * 感知亮度（= ACES(linear×exposure)），两套坐标差 exposure 倍：exposure=0.5 时用户阈值 0.6
 * 实际约等于「显示 48% 灰就起辉」——中灰以上全模型泛光（默认 VRM/MMD 开 pp 即亮瞎）。
 *
 * 修复 = 把用户值除以曝光换回 bloom 所在的线性域：thresholdLinear = user / exposure。
 * **只换算 threshold**：strength 是加性增益、无亮度域语义，且随 OutputPass 曝光自然缩放。
 *
 * 不选 ACES 反函数（阈值严格对齐「显示亮度」）的原因：ACES 上凸非线性，反解后阈值
 * 对曝光滑杆的响应是扭曲的（低阈值区响应过冲）；纯除法保持「阈值 ∝ 曝光」线性语义，
 * 且与用户直觉（暗场景阈值更低）一致。域钳 [0, +∞)：除数下限 1e-3 防零曝光除爆——
 * 零曝光时画面全黑，threshold 取什么值都无意义，钳到有限大即可，不产生 Infinity 污染 pass。
 */
export function bloomThresholdToLinear(userThreshold: number, exposure: number): number {
  return userThreshold / Math.max(exposure, 1e-3);
}

/**
 * [ADR-250] 原 `POSTPROC_PRESETS`（模型类别后处理预设表）已删除，勿再加回。
 * 「YSM/体素默认不开后处理」这一偏好改由 `MODEL_DEFAULTS`（state/model-defaults.ts）
 * 写 `ppEnabled: false` 表达——与 sky/light/fog/shadow/reflector/environment 六 cap 同路，
 * 且此时它是**可被用户覆盖的默认值**，而非钉死在 cap 里的 per-type 分支。
 */
