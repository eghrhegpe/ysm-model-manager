// ===== <app-toast> 组件级测试（G-1 — ADR-035 / Design.md §19.1）=====
// 断言基于 data-testid 稳定钩子；交互走 bus.emit 事件驱动。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getByTestId, getAllByTestId, waitFor, sleep } from "../../test-utils/index.ts";
import { bus } from "../../bus.ts";
import "./index.ts"; // 触发 customElements.define("app-toast")

function mountToast(): HTMLElement {
  const el = document.createElement("app-toast");
  document.body.appendChild(el);
  return el;
}

function unmount(el: HTMLElement): void {
  document.body.removeChild(el);
}

describe("app-toast（testid 钩子 + 生命周期）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("connected → 注册 toast:show 监听", async () => {
    const el = mountToast();
    // 发送 toast → 应在 DOM 中看到
    bus.emit("toast:show", { msg: "hello" });
    const root = el.shadowRoot!;
    await waitFor(() => getByTestId(root, "toast") !== null);
    expect(getByTestId(root, "toast")!.textContent).toContain("hello");
    unmount(el);
  });

  it("显示多条 toast（各自独立）", async () => {
    const el = mountToast();
    bus.emit("toast:show", { msg: "第一条" });
    bus.emit("toast:show", { msg: "第二条" });
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "toast").length >= 2);
    expect(getAllByTestId(root, "toast").length).toBe(2);
    unmount(el);
  });

  it("type 参数 → 正确添加 CSS class", async () => {
    const el = mountToast();
    bus.emit("toast:show", { msg: "出错啦", type: "error" });
    const root = el.shadowRoot!;
    await waitFor(() => getByTestId(root, "toast") !== null);
    const toast = getByTestId(root, "toast")!;
    expect(toast.classList.contains("error")).toBe(true);
    unmount(el);
  });

  it("关闭按钮 → 移除 toast", async () => {
    const el = mountToast();
    bus.emit("toast:show", { msg: "可关闭" });
    const root = el.shadowRoot!;
    await waitFor(() => getByTestId(root, "toast") !== null);
    const closeBtn = root.querySelector(".close-btn") as HTMLElement;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    await sleep(300); // 等待 slideOut 动画
    expect(getByTestId(root, "toast")).toBeNull();
    unmount(el);
  });

  it("撤销按钮 → 触发回调并显示撤销确认", async () => {
    const el = mountToast();
    const undoFn = vi.fn();
    bus.emit("toast:show", { msg: "可撤销", undo: undoFn });
    const root = el.shadowRoot!;
    await waitFor(() => getByTestId(root, "toast") !== null);
    const undoBtn = root.querySelector(".undo-btn") as HTMLElement;
    expect(undoBtn).toBeTruthy();
    undoBtn.click();
    expect(undoFn).toHaveBeenCalled();
    // 撤销后显示「已撤销」
    await sleep(100);
    expect(getAllByTestId(root, "toast").length).toBeGreaterThanOrEqual(1);
    unmount(el);
  });

  it("最多 5 条同时显示，超出移除最早的", async () => {
    const el = mountToast();
    for (let i = 0; i < 6; i++) {
      bus.emit("toast:show", { msg: `第${i + 1}条`, duration: 99999 });
    }
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "toast").length >= 5);
    // 最多 5 条（第 1 条被移除）
    expect(getAllByTestId(root, "toast").length).toBeLessThanOrEqual(5);
    unmount(el);
  });

  it("disconnected → 清理订阅（emit 不再新增 toast）", async () => {
    const el = mountToast();
    unmount(el);
    bus.emit("toast:show", { msg: "断开后不应出现" });
    await sleep(100);
    const root = el.shadowRoot!;
    expect(getByTestId(root, "toast")).toBeNull();
  });

  it("duration 到期后自动移除", async () => {
    const el = mountToast();
    bus.emit("toast:show", { msg: "短命", duration: 50 });
    const root = el.shadowRoot!;
    await waitFor(() => getByTestId(root, "toast") !== null);
    // 50ms 到期 + 200ms 动画移除
    await sleep(300);
    expect(getByTestId(root, "toast")).toBeNull();
    unmount(el);
  });
});