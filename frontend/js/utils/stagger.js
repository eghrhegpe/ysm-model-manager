// ===== Stagger 延迟计算工具 =====
// 统一所有 stagger 入场动画的延迟计算
// 用法: style="animation-delay:${stagger(i)}ms"

/**
 * @param {number} index - 当前项索引（从 0 开始）
 * @param {number} step - 每项间隔毫秒数（默认 30ms）
 * @param {number} max - 最大延迟毫秒数（默认 300ms）
 * @returns {number} 延迟毫秒数
 */
export const stagger = (index, step = 30, max = 300) =>
  Math.min(index * step, max);
