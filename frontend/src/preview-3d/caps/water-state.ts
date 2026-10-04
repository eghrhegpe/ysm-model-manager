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
 *  调大 = 高频波保留到更大尺寸但三角数平方上涨；调小 = 抗锯齿提前介入。
 *  ⚠️ 本常数与 WAVE_AA_FULL_VERTS 共同决定「淡出当前是否惰性」：D2 频谱锚定域宽后
 *  λ/spacing = 本常数/(4·1.19^i)（与 uSize 无关），64 时六波最小 6.70 ≥ 6 ⇒ aa 恒 1
 *  （惰性保险）；压到 ≤57 才会真正淡出高频——数值判据见
 *  water-capability.test.ts「波场守卫的真实性」describe。 */
export const WATER_WAVE_SEGMENTS = 64;

/** 波场退化门（锐评 2026-10-04 P0-1）：`wa = freq·amp` 低于本值的波整波跳过。
 *  背景：`amp = uWaveHeight·0.26·0.82^i·aa`，而 `uWaveHeight` 可为 0——浪高滑杆 min=0
 *  （schema waterWaveHeight.range）、水位归零 / pool 下水位 ≥ 池深都会让
 *  `water-params.ts|effectiveWaveHeight` 的预算归零。此时 `wa = 0` ⇒ 陡度式
 *  `0.8/(wa·6)` 得 +∞ ⇒ `steep·amp = ∞×0 = NaN` ⇒ 顶点坐标（transformed）与解析法线
 *  （objectNormal）双双污染 ⇒ 水面整块消失。**「1‰ 下界」救不了它**：那个下界加在 aa 上，
 *  而 amp 本身已是 0。唯一的出口是跳过该波（跳过后 nrm 保持 (0,0,1)、位移为 0 —— 平面水
 *  + 正确法线，静水态由此真正可达）。
 *  同源消费者：shader 注入串（本常量内插）、`scripts/probe-water-wave.ts|buildWaves`（同门）。 */
export const WAVE_DEGENERATE_WA = 1e-6;

/** Σσ·k 上限（防波面自交）：`steep` 的 clamp 上界 = 本值 / (wa·波数)，故 Σ(steep·wa) ≤ 本值。
 *  ⚠️ choppiness ∈ [0,1]（schema range）时 clamp 恒等（输入恰在 [0, 上界] 内）——它是
 *  **纵深防御**：只有 choppiness 越界（存档直写 / 未来放宽 range）才真正夹住。
 *  数值判据（含越界夹住的反证）见 water-capability.test.ts「波场守卫的真实性」。 */
export const WAVE_STEEP_SUM_LIMIT = 0.8;

/** 波陡基准尺寸（锐评 2026-10-04 P1-1）——`steep` 反归一的参考域宽，取 schema `waterSize` 的默认值。
 *  D2 让 λ ∝ uSize（频谱锚定域宽），而 Gerstner 的水平位移 `steep·amp ∝ 1/freq ∝ uSize`、与浪高解耦
 *  ⇒ 同一浪高在 size=10 与 300 下的水平摆动相差约 30 倍（实测 0.036 m ↔ 1.091 m，而垂直总振幅恒
 *  0.060 m）——大水面被「横向揉皱」。以本值为基准反归一（`steep` 乘 `本值/uSize`）后：
 *  默认档（80 m）**观感零变化**，且尺寸域内水平摆动恒定；只有小尺寸越过自交上界
 *  `WAVE_STEEP_SUM_LIMIT/(wa·N)` 时由该上界接管（物理约束，正确行为）。
 *  ⚠️ 必须与 `env-state-schema.ts|ENV_STATE_SCHEMA.waterSize.default` 同值（守卫 = 其测试断言两者相等）。 */
export const WAVE_STEEP_SIZE_REF = 80;

/** 波幅抗锯齿淡出的两个阈值（每波长顶点数 λ/spacing）：≥ FULL 全保留（aa = 1），
 *  在 MIN–FULL 之间线性消退；下方另有 1‰ 下界只保证 aa 非零，**不保证 wa > 0**（见
 *  WAVE_DEGENERATE_WA）。shader 注入串内插本对常量——菜单/测试/探针都只是读口。 */
export const WAVE_AA_MIN_VERTS = 2;
export const WAVE_AA_FULL_VERTS = 6;
