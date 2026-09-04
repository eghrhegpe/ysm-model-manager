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

export const DEFAULT_SHADOW_PARAMS: ShadowParams = {
  enabled: false,
  type: "hard",
  mapSize: 1024,
  bias: -0.0005,
  normalBias: 0.02,
  cameraSize: 15,
};

/** 预设（setPreset 套用到不同模型类别） */
export const SHADOW_PRESETS: Record<string, Partial<ShadowParams> | undefined> = {
  default: { type: "hard" },
  // v1.14: 启用 enabled:true；建筑类仍保持关闭以省 GPU
  prop: { enabled: true, type: "soft", mapSize: 2048, cameraSize: 10 },
  small: { enabled: true, type: "soft", mapSize: 1024, cameraSize: 12 },
  architecture: { enabled: false, type: "hard", mapSize: 1024, cameraSize: 40 },
  scene: { enabled: false, type: "hard", mapSize: 1024, cameraSize: 30 },
  character: { enabled: true, type: "soft", mapSize: 1024, cameraSize: 15 },
  creature: { enabled: true, type: "soft", mapSize: 1024, cameraSize: 18 },
};

/** 预设与模型类别的映射（无则落回 default） */
export const SHADOW_PRESET_BY_MODEL: Record<string, keyof typeof SHADOW_PRESETS> = {
  // 角色别名→character preset (soft shadow + 1024 res)
  mmd: "character",
  vrm: "character",
  ysm: "character",
  litematic: "character",
  prop: "prop",
  small: "small",
  architecture: "architecture",
  scene: "scene",
  character: "character",
  creature: "creature",
};
