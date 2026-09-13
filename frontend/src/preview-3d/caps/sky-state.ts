// ===== 天空能力状态/序列化层（拆轴自 sky-capability.ts）=====
// sky-capability.ts 原 942 行「薄封装」实际混装了状态定义与 Three 节点装配。
// 本文件收敛「纯数据 + 纯类型」轴（SkyParams / 默认值 / 模型预设），零 THREE 依赖、
// 无顶层副作用，可被测试独立 import；sky-capability.ts 保留 Sky 节点装配 / shader
// patch / God Rays / tone mapping 等渲染轴，仅 import 本文件的状态符号。

import type { RESOURCE_TYPES } from "@/utils/resource/types.ts";

export interface SkyParams {
  /** 太阳高度角（度，0=地平线，90=天顶） */
  elevation: number;
  /** 太阳方位角（度） */
  azimuth: number;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  /** 云量 0=晴空；默认 0（预览偏好干净天空） */
  cloudCoverage: number;
  /** 天空盒缩放（半边长须 > 相机 maxDistance；预览核心=5000 → 12000） */
  scale: number;
  /** 是否联动 IBL 环境贴图（scene.environment）。默认 true（2026-08-16 目视验证通过） */
  environment: boolean;
  /** 时间-of-day（小时 0-24），太阳方位/高度的单一事实来源；默认 9（上午，观感较佳） */
  timeOfDay: number;
  /** ACES 曝光（天空正确显色所需，同时影响模型观感） */
  exposure: number;
  /**
   * §4 解耦：Preetham 模型中天空底色 Lin 被 `vSunE × 太阳强度` 强耦合，
   * 正午 vSunE≈1000 会把整个天空散射炸白。此参数把 `vSunE` 缩放为 `vSunE × sunIntensityScale`，
   * 让天空色（蓝/橙/紫渐变）与太阳绝对亮度解耦。合理范围 0.5~1.0，默认 0.75。
   */
  sunIntensityScale: number;
  /**
   * §4 解耦：Preetham 太阳盘本身是 `vSunE × 19000` 的白光炸弹，经过 Bloom 会染白屏幕。
   * 此参数把 19000 缩放为 `19000 × sunDiscScale`，保留辨识度但压到不炸屏。
   * 合理范围 0.2~1.0，默认 0.5。
   */
  sunDiscScale: number;
}

export const DEFAULT_SKY_PARAMS: SkyParams = {
  elevation: 10,
  azimuth: 180,
  // §3 曝光治理：turbidity 10→7.5（雾霾天→通透蓝天）；rayleigh 2→2.5（蓝调更明显）
  // 前值 v1.14：turbidity=10 正午表现偏牛奶白，配合高曝光整片发白
  turbidity: 7.5,
  rayleigh: 2.5,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.8,
  cloudCoverage: 0,
  scale: 12000,
  environment: true,
  timeOfDay: 9,
  exposure: 0.5,
  // §4 解耦：默认 0.75 / 0.5，正午蓝天从 1000² 压到 750²（削 44%），太阳盘砍半
  sunIntensityScale: 0.75,
  sunDiscScale: 0.5,
};

/** 模型类别标识（取 PreviewAdapter.id：ysm/vrm/mmd/litematic） */
export type SkyModelType = typeof RESOURCE_TYPES.YSM | "vrm" | "mmd" | "litematic" | "default";
