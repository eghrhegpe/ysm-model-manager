// ===== 虚拟滚动核心测试 =====
// 覆盖：calcVisibleRange 边界/缓冲、installScrollSync rAF 合并与清理
import { describe, it, expect, vi, beforeEach } from "vitest";
import { calcVisibleRange, installScrollSync } from "./virtual-scroll.ts";

describe("calcVisibleRange", () => {
  function container(scrollTop: number, clientHeight: number): HTMLElement {
    const c = document.createElement("div");
    Object.defineProperty(c, "scrollTop", { value: scrollTop, writable: true });
    Object.defineProperty(c, "clientHeight", { value: clientHeight });
    return c;
  }

  it("顶部：startIdx 下限为 0，endIdx = 视口内行数 + 缓冲", () => {
    const c = container(0, 560); // 560/28 = 20 行
    expect(calcVisibleRange(c, 1000, 28)).toEqual({ startIdx: 0, endIdx: 35 });
  });

  it("中部滚动：前后各留 BUFFER 行", () => {
    const c = container(2800, 560); // 顶行 100，视口底 120
    expect(calcVisibleRange(c, 1000, 28)).toEqual({ startIdx: 85, endIdx: 135 });
  });

  it("列表模式行高 24：不同 endIdx", () => {
    const c = container(0, 480); // 480/24 = 20 行
    expect(calcVisibleRange(c, 1000, 24)).toEqual({ startIdx: 0, endIdx: 35 });
  });

  it("endIdx 上限为 totalRows", () => {
    const c = container(0, 100000);
    expect(calcVisibleRange(c, 5, 28).endIdx).toBe(5);
  });

  it("空列表：startIdx=endIdx=0", () => {
    const c = container(0, 560);
    expect(calcVisibleRange(c, 0, 28)).toEqual({ startIdx: 0, endIdx: 0 });
  });
});

describe("installScrollSync", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("scroll 事件经 rAF 触发 renderVisible（多次滚动合并为一次）", async () => {
    const container = document.createElement("div");
    const renderVisible = vi.fn();
    const cleanup = installScrollSync(container, renderVisible);

    container.dispatchEvent(new Event("scroll"));
    container.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 20));

    expect(renderVisible).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("清理后不再触发", async () => {
    const container = document.createElement("div");
    const renderVisible = vi.fn();
    const cleanup = installScrollSync(container, renderVisible);

    cleanup();
    container.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 20));

    expect(renderVisible).not.toHaveBeenCalled();
  });
});
