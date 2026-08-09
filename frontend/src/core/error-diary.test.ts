// ===== error-diary 单元测试：error/warn toast → 日记系统 =====
// 验证 registerErrorDiary 正确拦截 toast 事件并调 AddOpLog，
// 同时捕获 window.onerror / unhandledrejection
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../bus.ts";
import { registerErrorDiary, __TEST__resetDiary } from "./error-diary.ts";

const { addOpLogMock } = vi.hoisted(() => ({
  addOpLogMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({ AddOpLog: addOpLogMock }),
}));

beforeEach(() => {
  addOpLogMock.mockClear();
  __TEST__resetDiary();
});

afterEach(() => {
  addOpLogMock.mockClear();
});

/** 等待微任务队列清空（logUiMsg 是 async 函数，await getApp() 需等微任务） */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("registerErrorDiary", () => {
  it("error toast → AddOpLog called with status=failed", async () => {
    registerErrorDiary();
    bus.emit("toast:show", {
      msg: "❌ 保存失败: 网络超时",
      duration: 4000,
      type: "error",
    });
    await flush();
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
    await flush();
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
      await flush();
      await flush();
      // AddOpLog 已被调用（尝试写入），且拒绝被 .catch 吞掉，无 unhandledrejection 逸出
      expect(addOpLogMock).toHaveBeenCalledTimes(1);
      expect(rejectionSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
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
    await flush();
    expect(addOpLogMock).not.toHaveBeenCalled();
  });

  it("info toast → AddOpLog NOT called", async () => {
    registerErrorDiary();
    bus.emit("toast:show", {
      msg: "ℹ️ 提示信息",
      duration: 2000,
      type: "info",
    });
    await flush();
    expect(addOpLogMock).not.toHaveBeenCalled();
  });

  it("error toast without ❌ prefix → still logged", async () => {
    registerErrorDiary();
    bus.emit("toast:show", {
      msg: "权限不足，无法访问文件",
      duration: 4000,
      type: "error",
    });
    await flush();
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
    await flush();
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
    await flush();
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
    await flush();
    // 只注册一次，所以只调用一次 AddOpLog
    expect(addOpLogMock).toHaveBeenCalledTimes(1);
  });
});