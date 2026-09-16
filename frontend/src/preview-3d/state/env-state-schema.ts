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
  GROUND_OVERLAY_STYLES,
  GROUND_SOURCE_KINDS,
} from "@/preview-3d/caps/ground-surface-spec.ts";

type FieldDefaultMap = {
  number: number;
  boolean: boolean;
  string: string;
  enum: string;
  tuple3: readonly [number, number, number];
  "nullable-boolean": boolean | null;
  "nullable-number": number | null;
};

type _FieldDef<TType extends keyof FieldDefaultMap> = {
  type: TType;
  default: FieldDefaultMap[TType];
  /** dispatch 分组：字段变化时触发哪些 cap 回调。未指定 = 不触发。 */
  group?: string | readonly string[];
} & (TType extends "enum" ? { values: readonly string[] } : object);

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
  // ADR-249 §2.3 叠加层：独立透明格线层（正交于来源/样式两轴）
  groundOverlay: {
    type: "enum",
    values: GROUND_OVERLAY_STYLES,
    default: "none",
    group: "ground",
  },
  groundOverlayColor: { type: "number", default: 0xffffff, group: "ground" },
  groundOverlaySize: { type: "number", default: 10, group: "ground" },
  groundOverlayOpacity: { type: "number", default: 1, group: "ground" },
  groundSize: { type: "number", default: 80, group: "ground" },
  groundDivisions: { type: "number", default: 60, group: "ground" },
  groundColorCenter: { type: "number", default: 0x555577, group: "ground" },
  groundColorGrid: { type: "number", default: 0x2a2a3a, group: "ground" },
  // ADR-249 §2.6：默认值统一取自 spec（唯一事实源），不在此重写字面量。
  groundMatColor: { type: "number", default: GROUND_DEFAULTS.matColor, group: "ground" },
  groundMatColor2: { type: "number", default: GROUND_DEFAULTS.matColor2, group: "ground" },
  groundMatGridSize: { type: "number", default: GROUND_DEFAULTS.matGridSize, group: "ground" },
  groundMatOpacity: { type: "number", default: GROUND_DEFAULTS.matOpacity, group: "ground" },
  groundMatScale: { type: "number", default: GROUND_DEFAULTS.matScale, group: "ground" },
  groundMatRotationDeg: {
    type: "number",
    default: GROUND_DEFAULTS.matRotationDeg,
    group: "ground",
  },
  groundMatDensity: { type: "number", default: GROUND_DEFAULTS.matDensity, group: "ground" },
  groundMatAngleDeg: { type: "number", default: GROUND_DEFAULTS.matAngleDeg, group: "ground" },
  groundMatRoughness: { type: "number", default: GROUND_DEFAULTS.matRoughness, group: "ground" },
  groundMatMetalness: { type: "number", default: GROUND_DEFAULTS.matMetalness, group: "ground" },

  // --- Water ---
  waterEnabled: { type: "boolean", default: true, group: "water" },
  waterMode: {
    type: "enum",
    values: ["film", "pool"] as const,
    default: "film",
    group: "water",
  },
  waterWetness: { type: "number", default: 0.15, group: "water" },
  waterColor: { type: "number", default: 0x335577, group: "water" },
  waterOpacity: { type: "number", default: 0.25, group: "water" },
  waterNormalStrength: { type: "number", default: 0.08, group: "water" },
  waterClarity: { type: "number", default: 0.6, group: "water" },
  waterWaveSpeed: { type: "number", default: 1.0, group: "water" },
  waterPoolHeight: { type: "number", default: 0.3, group: "water" },
  waterPoolWallThickness: { type: "number", default: 0.15, group: "water" },
  waterPoolWallColor: { type: "number", default: 0x1a2a44, group: "water" },
  waterPoolRoundness: { type: "number", default: 0, group: "water" },
  waterSize: { type: "number", default: 80, group: "water" },

  // --- Environment ---
  envPreset: {
    type: "enum",
    values: ["sky", "studio", "sunset", "night", "forest", "custom"] as const,
    default: "sky",
    group: "environment",
  },
  envIntensity: { type: "number", default: 1.0, group: "environment" },
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
  fogDensity: { type: "number", default: 0.015, group: "fog" },
  fogNear: { type: "number", default: 10, group: "fog" },
  fogFar: { type: "number", default: 200, group: "fog" },

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
  // 注意：schema 键 = cap LightParams 扁平化（key/fill/rim 各含
  // enabled/color/intensity/azimuth/elevation；spotlight/volumetric 各自参数集）。
  // 颜色统一 number(hex)，与 cap 内部一致（勿用 tuple3）。
  // enabled(能力级) + currentPreset/manualPreset 运行时态不入 schema。
  // [ADR-246 D1] 原 volumetricEngine 运行时态随 postprocess 空壳引擎一并移除。
  lightKeyEnabled: { type: "boolean", default: true, group: "light" },
  lightKeyColor: { type: "number", default: 0xffffff, group: "light" },
  lightKeyIntensity: { type: "number", default: 1.2, group: "light" },
  lightKeyAzimuth: { type: "number", default: 30, group: "light" },
  lightKeyElevation: { type: "number", default: 45, group: "light" },
  lightFillEnabled: { type: "boolean", default: true, group: "light" },
  lightFillColor: { type: "number", default: 0xffffff, group: "light" },
  lightFillIntensity: { type: "number", default: 0.4, group: "light" },
  lightFillAzimuth: { type: "number", default: -30, group: "light" },
  lightFillElevation: { type: "number", default: 20, group: "light" },
  lightRimEnabled: { type: "boolean", default: true, group: "light" },
  lightRimColor: { type: "number", default: 0xffffff, group: "light" },
  lightRimIntensity: { type: "number", default: 0.3, group: "light" },
  lightRimAzimuth: { type: "number", default: 180, group: "light" },
  lightRimElevation: { type: "number", default: 25, group: "light" },
  lightAmbientColor: { type: "number", default: 0xffffff, group: "light" },
  lightAmbientIntensity: { type: "number", default: 0.5, group: "light" },
  lightSpotEnabled: { type: "boolean", default: false, group: "light" },
  lightSpotColor: { type: "number", default: 0xffffff, group: "light" },
  lightSpotIntensity: { type: "number", default: 2.0, group: "light" },
  lightSpotAngle: { type: "number", default: 25, group: "light" },
  lightSpotPenumbra: { type: "number", default: 0.3, group: "light" },
  lightSpotDistance: { type: "number", default: 30, group: "light" },
  lightSpotDecay: { type: "number", default: 1.5, group: "light" },
  lightVolumetricEnabled: { type: "boolean", default: false, group: "light" },
  lightVolumetricOpacity: { type: "number", default: 0.45, group: "light" },
  lightVolumetricFogPower: { type: "number", default: 1.5, group: "light" },
  lightVolumetricEdgeFade: { type: "number", default: 0.4, group: "light" },
  lightVolumetricBaseStrength: { type: "number", default: 0.9, group: "light" },
  lightVolumetricTipStrength: { type: "number", default: 0.25, group: "light" },
  // [ADR-246 D1] lightVolumetricEngine 已删除——postprocess 引擎为空壳（无任何体积光 pass），
  // 「cone/postprocess 切换」维度整体移除，回归单引擎。
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

// ======== Dispatch Key 派生 ========

const _groupCache = new Map<string, string[]>();

export function getPresetKeys(group: string): string[] {
  const cached = _groupCache.get(group);
  if (cached) return cached;
  const keys: string[] = [];
  for (const [key, def] of Object.entries(ENV_STATE_SCHEMA)) {
    const g = (def as { group?: string | readonly string[] }).group;
    if (!g) continue;
    if (typeof g === "string" ? g === group : g.includes(group)) {
      keys.push(key);
    }
  }
  _groupCache.set(group, keys);
  return keys;
}
