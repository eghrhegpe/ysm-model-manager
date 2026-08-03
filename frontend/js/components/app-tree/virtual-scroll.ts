// ===== 虚拟滚动核心 =====
// 支持动态行高：grid=28px, list=24px
export const ROW_H_GRID = 28;
export const ROW_H_LIST = 24;
export const BUFFER = 15;

/**
 * 根据滚动位置计算可见行范围（支持动态行高）
 * @param container - 滚动容器
 * @param totalRows - 总行数
 * @param rowH - 单行高度（px）
 */
export function calcVisibleRange(
  container: HTMLElement,
  totalRows: number,
  rowH = ROW_H_GRID,
): { startIdx: number; endIdx: number } {
  const st = container.scrollTop;
  const vh = container.clientHeight;
  const startIdx = Math.max(0, Math.floor(st / rowH) - BUFFER);
  const endIdx = Math.min(totalRows, Math.ceil((st + vh) / rowH) + BUFFER);
  return { startIdx, endIdx };
}

/**
 * 在容器上安装滚动监听，当滚动到新范围时自动重新渲染可见行
 * @param container - 滚动容器（#tree）
 * @param renderVisible - (startIdx, endIdx) => void
 */
export function installScrollSync(
  container: HTMLElement,
  renderVisible: () => void,
): () => void {
  let rafId: number | null = null;
  const handler = (): void => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      renderVisible();
    });
  };
  container.addEventListener("scroll", handler, { passive: true });
  return () => container.removeEventListener("scroll", handler);
}
