// ===== 虚拟滚动共享原语测试 =====
// calcVisibleRange：窗口数学（buffer / clamp / topOffset）；installScrollSync：
// scroll → rAF 合并（一帧一次）+ cleanup 取消在途 rAF（幽灵渲染防护）。
import { describe, it, expect, vi } from "vitest";
import { calcVisibleRange, installScrollSync } from "./virtual-scroll.ts";

function scrollEl(props: { scrollTop?: number; clientHeight?: number }): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollTop", { value: props.scrollTop ?? 0, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: props.clientHeight ?? 600, configurable: true });
  return el;
}

describe("calcVisibleRange", () => {
  it("顶部无滚动 → 含上缓冲钳到 0，end 含下缓冲", () => {
    const { startIdx, endIdx } = calcVisibleRange(scrollEl({}), 1000, 30);
    expect(startIdx).toBe(0);
    expect(endIdx).toBe(Math.ceil(600 / 30) + 15); // 20 + 15
  });

  it("中部滚动 → start/end 按 scrollTop 平移并含上下缓冲", () => {
    const { startIdx, endIdx } = calcVisibleRange(scrollEl({ scrollTop: 3000 }), 1000, 30);
    expect(startIdx).toBe(Math.floor(3000 / 30) - 15); // 100 - 15
    expect(endIdx).toBe(Math.ceil((3000 + 600) / 30) + 15);
  });

  it("topOffset 补偿：列表上方有其他区块时首行起点正确", () => {
    const withOffset = calcVisibleRange(scrollEl({ scrollTop: 120 }), 1000, 30, 120);
    const noOffset = calcVisibleRange(scrollEl({ scrollTop: 0 }), 1000, 30);
    expect(withOffset.startIdx).toBe(noOffset.startIdx);
    expect(withOffset.endIdx).toBe(noOffset.endIdx);
  });

  it("接近底部 → endIdx 钳到 totalRows", () => {
    const { endIdx } = calcVisibleRange(scrollEl({ scrollTop: 99999 }), 40, 30);
    expect(endIdx).toBe(40);
  });
});

describe("installScrollSync", () => {
  it("scroll 触发 rAF 合并 → 一帧只重渲一次", async () => {
    const el = scrollEl({});
    const render = vi.fn();
    installScrollSync(el, render);
    el.dispatchEvent(new Event("scroll"));
    el.dispatchEvent(new Event("scroll"));
    el.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("cleanup 取消在途 rAF → 已排队滚动不再触发渲染", async () => {
    const el = scrollEl({});
    const render = vi.fn();
    const cleanup = installScrollSync(el, render);
    el.dispatchEvent(new Event("scroll")); // rAF 已排队
    cleanup();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(render).not.toHaveBeenCalled();
    // 清理后滚动也失效
    el.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(render).not.toHaveBeenCalled();
  });
});
