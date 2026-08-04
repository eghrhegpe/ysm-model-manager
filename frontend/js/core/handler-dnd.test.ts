// ===== DnD 全局拖拽守卫测试 =====
// 守卫层：PageStore 页面守卫 / DnDLock 并发锁 / registerDnD 资源配对
// 深层收集逻辑（webkitGetAsEntry 等）依赖浏览器 DnD API，jsdom 不覆盖，测守卫与配对层。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../bus.ts";
import { registerPageStore } from "./page-store.ts";
import { registerDnD } from "./handler-dnd.ts";
import { DnDLock } from "../features/dnd-state.ts";

vi.mock("../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ImportModelFile: vi.fn().mockResolvedValue(undefined),
    DetectZipType: vi.fn().mockResolvedValue("ysm"),
  }),
}));

import { getApp } from "../wails/app.ts";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// jsdom 无 DragEvent 构造器：用 Event + cast（守卫层测试不依赖 dataTransfer 细节）
const dropEvent = (): DragEvent => new Event("drop", { cancelable: true }) as DragEvent;

describe("registerDnD 资源配对", () => {
  const unsubs: Array<() => void> = [];

  beforeEach(() => {
    unsubs.length = 0;
    document.querySelectorAll("#global-drop-overlay").forEach((el) => el.remove());
  });

  afterEach(() => {
    unsubs.forEach((fn) => fn());
    unsubs.length = 0;
  });

  it("注册 4 个 document listener，unsubs 清理时全部移除", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    registerDnD(unsubs);
    expect(addSpy).toHaveBeenCalledTimes(4); // dragover/dragleave/drop/dragend
    unsubs.forEach((fn) => fn());
    expect(removeSpy).toHaveBeenCalledTimes(4);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe("DnD 守卫层", () => {
  const pageUnsubs: Array<() => void> = [];
  const dndUnsubs: Array<() => void> = [];

  beforeEach(() => {
    (getApp as unknown as ReturnType<typeof vi.fn>).mockClear();
    pageUnsubs.length = 0;
    dndUnsubs.length = 0;
    registerPageStore(pageUnsubs);
    bus.emit("nav:changed", { page: "repository" });
    registerDnD(dndUnsubs);
  });

  afterEach(() => {
    pageUnsubs.forEach((fn) => fn());
    dndUnsubs.forEach((fn) => fn());
  });

  it("非仓库页 drop 被页面守卫拦截（getApp 零调用）", async () => {
    bus.emit("nav:changed", { page: "settings" });
    document.dispatchEvent(dropEvent());
    await flush();
    expect(getApp).not.toHaveBeenCalled();
  });

  it("DnDLock 锁定期间 drop 被并发锁拦截（getApp 零调用）", async () => {
    DnDLock.acquire();
    document.dispatchEvent(dropEvent());
    await flush();
    expect(getApp).not.toHaveBeenCalled();
    DnDLock.release();
  });

  it("仓库页 drop 无文件时 toast 提示", async () => {
    const toastSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    document.dispatchEvent(dropEvent());
    await flush();
    expect(toastSpy).toHaveBeenCalled();
    expect(String(toastSpy.mock.calls[0][0])).toContain("未检测到");
    unsubToast();
  });

  it("unsubs 清理后 drop 不再有副作用", async () => {
    dndUnsubs.forEach((fn) => fn());
    dndUnsubs.length = 0;
    const toastSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    document.dispatchEvent(dropEvent());
    await flush();
    expect(toastSpy).not.toHaveBeenCalled();
    unsubToast();
  });
});
