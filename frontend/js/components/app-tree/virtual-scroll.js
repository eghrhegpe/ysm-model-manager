// ===== 虚拟滚动核心 =====
// 固定行高 28px，上下各缓存 15 行
export const ROW_H = 28;
export const BUFFER = 15;

/**
 * 根据滚动位置计算可见行范围
 * @param {Element} container - 滚动容器
 * @param {number} totalRows - 总行数
 * @returns {{ startIdx: number, endIdx: number }}
 */
export function calcVisibleRange(container, totalRows) {
  const st = container.scrollTop;
  const vh = container.clientHeight;
  const startIdx = Math.max(0, Math.floor(st / ROW_H) - BUFFER);
  const endIdx = Math.min(totalRows, Math.ceil((st + vh) / ROW_H) + BUFFER);
  return { startIdx, endIdx };
}

/**
 * 在容器上安装滚动监听，当滚动到新范围时自动重新渲染可见行
 * @param {Element} container - 滚动容器（#tree）
 * @param {Function} renderVisible - (startIdx, endIdx) => void
 */
export function installScrollSync(container, renderVisible) {
  let rafId = null;
  const handler = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      renderVisible();
    });
  };
  container.addEventListener("scroll", handler, { passive: true });
  return () => container.removeEventListener("scroll", handler);
}
