// @vitest-environment node
// ===== instance-ops 整合包操作 handler 测试 =====
// 覆盖：导出清单（成功/未找到整合包/子目录读取失败/无文件）、清空目录（统计失败/取消/成功）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../../bus.ts";
import { flushPromises } from "../../test-utils/index.ts";
import { appFn, resetAppMock } from "../../test-utils/mock-app.ts";

// app mock：共享工厂 + 别名路径（归一写法，详见 test-utils/mock-app.ts 头注）
vi.mock("@/backend/app.ts", async () => {
  const { setupAppMock } = await import("@/test-utils/mock-app.ts");
  return setupAppMock();
});

// ---- mock 依赖 ----
// appFn 取 fail-closed Proxy 上的底层 vi.fn
// backend/app mock 走 test-setup §5 全局 fail-closed Proxy；appFn 取底层 vi.fn
// modalConfirm 经 vi.hoisted 声明（code_review 7be20003 #8）：vi.mock 被 hoist 到
// 文件顶，factory 闭包若读 body-scope 的 const mocks 会有时序依赖——isolate:false
// 共享模块图下 modal.ts 先求值即 ReferenceError。hoisted 绑定在 hoist 时已存在，
// factory 引用它无初始化顺序问题（对齐 pre-refactor 的 vi.hoisted 写法）。
const { modalConfirm } = vi.hoisted(() => ({ modalConfirm: vi.fn() }));
const mocks = {
  ListVersionInstances: appFn("ListVersionInstances"),
  ListFileNames: appFn("ListFileNames"),
  GetSubDirMap: appFn("GetSubDirMap"),
  CountInstanceResources: appFn("CountInstanceResources"),
  ClearInstanceResources: appFn("ClearInstanceResources"),
  modalConfirm,
};

vi.mock("../require-mcroot.ts", () => ({
  requireMcRoot: vi.fn().mockResolvedValue("/mc"),
}));

vi.mock("../dialogs/modal-confirm.ts", () => ({
  modalConfirm,
}));

// 统一清理：移除被测 handler 与 spy 监听
let cleanups: Array<() => void> = [];

beforeEach(() => {
  cleanups = [];
  vi.clearAllMocks();
  mocks.ListVersionInstances.mockResolvedValue([
    { Name: "TestPack", VersionDir: "/mc/instances/TestPack", Exists: true },
  ]);
  mocks.GetSubDirMap.mockResolvedValue({ ysm: "config/ysm", mmd: "mmd" });
  mocks.ListFileNames.mockResolvedValue(["a.ysm", "b.ysm"]);
  mocks.CountInstanceResources.mockResolvedValue(5);
  mocks.ClearInstanceResources.mockResolvedValue(5);
});

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  // B 簇（code_review 7be20003 #3/#4/#6）：isolate=false + shuffle 下 globalThis
  // store 跨文件存活，本文件配的实现/历史会残留给后跑文件——清回 fail-closed 起点
  resetAppMock();
});

/** 注册被测 handler 并登记清理 */
async function register(): Promise<void> {
  const { registerInstanceOps } = await import("./instance-ops.ts");
  const unsubs: Array<() => void> = [];
  registerInstanceOps(unsubs);
  cleanups.push(...unsubs);
}

/** 监听 toast / stats:refresh 并登记清理 */
function spyEvents() {
  const toasts: Array<{ msg: string; type: string }> = [];
  const refreshEvents: string[] = [];
  cleanups.push(
    bus.on("toast:show", (t) => toasts.push(t as { msg: string; type: string })),
    bus.on("stats:refresh", () => refreshEvents.push("stats:refresh")),
  );
  return { toasts, refreshEvents };
}

describe("registerInstanceOps — instance:export-list", () => {
  it("成功导出清单到剪贴板", async () => {
    await register();
    const { toasts } = spyEvents();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    bus.emit("instance:export-list", { name: "TestPack", rtype: "ysm" });
    await flushPromises();
    await flushPromises();

    expect(mocks.ListVersionInstances).toHaveBeenCalledWith("/mc");
    expect(mocks.GetSubDirMap).toHaveBeenCalled();
    expect(mocks.ListFileNames).toHaveBeenCalledWith("/mc/instances/TestPack/config/ysm");
    expect(writeText).toHaveBeenCalled();
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain("📦 TestPack");
    expect(text).toContain("ysm (2)");
    expect(text).toContain("a.ysm");
    expect(toasts.some((t) => t.type === "success")).toBe(true);
  });

  it("未找到整合包 → error toast，不调 ListFileNames", async () => {
    mocks.ListVersionInstances.mockResolvedValue([]);
    await register();
    const { toasts } = spyEvents();

    bus.emit("instance:export-list", { name: "Ghost", rtype: "ysm" });
    await flushPromises();

    expect(toasts.some((t) => t.msg === "未找到整合包" && t.type === "error")).toBe(true);
    expect(mocks.ListFileNames).not.toHaveBeenCalled();
  });

  it("requireMcRoot 返回空 → 直接返回", async () => {
    const { requireMcRoot } = await import("../require-mcroot.ts");
    (requireMcRoot as ReturnType<typeof vi.fn>).mockResolvedValueOnce("");
    await register();

    bus.emit("instance:export-list", { name: "TestPack", rtype: "ysm" });
    await flushPromises();

    expect(mocks.ListVersionInstances).not.toHaveBeenCalled();
  });

  it("ListFileNames 失败 → console.warn 但不中断", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.ListFileNames.mockRejectedValue(new Error("permission denied"));
    await register();
    spyEvents();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    bus.emit("instance:export-list", { name: "TestPack", rtype: "ysm" });
    await flushPromises();
    await flushPromises();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("无任何文件 → info toast 不复制", async () => {
    mocks.ListFileNames.mockResolvedValue([]);
    await register();
    const { toasts } = spyEvents();

    bus.emit("instance:export-list", { name: "TestPack", rtype: "ysm" });
    await flushPromises();

    expect(toasts.some((t) => t.msg === "该整合包没有资源文件" && t.type === "info")).toBe(true);
  });

  it("rtype 为空 → error toast，不调后端", async () => {
    await register();
    const { toasts } = spyEvents();

    bus.emit("instance:export-list", { name: "TestPack", rtype: "" });
    await flushPromises();

    expect(toasts.some((t) => t.msg.includes("整合包缺少类型信息") && t.type === "error")).toBe(true);
    expect(mocks.ListVersionInstances).not.toHaveBeenCalled();
  });
});

describe("registerInstanceOps — instance:clear", () => {
  it("统计失败 → error toast，不弹确认框", async () => {
    mocks.CountInstanceResources.mockRejectedValue(new Error("scan error"));
    await register();
    const { toasts } = spyEvents();

    bus.emit("instance:clear", { name: "TestPack", rtype: "ysm" });
    await flushPromises();

    expect(toasts.some((t) => t.msg.includes("统计失败") && t.type === "error")).toBe(true);
    expect(mocks.modalConfirm).not.toHaveBeenCalled();
  });

  it("count === 0 → info toast 不弹确认", async () => {
    mocks.CountInstanceResources.mockResolvedValue(0);
    await register();
    const { toasts } = spyEvents();

    bus.emit("instance:clear", { name: "TestPack", rtype: "ysm" });
    await flushPromises();

    expect(toasts.some((t) => t.msg.includes("没有可清空") && t.type === "info")).toBe(true);
    expect(mocks.modalConfirm).not.toHaveBeenCalled();
  });

  it("用户取消 → 已取消 toast，不调 ClearInstanceResources", async () => {
    mocks.modalConfirm.mockResolvedValue(false);
    await register();
    const { toasts } = spyEvents();

    bus.emit("instance:clear", { name: "TestPack", rtype: "ysm" });
    await flushPromises();

    expect(mocks.modalConfirm).toHaveBeenCalled();
    expect(mocks.ClearInstanceResources).not.toHaveBeenCalled();
    expect(toasts.some((t) => t.msg === "已取消")).toBe(true);
  });

  it("确认清空 → 调用 ClearInstanceResources + stats:refresh + 成功 toast", async () => {
    mocks.modalConfirm.mockResolvedValue(true);
    await register();
    const { toasts, refreshEvents } = spyEvents();

    bus.emit("instance:clear", { name: "TestPack", rtype: "ysm" });
    await flushPromises();
    await flushPromises();

    expect(mocks.ClearInstanceResources).toHaveBeenCalledWith("TestPack", "ysm");
    expect(refreshEvents.length).toBeGreaterThan(0);
    expect(toasts.some((t) => t.msg.includes("已清空 5 个文件") && t.type === "success")).toBe(true);
  });

  it("清空失败 → error toast", async () => {
    mocks.modalConfirm.mockResolvedValue(true);
    mocks.ClearInstanceResources.mockRejectedValue(new Error("disk error"));
    await register();
    const { toasts } = spyEvents();

    bus.emit("instance:clear", { name: "TestPack", rtype: "ysm" });
    await flushPromises();
    await flushPromises();

    expect(toasts.some((t) => t.msg.includes("清空失败") && t.type === "error")).toBe(true);
  });

  it("rtype 为空 → error toast，不调后端", async () => {
    await register();
    const { toasts } = spyEvents();

    bus.emit("instance:clear", { name: "TestPack", rtype: "" });
    await flushPromises();

    expect(toasts.some((t) => t.msg.includes("整合包缺少类型信息") && t.type === "error")).toBe(true);
    expect(mocks.CountInstanceResources).not.toHaveBeenCalled();
    expect(mocks.modalConfirm).not.toHaveBeenCalled();
  });

  it("registerInstanceOps 返回 unsub 函数可清理", async () => {
    const { registerInstanceOps } = await import("./instance-ops.ts");
    const myUnsubs: Array<() => void> = [];
    registerInstanceOps(myUnsubs);
    expect(myUnsubs.length).toBeGreaterThan(0);
    expect(() => myUnsubs.forEach((fn) => fn())).not.toThrow();
  });
});
