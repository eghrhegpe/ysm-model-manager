// ===== 统一场景状态 Schema（ADR-196 刀 0）=====
// 收口全部 cap 参数声明：类型 + 默认值 + dispatch 组。
// 仿 MikuMikuAR ENV_STATE_SCHEMA 模式，新增字段只需在此追加。

type FieldDefaultMap = {
  number: number;
  boolean: boolean;
  string: string;
  enum: string;
  tuple3: readonly [number, number, number];
};

type _FieldDef<TType extends keyof FieldDefaultMap> = {
  type: TType;
  default: FieldDefaultMap[TType];
  /** dispatch 分组：字段变化时触发哪些 cap 回调。未指定 = 不触发。 */
  group?: string | readonly string[];
} & (TType extends 'enum' ? { values: readonly string[] } : object);

type _AnyFieldDef = {
  [TType in keyof FieldDefaultMap]: _FieldDef<TType>;
}[keyof FieldDefaultMap];

// ======== Schema 定义 ========
// 按 sky / ground / water / environment / fog / shadow / reflector / postprocessing / light 分组

export const ENV_STATE_SCHEMA = {
  // --- Sky ---
  skyTimeOfDay: { type: 'number', default: 9, group: 'sky' },
  skyCloudCoverage: { type: 'number', default: 0, group: 'sky' },
  skyElevation: { type: 'number', default: 10, group: 'sky' },
  skyAzimuth: { type: 'number', default: 180, group: 'sky' },
  skyForceEnv: { type: 'boolean', default: true, group: 'sky' },
  skyTurbidity: { type: 'number', default: 7.5, group: 'sky' },
  skyRayleigh: { type: 'number', default: 2.5, group: 'sky' },
  skyMieCoefficient: { type: 'number', default: 0.005, group: 'sky' },
  skyMieDirectionalG: { type: 'number', default: 0.8, group: 'sky' },
  skySunIntensityScale: { type: 'number', default: 0.75, group: 'sky' },
  skySunDiscScale: { type: 'number', default: 0.5, group: 'sky' },
  skyExposure: { type: 'number', default: 0.5, group: 'sky' },
  skyEnvironment: { type: 'boolean', default: true, group: 'sky' },
  skyGodRaysEnabled: { type: 'boolean', default: false, group: 'sky' },
  skyAutoRotate: { type: 'boolean', default: false, group: 'sky' },
  skyScale: { type: 'number', default: 12000, group: 'sky' },

  // --- Ground ---
  groundVisible: { type: 'boolean', default: true, group: 'ground' },
  groundType: {
    type: 'enum',
    values: ['plain', 'grid', 'checker', 'lines', 'dots'] as const,
    default: 'plain',
    group: 'ground',
  },
  groundColor: {
    type: 'tuple3',
    default: [0.15, 0.15, 0.18] as [number, number, number],
    group: 'ground',
  },
  groundLineColor: {
    type: 'tuple3',
    default: [0.5, 0.5, 0.55] as [number, number, number],
    group: 'ground',
  },
  groundMatSource: {
    type: 'enum',
    values: ['none', 'solid', 'plain', 'grid', 'checker', 'texture', 'stripes', 'diamond', 'marble'] as const,
    default: 'none',
    group: 'ground',
  },
  groundSize: { type: 'number', default: 80, group: 'ground' },
  groundDivisions: { type: 'number', default: 60, group: 'ground' },
  groundColorCenter: { type: 'number', default: 0x555577, group: 'ground' },
  groundColorGrid: { type: 'number', default: 0x2a2a3a, group: 'ground' },
  groundMatColor: { type: 'number', default: 0x9a8b78, group: 'ground' },
  groundMatLineColor: { type: 'number', default: 0x5a4b3a, group: 'ground' },
  groundMatColor2: { type: 'number', default: 0x7a6b5a, group: 'ground' },
  groundMatGridSize: { type: 'number', default: 10, group: 'ground' },
  groundMatOpacity: { type: 'number', default: 1.0, group: 'ground' },
  groundMatScale: { type: 'number', default: 1.0, group: 'ground' },
  groundMatRotationDeg: { type: 'number', default: 0, group: 'ground' },
  groundMatDensity: { type: 'number', default: 1.0, group: 'ground' },
  groundMatAngleDeg: { type: 'number', default: 0, group: 'ground' },
  groundMatRoughness: { type: 'number', default: 0.8, group: 'ground' },
  groundMatMetalness: { type: 'number', default: 0.0, group: 'ground' },

  // --- Water ---
  waterEnabled: { type: 'boolean', default: true, group: 'water' },
  waterMode: {
    type: 'enum',
    values: ['film', 'pool'] as const,
    default: 'film',
    group: 'water',
  },
  waterWetness: { type: 'number', default: 0.15, group: 'water' },
  waterColor: {
    type: 'tuple3',
    default: [0.2, 0.3, 0.45] as [number, number, number],
    group: 'water',
  },
  waterOpacity: { type: 'number', default: 0.25, group: 'water' },
  waterNormalStrength: { type: 'number', default: 0.08, group: 'water' },
  waterClarity: { type: 'number', default: 0.6, group: 'water' },
  waterWaveSpeed: { type: 'number', default: 1.0, group: 'water' },
  waterPoolHeight: { type: 'number', default: 0.3, group: 'water' },
  waterPoolWallThickness: { type: 'number', default: 0.15, group: 'water' },
  waterPoolWallColor: {
    type: 'tuple3',
    default: [0.1, 0.16, 0.27] as [number, number, number],
    group: 'water',
  },
  waterPoolRoundness: { type: 'number', default: 0, group: 'water' },
  waterSize: { type: 'number', default: 80, group: 'water' },

  // --- Environment ---
  envPreset: {
    type: 'enum',
    values: ['sky', 'studio', 'sunset', 'night', 'forest', 'custom'] as const,
    default: 'sky',
    group: 'environment',
  },
  envIntensity: { type: 'number', default: 1.0, group: 'environment' },
  envUseAsBackground: { type: 'boolean', default: false, group: 'environment' },
  envResolution: { type: 'number', default: 1024, group: 'environment' },

  // --- Fog ---
  fogEnabled: { type: 'boolean', default: false, group: 'fog' },
  fogMode: {
    type: 'enum',
    values: ['linear', 'exp2'] as const,
    default: 'linear',
    group: 'fog',
  },
  fogColor: { type: 'number', default: 0xaac4e8, group: 'fog' },
  fogDensity: { type: 'number', default: 0.015, group: 'fog' },
  fogNear: { type: 'number', default: 10, group: 'fog' },
  fogFar: { type: 'number', default: 200, group: 'fog' },

  // --- Shadow ---
  shadowEnabled: { type: 'boolean', default: true, group: 'shadow' },
  shadowType: {
    type: 'enum',
    values: ['soft', 'hard'] as const,
    default: 'hard',
    group: 'shadow',
  },
  shadowMapSize: { type: 'number', default: 2048, group: 'shadow' },
  shadowBias: { type: 'number', default: -0.0005, group: 'shadow' },
  shadowNormalBias: { type: 'number', default: 0.02, group: 'shadow' },
  shadowCameraSize: { type: 'number', default: 15, group: 'shadow' },

  // --- Reflector ---
  reflectorEnabled: { type: 'boolean', default: false, group: 'reflector' },
  reflectorOpacity: { type: 'number', default: 0.6, group: 'reflector' },
  reflectorResolution: { type: 'number', default: 1024, group: 'reflector' },
  reflectorSize: { type: 'number', default: 100, group: 'reflector' },
  reflectorColor: { type: 'number', default: 0xffffff, group: 'reflector' },
  reflectorClipBias: { type: 'number', default: 0.003, group: 'reflector' },

  // --- Postprocessing ---
  ppEnabled: { type: 'boolean', default: true, group: 'postprocessing' },
  ppBloomEnabled: { type: 'boolean', default: true, group: 'postprocessing' },
  ppBloomIntensity: { type: 'number', default: 0.8, group: 'postprocessing' },
  ppBloomThreshold: { type: 'number', default: 0.85, group: 'postprocessing' },
  ppSsaoEnabled: { type: 'boolean', default: false, group: 'postprocessing' },
  ppSsaoIntensity: { type: 'number', default: 1.5, group: 'postprocessing' },
  ppExposure: { type: 'number', default: 1.0, group: 'postprocessing' },
  ppToneMapping: {
    type: 'enum',
    values: ['none', 'aces', 'reinhard', 'cineon'] as const,
    default: 'aces',
    group: 'postprocessing',
  },

  // --- Light ---
  lightKeyIntensity: { type: 'number', default: 1.0, group: 'light' },
  lightKeyColor: {
    type: 'tuple3',
    default: [1.0, 0.95, 0.85] as [number, number, number],
    group: 'light',
  },
  lightFillIntensity: { type: 'number', default: 0.5, group: 'light' },
  lightFillColor: {
    type: 'tuple3',
    default: [0.85, 0.9, 1.0] as [number, number, number],
    group: 'light',
  },
  lightRimIntensity: { type: 'number', default: 0.3, group: 'light' },
  lightRimColor: {
    type: 'tuple3',
    default: [1.0, 0.8, 0.6] as [number, number, number],
    group: 'light',
  },
  lightAmbientIntensity: { type: 'number', default: 0.3, group: 'light' },
  lightDirectionalIntensity: { type: 'number', default: 1.0, group: 'light' },
} as const satisfies Record<string, _AnyFieldDef>;

export type EnvStateSchema = typeof ENV_STATE_SCHEMA;

// ======== 默认值推导 ========

export function deriveDefaultEnvState(): EnvState {
  const out = {} as Record<string, unknown>;
  for (const [key, def] of Object.entries(ENV_STATE_SCHEMA)) {
    out[key] = def.type === 'tuple3' ? (def.default as readonly number[]).slice() : def.default;
  }
  return out as unknown as EnvState;
}

// ======== Type 派生 ========

export type EnvState = {
  -readonly [K in keyof EnvStateSchema]: EnvStateSchema[K] extends { type: infer T; values?: infer V }
    ? T extends 'number'
      ? number
      : T extends 'boolean'
        ? boolean
        : T extends 'string'
          ? string
          : T extends 'enum'
            ? V extends readonly string[] ? V[number] : string
            : T extends 'tuple3'
              ? [number, number, number]
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
    if (typeof g === 'string' ? g === group : g.includes(group)) {
      keys.push(key);
    }
  }
  _groupCache.set(group, keys);
  return keys;
}
