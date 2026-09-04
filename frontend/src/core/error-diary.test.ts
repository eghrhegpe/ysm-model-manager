// ===== error-diary 单元测试：error/warn toast → 日记系统 =====
// 验证 registerErrorDiary 正确拦截 toast 事件并调 AddOpLog，
// 同时捕获 window.onerror / unhandledrejection
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../bus.ts";
import { registerErrorDiary, __TEST__resetDiary } from "./error-diary.ts";
import { flushPromises } from "../test-utils/index.ts";

const { addOpLogMock } = vi.hoisted(() => ({
  addOpLogMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({ AddOpLog: addOpLogMock }),
}));

// P3（code_review）：网页版早退测试需要可控的 resolveWebMode——默认 false（桌面），
// 特定用例 mockReturnValue(true)
vi.mock("../backend/platform.ts", () => ({
  resolveWebMode: vi.fn(() => false),
}));

import { resolveWebMode } from "../backend/platform.ts";

beforeEach(() => {
  addOpLogMock.mockClear();
  __TEST__resetDiary();
});

afterEach(() => {
  addOpLogMock.mockClear();
});

describe("registerErrorDiary", () => {
  it("error toast → AddOpLog called with status=failed", async () => {
    registerErrorDiary();
    bus.emit("toast:show", {
      msg: "❌ 保存失败: 网络超时",
      duration: 4000,
      type: "error",
    });
    await flushPromises();
    expect(addOpLogMock).toHaveBeenCalledTimes(1);
    const call = addOpLogMock.mock.calls[0];
    expect(call[0]).toBe("ui");               // op
    expect(call[1]).toBe("保存失败: 网络超时");  // modelName (❌ stripped)
    expect(call[2]).toBe("");                  // sourcePath
    expect(call[3]).toBe("");                  // targetDir
    expect(call[4]).toBe(0);                   // fileSize
    expect(call[5]).toBe("failed");            // status
    expect(call[6]).toBe("❌ 保存失败: 网络超时"); // errMsg (raw)
  });

  it("warn toast → AddOpLog called with status=warn", async () => {
    registerErrorDiary();
    bus.emit("toast:show", {
      msg: "⚠️ 请先配置路径",
      duration: 3000,
      type: "warn",
    });
    await flushPromises();
    expect(addOpLogMock).toHaveBeenCalledTimes(1);
    const call = addOpLogMock.mock.calls[0];
    expect(call[0]).toBe("ui");
    expect(call[1]).toBe("请先配置路径"); // ⚠️ stripped
    expect(call[5]).toBe("warn");         // status
  });

  it("P2 修复：AddOpLog reject 不产生未处理拒绝（防日志死循环）", async () => {
    // 原 `void AddOpLog(...)` 浮空 Promise——Wails 调用失败 reject → unhandledrejection
    // → 触发本模块 onRejection → 再 logUiMsg → 再 AddOpLog → 拒绝 → 死循环；
    // 补 .catch 后拒绝被截断，onRejection 不应被二次触发
    addOpLogMock.mockRejectedValueOnce(new Error("bridge down"));
    const rejectionSpy = vi.fn();
    const onRejection = (e: PromiseRejectionEvent): void => rejectionSpy(e.reason);
    window.addEventListener("unhandledrejection", onRejection);
    try {
      registerErrorDiary();
      bus.emit("toast:show", { msg: "❌ 会失败的日志", type: "error" });
      await flushPromises();
      await flushPromises();
      // AddOpLog 已被调用（尝试写入），且拒绝被 .catch 吞掉，无 unhandledrejection 逸出
      expect(addOpLogMock).toHaveBeenCalledTimes(1);
      expect(rejectionSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
      __TEST__resetDiary();
    }
  });

  it("P4 写路径兜底：getApp 拒绝 → console.warn 留痕且无未处理拒绝逸出", async () => {
    // logUiMsg 外层 try/catch 截断 getApp() 拒绝——浮空 Promise 不得触发
    // onRejection 死循环（与 AddOpLog .catch 截断同理）
    const { getApp } = await import("../backend/app.ts");
    vi.mocked(getApp).mockRejectedValueOnce(new Error("bridge down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rejectionSpy = vi.fn();
    const onRejection = (e: PromiseRejectionEvent): void => rejectionSpy(e.reason);
    window.addEventListener("unhandledrejection", onRejection);
    try {
      registerErrorDiary();
      bus.emit("toast:show", { msg: "❌ getApp 失败", type: "error" });
      await flushPromises();
      await flushPromises();
      expect(addOpLogMock).not.toHaveBeenCalled();
      expect(rejectionSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
      warnSpy.mockRestore();
      __TEST__resetDiary();
    }
  });

  it("success toast → AddOpLog NOT called", async () => {
    registerErrorDiary();
    bus.emit("toast:show", {
      msg: "✅ 操作成功",
      duration: 2000,
      type: "success",
    });
    await flushPromises();
    expect(addOpLogMock).not.toHaveBeenCalled();
  });

  it("info toast → AddOpLog NOT called", async () => {
    registerErrorDiary();
    bus.emit("toast:show", {
      msg: "ℹ️ 提示信息",
      duration: 2000,
      type: "info",
    });
    await flushPromises();
    expect(addOpLogMock).not.toHaveBeenCalled();
  });

  it("error toast without ❌ prefix → still logged", async () => {
    registerErrorDiary();
    bus.emit("toast:show", {
      msg: "权限不足，无法访问文件",
      duration: 4000,
      type: "error",
    });
    await flushPromises();
    expect(addOpLogMock).toHaveBeenCalledTimes(1);
    const call = addOpLogMock.mock.calls[0];
    expect(call[1]).toBe("权限不足，无法访问文件");
    expect(call[5]).toBe("failed");
  });

  it("window.onerror → AddOpLog called", async () => {
    registerErrorDiary();
    const errorEvent = new ErrorEvent("error", {
      message: "脚本执行出错",
      error: new Error("脚本执行出错"),
    });
    window.dispatchEvent(errorEvent);
    await flushPromises();
    expect(addOpLogMock).toHaveBeenCalledTimes(1);
    expect(addOpLogMock).toHaveBeenCalledWith(
      "ui", "脚本执行出错", "", "", 0, "failed", "脚本执行出错",
    );
  });

  it("unhandledrejection → AddOpLog called", async () => {
    registerErrorDiary();
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
    expect(addOpLogMock).toHaveBeenCalledTimes(1);
    expect(addOpLogMock).toHaveBeenCalledWith(
      "ui", "API 请求失败", "", "", 0, "failed", "API 请求失败",
    );
  });

  it("registerErrorDiary is idempotent", async () => {
    registerErrorDiary();
    registerErrorDiary();
    registerErrorDiary();
    bus.emit("toast:show", { msg: "❌ 错误", duration: 3000, type: "error" });
    await flushPromises();
    // 只注册一次，所以只调用一次 AddOpLog
    expect(addOpLogMock).toHaveBeenCalledTimes(1);
  });

  it("P2 去重：相同 (msg,status) 5s 窗口内只记一条", async () => {
    registerErrorDiary();
    bus.emit("toast:show", { msg: "❌ 网络抖动", duration: 3000, type: "error" });
    await flushPromises();
    bus.emit("toast:show", { msg: "❌ 网络抖动", duration: 3000, type: "error" });
    await flushPromises();
    // 相同消息+状态在窗口内被去重 → 只写一次（防错误风暴 N 次全文件重写）
    expect(addOpLogMock).toHaveBeenCalledTimes(1);
  });

  it("P2 去重：窗口内不同消息/状态仍记录", async () => {
    registerErrorDiary();
    bus.emit("toast:show", { msg: "❌ 错误A", duration: 3000, type: "error" });
    bus.emit("toast:show", { msg: "❌ 错误B", duration: 3000, type: "error" });
    bus.emit("toast:show", { msg: "⚠️ 错误A", duration: 3000, type: "warn" });
    await flushPromises();
    // 不同 msg 或不同 status 的 key 不同 → 均不被去重，共 3 条
    expect(addOpLogMock).toHaveBeenCalledTimes(3);
  });

  it("P2 路径剥离：源路径/目标路径段不进入日记（errMsg 与 modelName）", async () => {
    registerErrorDiary();
    bus.emit("toast:show", {
      msg: "❌ 写入失败 源路径：C:\\Users\\zhujieling11\\foo.ysm 目标路径：D:\\bar 解决建议：检查权限",
      duration: 4000,
      type: "error",
    });
    await flushPromises();
    expect(addOpLogMock).toHaveBeenCalledTimes(1);
    const call = addOpLogMock.mock.calls[0];
    // 两条持久化字段（modelName=call[1]、errMsg=call[6]）均不包含内部路径段
    expect(call[1]).not.toContain("源路径");
    expect(call[1]).not.toContain("C:\\Users");
    expect(call[6]).not.toContain("目标路径");
    expect(call[6]).not.toContain("D:\\bar");
    // 保留其余文案（解决建议等）
    expect(call[6]).toContain("解决建议");
  });

  it("ADR-071 修正：web 模式同样调 AddOpLog（web-store 已实现内存日志环，早退已移除）", async () => {    vi.mocked(resolveWebMode).mockReturnValue(true);
    try {
      registerErrorDiary();
      bus.emit("toast:show", { msg: "❌ 网页版错误", duration: 3000, type: "error" });
      await flushPromises();
      // 早退删除后 web 也落日记（原测试断言"不调用"已过时）
      expect(addOpLogMock).toHaveBeenCalled();
    } finally {
      vi.mocked(resolveWebMode).mockReturnValue(false);
    }
  });
});

// ===== logWarn/logError 透写日记（code review #6：热路径告警进环形日志）=====
describe("log sink 透写", () => {
  it("logError → AddOpLog status=failed，带 tag 前缀与 err detail", async () => {
    const { logError } = await import("../utils/core/log.ts");
    registerErrorDiary();
    logError("preview 3D", "加载失败", new Error("boom"));
    await flushPromises();
    expect(addOpLogMock).toHaveBeenCalledTimes(1);
    const call = addOpLogMock.mock.calls[0];
    expect(call[0]).toBe("ui");
    expect(call[1]).toContain("preview 3D");
    expect(call[1]).toContain("加载失败");
    expect(call[1]).toContain("boom");
    expect(call[5]).toBe("failed");
  });

  it("logWarn → AddOpLog status=warn；无 err 不追加 detail", async () => {
    const { logWarn } = await import("../utils/core/log.ts");
    registerErrorDiary();
    logWarn("preview 3D", "handle.cleanup 失败");
    await flushPromises();
    expect(addOpLogMock).toHaveBeenCalledTimes(1);
    expect(addOpLogMock.mock.calls[0][5]).toBe("warn");
  });

  it("__TEST__resetDiary 拆除 sink：reset 后 logWarn 不再落日记", async () => {
    const { logWarn } = await import("../utils/core/log.ts");
    registerErrorDiary();
    __TEST__resetDiary();
    logWarn("tag", "reset 后的消息");
    await flushPromises();
    expect(addOpLogMock).not.toHaveBeenCalled();
  });
});