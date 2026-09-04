// ===== 环境能力状态/序列化层（拆轴自 environment-capability.ts）=====
// 收口「巨型 cap 混装状态与 Three 装配」的锐评结论：本文件收敛纯数据 + 纯类型轴
// （EnvPresetId / EnvPreset / ENV_PRESETS / EnvPresetLinkage / ENV_PRESET_LINKAGE /
// EnvironmentParams / 默认值 / 模型映射），零 THREE 依赖、无顶层副作用；
// environment-capability.ts 保留 envMap 管线 / PMREM / canvas equirect 绘制 / HDR 加载等渲染轴。
// 注意：sky-capability.ts 亦跨文件消费 ENV_PRESETS（sunPos 口径对齐），下沉后 import 路径更短。

export type EnvPresetId = "sky" | "studio" | "sunset" | "night" | "forest" | "custom";

export interface EnvPreset {
  id: Exclude<EnvPresetId, "custom">;
  label: string;
  /** 顶部天空色（y=+1 方向） */
  zenith: number;
  /** 地平线色（y≈0 方向） */
  horizon: number;
  /** 底部地面色（y=-1 方向） */
  nadir: number;
  /** 太阳/主光源色 */
  sunColor: number;
  /** 太阳/主光源在 equirect 上的归一化位置（x: 0~1 经度, y: 0~1 纬度，0=底 1=顶） */
  sunPos: { x: number; y: number };
  /** 太阳半径（归一化，0~0.2） */
  sunRadius: number;
  /** 云/光斑层数（0~3） */
  hazeLayers: number;
  /** 默认 envMapIntensity（0~3） */
  defaultIntensity: number;
}

export const ENV_PRESETS: Record<Exclude<EnvPresetId, "custom">, EnvPreset> = {
  sky: {
    id: "sky", label: "天空（跟随 SkyCapability）",
    zenith: 0x0b5ea8, horizon: 0x78a7e6, nadir: 0xb8d0ec,
    sunColor: 0xfff1c0, sunPos: { x: 0.25, y: 0.75 }, sunRadius: 0.05,
    hazeLayers: 1, defaultIntensity: 1.0,
  },
  studio: {
    id: "studio", label: "工作室",
    zenith: 0xcfd8e5, horizon: 0xeef2f7, nadir: 0x8a95a8,
    sunColor: 0xfff4e2, sunPos: { x: 0.3, y: 0.7 }, sunRadius: 0.1,
    hazeLayers: 3, defaultIntensity: 1.6,
  },
  sunset: {
    id: "sunset", label: "日落",
    zenith: 0x2a1855, horizon: 0xff8a5c, nadir: 0xffd28f,
    sunColor: 0xffe0a8, sunPos: { x: 0.5, y: 0.2 }, sunRadius: 0.12,
    hazeLayers: 2, defaultIntensity: 1.4,
  },
  night: {
    id: "night", label: "夜景",
    zenith: 0x02030a, horizon: 0x0e1530, nadir: 0x07091a,
    sunColor: 0xc8d4f0, sunPos: { x: 0.7, y: 0.82 }, sunRadius: 0.04,
    hazeLayers: 0, defaultIntensity: 0.7,
  },
  forest: {
    id: "forest", label: "森林",
    zenith: 0x1e4a3a, horizon: 0x6fa47a, nadir: 0x4a6b3a,
    sunColor: 0xd8f0a0, sunPos: { x: 0.2, y: 0.55 }, sunRadius: 0.06,
    hazeLayers: 2, defaultIntensity: 1.1,
  },
};

/**
 * 预设快捷联动表：选某预设时，除切 environment.preset 外，一并联动 sky/fog/env 参数，
 * 让「日落」「夜景」等预设呈现完整氛围，而非只换一张 envMap。
 *
 * 字段语义：
 *  - sky: { time, cloud } — 调 SkyCapability.setTime / setCloudCoverage
 *  - fog: { enabled, mode?, density?, near?, far? } — 调 FogCapability 对应 setter
 *  - envIntensity: number — 调 EnvironmentCapability.setIntensity
 *  - 仅列需要改的字段；未列的字段保持用户当前值（不覆盖）
 */
export interface EnvPresetLinkage {
  sky?: { time: number; cloud: number };
  fog?: {
    enabled: boolean;
    mode?: "linear" | "exp2";
    density?: number;
    near?: number;
    far?: number;
  };
  envIntensity?: number;
}

export const ENV_PRESET_LINKAGE: Record<Exclude<EnvPresetId, "custom">, EnvPresetLinkage> = {
  sky: {
    sky: { time: 9, cloud: 0.1 },
    envIntensity: 1.0,
  },
  studio: {
    sky: { time: 12, cloud: 0.0 },
    fog: { enabled: false },
    envIntensity: 1.6,
  },
  sunset: {
    sky: { time: 18, cloud: 0.6 },
    fog: { enabled: true, mode: "linear", density: 0.02, near: 50, far: 800 },
    envIntensity: 1.4,
  },
  night: {
    sky: { time: 22, cloud: 0.0 },
    fog: { enabled: true, mode: "exp2", density: 0.015 },
    envIntensity: 0.7,
  },
  forest: {
    sky: { time: 10, cloud: 0.4 },
    fog: { enabled: true, mode: "exp2", density: 0.03 },
    envIntensity: 1.1,
  },
};

export interface EnvironmentParams {
  enabled: boolean;
  preset: EnvPresetId;
  /** envMap 反射强度（作用于所有 mesh 的 material.envMapIntensity） */
  intensity: number;
  /** 程序化纹理分辨率（宽，高=宽/2）；越大过渡越平滑，512 足够 */
  resolution: number;
  /** 是否把当前环境贴图（HDR 原图/程序化 canvas）作为 scene.background */
  useAsBackground: boolean;
}

export const DEFAULT_ENV_PARAMS: EnvironmentParams = {
  enabled: true,
  preset: "sky",
  intensity: 1.0,
  resolution: 1024,
  useAsBackground: false,
};

/** 模型类别环境默认 preset（YSM 方块=sky，VRM/MMD=studio 柔光更友好，体素=forest） */
export const ENV_PRESET_BY_MODEL: Record<string, Partial<EnvironmentParams>> = {
  default: { preset: "sky", intensity: ENV_PRESETS.sky.defaultIntensity },
  ysm: { preset: "sky", intensity: 1.0 },
  vrm: { preset: "studio", intensity: ENV_PRESETS.studio.defaultIntensity },
  mmd: { preset: "studio", intensity: ENV_PRESETS.studio.defaultIntensity },
  "mmd-scene": { preset: "sky", intensity: 1.1 },
  litematic: { preset: "forest", intensity: ENV_PRESETS.forest.defaultIntensity },
  resourcepack: { preset: "sky", intensity: 1.0 },
};
