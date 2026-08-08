// ===== sync handler 测试：download-missing / toggle-status =====
// 覆盖：并发守卫、repoRoot 未配置、成功路径、finally 解锁、toggle 成功/失败聚合
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../../bus.ts";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    ListVersionInstances: vi.fn(),
    GetResourceInstanceStatus: vi.fn(),
    InstallModelTo: vi.fn(),
    InstallResourceToInstance: vi.fn(),
    GetRepoRoot: vi.fn(),
    InvalidateScanCache: vi.fn(),
    SyncModelToggleStatus: vi.fn(),
    AddImportLog: vi.fn(),
  };
  return { mocks };
});

vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ListVersionInstances: mocks.ListVersionInstances,
    GetResourceInstanceStatus: mocks.GetResourceInstanceStatus,
    InstallModelTo: mocks.InstallModelTo,
    InstallResourceToInstance: mocks.InstallResourceToInstance,
    GetRepoRoot: mocks.GetRepoRoot,
    InvalidateScanCache: mocks.InvalidateScanCache,
    SyncModelToggleStatus: mocks.SyncModelToggleStatus,
    AddImportLog: mocks.AddImportLog,
  }),
}));

vi.mock("./require-mcroot.ts", () => ({
  requireMcRoot: vi.fn().mockResolvedValue("/mc"),
}));

// 统一清理：每个用例结束后移除本次注册的全部 bus handler（含被测 handler）
let cleanups: Array<() => void> = [];

beforeEach(() => {
  cleanups = [];
  vi.clearAllMocks();
  mocks.ListVersionInstances.mockResolvedValue([
    { Name: "PackA", CustomDir: "/mc/instances/PackA/custom", Exists: true },
    { Name: "PackB", CustomDir: "/mc/instances/PackB/custom", Exists: true },
  ]);
  mocks.GetRepoRoot.mockResolvedValue("/repo");
  mocks.GetResourceInstanceStatus.mockResolvedValue([
    { Name: "PackA", Missing: ["/repo/a.ysm"] },
    { Name: "PackB", Missing: [] },
  ]);
  mocks.InstallModelTo.mockResolvedValue(undefined);
  mocks.InvalidateScanCache.mockResolvedValue(undefined);
  mocks.SyncModelToggleStatus.mockResolvedValue([2, 1]);
  mocks.AddImportLog.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
});

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 注册被测 handler 并登记清理 */
async function register(): Promise<void> {
  const { registerSync } = await import("./sync.ts");
  const unsubs: Array<() => void> = [];
  registerSync(unsubs);
  cleanups.push(...unsubs);
}

/** 监听 toast / 事件并登记清理 */
function spyEvents() {
  const toasts: Array<{ msg: string; type: string }> = [];
  const doneEvents: Array<{ token?: string }> = [];
  const refreshEvents: string[] = [];
  const reloadEvents: string[] = [];
  cleanups.push(
    bus.on("toast:show", (t) => toasts.push(t as { msg: string; type: string })),
    bus.on("sync:download:done", (e) => doneEvents.push(e as { token?: string })),
    bus.on("stats:refresh", () => refreshEvents.push("stats:refresh")),
    bus.on("tree:reload", () => reloadEvents.push("tree:reload")),
  );
  return { toasts, doneEvents, refreshEvents, reloadEvents };
}

describe("registerSync — sync:download:missing", () => {
  it("成功路径：安装缺失文件，发 stats:refresh + done + tree:reload", async () => {
    await register();
    const { toasts, doneEvents, refreshEvents, reloadEvents } = spyEvents();

    bus.emit("sync:download:missing", { instanceName: "PackA", rtype: "ysm", token: "t1" });
    await flush();
    await flush();

    expect(mocks.GetRepoRoot).toHaveBeenCalledWith("ysm");
    expect(mocks.InstallModelTo).toHaveBeenCalledWith("/repo/a.ysm", "/mc/instances/PackA/custom");
    expect(refreshEvents.length).toBeGreaterThan(0);
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].token).toBe("t1");
    expect(reloadEvents.length).toBeGreaterThan(0);
    expect(toasts.some((t) => t.msg.includes("PackA: 导入 1 成功"))).toBe(true);
  });

  it("instanceName 为空 → 遍历全部实例", async () => {
    await register();
    const { toasts } = spyEvents();

    bus.emit("sync:download:missing", { instanceName: "", rtype: "ysm", token: "t2" });
    await flush();
    await flush();

    // 只有 PackA 有 Missing，PackB 跳过
    expect(mocks.InstallModelTo).toHaveBeenCalledTimes(1);
    expect(toasts.some((t) => t.msg.includes("全部导入完成: 1 成功"))).toBe(true);
  });

  it("repoRoot 未配置 → warn toast，不安装", async () => {
    mocks.GetRepoRoot.mockResolvedValue("");
    await register();
    const { toasts, doneEvents } = spyEvents();

    bus.emit("sync:download:missing", { instanceName: "", rtype: "ysm", token: "t3" });
    await flush();

    expect(toasts.some((t) => t.msg === "请先配置该资源类型目录" && t.type === "warn")).toBe(true);
    expect(mocks.InstallModelTo).not.toHaveBeenCalled();
    // finally 仍然执行
    expect(doneEvents.length).toBe(1);
  });

  it("并发守卫：连点两次只执行一次安装", async () => {
    await register();
    const { doneEvents } = spyEvents();

    // 第一个请求挂起（InstallModelTo 未立即 resolve）
    let resolveInstall: () => void = () => {};
    mocks.InstallModelTo.mockImplementationOnce(
      () => new Promise<void>((r) => { resolveInstall = r; }),
    );
    bus.emit("sync:download:missing", { instanceName: "PackA", rtype: "ysm", token: "t4" });
    await flush();

    // 第二次触发（此时 busy=true）
    bus.emit("sync:download:missing", { instanceName: "PackA", rtype: "ysm", token: "t5" });
    await flush();

    resolveInstall();
    await flush();
    await flush();

    // 只有第一次执行了安装
    expect(mocks.InstallModelTo).toHaveBeenCalledTimes(1);
    // P1 修复后契约：busy 命中的第二个请求也回 done（带 skipped）——调用方（app-sidebar）
    // 得以立即解锁而非 30s 超时；断言 2 个 done（1 正常 + 1 skipped）
    expect(doneEvents.length).toBe(2);
    expect(doneEvents.filter((d) => d.skipped).length).toBe(1);
  });

  it("requireMcRoot 为空 → 直接返回但 finally 解锁", async () => {
    const { requireMcRoot } = await import("./require-mcroot.ts");
    (requireMcRoot as ReturnType<typeof vi.fn>).mockResolvedValueOnce("");
    await register();
    const { doneEvents } = spyEvents();

    bus.emit("sync:download:missing", { instanceName: "", rtype: "ysm", token: "t6" });
    await flush();

    expect(doneEvents.length).toBe(1);
  });

  it("非 YSM rtype → 走 InstallResourceToInstance", async () => {
    await register();
    spyEvents();
    mocks.GetResourceInstanceStatus.mockResolvedValue([
      { Name: "PackA", Missing: ["/repo/rp.zip"] },
    ]);

    bus.emit("sync:download:missing", { instanceName: "PackA", rtype: "pack", token: "t7" });
    await flush();
    await flush();

    expect(mocks.InstallResourceToInstance).toHaveBeenCalledWith("pack", "/repo/rp.zip", "PackA");
    expect(mocks.InstallModelTo).not.toHaveBeenCalled();
  });
});

describe("registerSync — sync:toggle:status", () => {
  it("成功路径：聚合禁用/启用数，发 AddImportLog + stats:refresh", async () => {
    await register();
    const { toasts, refreshEvents } = spyEvents();

    bus.emit("sync:toggle:status");
    await flush();
    await flush();

    expect(mocks.SyncModelToggleStatus).toHaveBeenCalledTimes(2); // 两个实例
    expect(mocks.AddImportLog).toHaveBeenCalledWith(
      "sync-status",
      expect.stringContaining("同步状态"),
      "/repo",
      0,
      "success",
      expect.stringContaining("禁用 4 启用 2"),
    );
    expect(toasts.some((t) => t.msg.includes("禁用 4 项") && t.msg.includes("启用 2 项"))).toBe(true);
    expect(refreshEvents.length).toBeGreaterThan(0);
  });

  it("无实例 → info toast '没有找到整合包'", async () => {
    mocks.ListVersionInstances.mockResolvedValue([]);
    await register();
    const { toasts } = spyEvents();

    bus.emit("sync:toggle:status");
    await flush();

    expect(toasts.some((t) => t.msg === "没有找到整合包" && t.type === "info")).toBe(true);
    expect(mocks.SyncModelToggleStatus).not.toHaveBeenCalled();
  });

  it("单个实例同步失败 → 聚合错误但不中断", async () => {
    mocks.SyncModelToggleStatus
      .mockResolvedValueOnce([1, 0])
      .mockRejectedValueOnce(new Error("locked"));
    await register();
    const { toasts } = spyEvents();

    bus.emit("sync:toggle:status");
    await flush();
    await flush();

    expect(mocks.AddImportLog).toHaveBeenCalledWith(
      "sync-status",
      expect.any(String),
      "/repo",
      0,
      "failed",
      expect.stringContaining("locked"),
    );
    // 有成功项（禁用 1 项）→ toast 仍为 success；错误已在 AddImportLog 中记录
    expect(toasts.some((t) => t.type === "success")).toBe(true);
  });

  it("repoRoot/mcRoot 未配置 → warn toast", async () => {
    mocks.GetRepoRoot.mockResolvedValue("");
    await register();
    const { toasts } = spyEvents();

    bus.emit("sync:toggle:status");
    await flush();

    expect(toasts.some((t) => t.msg === "请先配置目录" && t.type === "warn")).toBe(true);
  });
});
