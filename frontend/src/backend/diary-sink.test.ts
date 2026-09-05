// ===== diary-sink 适配层测试：DiarySink → backend AddOpLog（ADR-189 D1）=====
// core/error-diary 经此注入落盘能力；reject 截断语义从 core 测试迁入本层
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDiarySink } from "./diary-sink.ts";
import { flushPromises } from "../test-utils/index.ts";

const { addOpLogMock } = vi.hoisted(() => ({
  addOpLogMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({ AddOpLog: addOpLogMock }),
}));

beforeEach(() => {
  addOpLogMock.mockClear();
});

describe("makeDiarySink", () => {
  it("entry → AddOpLog('ui', title, '', '', 0, status, detail)", async () => {
    makeDiarySink()({ title: "保存失败", detail: "❌ 保存失败: 超时", status: "failed" });
    await flushPromises();
    expect(addOpLogMock).toHaveBeenCalledTimes(1);
    expect(addOpLogMock).toHaveBeenCalledWith(
      "ui", "保存失败", "", "", 0, "failed", "❌ 保存失败: 超时",
    );
  });

  it("AddOpLog reject → console.warn 留痕，无未处理拒绝逸出（防 error-diary 死循环）", async () => {
    // 浮空 Promise 若逸出 → error-diary 的 unhandledrejection 监听 → logUiMsg
    // → 再落盘 → 拒绝 → 死循环；.catch 必须在适配层就地截断
    addOpLogMock.mockRejectedValueOnce(new Error("bridge down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rejectionSpy = vi.fn();
    const onRejection = (e: PromiseRejectionEvent): void => rejectionSpy(e.reason);
    window.addEventListener("unhandledrejection", onRejection);
    try {
      makeDiarySink()({ title: "x", detail: "y", status: "failed" });
      await flushPromises();
      await flushPromises();
      expect(addOpLogMock).toHaveBeenCalledTimes(1);
      expect(rejectionSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
      warnSpy.mockRestore();
    }
  });

  it("getApp 拒绝 → 同样就地截断，不产生 AddOpLog 调用", async () => {
    const { getApp } = await import("./app.ts");
    vi.mocked(getApp).mockRejectedValueOnce(new Error("bridge down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rejectionSpy = vi.fn();
    const onRejection = (e: PromiseRejectionEvent): void => rejectionSpy(e.reason);
    window.addEventListener("unhandledrejection", onRejection);
    try {
      makeDiarySink()({ title: "x", detail: "y", status: "warn" });
      await flushPromises();
      await flushPromises();
      expect(addOpLogMock).not.toHaveBeenCalled();
      expect(rejectionSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
      warnSpy.mockRestore();
    }
  });
});
