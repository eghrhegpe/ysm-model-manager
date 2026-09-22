// ===== 水面能力状态层（拆轴自 water-capability.ts）=====
// 收口「巨型 cap 混装状态与 Three 装配」的锐评结论：本文件收敛纯类型轴与共享常数，零 THREE 依赖、
// 无顶层副作用；water-capability.ts 保留波浪 shader / 微细节法线 / 容器装配等渲染轴。
//
// ⚠️ 刀⑳：`WaterParams` 接口与 `DEFAULT_WATER_PARAMS` 已删除——ADR-196 把 cap 参数
// 统一收口到 `state/env-state-schema.ts|ENV_STATE_SCHEMA` 后，二者**零消费者**
// （仅靠 check-orphan-exports 的 `DEFAULT_*_PARAMS` 豁免规则遮蔽）。默认值现由
// schema 的 `water*` 键承担，是唯一事实源；此处只留真正被消费的 WaterMode / WATER_MODES。

/** 水面呈现模式：film=贴地薄水膜；pool=立体水池（有侧壁 + 高度） */
export type WaterMode = "film" | "pool";

export const WATER_MODES: readonly WaterMode[] = ["film", "pool"];

/** 顶水面波浪顶点网格的分段数（PlaneGeometry 单边段数）——波场采样密度的唯一事实源。
 *  两处消费者必须同源（守卫 = water-capability.test.ts「分段数唯一事实源」用例）：
 *  ① 几何装配：water-body-strategies 的 film 顶面 / pool 顶面；
 *  ② shader 波幅抗锯齿：gerstner 内顶点间距 s = uSize / 本常数，每波长顶点数不足时
 *    高频波淡出（大水面混叠摩尔纹的处方，2026-09-22）。
 *  调大 = 高频波保留到更大尺寸但三角数平方上涨；调小 = 抗锯齿提前介入。 */
export const WATER_WAVE_SEGMENTS = 64;
