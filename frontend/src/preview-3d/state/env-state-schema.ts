// ===== 统一场景状态 Schema（ADR-196 刀 0）=====
// 收口全部 cap 参数声明：类型 + 默认值 + dispatch 组。
// 仿 MikuMikuAR ENV_STATE_SCHEMA 模式，新增字段只需在此追加。
//
// ⚠️ 默认值单一事实源（ADR-249 §2.6）：地面材质字段的默认值取自
// ground-surface-spec.ts 的 DEFAULT_GROUND_SURFACE_PARAMS，**不在此重写字面量**。
// 历史缺陷：两处各自声明默认值且不一致（matGridSize 10 vs 8、matRoughness 0.8 vs 0.85、
// matLineColor/matColor2 亦分歧），实际渲染读 spec 侧 → schema 侧为死值，
// 用户看到的数值与 schema 声明对不上。同类病例参照 MikuMikuAR bd65c02f（常量双源）。
import {
  GROUND_CANVAS_STYLES,
  DEFAULT_GROUND_SURFACE_PARAMS as GROUND_DEFAULTS,
  GROUND_MATERIAL_PRESET_IDS,
  GROUND_OVERLAY_STYLES,
  GROUND_SOURCE_KINDS,
} from "@/preview-3d/caps/ground-surface-spec.ts";
import { clamp } from "@/utils/base/pure/clamp.ts";

type FieldDefaultMap = {
  number: number;
  boolean: boolean;
  string: string;
  enum: string;
  tuple3: readonly [number, number, number];
  "nullable-boolean": boolean | null;
  "nullable-number": number | null;
};

/** 数值值域描述符（ADR-283）：schema 是值域的**唯一事实源**。
 *  - `range`   = **合法域**：`setEnvState` 唯一写入口按此钳制（step/unit 不参与钳制，仅供菜单）；
 *  - `uiRange` = **展示域**（可选，缺省 = range）：滑杆行程的手感设计，可与合法域不同
 *               （`waterSize` 合法 ≥1，但滑杆 10–300 才是常用区）。
 *  只声明在 `type: "number"` 字段上（颜色虽为 number，但无值域语义，故不声明）。 */
export type NumericRange = {
  readonly min: number;
  readonly max: number;
  /** 步长（**必填**：值域的实际消费者是滑杆；给个缺省值反而会成为隐藏的第二事实源）。 */
  readonly step: number;
  readonly unit?: string;
};

type _FieldDef<TType extends keyof FieldDefaultMap> = {
  type: TType;
  default: FieldDefaultMap[TType];
  /** dispatch 分组：字段变化时触发哪些 cap 回调。未指定 = 不触发。 */
  group?: string | readonly string[];
} & (TType extends "enum" ? { values: readonly string[] } : object) &
  (TType extends "number" ? { range?: NumericRange; uiRange?: NumericRange } : object);

type _AnyFieldDef = {
  [TType in keyof FieldDefaultMap]: _FieldDef<TType>;
}[keyof FieldDefaultMap];

// ======== Schema 定义 ========
// 按 sky / ground / water / environment / fog / shadow / reflector / renderMode / postprocessing / light 分组

export const ENV_STATE_SCHEMA = {
  // --- Sky ---
  skyTimeOfDay: { type: "number", default: 9, group: "sky" },
  skyCloudCoverage: { type: "number", default: 0, group: "sky" },
  skyElevation: { type: "number", default: 10, group: "sky" },
  skyAzimuth: { type: "number", default: 180, group: "sky" },
  skyForceEnv: { type: "boolean", default: true, group: "sky" },
  skyTurbidity: { type: "number", default: 7.5, group: "sky" },
  skyRayleigh: { type: "number", default: 2.5, group: "sky" },
  skyMieCoefficient: { type: "number", default: 0.005, group: "sky" },
  skyMieDirectionalG: { type: "number", default: 0.8, group: "sky" },
  skySunIntensityScale: { type: "number", default: 0.75, group: "sky" },
  skySunDiscScale: { type: "number", default: 0.5, group: "sky" },
  skyExposure: { type: "number", default: 0.5, group: "sky" },
  skyEnvironment: { type: "boolean", default: true, group: "sky" },
  skyGodRaysEnabled: { type: "boolean", default: false, group: "sky" },
  skyAutoRotate: { type: "boolean", default: false, group: "sky" },
  skyScale: { type: "number", default: 12000, group: "sky" },

  // --- Ground ---
  groundVisible: { type: "boolean", default: true, group: "ground" },
  // 2026-09-19：参考网格（GridHelper 层）独立开关——历史遗留（知识卡「已知遗留 1」）是
  // 网格层与表面材质层共用 groundVisible，用户选了纯色/贴图材质也关不掉底下那张 y=0 参考网格，
  // 且菜单无任何网格参数出口。现拆出单轴：网格显隐 = enabled && groundVisible && groundGridVisible。
  groundGridVisible: { type: "boolean", default: true, group: "ground" },
  groundType: {
    type: "enum",
    values: ["plain", "grid", "checker", "lines", "dots"] as const,
    default: "plain",
    group: "ground",
  },
  groundColor: {
    type: "tuple3",
    default: [0.15, 0.15, 0.18] as [number, number, number],
    group: "ground",
  },
  groundLineColor: {
    type: "tuple3",
    default: [0.5, 0.5, 0.55] as [number, number, number],
    group: "ground",
  },
  // ADR-249 §2.1 拆轴：来源轴（颜色从哪来）。替代原单枚举 groundMatSource。
  groundSourceKind: {
    type: "enum",
    values: GROUND_SOURCE_KINDS,
    default: "none",
    group: "ground",
  },
  // ADR-249 §2.1 拆轴：样式轴（程序化画布长什么样，仅 sourceKind===canvas 有效）。
  groundCanvasStyle: {
    type: "enum",
    values: GROUND_CANVAS_STYLES,
    default: "plain",
    group: "ground",
  },
  // ADR-254：材质预设显式状态——「当前处于哪个材质预设」是可见事实。
  // `custom` = 用户手改过预设关心的字段，已脱离预设（由写入中间件置位）。
  groundMaterialPreset: {
    type: "enum",
    values: [...GROUND_MATERIAL_PRESET_IDS, "custom"] as const,
    default: "plain",
    group: "ground",
  },
  // ADR-249 §2.3 叠加层：独立透明格线层（正交于来源/样式两轴）
  groundOverlay: {
    type: "enum",
    values: GROUND_OVERLAY_STYLES,
    default: "none",
    group: "ground",
  },
  groundOverlayColor: { type: "number", default: 0xffffff, group: "ground" },
  groundOverlaySize: {
    type: "number",
    default: 10,
    group: "ground",
    range: { min: 2, max: 64, step: 1 },
  },
  groundOverlayOpacity: {
    type: "number",
    default: 1,
    group: "ground",
    range: { min: 0, max: 1, step: 0.05 },
  },
  groundSize: { type: "number", default: 80, group: "ground" },
  groundDivisions: { type: "number", default: 60, group: "ground" },
  groundColorCenter: { type: "number", default: 0x555577, group: "ground" },
  groundColorGrid: { type: "number", default: 0x2a2a3a, group: "ground" },
  // ADR-249 §2.6：默认值统一取自 spec（唯一事实源），不在此重写字面量。
  groundMatColor: { type: "number", default: GROUND_DEFAULTS.matColor, group: "ground" },
  groundMatColor2: { type: "number", default: GROUND_DEFAULTS.matColor2, group: "ground" },
  groundMatGridSize: {
    type: "number",
    default: GROUND_DEFAULTS.matGridSize,
    group: "ground",
    // 合法域上界 32 取自滑杆（原钳制 Math.max(2, round(n)) 无上界，ADR-283 迁移时补齐）
    range: { min: 2, max: 32, step: 1 },
  },
  groundMatOpacity: {
    type: "number",
    default: GROUND_DEFAULTS.matOpacity,
    group: "ground",
    range: { min: 0, max: 1, step: 0.05 },
  },
  groundMatScale: {
    type: "number",
    default: GROUND_DEFAULTS.matScale,
    group: "ground",
    range: { min: 0.25, max: 8, step: 0.25 },
  },
  groundMatRotationDeg: {
    type: "number",
    default: GROUND_DEFAULTS.matRotationDeg,
    group: "ground",
    // 角度域 [0,360]：实际归一靠 setter 的 360 回绕（非钳制），故入口钳制不会触发
    range: { min: 0, max: 360, step: 5, unit: "°" },
  },
  groundMatDensity: {
    type: "number",
    default: GROUND_DEFAULTS.matDensity,
    group: "ground",
    range: { min: 0.25, max: 8, step: 0.25 },
  },
  groundMatAngleDeg: {
    type: "number",
    default: GROUND_DEFAULTS.matAngleDeg,
    group: "ground",
    // 同 rotation：语义是回绕而非钳制
    range: { min: 0, max: 360, step: 5, unit: "°" },
  },
  groundMatRoughness: {
    type: "number",
    default: GROUND_DEFAULTS.matRoughness,
    group: "ground",
    range: { min: 0, max: 1, step: 0.05 },
  },
  groundMatMetalness: {
    type: "number",
    default: GROUND_DEFAULTS.matMetalness,
    group: "ground",
    range: { min: 0, max: 1, step: 0.05 },
  },

  // --- Water ---
  waterEnabled: { type: "boolean", default: true, group: "water" },
  waterMode: {
    type: "enum",
    values: ["film", "pool"] as const,
    default: "film",
    group: "water",
  },
  // ADR-257：水面世界 y 坐标——「抬高/压低水面」的唯一入口，film 与 pool 共用。
  // 默认 0.01 = film 历史水膜微抬量（原 scene-capability.ts|GROUND_LAYER_OFFSETS.waterFilm
  // 已随 2026-09-18 收口删除，此处成为唯一事实源）；本 schema 为零 THREE 依赖层，故写字面量。
  waterLevel: {
    type: "number",
    default: 0.01,
    group: "water",
    range: { min: 0, max: 5, step: 0.01, unit: "m" },
  },
  waterWetness: {
    type: "number",
    default: 0.5,
    group: "water",
    range: { min: 0, max: 1, step: 0.05 },
  },
  waterColor: { type: "number", default: 0x335577, group: "water" }, // 颜色：无值域语义，不声明 range
  waterOpacity: {
    type: "number",
    default: 0.25,
    group: "water",
    range: { min: 0, max: 1, step: 0.05 },
  },
  waterNormalStrength: {
    type: "number",
    default: 0.08,
    group: "water",
    range: { min: 0, max: 1, step: 0.05 },
  },
  waterClarity: {
    type: "number",
    default: 0.6,
    group: "water",
    range: { min: 0, max: 1, step: 0.05 },
  },
  waterWaveSpeed: {
    type: "number",
    default: 1.0,
    group: "water",
    range: { min: 0, max: 3, step: 0.05, unit: "x" },
  },
  waterChoppiness: {
    type: "number",
    default: 0.5,
    group: "water",
    range: { min: 0, max: 1, step: 0.05 },
  },
  waterPoolHeight: {
    type: "number",
    default: 0.3,
    group: "water",
    range: { min: 0.01, max: 5, step: 0.05, unit: "m" },
  },
  waterPoolWallThickness: {
    type: "number",
    default: 0.15,
    group: "water",
    range: { min: 0.01, max: 2, step: 0.01, unit: "m" },
  },
  waterPoolWallColor: { type: "number", default: 0x1a2a44, group: "water" }, // 颜色：同上
  waterPoolRoundness: {
    type: "number",
    default: 0,
    group: "water",
    range: { min: 0, max: 0.5, step: 0.01 },
  },
  // 合法域下界 = 1（0/负数会让水面退化成一个点；与 loadState 脏数据同口径）；
  // 展示域 10–300 是滑杆手感设计（默认 80 居中，step=1 避开小数累加误差）。
  waterSize: {
    type: "number",
    default: 80,
    group: "water",
    range: { min: 1, max: 300, step: 1, unit: "m" },
    uiRange: { min: 10, max: 300, step: 1, unit: "m" },
  },

  // --- Environment ---
  envPreset: {
    type: "enum",
    values: ["sky", "studio", "sunset", "night", "forest", "custom"] as const,
    default: "sky",
    group: "environment",
  },
  envIntensity: {
    type: "number",
    default: 1.0,
    group: "environment",
    // 合法域 [0,5]（写入钳制：HDR 环境常需 >3）；滑杆展示域 [0,3] 是手感设计（ADR-283 §2.2）
    range: { min: 0, max: 5, step: 0.05 },
    uiRange: { min: 0, max: 3, step: 0.05 },
  },
  envUseAsBackground: { type: "boolean", default: false, group: "environment" },
  envResolution: { type: "number", default: 1024, group: "environment" },

  // --- Fog ---
  fogEnabled: { type: "boolean", default: false, group: "fog" },
  fogMode: {
    type: "enum",
    values: ["linear", "exp2"] as const,
    default: "linear",
    group: "fog",
  },
  fogColor: { type: "number", default: 0xaac4e8, group: "fog" },
  fogDensity: {
    type: "number",
    default: 0.015,
    group: "fog",
    range: { min: 0.001, max: 0.1, step: 0.001 },
  },
  fogNear: {
    type: "number",
    default: 10,
    group: "fog",
    range: { min: 0, max: 500, step: 1 },
  },
  fogFar: {
    type: "number",
    default: 200,
    group: "fog",
    range: { min: 10, max: 2000, step: 10 },
  },

  // --- Shadow ---
  shadowEnabled: { type: "boolean", default: true, group: "shadow" },
  shadowType: {
    type: "enum",
    values: ["soft", "hard"] as const,
    default: "hard",
    group: "shadow",
  },
  shadowMapSize: { type: "number", default: 2048, group: "shadow" },
  shadowBias: { type: "number", default: -0.0005, group: "shadow" },
  shadowNormalBias: { type: "number", default: 0.02, group: "shadow" },
  shadowCameraSize: { type: "number", default: 15, group: "shadow" },

  // --- Reflector ---
  reflectorEnabled: { type: "boolean", default: false, group: "reflector" },
  reflectorOpacity: { type: "number", default: 0.6, group: "reflector" },
  reflectorResolution: { type: "number", default: 1024, group: "reflector" },
  reflectorSize: { type: "number", default: 100, group: "reflector" },
  reflectorColor: { type: "number", default: 0xffffff, group: "reflector" },
  reflectorClipBias: { type: "number", default: 0.003, group: "reflector" },

  // --- Render Mode ---
  renderModeWireframe: { type: "nullable-boolean", default: null, group: "renderMode" },
  renderModeBlending: { type: "nullable-number", default: null, group: "renderMode" },
  renderModeDepthTest: { type: "nullable-boolean", default: null, group: "renderMode" },
  renderModeSide: { type: "nullable-number", default: null, group: "renderMode" },
  renderModeDepthWrite: { type: "nullable-boolean", default: null, group: "renderMode" },

  // --- Postprocessing ---
  // [ADR-250] ppEnabled = 后处理启用意图，正式入 schema。
  //  历史：该语义曾以 `perTypeGate`（模型类别门禁）形式留 cap 私有，与「能力级挂载」混淆，
  //  导致模型切换翻转它 → composer 整组重建（缓存失效）+ exposure 属主争夺（亮度跳变）。
  //  降参后唯一真值在本层，cap 不再持有该字段，模型类别经 MODEL_DEFAULTS 写本键即可。
  ppEnabled: { type: "boolean", default: false, group: "postprocessing" },
  ppBloomEnabled: { type: "boolean", default: true, group: "postprocessing" },
  ppBloomStrength: { type: "number", default: 0.6, group: "postprocessing" },
  ppBloomThreshold: { type: "number", default: 0.6, group: "postprocessing" },
  ppBloomRadius: { type: "number", default: 0.5, group: "postprocessing" },
  ppBloomFollowVolumetric: { type: "boolean", default: true, group: "postprocessing" },
  ppSsaoEnabled: { type: "boolean", default: false, group: "postprocessing" },
  ppSsaoRadius: { type: "number", default: 8, group: "postprocessing" },
  ppSsaoMinDist: { type: "number", default: 0.005, group: "postprocessing" },
  ppSsaoMaxDist: { type: "number", default: 0.1, group: "postprocessing" },
  ppExposure: { type: "number", default: 1.0, group: "postprocessing" },
  ppToneMapping: {
    type: "enum",
    values: ["none", "linear", "reinhard", "aces", "cineon"] as const,
    default: "aces",
    group: "postprocessing",
  },
  ppReflectionMode: {
    type: "enum",
    values: ["envmap-only", "envmap+ssr", "ssr-only"] as const,
    default: "envmap-only",
    group: "postprocessing",
  },
  ppSsrOpacity: { type: "number", default: 0.5, group: "postprocessing" },
  ppSsrMaxDistance: { type: "number", default: 180, group: "postprocessing" },
  ppSsrThickness: { type: "number", default: 0.018, group: "postprocessing" },
  ppSsrBlur: { type: "boolean", default: true, group: "postprocessing" },
  ppSsrDistanceAttenuation: { type: "boolean", default: true, group: "postprocessing" },
  ppSsrFresnel: { type: "boolean", default: true, group: "postprocessing" },
  ppSsrBouncing: { type: "boolean", default: false, group: "postprocessing" },
  ppReflectorDisableWhenSSR: { type: "boolean", default: true, group: "postprocessing" },

  // --- Light ---
  // 统一灯光实例（[light-type-switch]）：每盏灯(key/fill/rim)可在
  // directional / point / spot 间切换，参数结构统一。
  // volume 参数仍独立（与任意 spot 灯绑定）。
  //
  // key 灯
  lightKeyType: {
    type: "enum",
    values: ["directional", "point", "spot"] as const,
    default: "directional",
    group: "light",
  },
  lightKeyEnabled: { type: "boolean", default: true, group: "light" },
  lightKeyColor: { type: "number", default: 0xffffff, group: "light" },
  lightKeyIntensity: {
    type: "number",
    default: 1.2,
    group: "light",
    range: { min: 0, max: 6, step: 0.1 },
  },
  lightKeyAzimuth: {
    type: "number",
    default: 30,
    group: "light",
    range: { min: -180, max: 180, step: 1, unit: "°" },
  },
  lightKeyElevation: {
    type: "number",
    default: 45,
    group: "light",
    range: { min: -90, max: 90, step: 1, unit: "°" },
  },
  lightKeyAngle: {
    type: "number",
    default: 25,
    group: "light",
    range: { min: 10, max: 70, step: 1, unit: "°" },
  },
  lightKeyPenumbra: {
    type: "number",
    default: 0.3,
    group: "light",
    range: { min: 0, max: 1, step: 0.05 },
  },
  lightKeyDistance: {
    type: "number",
    default: 30,
    group: "light",
    range: { min: 0, max: 200, step: 1 },
  },
  lightKeyDecay: {
    type: "number",
    default: 1.5,
    group: "light",
    range: { min: 0, max: 4, step: 0.1 },
  },
  // fill 灯
  lightFillType: {
    type: "enum",
    values: ["directional", "point", "spot"] as const,
    default: "directional",
    group: "light",
  },
  lightFillEnabled: { type: "boolean", default: true, group: "light" },
  lightFillColor: { type: "number", default: 0xffffff, group: "light" },
  lightFillIntensity: {
    type: "number",
    default: 0.4,
    group: "light",
    range: { min: 0, max: 6, step: 0.1 },
  },
  lightFillAzimuth: {
    type: "number",
    default: -30,
    group: "light",
    range: { min: -180, max: 180, step: 1, unit: "°" },
  },
  lightFillElevation: {
    type: "number",
    default: 20,
    group: "light",
    range: { min: -90, max: 90, step: 1, unit: "°" },
  },
  lightFillAngle: {
    type: "number",
    default: 25,
    group: "light",
    range: { min: 10, max: 70, step: 1, unit: "°" },
  },
  lightFillPenumbra: {
    type: "number",
    default: 0.3,
    group: "light",
    range: { min: 0, max: 1, step: 0.05 },
  },
  lightFillDistance: {
    type: "number",
    default: 30,
    group: "light",
    range: { min: 0, max: 200, step: 1 },
  },
  lightFillDecay: {
    type: "number",
    default: 1.5,
    group: "light",
    range: { min: 0, max: 4, step: 0.1 },
  },
  // rim 灯
  lightRimType: {
    type: "enum",
    values: ["directional", "point", "spot"] as const,
    default: "directional",
    group: "light",
  },
  lightRimEnabled: { type: "boolean", default: true, group: "light" },
  lightRimColor: { type: "number", default: 0xffffff, group: "light" },
  lightRimIntensity: {
    type: "number",
    default: 0.3,
    group: "light",
    range: { min: 0, max: 6, step: 0.1 },
  },
  lightRimAzimuth: {
    type: "number",
    default: 180,
    group: "light",
    range: { min: -180, max: 180, step: 1, unit: "°" },
  },
  lightRimElevation: {
    type: "number",
    default: 25,
    group: "light",
    range: { min: -90, max: 90, step: 1, unit: "°" },
  },
  lightRimAngle: {
    type: "number",
    default: 25,
    group: "light",
    range: { min: 10, max: 70, step: 1, unit: "°" },
  },
  lightRimPenumbra: {
    type: "number",
    default: 0.3,
    group: "light",
    range: { min: 0, max: 1, step: 0.05 },
  },
  lightRimDistance: {
    type: "number",
    default: 30,
    group: "light",
    range: { min: 0, max: 200, step: 1 },
  },
  lightRimDecay: {
    type: "number",
    default: 1.5,
    group: "light",
    range: { min: 0, max: 4, step: 0.1 },
  },
  // ambient
  lightAmbientColor: { type: "number", default: 0xffffff, group: "light" },
  lightAmbientIntensity: {
    type: "number",
    default: 0.5,
    group: "light",
    range: { min: 0, max: 2, step: 0.1 },
  },
  // volume（与任意 type=spot 的灯绑定）
  lightVolumetricEnabled: { type: "boolean", default: false, group: "light" },
  lightVolumetricOpacity: {
    type: "number",
    default: 0.45,
    group: "light",
    range: { min: 0, max: 1, step: 0.05 },
  },
  lightVolumetricFogPower: {
    type: "number",
    default: 1.5,
    group: "light",
    range: { min: 0.5, max: 3, step: 0.1 },
  },
  lightVolumetricEdgeFade: {
    type: "number",
    default: 0.4,
    group: "light",
    range: { min: 0, max: 1, step: 0.05 },
  },
  lightVolumetricBaseStrength: { type: "number", default: 0.9, group: "light" },
  lightVolumetricTipStrength: { type: "number", default: 0.25, group: "light" },
} as const satisfies Record<string, _AnyFieldDef>;

export type EnvStateSchema = typeof ENV_STATE_SCHEMA;

// ======== 默认值推导 ========

export function deriveDefaultEnvState(): EnvState {
  const out = {} as Record<string, unknown>;
  for (const [key, def] of Object.entries(ENV_STATE_SCHEMA)) {
    out[key] = def.type === "tuple3" ? (def.default as readonly number[]).slice() : def.default;
  }
  return out as unknown as EnvState;
}

// ======== Type 派生 ========

export type EnvState = {
  -readonly [K in keyof EnvStateSchema]: EnvStateSchema[K] extends {
    type: infer T;
    values?: infer V;
  }
    ? T extends "number"
      ? number
      : T extends "boolean"
        ? boolean
        : T extends "string"
          ? string
          : T extends "enum"
            ? V extends readonly string[]
              ? V[number]
              : string
            : T extends "tuple3"
              ? [number, number, number]
              : T extends "nullable-boolean"
                ? boolean | null
                : T extends "nullable-number"
                  ? number | null
                  : never
    : never;
};

/** envState 键域——派发层唯一合法键类型（changed.has 拼写错误由编译器拦截） */
export type EnvStateKey = keyof EnvState;

// ======== Dispatch Key 派生 ========

const _groupCache = new Map<string, EnvStateKey[]>();

export function getPresetKeys(group: string): EnvStateKey[] {
  const cached = _groupCache.get(group);
  if (cached) return cached;
  const keys: EnvStateKey[] = [];
  for (const [key, def] of Object.entries(ENV_STATE_SCHEMA)) {
    const g = (def as { group?: string | readonly string[] }).group;
    if (!g) continue;
    if (typeof g === "string" ? g === group : g.includes(group)) {
      keys.push(key as EnvStateKey);
    }
  }
  _groupCache.set(group, keys);
  return keys;
}

// ======== 值域读口（ADR-283）========

/** 声明了 `range` 的键域：菜单取值域的**类型入口**——未声明值域的键在编译期就传不进来。 */
export type RangedKey = {
  [K in EnvStateKey]: EnvStateSchema[K] extends { range: NumericRange } ? K : never;
}[EnvStateKey];

/** 菜单展示域：`uiRange ?? range`（合法域与展示域分离——ADR-283 §2.2）。 */
export function getParamRange(key: RangedKey): NumericRange {
  const def = ENV_STATE_SCHEMA[key] as { range: NumericRange; uiRange?: NumericRange };
  return def.uiRange ?? def.range;
}

/** 唯一写入口的值域钳制（ADR-283 §2.3）：声明了 `range` 的数值字段钳到合法域，其余原样返回。
 *  NaN → range.min（`clamp` 语义），Infinity → range.max。
 *  重载：传入可能缺失的 `Partial` 值（唯一写入口的 patch）时，undefined 原样短路。 */
export function clampFieldValue<K extends EnvStateKey>(key: K, value: EnvState[K]): EnvState[K];
export function clampFieldValue<K extends EnvStateKey>(
  key: K,
  value: EnvState[K] | undefined,
): EnvState[K] | undefined;
export function clampFieldValue(key: EnvStateKey, value: unknown): unknown {
  const range = (ENV_STATE_SCHEMA[key] as { range?: NumericRange }).range;
  if (range && typeof value === "number") return clamp(value, range.min, range.max);
  return value;
}
