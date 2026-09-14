// ===== 水面能力状态层（拆轴自 water-capability.ts）=====
// 收口「巨型 cap 混装状态与 Three 装配」的锐评结论：本文件收敛纯类型轴，零 THREE 依赖、
// 无顶层副作用；water-capability.ts 保留波浪 shader / 法线贴图 / 容器装配等渲染轴。
//
// ⚠️ 刀⑳：`WaterParams` 接口与 `DEFAULT_WATER_PARAMS` 已删除——ADR-196 把 cap 参数
// 统一收口到 `state/env-state-schema.ts|ENV_STATE_SCHEMA` 后，二者**零消费者**
// （仅靠 check-orphan-exports 的 `DEFAULT_*_PARAMS` 豁免规则遮蔽）。默认值现由
// schema 的 `water*` 键承担，是唯一事实源；此处只留真正被消费的 WaterMode / WATER_MODES。

/** 水面呈现模式：film=贴地薄水膜；pool=立体水池（有侧壁 + 高度） */
export type WaterMode = "film" | "pool";

export const WATER_MODES: readonly WaterMode[] = ["film", "pool"];
