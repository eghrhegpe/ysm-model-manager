// ===== 天空能力状态/序列化层（拆轴自 sky-capability.ts）=====
// 锐评收口：sky-capability.ts 原 942 行「薄封装」实际混装了状态定义与 Three 节点装配。
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

/**
 * 按模型类别的散射/曝光预设（ADR-073 #3）。
 * 不同模型材质特性不同：VRM 为 PBR 角色、MMD 常带 toon/emissive 易过曝、
 * YSM/Litematic 为方块哑光。预设仅调散射与曝光，不改太阳位置（由 timeOfDay 控制）。
 * 数值为初始合理值，观感待目视微调。
 */
export const MODEL_SKY_PRESETS: Record<string, Partial<SkyParams>> = {
  // §3 曝光治理：各预设 turbidity 按原比例整体下调，rayleigh 同步上调，
  // 让正午 Preetham 天空从"牛奶白"回归"通透蓝天"，同时保持预设间原有的差异梯度。
  // §4 解耦：全部预设统一携带 sunIntensityScale / sunDiscScale（0.75/0.5 默认），
  // 后续目视验证后可按模型微调。
  default: {
    turbidity: 7.5,
    rayleigh: 2.5,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.8,
    exposure: 0.5,
    sunIntensityScale: 0.75,
    sunDiscScale: 0.5,
  },
  // VRM PBR 角色：原 turbidity=7 已偏低，再微调至 6；rayleigh 轻微上浮，蓝天当背景更衬肤色
  vrm: {
    turbidity: 6,
    rayleigh: 2.3,
    mieCoefficient: 0.004,
    mieDirectionalG: 0.85,
    exposure: 0.55,
    sunIntensityScale: 0.78,
    sunDiscScale: 0.55,
  },
  // MMD Toon：原 9→7.5（去雾霾感）；rayleigh 1.8→2.3（补回蓝色层次）；sunDiscScale 稍低（Toon 背景易白）
  mmd: {
    turbidity: 7.5,
    rayleigh: 2.3,
    mieCoefficient: 0.006,
    mieDirectionalG: 0.8,
    exposure: 0.55,
    sunIntensityScale: 0.72,
    sunDiscScale: 0.45,
  },
  // MMD 场景：原 14 极雾霾→10 正常云絮天；rayleigh 翻倍从 1.2→2.0，避免背景死白
  "mmd-scene": {
    turbidity: 10,
    rayleigh: 2.0,
    mieCoefficient: 0.008,
    mieDirectionalG: 0.75,
    exposure: 0.55,
    sunIntensityScale: 0.7,
    sunDiscScale: 0.45,
  },
  // YSM 方块：原 11→8.5；哑光方块需要更强的蓝白对比
  ysm: {
    turbidity: 8.5,
    rayleigh: 2.6,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.8,
    exposure: 0.6,
    sunIntensityScale: 0.75,
    sunDiscScale: 0.5,
  },
  // Litematic 体素：同 default，10→7.5
  litematic: {
    turbidity: 7.5,
    rayleigh: 2.5,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.8,
    exposure: 0.5,
    sunIntensityScale: 0.75,
    sunDiscScale: 0.5,
  },
};
