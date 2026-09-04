// ===== 虚拟滚动共享原语（定高行窗口化）=====
// 从 views/app-tree/virtual-scroll.ts 下沉（工坊模型列表复用，社区上线后条目可达 2000 级）。
// 消费方：app-tree（仓库树，topOffset=0）、community/virtual-list.ts（列表上方有
// toolbar/队列状态区，经 topOffset 补偿行起点偏移）。
// 前提：定高行；不等高布局（如创作者卡片网格）不适用，需分批渲染 + 哨兵续批。

/** 可见行缓冲：上下各多渲染 BUFFER 行，保证快速滚动不露白 */
const VS_BUFFER = 15;

/**
 * 根据滚动位置计算可见行范围。
 * @param scrollEl - 滚动容器（scrollTop/clientHeight 的宿主）
 * @param totalRows - 总行数
 * @param rowH - 单行高度（px，含 margin）
 * @param topOffset - 首行相对滚动内容顶部的偏移（列表上方有其他区块时传入）
 */
export function calcVisibleRange(
  scrollEl: HTMLElement,
  totalRows: number,
  rowH: number,
  topOffset = 0,
): { startIdx: number; endIdx: number } {
  const st = scrollEl.scrollTop - topOffset;
  const vh = scrollEl.clientHeight;
  const startIdx = Math.max(0, Math.floor(st / rowH) - VS_BUFFER);
  const endIdx = Math.min(totalRows, Math.ceil((st + vh) / rowH) + VS_BUFFER);
  return { startIdx, endIdx };
}

/**
 * 在滚动容器上安装监听，滚动时经 rAF 合并后触发重渲（一帧最多一次）。
 * @param scrollEl - 滚动容器
 * @param renderVisible - 重渲回调
 * @returns cleanup（同步取消已排队 rAF，防清理后幽灵渲染）
 */
export function installScrollSync(scrollEl: HTMLElement, renderVisible: () => void): () => void {
  let rafId: number | null = null;
  const handler = (): void => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      renderVisible();
    });
  };
  scrollEl.addEventListener("scroll", handler, { passive: true });
  return () => {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
    scrollEl.removeEventListener("scroll", handler);
  };
}
