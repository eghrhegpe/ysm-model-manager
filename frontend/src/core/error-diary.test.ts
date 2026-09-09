// ===== error-diary 单元测试：error/warn toast → DiarySink =====
// ADR-189 D1：core 不感知 backend——落盘断言改走注入的 sink spy；
// AddOpLog 适配（含 reject 截断防死循环）的用例见 backend/diary-sink.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bus } from "@/bus";
import {
  pushToDiary,
  registerErrorDiary,
  unregisterErrorDiary,
  type DiaryEntry,
} from "./error-diary.ts";
import { installGlobalErrorListeners } from "@/backend/global-error-listeners.ts";
import { flushPromises } from "@/test-utils/index.ts";

const sinkSpy = vi.fn<(e: DiaryEntry) => void>();
// 全局 window 监听由 utils/dom 层单独安装，测试须显式装/卸以防跨用例泄漏
let disposeGlobal: (() => void) | undefined;

beforeEach(() => {
  sinkSpy.mockClear();
  unregisterErrorDiary();
  disposeGlobal?.();
  disposeGlobal = undefined;
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
    disposeGlobal = installGlobalErrorListeners();
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
    disposeGlobal = installGlobalErrorListeners();
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

  it("ADR-207 D1：仅路径段不同的原始文本 → 净化后同类 → 只落一条", async () => {
    registerErrorDiary(sinkSpy);
    bus.emit("toast:show", {
      msg: "❌ 写入失败 源路径：C:\\a.ysm 目标路径：D:\\b 解决建议：检查权限",
      duration: 3000,
      type: "error",
    });
    await flushPromises();
    bus.emit("toast:show", {
      msg: "❌ 写入失败 源路径：C:\\c.ysm 目标路径：D:\\d 解决建议：检查权限",
      duration: 3000,
      type: "error",
    });
    await flushPromises();
    // 去重键 = 净化后（status + title）：两条原始文本塌缩同键 → 只记一条
    expect(sinkSpy).toHaveBeenCalledTimes(1);
  });

  it("ADR-207 D1：A-B-A 交错风暴 → 按 key 独立窗口抑制（A 只落一条）", async () => {
    registerErrorDiary(sinkSpy);
    const fire = (msg: string) => bus.emit("toast:show", { msg, type: "error" });
    fire("A 类错误");
    await flushPromises();
    fire("B 类错误");
    await flushPromises();
    fire("A 类错误");
    await flushPromises();
    // 原单槽 last-write 语义下第 3 条（A）会穿透；按 key 窗口后 A 被自身 5s 窗口抑制
    expect(sinkSpy).toHaveBeenCalledTimes(2);
  });

  it("ADR-207 D1：超过 32 键 cap → 淘汰最旧键，被淘汰种类 fail-open 重记", async () => {
    registerErrorDiary(sinkSpy);
    sinkSpy.mockClear();
    const fire = (msg: string) => bus.emit("toast:show", { msg, type: "error" });
    for (let i = 0; i < 33; i++) {
      fire(`err-${i} 类错误`);
      await flushPromises();
    }
    expect(sinkSpy).toHaveBeenCalledTimes(33);
    // 第 33 种（err-32）入窗时淘汰最旧（err-0）；err-0 重发 → 无窗口记录 → fail-open 再记
    fire("err-0 类错误");
    await flushPromises();
    expect(sinkSpy).toHaveBeenCalledTimes(34);
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

  it("注册失败回滚后重注册可恢复（僵尸 handle 不占位——bus.on 抛错场景）", async () => {
    const onSpy = vi.spyOn(bus, "on").mockImplementation(() => {
      throw new Error("bus boom");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failedHandle = registerErrorDiary(sinkSpy);
    failedHandle.dispose(); // 调用方按句柄契约清理（失败时本就 no-op）
    onSpy.mockRestore();
    // 回滚后 currentHandle 必须为空 → 重注册真正生效（缺陷态：僵尸 handle 占位 → 永久静默失效）
    registerErrorDiary(sinkSpy);
    bus.emit("toast:show", { msg: "❌ 注册失败后可恢复", duration: 3000, type: "error" });
    await flushPromises();
    expect(sinkSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
    unregisterErrorDiary();
  });

  it("unregisterErrorDiary 拆除 toast 监听：reset 后 error toast 不再落盘", async () => {
    registerErrorDiary(sinkSpy);
    unregisterErrorDiary();
    bus.emit("toast:show", { msg: "❌ reset 后的错误", duration: 3000, type: "error" });
    await flushPromises();
    expect(sinkSpy).not.toHaveBeenCalled();
  });

  it("registerErrorDiary 返回 handle，dispose 后 error toast 不再落盘", async () => {
    const handle = registerErrorDiary(sinkSpy);
    handle.dispose();
    bus.emit("toast:show", { msg: "❌ dispose 后", duration: 3000, type: "error" });
    await flushPromises();
    expect(sinkSpy).not.toHaveBeenCalled();
  });

  it("registerErrorDiary 幂等：第二次返回空 handle，dispose 不影响第一次", async () => {
    const handle1 = registerErrorDiary(sinkSpy);
    const handle2 = registerErrorDiary(sinkSpy);
    handle2.dispose(); // 空操作，不影响第一次注册
    bus.emit("toast:show", { msg: "❌ 仍应落盘", duration: 3000, type: "error" });
    await flushPromises();
    expect(sinkSpy).toHaveBeenCalledTimes(1);
    handle1.dispose();
  });
});

// ===== logWarn/logError 透写日记（热路径告警进环形日志，经注入 sink 落盘）=====
describe("log sink 透写", () => {
  it("logError → status=failed，带 tag 前缀与 err detail", async () => {
    const { logError } = await import("@/utils/base/log.ts");
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
    const { logWarn } = await import("@/utils/base/log.ts");
    registerErrorDiary(sinkSpy);
    logWarn("preview 3D", "handle.cleanup 失败");
    await flushPromises();
    expect(sinkSpy).toHaveBeenCalledTimes(1);
    expect(sinkSpy.mock.calls[0][0].status).toBe("warn");
  });

  it("unregisterErrorDiary 拆除 sink：reset 后 logWarn 不再落日记", async () => {
    const { logWarn } = await import("@/utils/base/log.ts");
    registerErrorDiary(sinkSpy);
    unregisterErrorDiary();
    logWarn("tag", "reset 后的消息");
    await flushPromises();
    expect(sinkSpy).not.toHaveBeenCalled();
  });
});

// ===== pushToDiary 未注册态（ADR-210 D5：失活留痕，不再静默 no-op）=====
describe("pushToDiary 未注册态", () => {
  it("两次调用仅首次告警（节流防风暴），内容指向漏注册", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      pushToDiary("全局未捕获 X", "failed");
      pushToDiary("全局未捕获 Y", "failed");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("未注册态");
    } finally {
      warn.mockRestore();
    }
  });

  it("注册成功后标志复位：再次失活（unregister 后）可重新告警", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      registerErrorDiary(sinkSpy);
      unregisterErrorDiary();
      pushToDiary("全局未捕获 Z", "failed");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("未注册态");
    } finally {
      warn.mockRestore();
    }
  });

  it("已注册态转发到 sink（不告警）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      registerErrorDiary(sinkSpy);
      pushToDiary("全局未捕获 E", "failed");
      expect(warn).not.toHaveBeenCalled();
      expect(sinkSpy).toHaveBeenCalledTimes(1);
      expect(sinkSpy.mock.calls[0][0].title).toContain("E");
    } finally {
      warn.mockRestore();
    }
  });
});
