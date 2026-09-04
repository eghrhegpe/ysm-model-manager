// ===== LightCapability 预设层（ADR-177 拆分：职责③数据面）=====
// 从 light-capability.ts 抽离：参数类型、默认值、模型类别预设、合并函数。
// 行为与原实现逐字节一致；light-capability.ts 经 `export *` 重导出本文件全部符号，
// 外部 import（screenshot-lights.ts 的 DirectionalLightParams）零改动。

/* ============ 参数类型 ============ */

/** 递归 Partial：允许任意深度只传子集字段 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface DirectionalLightParams {
  enabled: boolean;
  color: number;
  intensity: number;
  /** 方位角（度，0=+X 东，90=+Z 南，180=-X 西，270=-Z 北；Y-up 坐标系） */
  azimuth: number;
  /** 仰角（度，0=水平，90=正上；负值=地面下） */
  elevation: number;
}

export interface AmbientLightParams {
  color: number;
  intensity: number;
}

export interface SpotlightParams {
  enabled: boolean;
  color: number;
  intensity: number;
  /** 锥角半角（度，越大越宽） */
  angle: number;
  /** 半影（0=硬边，1=全软边） */
  penumbra: number;
  /** 衰减距离 */
  distance: number;
  /** 衰减指数（0=无衰减，2=经典物理衰减） */
  decay: number;
}

export interface VolumetricParams {
  enabled: boolean;
  /** 最大透明度 */
  opacity: number;
  /** 空气散射幂次（越大衰减越陡，越集中底部） */
  fogPower: number;
  /** 边缘羽化（0=无，1=完全透明边缘） */
  edgeFade: number;
  /** 底部强度（光落在对象上） */
  baseStrength: number;
  /** 顶部强度（光源附近） */
  tipStrength: number;
}

export interface LightParams {
  key: DirectionalLightParams;
  fill: DirectionalLightParams;
  rim: DirectionalLightParams;
  ambient: AmbientLightParams;
  spotlight: SpotlightParams;
  volumetric: VolumetricParams;
}

/* ============ 默认值与预设 ============ */

const DEFAULT_KEY: DirectionalLightParams = {
  enabled: true,
  color: 0xffffff,
  intensity: 1.2,
  azimuth: 30,
  elevation: 45,
};
const DEFAULT_FILL: DirectionalLightParams = {
  enabled: true,
  color: 0xffffff,
  intensity: 0.4,
  azimuth: -30,
  elevation: 20,
};
const DEFAULT_RIM: DirectionalLightParams = {
  enabled: true,
  color: 0xffffff,
  intensity: 0.3,
  azimuth: 180,
  elevation: 25,
};
const DEFAULT_AMBIENT: AmbientLightParams = { color: 0xffffff, intensity: 0.5 };
const DEFAULT_SPOTLIGHT: SpotlightParams = {
  enabled: false,
  color: 0xffffff,
  intensity: 2.0,
  angle: 25,
  penumbra: 0.3,
  distance: 30,
  decay: 1.5,
};
const DEFAULT_VOLUMETRIC: VolumetricParams = {
  enabled: false,
  opacity: 0.45,
  fogPower: 1.5,
  edgeFade: 0.4,
  baseStrength: 0.9,
  tipStrength: 0.25,
};

export const DEFAULT_LIGHT_PARAMS: LightParams = {
  key: { ...DEFAULT_KEY },
  fill: { ...DEFAULT_FILL },
  rim: { ...DEFAULT_RIM },
  ambient: { ...DEFAULT_AMBIENT },
  spotlight: { ...DEFAULT_SPOTLIGHT },
  volumetric: { ...DEFAULT_VOLUMETRIC },
};

/** 模型类别预设（对齐 SkyCapability.MODEL_SKY_PRESETS 模式） */
export const LIGHT_PRESETS: Record<string, Partial<LightParams>> = {
  default: {
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false },
  },
  ysm: {
    // 方块哑光，rim增强方块边缘识别
    key: { ...DEFAULT_KEY, intensity: 1.3 },
    fill: { ...DEFAULT_FILL, intensity: 0.5 },
    rim: { ...DEFAULT_RIM, intensity: 0.45 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false, intensity: 1.8, angle: 30, penumbra: 0.4 },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false, opacity: 0.4, fogPower: 1.2 },
  },
  vrm: {
    // PBR 角色，rim 稍强勾勒轮廓
    key: { ...DEFAULT_KEY, intensity: 1.0 },
    fill: { ...DEFAULT_FILL, intensity: 0.5 },
    rim: { ...DEFAULT_RIM, intensity: 0.6 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false, intensity: 1.5, angle: 28 },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false },
  },
  mmd: {
    // toon 材质易过曝，整体降 30%
    key: { ...DEFAULT_KEY, intensity: 0.85 },
    fill: { ...DEFAULT_FILL, intensity: 0.3 },
    rim: { ...DEFAULT_RIM, intensity: 0.25 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false, intensity: 1.4 },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false },
  },
  litematic: {
    // 体素，均匀光照
    key: { ...DEFAULT_KEY, intensity: 1.0, azimuth: 45, elevation: 60 },
    fill: { ...DEFAULT_FILL, intensity: 0.4, azimuth: -45, elevation: 30 },
    rim: { ...DEFAULT_RIM, intensity: 0.3, azimuth: 135, elevation: 30 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false },
  },
  resourcepack: {
    // MC 方块/物品，顶光稍柔（alias for pack-model 兼容 adapter.id）
    key: { ...DEFAULT_KEY, intensity: 1.3 },
    fill: { ...DEFAULT_FILL, intensity: 0.4 },
    rim: { ...DEFAULT_RIM, intensity: 0.35 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false, intensity: 1.8, angle: 30 },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false, opacity: 0.4 },
  },
  "mmd-scene": {
    // 场景模型：光照更均匀，体积光锥启用营造氛围
    key: { ...DEFAULT_KEY, intensity: 1.2 },
    fill: { ...DEFAULT_FILL, intensity: 0.55 },
    rim: { ...DEFAULT_RIM, intensity: 0.4 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false, intensity: 1.6, angle: 40, penumbra: 0.6 },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false, opacity: 0.35, fogPower: 1.0 },
  },
};

/* ============ 合并工具 ============ */

export function deepMergeLightParams(
  base: LightParams,
  override: DeepPartial<LightParams>,
): LightParams {
  const mergeDir = (
    a: DirectionalLightParams,
    b?: Partial<DirectionalLightParams>,
  ): DirectionalLightParams => ({ ...a, ...b }) as DirectionalLightParams;
  const mergeAmb = (a: AmbientLightParams, b?: Partial<AmbientLightParams>): AmbientLightParams =>
    ({ ...a, ...b }) as AmbientLightParams;
  const mergeSpot = (a: SpotlightParams, b?: Partial<SpotlightParams>): SpotlightParams =>
    ({ ...a, ...b }) as SpotlightParams;
  const mergeVol = (a: VolumetricParams, b?: Partial<VolumetricParams>): VolumetricParams =>
    ({ ...a, ...b }) as VolumetricParams;

  return {
    key: mergeDir(base.key, override.key),
    fill: mergeDir(base.fill, override.fill),
    rim: mergeDir(base.rim, override.rim),
    ambient: mergeAmb(base.ambient, override.ambient),
    spotlight: mergeSpot(base.spotlight, override.spotlight),
    volumetric: mergeVol(base.volumetric, override.volumetric),
  };
}
