// ===== 后处理能力状态/序列化层（拆轴自 postprocessing-capability.ts）=====
// 收口「巨型 cap 混装状态与 Three 装配」的锐评结论：本文件收敛纯数据 + 纯类型轴
// （ReflectionMode / PostprocessingParams / 默认值 / 光影包预设 / toneMapping 键表），
// 零 THREE 依赖、无顶层副作用；postprocessing-capability.ts 保留 EffectComposer /
// Bloom / SSAO / SSR pass 装配、惰性 THREE 枚举求值等渲染轴。
// 注意：THREE.ToneMapping 枚举值不在本文件求值（verbatimModuleSyntax + 测试 mock 约束），
// 运行时映射统一走 postprocessing-capability.ts 的 toneMappingValue()。

/** 反射模式三档：envmap-only 纯环境贴图、envmap+ssr SSR+屏外 fallback、ssr-only 纯 SSR（屏外会变黑） */
export type ReflectionMode = "envmap-only" | "envmap+ssr" | "ssr-only";

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
  /** 独立辉光开关：false 时旁路 bloomPass，不影响 SSAO/SSR（与整条管线开关 this.enabled 正交） */
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
 * 注意：不要在模块级求值 THREE 枚举（如 LinearToneMapping）——verbatimModuleSyntax 下
 * 未用值导入不再被擦除，全量 mock three 的测试（如 screenshot-render.test）会在收集期
 * 因 mock 缺枚举导出而炸。枚举取值统一走 postprocessing-capability.ts 的 toneMappingValue()。
 */
export const TONE_MAPPING_KEYS = ["none", "linear", "reinhard", "aces", "cineon"] as const;

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
 * 模型类别后处理预设 —— 统一亮度口径
 *
 * bloomStrength / bloomThreshold / bloomRadius / exposure / toneMapping 一律继承
 * DEFAULT_POSTPROC_PARAMS（光影包全局值），**不按类型分别调**：同一光影包 → 同一观感，
 * 消除「YSM/车万女仆爆亮、MMD/VRM 无反应」的不对称（材质差异不应由 per-type 亮度补偿）。
 *
 * per-type 预设只保留 `enabled`，语义收紧为「该类模型是否允许走后处理」——纯性能/视觉门禁。
 * 最终生效开关 = 性能档位 `render.bloom`（总闸：低档=false 全关）&& 此处 `enabled`（per-type 门禁）。
 */
export const POSTPROC_PRESETS: Record<string, Partial<PostprocessingParams>> = {
  default: { ...DEFAULT_POSTPROC_PARAMS },
  ysm: { enabled: false }, // 方块/车万女仆：满亮材质 + 发光骨，默认关后处理避免爆亮
  vrm: { enabled: true }, // PBR 角色：开柔光
  mmd: { enabled: true }, // toon：开辉光
  litematic: { enabled: false }, // 体素：默认关
  resourcepack: { enabled: false }, // 资源包：默认关
  "mmd-scene": { enabled: false }, // 场景：默认关
};
