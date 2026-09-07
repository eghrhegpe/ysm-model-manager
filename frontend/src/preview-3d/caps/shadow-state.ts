// ===== 阴影能力状态/序列化层（拆轴自 shadow-capability.ts）=====
// 收口「巨型 cap 混装状态与 Three 装配」的锐评结论：本文件收敛纯数据 + 纯类型轴
// （ShadowParams / 默认值 / 预设表 / 模型映射），零 THREE 依赖、无顶层副作用；
// shadow-capability.ts 保留 renderer.shadowMap 装配 / 灯与 mesh 快照 / 释放还原等渲染轴。

export interface ShadowParams {
  /** 阴影总开关（默认 false：性能优先） */
  enabled: boolean;
  /** 阴影类型：hard（BasicShadowMap 硬阴影）/ soft（PCFSoftShadowMap 软阴影） */
  type: "hard" | "soft";
  /** shadow map 分辨率（方向灯/聚光灯共用），越大越清晰 */
  mapSize: number;
  /** shadow acne 修复（负值，越大越抑制 acne 但易产生 Peter-Panning） */
  bias: number;
  /** 法线偏移（防止阴影缝合面漏光/漏阴） */
  normalBias: number;
  /** 方向灯 shadow camera（正交）视锥大小，± 值；越大覆盖范围越广但精度下降 */
  cameraSize: number;
}

/** type 合法值白名单（loadState 枚举校验用） */
export const SHADOW_TYPES = ["hard", "soft"] as const satisfies readonly ShadowParams["type"][];

export const DEFAULT_SHADOW_PARAMS: ShadowParams = {
  enabled: false,
  type: "hard",
  mapSize: 1024,
  bias: -0.0005,
  normalBias: 0.02,
  cameraSize: 15,
};

// 注：SHADOW_PRESETS / SHADOW_PRESET_BY_MODEL（v1.14 风格预设表）已并入
// state/model-defaults.ts 的 MODEL_DEFAULTS，applyModelPreset 不再读此文件。
