// ===== error-diary 单元测试：error/warn toast → DiarySink =====
// ADR-189 D1：core 不感知 backend——落盘断言改走注入的 sink spy；
// AddOpLog 适配（含 reject 截断防死循环）的用例见 backend/diary-sink.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bus } from "../bus.ts";
import { registerErrorDiary, unregisterErrorDiary, type DiaryEntry } from "./error-diary.ts";
import { flushPromises } from "../test-utils/index.ts";

const sinkSpy = vi.fn<(e: DiaryEntry) => void>();

beforeEach(() => {
  sinkSpy.mockClear();
  unregisterErrorDiary();
});

describe("registerErrorDiary", () => {
  it("error toast → sink status=failed，title 剥 ❌ 前缀，detail 保留原始", async () => {
    registerErrorDiary(sinkSpy);
    bus.emit("toast:show", {
      msg: "❌ 保存失败: 网络超时",
      duration: 4000,
      type: "error",
    });
    await flushPromises();
    expect(sinkSpy).toHaveBeenCalledTimes(1);
    const entry = sinkSpy.mock.calls[0][0];
    expect(entry.title).toBe("保存失败: 网络超时"); // ❌ stripped
    expect(entry.detail).toBe("❌ 保存失败: 网络超时"); // detail 保留原始
    expect(entry.status).toBe("failed");
  });

  it("warn toast → sink status=warn，title 剥 ⚠️ 前缀", async () => {
    registerErrorDiary(sinkSpy);
    bus.emit("toast:show", {
      msg: "⚠️ 请先配置路径",
      duration: 3000,
      type: "warn",
    });
    await flushPromises();
    expect(sinkSpy).toHaveBeenCalledTimes(1);
    const entry = sinkSpy.mock.calls[0][0];
    expect(entry.title).toBe("请先配置路径");
    expect(entry.status).toBe("warn");
  });

  it("success toast → sink NOT called", async () => {
    registerErrorDiary(sinkSpy);
    bus.emit("toast:show", { msg: "✅ 操作成功", duration: 2000, type: "success" });
    await flushPromises();
    expect(sinkSpy).not.toHaveBeenCalled();
  });

  it("info toast → sink NOT called", async () => {
    registerErrorDiary(sinkSpy);
    bus.emit("toast:show", { msg: "ℹ️ 提示信息", duration: 2000, type: "info" });
    await flushPromises();
    expect(sinkSpy).not.toHaveBeenCalled();
  });

  it("error toast without ❌ prefix → still logged", async () => {
    registerErrorDiary(sinkSpy);
    bus.emit("toast:show", {
      msg: "权限不足，无法访问文件",
      duration: 4000,
      type: "error",
    });
    await flushPromises();
    expect(sinkSpy).toHaveBeenCalledTimes(1);
    const entry = sinkSpy.mock.calls[0][0];
    expect(entry.title).toBe("权限不足，无法访问文件");
    expect(entry.status).toBe("failed");
  });

  it("window.onerror → sink called", async () => {
    registerErrorDiary(sinkSpy);
    const errorEvent = new ErrorEvent("error", {
      message: "脚本执行出错",
      error: new Error("脚本执行出错"),
    });
    window.dispatchEvent(errorEvent);
    await flushPromises();
    expect(sinkSpy).toHaveBeenCalledTimes(1);
    expect(sinkSpy).toHaveBeenCalledWith({
      title: "脚本执行出错",
      detail: "脚本执行出错",
      status: "failed",
    });
  });

  it("unhandledrejection → sink called", async () => {
    registerErrorDiary(sinkSpy);
    const reason = new Error("API 请求失败");
    // happy-dom 未实现全局 PromiseRejectionEvent 构造器（jsdom 有），
    // 用局部构造器兜底：真实浏览器均支持该事件，生产代码依赖的只是 reason 字段
    const RejectionCtor = (
      globalThis as unknown as { PromiseRejectionEvent?: typeof PromiseRejectionEvent }
    ).PromiseRejectionEvent;
    const rejectionEvent = RejectionCtor
      ? new RejectionCtor("unhandledrejection", {
          reason,
          promise: Promise.reject(reason).catch(() => {}),
        })
      : Object.assign(new Event("unhandledrejection"), { reason });
    window.dispatchEvent(rejectionEvent);
    await flushPromises();
    expect(sinkSpy).toHaveBeenCalledTimes(1);
    expect(sinkSpy).toHaveBeenCalledWith({
      title: "API 请求失败",
      detail: "API 请求失败",
      status: "failed",
    });
  });

  it("registerErrorDiary is idempotent", async () => {
    registerErrorDiary(sinkSpy);
    registerErrorDiary(sinkSpy);
    registerErrorDiary(sinkSpy);
    bus.emit("toast:show", { msg: "❌ 错误", duration: 3000, type: "error" });
    await flushPromises();
    // 只注册一次，所以只落一次
    expect(sinkSpy).toHaveBeenCalledTimes(1);
  });

  it("P2 去重：相同 (msg,status) 5s 窗口内只记一条", async () => {
    registerErrorDiary(sinkSpy);
    bus.emit("toast:show", { msg: "❌ 网络抖动", duration: 3000, type: "error" });
    await flushPromises();
    bus.emit("toast:show", { msg: "❌ 网络抖动", duration: 3000, type: "error" });
    await flushPromises();
    // 相同消息+状态在窗口内被去重 → 只落一次（防错误风暴写入放大）
    expect(sinkSpy).toHaveBeenCalledTimes(1);
  });

  it("P2 去重：窗口内不同消息/状态仍记录", async () => {
    registerErrorDiary(sinkSpy);
    bus.emit("toast:show", { msg: "❌ 错误A", duration: 3000, type: "error" });
    bus.emit("toast:show", { msg: "❌ 错误B", duration: 3000, type: "error" });
    bus.emit("toast:show", { msg: "⚠️ 错误A", duration: 3000, type: "warn" });
    await flushPromises();
    // 不同 msg 或不同 status 的 key 不同 → 均不被去重，共 3 条
    expect(sinkSpy).toHaveBeenCalledTimes(3);
  });

  it("P2 路径剥离：源路径/目标路径段不进入日记（title 与 detail 双字段）", async () => {
    registerErrorDiary(sinkSpy);
    bus.emit("toast:show", {
      msg: "❌ 写入失败 源路径：C:\\Users\\zhujieling11\\foo.ysm 目标路径：D:\\bar 解决建议：检查权限",
      duration: 4000,
      type: "error",
    });
    await flushPromises();
    expect(sinkSpy).toHaveBeenCalledTimes(1);
    const entry = sinkSpy.mock.calls[0][0];
    // 两条持久化字段（title/detail）均不包含内部路径段
    expect(entry.title).not.toContain("源路径");
    expect(entry.title).not.toContain("C:\\Users");
    expect(entry.detail).not.toContain("目标路径");
    expect(entry.detail).not.toContain("D:\\bar");
    // 保留其余文案（解决建议等）
    expect(entry.detail).toContain("解决建议");
  });

  it("P4 兜底：sink 同步抛错 → console.warn 留痕，不外溢中断 toast 链路", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      registerErrorDiary(() => {
        throw new Error("sink boom");
      });
      expect(() =>
        bus.emit("toast:show", { msg: "❌ 触发同步抛错", duration: 3000, type: "error" }),
      ).not.toThrow();
      await flushPromises();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      unregisterErrorDiary();
    }
  });

  it("unregisterErrorDiary 拆除 toast 监听：reset 后 error toast 不再落盘", async () => {
    registerErrorDiary(sinkSpy);
    unregisterErrorDiary();
    bus.emit("toast:show", { msg: "❌ reset 后的错误", duration: 3000, type: "error" });
    await flushPromises();
    expect(sinkSpy).not.toHaveBeenCalled();
  });
});

// ===== logWarn/logError 透写日记（热路径告警进环形日志，经注入 sink 落盘）=====
describe("log sink 透写", () => {
  it("logError → status=failed，带 tag 前缀与 err detail", async () => {
    const { logError } = await import("../utils/base/log.ts");
    registerErrorDiary(sinkSpy);
    logError("preview 3D", "加载失败", new Error("boom"));
    await flushPromises();
    expect(sinkSpy).toHaveBeenCalledTimes(1);
    const entry = sinkSpy.mock.calls[0][0];
    expect(entry.title).toContain("preview 3D");
    expect(entry.title).toContain("加载失败");
    expect(entry.title).toContain("boom");
    expect(entry.status).toBe("failed");
  });

  it("logWarn → status=warn；无 err 不追加 detail", async () => {
    const { logWarn } = await import("../utils/base/log.ts");
    registerErrorDiary(sinkSpy);
    logWarn("preview 3D", "handle.cleanup 失败");
    await flushPromises();
    expect(sinkSpy).toHaveBeenCalledTimes(1);
    expect(sinkSpy.mock.calls[0][0].status).toBe("warn");
  });

  it("unregisterErrorDiary 拆除 sink：reset 后 logWarn 不再落日记", async () => {
    const { logWarn } = await import("../utils/base/log.ts");
    registerErrorDiary(sinkSpy);
    unregisterErrorDiary();
    logWarn("tag", "reset 后的消息");
    await flushPromises();
    expect(sinkSpy).not.toHaveBeenCalled();
  });
});
