// @vitest-environment node
// ===== sync handler 测试：download-missing / toggle-status =====
// 覆盖：并发守卫、repoRoot 未配置、成功路径、finally 解锁、toggle 成功/失败聚合
// mock 基线来自 e2e/mock-data.ts（共享单源：改 Go 数据只改一处，防双源漂移）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { MOCK_DATA } from "../../../e2e/mock-data.ts";

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

vi.mock("../../backend/app.ts", () => ({
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
  // 共享基线：repoRoot 取 MOCK_DATA 值（/e2e/repo），与 e2e 一致
  const repo = MOCK_DATA.GetRepoRoot;
  mocks.GetRepoRoot.mockResolvedValue(repo);
  mocks.GetResourceInstanceStatus.mockResolvedValue([
    { Name: "PackA", Missing: [`${repo}/a.ysm`] },
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
  // P1 修复（code_review）：doneEvents 元素类型补 skipped——原 { token?: string }
  // 缺该字段，新断言 d.skipped 在 tsc --noEmit（strict）下 TS2339 报错
  const doneEvents: Array<{ token?: string; skipped?: boolean }> = [];
  const refreshEvents: string[] = [];
  const reloadEvents: string[] = [];
  cleanups.push(
    bus.on("toast:show", (t) => toasts.push(t as { msg: string; type: string })),
    bus.on("sync:download:done", (e) => doneEvents.push(e)),
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
    expect(mocks.InstallModelTo).toHaveBeenCalledWith(
      `${MOCK_DATA.GetRepoRoot}/a.ysm`,
      "/mc/instances/PackA/custom",
    );
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

  it("repoRoot 未配置 → warn toast，不安装，不触发 tree:reload", async () => {
    mocks.GetRepoRoot.mockResolvedValue("");
    await register();
    const { toasts, doneEvents, reloadEvents } = spyEvents();

    bus.emit("sync:download:missing", { instanceName: "", rtype: "ysm", token: "t3" });
    await flush();
    await flush();

    expect(toasts.some((t) => t.msg === "请先配置该资源类型目录" && t.type === "warn")).toBe(true);
    expect(mocks.InstallModelTo).not.toHaveBeenCalled();
    // finally 仍然执行
    expect(doneEvents.length).toBe(1);
    // 配置缺失未做任何写操作 → 不广播全树重扫（P2 审核修复）
    expect(reloadEvents.length).toBe(0);
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

  it("缺 rtype → 显式失败（error toast + done skipped），不静默降级 YSM", async () => {
    await register();
    const { toasts, doneEvents } = spyEvents();

    // 故意违反契约（bus.ts 已声明 rtype 必填）：runtime 守卫应显式失败而非降级
    bus.emit("sync:download:missing", { instanceName: "PackA", token: "t8" } as unknown as { instanceName?: string; rtype: string; token?: string });
    await flush();
    await flush();

    expect(mocks.GetRepoRoot).not.toHaveBeenCalled();
    expect(mocks.InstallModelTo).not.toHaveBeenCalled();
    // i18n 合规（P2 修复）：toast 文案必须走 t("sync.missingRtype")，
    // 不得硬编码、不得向用户暴露内部事件名 "sync:download:missing"
    const errToast = toasts.find((t) => t.type === "error")!;
    expect(errToast).toBeTruthy();
    expect(errToast.msg).toBe(t("sync.missingRtype"));
    expect(errToast.msg).not.toContain("sync:download:missing");
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].skipped).toBe(true);
  });

  it("非 YSM rtype → 走 InstallResourceToInstance", async () => {
    await register();
    spyEvents();
    mocks.GetResourceInstanceStatus.mockResolvedValue([
      { Name: "PackA", Missing: [`${MOCK_DATA.GetRepoRoot}/rp.zip`] },
    ]);

    bus.emit("sync:download:missing", { instanceName: "PackA", rtype: "pack", token: "t7" });
    await flush();
    await flush();

    expect(mocks.InstallResourceToInstance).toHaveBeenCalledWith(
      "pack",
      `${MOCK_DATA.GetRepoRoot}/rp.zip`,
      "PackA",
    );
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
      MOCK_DATA.GetRepoRoot,
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
      MOCK_DATA.GetRepoRoot,
      0,
      "failed",
      expect.stringContaining("locked"),
    );
    // P3 修复（审核发现）：有成功项（禁用 1 项）但存在错误 → toast 应为 warn，
    // 与 AddImportLog 的 "failed" 一致（旧断言固化了「有错误仍报 success」的矛盾行为）
    expect(toasts.some((t) => t.type === "warn" && t.msg.includes("同步完成"))).toBe(true);
  });

  it("repoRoot/mcRoot 未配置 → warn toast", async () => {
    mocks.GetRepoRoot.mockResolvedValue("");
    await register();
    const { toasts } = spyEvents();

    bus.emit("sync:toggle:status");
    await flush();

    expect(toasts.some((t) => t.msg === "请先配置目录" && t.type === "warn")).toBe(true);
  });

  it("并发守卫：busy 命中时发 info toast 提示，不静默吞事件", async () => {
    await register();
    const { toasts } = spyEvents();

    // 第一个请求挂起（SyncModelToggleStatus 未立即 resolve）
    let resolveToggle: () => void = () => {};
    mocks.SyncModelToggleStatus.mockImplementationOnce(
      () => new Promise<void>((r) => { resolveToggle = r; }),
    );
    bus.emit("sync:toggle:status");
    await flush();

    // 第二次触发（此时 busy=true）→ 应发提示 toast 而非静默 return
    // 挂起的是第一个实例的调用，循环阻塞中；记录当前调用数，第二次 emit 不应新增
    const callsBeforeSecond = mocks.SyncModelToggleStatus.mock.calls.length;
    bus.emit("sync:toggle:status");
    await flush();

    expect(toasts.some((t) => t.msg === "同步进行中，已跳过本次" && t.type === "info")).toBe(true);
    expect(mocks.SyncModelToggleStatus.mock.calls.length).toBe(callsBeforeSecond);

    resolveToggle();
    await flush();
    await flush();
  });
});
