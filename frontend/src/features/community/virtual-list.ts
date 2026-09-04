// ===== 定高虚拟列表（工坊模型列表窗口化）=====
// 社区上线后仓库模型索引可能顶到 2000 级，全量渲染 DOM 会爆炸。
// 策略：占位式——列表容器 paddingTop/Bottom 撑出总高，DOM 常驻仅可见切片 ± 缓冲行。
// 兼容零高度（jsdom/首帧 clientHeight=0）→ 自动降级全量渲染。
// 前提：定高行；不等高布局（如创作者卡片网格）不适用。
import { calcVisibleRange, installScrollSync } from "../../utils/dom/virtual-scroll.ts";

export interface VirtualListOpts<T> {
  /** 滚动容器 */
  scrollEl: HTMLElement;
  /** 列表容器（scrollEl 内，行的 DOM 宿主） */
  listEl: HTMLElement;
  /** 单行定高（px，含 padding/margin） */
  rowH: number;
  /** 单行构建器 */
  renderItem: (item: T) => HTMLElement;
  /** 空列表构建器（可选） */
  renderEmpty?: () => HTMLElement | null;
}

export interface VirtualList<T> {
  /** 数据变化后调用：内部自动切虚拟化/全量 */
  refresh(items: T[]): void;
  /** 卸载：移除滚动监听、清空容器 */
  destroy(): void;
}

/** 全量渲染阈值：行数低于此值不值得虚拟化 */
const FULL_RENDER_THRESHOLD = 60;

export function createVirtualList<T>(opts: VirtualListOpts<T>): VirtualList<T> {
  const { scrollEl, listEl, rowH, renderItem, renderEmpty } = opts;
  let items: T[] = [];
  let cleanupScroll: (() => void) | null = null;

  /** 列表在滚动内容中的顶部偏移（列表上方有 header/队列状态等区块时） */
  const listTopOffset = (): number =>
    listEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;

  const renderSlice = (): void => {
    const total = items.length;
    if (!total) {
      listEl.replaceChildren(renderEmpty?.() ?? document.createElement("div"));
      return;
    }
    const { startIdx, endIdx } = calcVisibleRange(scrollEl, total, rowH, listTopOffset());
    const frag = document.createDocumentFragment();
    for (let i = startIdx; i < endIdx; i++) frag.appendChild(renderItem(items[i]));
    listEl.style.paddingTop = `${startIdx * rowH}px`;
    listEl.style.paddingBottom = `${(total - endIdx) * rowH}px`;
    listEl.replaceChildren(frag);
  };

  const disposeScroll = (): void => {
    cleanupScroll?.();
    cleanupScroll = null;
  };

  const refresh = (next: T[]): void => {
    items = next;
    // 零高度（jsdom/首帧）或数据量小 → 全量渲染，跳过虚拟化
    if (scrollEl.clientHeight === 0 || items.length <= FULL_RENDER_THRESHOLD) {
      disposeScroll();
      listEl.style.paddingTop = "";
      listEl.style.paddingBottom = "";
      if (!items.length) {
        listEl.replaceChildren(renderEmpty?.() ?? document.createElement("div"));
      } else {
        const frag = document.createDocumentFragment();
        for (const item of items) frag.appendChild(renderItem(item));
        listEl.replaceChildren(frag);
      }
      return;
    }
    if (!cleanupScroll) cleanupScroll = installScrollSync(scrollEl, renderSlice);
    renderSlice();
  };

  const destroy = (): void => {
    disposeScroll();
    listEl.replaceChildren();
  };

  return { refresh, destroy };
}
