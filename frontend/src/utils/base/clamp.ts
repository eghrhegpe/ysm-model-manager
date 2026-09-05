// utils/base/clamp.ts — 零依赖数学钳制叶子。
// 独立自 MikuMikuAR @/core/utils 去桶化（原误记 ADR-191，ADR-189 D5 更正）：纯几何/物理模块直接从此处导入，
// 避免从神桶拖起整套应用工具层。

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function clampInt(v: number, lo: number, hi: number): number {
  return Math.round(clamp(v, lo, hi));
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** 线性插值。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 逐元素线性插值数组。 */
export function lerpArray(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => lerp(v, b[i], t));
}

/** 百分比钳制到 [0, 100]。 */
export function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}
