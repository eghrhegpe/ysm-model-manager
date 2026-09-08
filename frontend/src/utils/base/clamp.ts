// utils/base/clamp.ts — 零依赖数学钳制叶子。
// 独立自 MikuMikuAR @/core/utils 去桶化（原误记 ADR-191，ADR-189 D5 更正）：纯几何/物理模块直接从此处导入，
// 避免从神桶拖起整套应用工具层。

/**
 * 将数值钳制到 [lo, hi] 区间
 * @param v 待钳制值（NaN → 返回 lo）
 * @param lo 下界
 * @param hi 上界（若 lo > hi 自动交换）
 * @returns 钳制后的值
 */
export function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  if (lo > hi) [lo, hi] = [hi, lo];
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 将数值钳制到 [0, 1] 区间
 * @param v 待钳制值
 * @returns 钳制后的值
 */
export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** 百分比钳制到 [0, 100]。 */
export function clampPct(v: number): number {
  return clamp(v, 0, 100);
}
