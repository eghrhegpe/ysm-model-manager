// ===== 定高虚拟列表测试 =====
// 覆盖：零高度全量回退 / 大数据切片渲染 + padding 撑高 / 滚动后窗口变化 / destroy 清理
import { describe, it, expect, vi, afterEach } from "vitest";
import { createVirtualList } from "./virtual-list.ts";

const ROW_H = 42;
const items = (n: number): string[] => Array.from({ length: n }, (_, i) => `m${i}`);

/** 滚动容器 viewport 位置（getBoundingClientRect.top 固定值，模拟真实浏览器） */
const SCROLL_TOP = 100;
/** 列表上方内容偏移（本测试为 0） */
const HEADER = 0;

/**
 * 构造滚动容器 + 列表容器。
 * jsdom 的 getBoundingClientRect 不随滚动更新，这里手动 mock：
 * listEl.top = SCROLL_TOP - scrollTop + HEADER（模拟真实滚动后子元素上移），
 * 使 topOffset 恒等于 HEADER，calcVisibleRange 的 st = scrollTop。
 */
function makeScroll(scrollTop: number, clientHeight: number) {
  const scrollEl = document.createElement("div");
  Object.defineProperty(scrollEl, "scrollTop", { value: scrollTop, writable: true });
  Object.defineProperty(scrollEl, "clientHeight", { value: clientHeight });
  const listEl = document.createElement("div");
  const mockRect = (top: number): DOMRect =>
    ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  scrollEl.getBoundingClientRect = () => mockRect(SCROLL_TOP);
  listEl.getBoundingClientRect = () =>
    mockRect(SCROLL_TOP - scrollEl.scrollTop + HEADER);
  return { scrollEl, listEl };
}

function setup(scrollTop: number, clientHeight: number, _rows: string[]) {
  const { scrollEl, listEl } = makeScroll(scrollTop, clientHeight);
  const vlist = createVirtualList<string>({
    scrollEl,
    listEl,
    rowH: ROW_H,
    renderItem: (m) => {
      const row = document.createElement("div");
      row.className = "gh-row";
      row.textContent = m;
      return row;
    },
  });
  return { scrollEl, listEl, vlist };
}

describe("createVirtualList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("零高度（jsdom/首帧）→ 全量渲染，无 padding", () => {
    const { listEl, vlist } = setup(0, 0, items(100));
    vlist.refresh(items(100));
    expect(listEl.childElementCount).toBe(100);
    expect(listEl.style.paddingTop).toBe("");
    expect(listEl.style.paddingBottom).toBe("");
  });

  it("数据量小（≤阈值）→ 全量渲染", () => {
    const { listEl, vlist } = setup(0, 560, items(10));
    vlist.refresh(items(10));
    expect(listEl.childElementCount).toBe(10);
  });

  it("大数据 + 有高度 → 只渲染可见切片，padding 撑出总高", () => {
    const rows = items(1000);
    const { listEl, vlist } = setup(0, 560, rows);
    vlist.refresh(rows);
    // 可见 560/42≈14 行 + 上下缓冲 15 → 顶部 startIdx=0，endIdx≈29
    const rendered = listEl.childElementCount;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(60); // 远小于 1000
    expect(listEl.style.paddingTop).toBe("0px");
    // paddingBottom = (1000 - endIdx) * 42
    expect(listEl.style.paddingBottom).toMatch(/^\d+px$/);
  });

  it("滚动到中部 → startIdx 前移（含缓冲），首行从中间开始", () => {
    const rows = items(1000);
    const { listEl, vlist } = setup(4200, 560, rows); // scrollTop=100 行
    vlist.refresh(rows);
    // startIdx = floor(4200/42) - 15 = 85
    expect(listEl.style.paddingTop).toBe(`${85 * 42}px`);
    // 首行应为 m85
    expect(listEl.firstElementChild?.textContent).toBe("m85");
  });

  it("空列表 → renderEmpty 兜底", () => {
    const { listEl, vlist } = setup(0, 560, []);
    vlist.refresh([]);
    expect(listEl.childElementCount).toBe(1);
  });

  it("destroy 清空列表且移除滚动监听（清理后 scroll 不再重渲）", async () => {
    const rows = items(1000);
    const { scrollEl, listEl, vlist } = setup(0, 560, rows);
    vlist.refresh(rows);
    expect(listEl.childElementCount).toBeGreaterThan(0);
    vlist.destroy();
    expect(listEl.childElementCount).toBe(0);
    // 监听已移除：scroll 后列表保持空（不触发 renderSlice 重建）
    scrollEl.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 20));
    expect(listEl.childElementCount).toBe(0);
  });
});
