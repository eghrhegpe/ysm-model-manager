// ===== Stagger 延迟计算工具（类型化版 — ADR-014 P2）=====
// 统一所有 stagger 入场动画的延迟计算
// 用法: style="animation-delay:${stagger(i)}ms"

/**
 * @param index - 当前项索引（从 0 开始）
 * @param step - 每项间隔毫秒数（默认 30ms）
 * @param max - 最大延迟毫秒数（默认 300ms）
 * @returns 延迟毫秒数
 */
export const stagger = (index: number, step = 30, max = 300): number =>
  Math.min(index * step, max);
