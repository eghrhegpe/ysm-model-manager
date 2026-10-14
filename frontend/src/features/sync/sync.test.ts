// @vitest-environment node
// ===== sync handler 测试：download-missing / toggle-status =====
// 覆盖：并发守卫、repoRoot 未配置、成功路径、finally 解锁、toggle 成功/失败聚合
// mock 基线来自 e2e/mock-data.ts（共享单源：改 Go 数据只改一处，防双源漂移）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { MOCK_DATA } from "../../../e2e/mock-data.ts";
import { flushPromises } from "@/test-utils/index.ts";
import { appFn, resetAppMock } from "@/test-utils/mock-app.ts";

// app mock：共享工厂 + 别名路径（归一写法，详见 test-utils/mock-app.ts 头注）
vi.mock("@/backend/app.ts", async () => {
  const { setupAppMock } = await import("@/test-utils/mock-app.ts");
  return setupAppMock();
});

// backend/app mock 为 fail-closed Proxy；appFn 取底层 vi.fn
const mocks = {
  ListVersionInstances: appFn("ListVersionInstances"),
  GetResourceInstanceStatus: appFn("GetResourceInstanceStatus"),
  InstallModelTo: appFn("InstallModelTo"),
  InstallResourceToInstance: appFn("InstallResourceToInstance"),
  PushSingleResourceToInstance: appFn("PushSingleResourceToInstance"),
  GetRepoRoot: appFn("GetRepoRoot"),
  InvalidateScanCache: appFn("InvalidateScanCache"),
  SyncModelToggleStatus: appFn("SyncModelToggleStatus"),
  SyncModelToggleStatusForType: appFn("SyncModelToggleStatusForType"),
  AddImportLog: appFn("AddImportLog"),
};

vi.mock("@/features/require-mcroot.ts", () => ({
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
  // code_review 7be20003 #1/#2/#5：InstallResourceToInstance 经 appFn 映射但原
  // beforeEach 未配置——旧 vi.hoisted 裸 fn 返回 undefined（成功语义）；新工厂
  // fail-closed（未配置即 throw），「非 YSM rtype → 走 InstallResourceToInstance」
  // 用例（L199-216）会命中 throw：sync 吞掉则静默假绿、不吞则 unhandled rejection。
  // 补回成功默认，让该用例继续验证成功分支。
  mocks.InstallResourceToInstance.mockResolvedValue(undefined);
  mocks.InvalidateScanCache.mockResolvedValue(undefined);
  mocks.SyncModelToggleStatus.mockResolvedValue([2, 1]);
  mocks.SyncModelToggleStatusForType.mockResolvedValue([4, 2]);
  mocks.AddImportLog.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  // B 簇（code_review 7be20003 #3/#4/#6）：isolate=false + shuffle 下 globalThis
  // store 跨文件存活，本文件配的实现/历史会残留给后跑文件——清回 fail-closed 起点
  resetAppMock();
});

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
  const refreshEvents: string[] = [];
  const reloadEvents: string[] = [];
  cleanups.push(
    bus.on("toast:show", (t) => toasts.push(t as { msg: string; type: string })),
    bus.on("stats:refresh", () => refreshEvents.push("stats:refresh")),
    bus.on("tree:reload", () => reloadEvents.push("tree:reload")),
  );
  return { toasts, refreshEvents, reloadEvents };
}

// ADR-340 去总线化：原 describe("registerSync — sync:download:missing") 的 bus 往返
// （emit missing → 等 done 回执）整段退役为 downloadMissing 直调——结果断言直接落在
// Promise 返回值上（ok/fail/skipped/skipReason），token/skipped 回执/静默宽限等
// 总线协议补丁的回归锁随实现退役（它们守护的是补丁本身）。
describe("downloadMissing — 导入缺失直调（ADR-340）", () => {
  it("成功路径：安装缺失文件，返回计数 + stats:refresh + tree:reload + 单包 toast", async () => {
    const { downloadMissing } = await import("./sync.ts");
    const { toasts, refreshEvents, reloadEvents } = spyEvents();

    const outcome = await downloadMissing({ instanceName: "PackA", rtype: "ysm" });

    expect(mocks.GetRepoRoot).toHaveBeenCalledWith("ysm");
    expect(mocks.InstallModelTo).toHaveBeenCalledWith(
      `${MOCK_DATA.GetRepoRoot}/a.ysm`,
      "/mc/instances/PackA/custom",
    );
    expect(refreshEvents.length).toBeGreaterThan(0);
    expect(outcome).toEqual({ ok: 1, fail: 0, skipped: false, errors: [] });
    expect(reloadEvents.length).toBeGreaterThan(0);
    expect(toasts.some((t) => t.msg.includes("PackA: 导入 1 成功"))).toBe(true);
  });

  it("ADR-310：MissingDirs 走 folder-aware 推送，不喂逐条 Install", async () => {
    const repo = MOCK_DATA.GetRepoRoot;
    // 仅目录单元（夹内无可逐文件安装的受支持文件，如只含 pack.mcmeta 的资源包夹）
    mocks.GetResourceInstanceStatus.mockResolvedValue([
      { Name: "PackA", Missing: [], MissingDirs: [`${repo}/rpA`] },
      { Name: "PackB", Missing: [], MissingDirs: [] },
    ]);
    mocks.PushSingleResourceToInstance.mockResolvedValue(undefined);
    const { downloadMissing } = await import("./sync.ts");
    const { toasts } = spyEvents();

    const outcome = await downloadMissing({ instanceName: "PackA", rtype: "resourcepack" });

    // 关键：目录必须走整夹推送（对目录走 InstallDir 装该夹本身），
    // 喂给 InstallResourceToInstance 会装成它的父目录（过度安装，ADR-310 §3）
    expect(mocks.PushSingleResourceToInstance).toHaveBeenCalledWith(
      "resourcepack",
      "PackA",
      `${repo}/rpA`,
    );
    expect(mocks.InstallResourceToInstance).not.toHaveBeenCalled();
    expect(mocks.InstallModelTo).not.toHaveBeenCalled();
    // 整夹安装计入成功数（徽章有数 ⇒ 一键安装有动作）
    expect(outcome).toEqual({ ok: 1, fail: 0, skipped: false, errors: [] });
    expect(toasts.some((t) => t.msg.includes("PackA: 导入 1 成功"))).toBe(true);
  });

  it("instanceName 为空 → 遍历全部实例", async () => {
    const { downloadMissing } = await import("./sync.ts");
    const { toasts } = spyEvents();

    const outcome = await downloadMissing({ rtype: "ysm" });

    // 只有 PackA 有 Missing，PackB 跳过
    expect(mocks.InstallModelTo).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: 1, fail: 0, skipped: false, errors: [] });
    expect(toasts.some((t) => t.msg.includes("全部导入完成: 1 成功"))).toBe(true);
  });

  it("repoRoot 未配置 → skipped config（warn toast，不安装，不触发 tree:reload）", async () => {
    mocks.GetRepoRoot.mockResolvedValue("");
    const { downloadMissing } = await import("./sync.ts");
    const { toasts, reloadEvents } = spyEvents();

    const outcome = await downloadMissing({ rtype: "ysm" });

    expect(toasts.some((t) => t.msg === "请先配置该资源类型目录" && t.type === "warn")).toBe(true);
    expect(mocks.InstallModelTo).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ok: 0, fail: 0, skipped: true, skipReason: "config" });
    // 配置缺失未做任何写操作 → 不广播全树重扫（P2 审核修复）
    expect(reloadEvents.length).toBe(0);
  });

  it("互斥守卫：首批在途时第二批并发 → skipped busy（模块级锁挡跨页并发写）", async () => {
    const { downloadMissing } = await import("./sync.ts");
    spyEvents();

    // 第一个请求挂起（InstallModelTo 未立即 resolve，锁保持占用）
    let resolveInstall: () => void = () => {};
    mocks.InstallModelTo.mockImplementationOnce(
      () => new Promise<void>((r) => { resolveInstall = r; }),
    );
    const first = downloadMissing({ instanceName: "PackA", rtype: "ysm" });
    await flushPromises();
    await flushPromises();

    // 第二个并发调用（锁占用中）——原总线实现回 done(skipped:busy)，直调即返回值
    const second = await downloadMissing({ instanceName: "PackB", rtype: "ysm" });
    expect(second).toEqual({ ok: 0, fail: 0, skipped: true, skipReason: "busy" });
    // 只有第一批执行了安装
    expect(mocks.InstallModelTo).toHaveBeenCalledTimes(1);

    resolveInstall();
    const firstOutcome = await first;
    expect(firstOutcome.skipped).toBe(false);
  });

  it("requireMcRoot 为空 → skipped config（mcRoot 守卫 toast 已弹，立即返回不安装）", async () => {
    const { requireMcRoot } = await import("@/features/require-mcroot.ts");
    (requireMcRoot as ReturnType<typeof vi.fn>).mockResolvedValueOnce("");
    const { downloadMissing } = await import("./sync.ts");
    const { toasts } = spyEvents();

    const outcome = await downloadMissing({ rtype: "ysm" });

    expect(outcome).toEqual({ ok: 0, fail: 0, skipped: true, skipReason: "config" });
    expect(toasts.some((t) => t.msg === "请先配置该资源类型目录")).toBe(false); // 未到 repoRoot 步
    expect(mocks.InstallModelTo).not.toHaveBeenCalled();
  });

  it("缺 rtype → 显式失败（error toast + skipped config），不静默降级 YSM", async () => {
    const { downloadMissing } = await import("./sync.ts");
    const { toasts } = spyEvents();

    // 故意违反契约（参数 rtype 必填）：runtime 守卫应显式失败而非降级
    const outcome = await downloadMissing({ instanceName: "PackA", rtype: "" });

    expect(mocks.GetRepoRoot).not.toHaveBeenCalled();
    expect(mocks.InstallModelTo).not.toHaveBeenCalled();
    // i18n 合规（P2 修复）：toast 文案必须走 t("sync.missingRtype")，不得硬编码
    const errToast = toasts.find((t) => t.type === "error")!;
    expect(errToast).toBeTruthy();
    expect(errToast.msg).toBe(t("sync.missingRtype"));
    expect(outcome).toEqual({ ok: 0, fail: 0, skipped: true, skipReason: "config" });
  });

  it("非 YSM rtype → 走 InstallResourceToInstance", async () => {
    const { downloadMissing } = await import("./sync.ts");
    spyEvents();
    mocks.GetResourceInstanceStatus.mockResolvedValue([
      { Name: "PackA", Missing: [`${MOCK_DATA.GetRepoRoot}/rp.zip`] },
    ]);

    await downloadMissing({ instanceName: "PackA", rtype: "pack" });

    expect(mocks.InstallResourceToInstance).toHaveBeenCalledWith(
      "pack",
      `${MOCK_DATA.GetRepoRoot}/rp.zip`,
      "PackA",
    );
    expect(mocks.InstallModelTo).not.toHaveBeenCalled();
  });

  // 锐评 P1-1 回归锁（止血 91e18f5ed → ADR-340 直调化）：文件级失败计数必达发起方。
  // 原总线时代计数走 done 载荷，直调后走 Promise 返回值——语义等价，断言面收窄。
  it("返回值携带 ok/fail 文件级计数（部分安装失败对发起方可见）", async () => {
    const repo = MOCK_DATA.GetRepoRoot;
    mocks.GetResourceInstanceStatus.mockResolvedValue([
      { Name: "PackA", Missing: [`${repo}/a.ysm`, `${repo}/b.ysm`, `${repo}/c.ysm`] },
    ]);
    // a 成功、b 失败、c 成功 → ok=2 fail=1
    mocks.InstallModelTo.mockImplementation((srcPath: string) =>
      srcPath.endsWith("b.ysm") ? Promise.reject(new Error("locked")) : Promise.resolve(),
    );
    const { downloadMissing } = await import("./sync.ts");
    spyEvents();

    const outcome = await downloadMissing({ instanceName: "PackA", rtype: "ysm" });

    expect(outcome).toEqual({ ok: 2, fail: 1, skipped: false, errors: expect.any(Array) });
    // 锐评 UX 高项收口（2026-10-14）：失败明细必点名——原 `catch { totalFail++ }` 吞错误
    expect(outcome.errors?.[0]).toContain("locked");
  });

  // 锐评 UX 高项收口（2026-10-14）：失败明细含包名 + 文件路径 + 友好缘由；上限 3 条
  it("失败明细带包名与文件路径，上限 3 条（防批量失败 toast 过长）", async () => {
    const repo = MOCK_DATA.GetRepoRoot;
    mocks.GetResourceInstanceStatus.mockResolvedValue([
      {
        Name: "PackA",
        Missing: [`${repo}/a.ysm`, `${repo}/b.ysm`, `${repo}/c.ysm`, `${repo}/d.ysm`, `${repo}/e.ysm`],
      },
    ]);
    mocks.InstallModelTo.mockRejectedValue(new Error("disk full"));
    const { downloadMissing } = await import("./sync.ts");
    spyEvents();

    const outcome = await downloadMissing({ instanceName: "PackA", rtype: "ysm" });

    expect(outcome.fail).toBe(5);
    expect(outcome.errors).toHaveLength(3); // 上限 3 条
    expect(outcome.errors?.[0]).toContain("PackA");
    expect(outcome.errors?.[0]).toContain("disk full");
  });

  // 锐评 UX 高项收口（2026-10-14）：InvalidateScanCache 失败不再只 dbg——
  // 「装成功却等不到新模型」是最困惑的反馈（用户会反复重试/怀疑安装失败），须用户可见。
  it("InvalidateScanCache 失败 → errors 携带可读缘由（装成功也须知情）", async () => {
    mocks.InvalidateScanCache.mockRejectedValueOnce(new Error("cache locked"));
    const { downloadMissing } = await import("./sync.ts");
    const { toasts } = spyEvents();

    const outcome = await downloadMissing({ instanceName: "PackA", rtype: "ysm" });

    // 安装本身成功（ok=1），但缓存失效失败必须点名
    expect(outcome.ok).toBe(1);
    expect(outcome.fail).toBe(0);
    expect(outcome.errors?.join(" ")).toContain("cache locked");
    // 单包模式 toast 必含该缘由（用户可见，非仅 dbg）
    expect(toasts.some((x) => String(x.msg).includes("cache locked"))).toBe(true);
  });

  // 锐评 P2-1 回归锁：批量模式（instanceNames）静默——「全部类型」推送每类型一次
  // 直调，逐类型 toast 会连珠炮（含 0 成功 0 失败）淹没发起方汇总。反馈权归发起方
  // （runPush 一条汇总）；单包/全遍历模式（无 instanceNames）照旧弹。
  it("批量模式（instanceNames）→ 不弹结果 toast（静默交发起方汇总）", async () => {
    const { downloadMissing } = await import("./sync.ts");
    const { toasts } = spyEvents();

    const outcome = await downloadMissing({ instanceNames: ["PackA", "PackB"], rtype: "ysm" });

    // 安装确实发生了（PackA 有 Missing），只是不弹结果 toast
    expect(mocks.InstallModelTo).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: 1, fail: 0, skipped: false, errors: [] });
    expect(toasts.some((t) => t.msg.includes("导入"))).toBe(false);
  });
});

describe("registerSync — sync:toggle:status", () => {
  // ADR-339：前端只读不判——类型枚举/实例目录解析下沉 Go（SyncModelToggleStatusForType），
  // 前端只透传 rtype + 消费聚合结果（[禁用数, 启用数]）。
  it("成功路径（带 rtype）：调 SyncModelToggleStatusForType，发 AddImportLog + stats:refresh", async () => {
    await register();
    const { toasts, refreshEvents } = spyEvents();

    bus.emit("sync:toggle:status", { rtype: "ysm" });
    await flushPromises();
    await flushPromises();

    expect(mocks.SyncModelToggleStatusForType).toHaveBeenCalledWith("ysm");
    expect(mocks.AddImportLog).toHaveBeenCalledWith(
      "sync-status",
      expect.stringContaining("同步状态"),
      "",
      0,
      "success",
      expect.stringContaining("禁用 4 启用 2"),
    );
    expect(toasts.some((t) => t.msg.includes("禁用 4 项") && t.msg.includes("启用 2 项"))).toBe(true);
    expect(refreshEvents.length).toBeGreaterThan(0);
  });

  it("缺省 rtype → 传空串（Go 侧覆盖全部 dirLevelSync 类型）", async () => {
    await register();
    const { refreshEvents } = spyEvents();

    bus.emit("sync:toggle:status", {});
    await flushPromises();
    await flushPromises();

    expect(mocks.SyncModelToggleStatusForType).toHaveBeenCalledWith("");
    expect(refreshEvents.length).toBeGreaterThan(0);
  });

  it("同步失败（binding reject）→ 写「同步失败」日志 + error toast + tree:reload", async () => {
    mocks.SyncModelToggleStatusForType.mockRejectedValueOnce(new Error("locked"));
    await register();
    const { toasts, reloadEvents } = spyEvents();

    bus.emit("sync:toggle:status", { rtype: "ysm" });
    await flushPromises();
    await flushPromises();

    expect(mocks.AddImportLog).toHaveBeenCalledWith(
      "sync-status",
      "同步失败",
      "",
      0,
      "failed",
      expect.stringContaining("locked"),
    );
    expect(toasts.some((t) => t.type === "error")).toBe(true);
    expect(reloadEvents.length).toBeGreaterThan(0);
  });

  it("并发守卫：busy 命中时发 info toast 提示，不静默吞事件", async () => {
    await register();
    const { toasts } = spyEvents();

    // 第一个请求挂起（SyncModelToggleStatusForType 未立即 resolve）
    let resolveToggle: () => void = () => {};
    mocks.SyncModelToggleStatusForType.mockImplementationOnce(
      () => new Promise<void>((r) => { resolveToggle = r; }),
    );
    bus.emit("sync:toggle:status", { rtype: "ysm" });
    await flushPromises();

    // 第二次触发（此时 busy=true）→ 应发提示 toast 而非静默 return；记录调用数不新增
    const callsBeforeSecond = mocks.SyncModelToggleStatusForType.mock.calls.length;
    bus.emit("sync:toggle:status", { rtype: "ysm" });
    await flushPromises();

    expect(toasts.some((t) => t.msg === "同步进行中，已跳过本次" && t.type === "info")).toBe(true);
    expect(mocks.SyncModelToggleStatusForType.mock.calls.length).toBe(callsBeforeSecond);

    resolveToggle();
    await flushPromises();
    await flushPromises();
  });
});
