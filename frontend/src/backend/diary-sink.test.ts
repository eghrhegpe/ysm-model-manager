// ===== diary-sink 适配层测试：DiarySink → backend AddOpLog（ADR-189 D1）=====
// core/error-diary 经此注入落盘能力；reject 截断语义从 core 测试迁入本层
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDiarySink } from "./diary-sink.ts";
import { flushPromises } from "@/test-utils/index.ts";

const { addOpLogMock, dbgMock, enqueueMock } = vi.hoisted(() => ({
  addOpLogMock: vi.fn().mockResolvedValue(undefined),
  dbgMock: vi.fn(),
  enqueueMock: vi.fn(),
}));

vi.mock("./app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({ AddOpLog: addOpLogMock }),
}));

// ADR-322 D2：主通道失败必须补投 localStorage 第二通道——dbg 受调试门控，
// 唯一的报告者把报告丢了就是元失败。mock 掉 outbox 隔离断言主通道失败分支。
vi.mock("./diary-outbox.ts", () => ({
  enqueueDiaryOutbox: enqueueMock,
  drainDiaryOutbox: vi.fn().mockResolvedValue(0),
}));

// P1-6 修复：diary-sink 改用 dbg 环形缓冲替代 console.warn——
// 测试同步 spy dbg 模块，验证落盘失败有留痕
vi.mock("@/utils/debug/debug.ts", () => ({
  dbg: dbgMock,
}));

beforeEach(() => {
  addOpLogMock.mockClear();
  dbgMock.mockClear();
  enqueueMock.mockClear();
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

  it("AddOpLog reject → dbg 留痕，无未处理拒绝逸出（防 error-diary 死循环）", async () => {
    // 浮空 Promise 若逸出 → error-diary 的 unhandledrejection 监听 → logUiMsg
    // → 再落盘 → 拒绝 → 死循环；.catch 必须在适配层就地截断
    addOpLogMock.mockRejectedValueOnce(new Error("bridge down"));
    const rejectionSpy = vi.fn();
    const onRejection = (e: PromiseRejectionEvent): void => rejectionSpy(e.reason);
    window.addEventListener("unhandledrejection", onRejection);
    try {
      makeDiarySink()({ title: "x", detail: "y", status: "failed" });
      await flushPromises();
      await flushPromises();
      expect(addOpLogMock).toHaveBeenCalledTimes(1);
      expect(rejectionSpy).not.toHaveBeenCalled();
      expect(dbgMock).toHaveBeenCalled();
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
    }
  });

  it("getApp 拒绝 → 同样就地截断，不产生 AddOpLog 调用", async () => {
    const { getApp } = await import("./app.ts");
    vi.mocked(getApp).mockRejectedValueOnce(new Error("bridge down"));
    const rejectionSpy = vi.fn();
    const onRejection = (e: PromiseRejectionEvent): void => rejectionSpy(e.reason);
    window.addEventListener("unhandledrejection", onRejection);
    try {
      makeDiarySink()({ title: "x", detail: "y", status: "warn" });
      await flushPromises();
      await flushPromises();
      expect(addOpLogMock).not.toHaveBeenCalled();
      expect(rejectionSpy).not.toHaveBeenCalled();
      expect(dbgMock).toHaveBeenCalled();
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
    }
  });

  // ADR-322 D2：dbg 是门控的（关调试即静默），故失败必须同时进第二通道。
  // 断言 entry 原样透传——outbox 是最后一道证据，落库前不该被二次加工。
  it("AddOpLog reject → 原始 entry 进 outbox 第二通道", async () => {
    addOpLogMock.mockRejectedValueOnce(new Error("bridge down"));
    makeDiarySink()({ title: "保存失败", detail: "超时", status: "failed" });
    await flushPromises();
    await flushPromises();
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith({
      title: "保存失败",
      detail: "超时",
      status: "failed",
    });
  });

  it("AddOpLog 成功 → 不投 outbox（第二通道只兜失败，不做双写）", async () => {
    makeDiarySink()({ title: "ok", detail: "d", status: "warn" });
    await flushPromises();
    expect(addOpLogMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
