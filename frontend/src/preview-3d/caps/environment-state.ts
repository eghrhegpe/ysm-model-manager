// ===== 环境能力状态/序列化层（拆轴自 environment-capability.ts）=====
// 收口「巨型 cap 混装状态与 Three 装配」的锐评结论：本文件收敛纯数据 + 纯类型轴
// （EnvPreset / ENV_PRESETS / EnvironmentParams；EnvPresetId 与每预设默认强度已下沉
//  state/env-preset-types.ts），零 THREE 依赖、无顶层副作用；
// environment-capability.ts 保留 envMap 管线 / PMREM / canvas equirect 绘制 / HDR 加载等渲染轴。
// 注意：sky-capability.ts 亦跨文件消费 ENV_PRESETS（sunPos 口径对齐），下沉后 import 路径更短。

// [锐评 2026-10-07] EnvPresetId 下沉至 state/env-preset-types.ts（切 state→caps 类型倒置，
// ADR-168 preview-paths 同法）；此处 import 引入作用域 + re-export 保公共面，既有消费方零改动。
import type { EnvPresetId, SelectableEnvPresetId } from "@/preview-3d/state/env-preset-types.ts";

export type { EnvPresetId, SelectableEnvPresetId };

export interface EnvPreset {
  id: SelectableEnvPresetId;
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
}

export const ENV_PRESETS: Record<SelectableEnvPresetId, EnvPreset> = {
  sky: {
    id: "sky",
    label: "天空（跟随 SkyCapability）",
    zenith: 0x0b5ea8,
    horizon: 0x78a7e6,
    nadir: 0xb8d0ec,
    sunColor: 0xfff1c0,
    sunPos: { x: 0.25, y: 0.75 },
    sunRadius: 0.05,
    hazeLayers: 1,
  },
  studio: {
    id: "studio",
    label: "工作室",
    zenith: 0xcfd8e5,
    horizon: 0xeef2f7,
    nadir: 0x8a95a8,
    sunColor: 0xfff4e2,
    sunPos: { x: 0.3, y: 0.7 },
    sunRadius: 0.1,
    hazeLayers: 3,
  },
  sunset: {
    id: "sunset",
    label: "日落",
    zenith: 0x2a1855,
    horizon: 0xff8a5c,
    nadir: 0xffd28f,
    sunColor: 0xffe0a8,
    sunPos: { x: 0.5, y: 0.2 },
    sunRadius: 0.12,
    hazeLayers: 2,
  },
  night: {
    id: "night",
    label: "夜景",
    zenith: 0x02030a,
    horizon: 0x0e1530,
    nadir: 0x07091a,
    sunColor: 0xc8d4f0,
    sunPos: { x: 0.7, y: 0.82 },
    sunRadius: 0.04,
    hazeLayers: 0,
  },
  forest: {
    id: "forest",
    label: "森林",
    zenith: 0x1e4a3a,
    horizon: 0x6fa47a,
    nadir: 0x4a6b3a,
    sunColor: 0xd8f0a0,
    sunPos: { x: 0.2, y: 0.55 },
    sunRadius: 0.06,
    hazeLayers: 2,
  },
};

/**
 * 注：EnvPresetLinkage / ENV_PRESET_LINKAGE 已由 atmosphere-presets.ts 的 ATMOSPHERE_PRESETS 取代
 * （完整氛围快照 + auto-atmosphere source + 统一 setEnvState 派发），旧硬编码联动表不再消费。
 */

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
