// ===== 定高虚拟列表测试 =====
// 覆盖：零高度全量回退 / 大数据切片渲染 + padding 撑高 / 滚动后窗口变化 / destroy 清理
// + measureGhRowH 探针兜底（jsdom 无布局 → GH_ROW_H）
import { describe, it, expect, vi, afterEach } from "vitest";
import { createVirtualList } from "./virtual-list.ts";
import { GH_ROW_H, measureGhRowH } from "./repo-events-shared.ts";

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
  // configurable: true —— 供「零高度 → 下一帧布局就绪」用例改写高度
  //（模拟首帧 clientHeight=0、下一帧变 560 的真实时序）
  Object.defineProperty(scrollEl, "clientHeight", { value: clientHeight, configurable: true });
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

  // 锐评修复（2026-10-14）：零高度必须 rAF 重试，不能只降级。
  // 病：原实现零高度时全量渲染**且不装滚动同步**——此后该视图虚拟化永久失效
  //（直到下一次 refresh 才可能恢复）。面板在隐藏态被创建/首帧布局未完成时命中此分支，
  // 2000 级列表整体进 DOM，抹掉本模块存在的意义。
  // 与 app-tree/render.ts 对齐：那一侧早有 `if (container.clientHeight === 0) requestAnimationFrame(redraw)`。
  it("零高度 → 下一帧高度就绪后自动切回虚拟化（补 rAF 重试）", async () => {
    const rows = items(1000);
    const { scrollEl, listEl, vlist } = setup(0, 0, rows);
    // 首帧零高度：全量兜底
    vlist.refresh(rows);
    expect(listEl.childElementCount).toBe(1000);

    // 模拟布局就绪：下一帧高度变为 560
    Object.defineProperty(scrollEl, "clientHeight", { value: 560, configurable: true });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    // 必须已切回虚拟化：DOM 行数骤降 + padding 撑高
    expect(listEl.childElementCount).toBeLessThan(60);
    expect(listEl.style.paddingBottom).toMatch(/^\d+px$/);
  });

  it("destroy 取消在途 rAF 重试（不留幽灵渲染）", async () => {
    const rows = items(1000);
    const { scrollEl, listEl, vlist } = setup(0, 0, rows);
    vlist.refresh(rows);
    expect(listEl.childElementCount).toBe(1000);

    vlist.destroy();
    expect(listEl.childElementCount).toBe(0);
    // 高度就绪 + 帧推进：已销毁的列表不得再被重试回调填充
    Object.defineProperty(scrollEl, "clientHeight", { value: 560, configurable: true });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(listEl.childElementCount).toBe(0);
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

describe("measureGhRowH 探针行高测量", () => {
  it("无布局环境（jsdom offsetHeight=0）→ 回退 GH_ROW_H 兜底", () => {
    const sr = document.createElement("div");
    expect(measureGhRowH(sr)).toBe(GH_ROW_H);
    // 探针自清：测量不留残余节点
    expect(sr.childElementCount).toBe(0);
  });

  it("有布局探针（stub offsetHeight）→ 实测高 + margin 2px", () => {
    const sr = document.createElement("div");
    const proto = HTMLElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
    Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 45 });
    try {
      expect(measureGhRowH(sr)).toBe(47); // 45 + margin-bottom 2
      expect(sr.childElementCount).toBe(0); // 探针自清
    } finally {
      if (original) Object.defineProperty(proto, "offsetHeight", original);
    }
  });
});
