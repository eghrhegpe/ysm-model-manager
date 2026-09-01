// ===== loadOldestModel 资历最深/评分/热力图/每日推荐测试 =====
// 覆盖：空仓库、未配置目录、正常渲染（评分/热力图/资历最深/推荐）、rtype 切换、清理函数、点击选模型
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../bus.ts";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    ScanModelEntries: vi.fn(),
    GetRepoRoot: vi.fn(),
    RepoHealthAudit: vi.fn(),
  };
  return { mocks };
});

vi.mock("../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ScanModelEntriesWithLabel: mocks.ScanModelEntries,
    GetRepoRoot: mocks.GetRepoRoot,
    RepoHealthAudit: mocks.RepoHealthAudit,
  }),
}));

vi.mock("../utils/resource/registry.ts", () => ({
  loadResourceRegistry: vi.fn().mockResolvedValue({
    ysm: { icon: "📦" },
    mmd: { icon: "🎭" },
  }),
}));

// 固定随机数，保证每日推荐可断言
// 注意：不能使用 vi.restoreAllMocks() —— 它会清掉 vi.mock factory 中 getApp 的
// mockResolvedValue 实现，导致后续测试 getApp() 返回 undefined
let randomSpy: ReturnType<typeof vi.spyOn> | null = null;
// model:select 测试监听器（afterEach 用 unsub 精确清理）
let unsubModelSelect: (() => void) | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.1);
  mocks.GetRepoRoot.mockResolvedValue("/repo");
  mocks.RepoHealthAudit.mockResolvedValue(auditReport());
  localStorage.setItem("repo_rtype", "ysm");
});

afterEach(() => {
  randomSpy?.mockRestore();
  randomSpy = null;
  unsubModelSelect?.();
  unsubModelSelect = null;
  localStorage.removeItem("repo_rtype");
});

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 构造 RepoHealthAudit 合法返回（字段与 go/repoaudit.HealthReport 对齐；ADR-143 P1 后 typed） */
function auditReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timestamp: "2026-08-30T00:00:00Z",
    directory: "/repo",
    score: 87,
    completeness: { checked: 3, valid: 3, invalid: 0, percentage: 100 },
    cache: { cache_dir: "", cache_files: 0, cache_size: 0, hit_rate: 0 },
    resources: { total_files: 7, total_size: 1051136, banned: 1, by_type: {} },
    dedup: { groups: 0, extra_files: 0, reclaim_bytes: 0 },
    ...overrides,
  };
}

const sampleEntries = [
  { Name: "oldest.ysm", Size: 2048, Path: "/repo/oldest.ysm", Ext: ".ysm", Hash: "h1", ModTime: Date.now() - 365 * 86400000 },
  { Name: "new.ysm", Size: 1048576, Path: "/repo/new.ysm", Ext: ".ysm", Hash: "h2", ModTime: Date.now() - 1000 },
  { Name: "banned.ysm.ban", Size: 512, Path: "/repo/banned.ysm.ban", Ext: ".ban", Hash: "h3", ModTime: Date.now() - 5000 },
];

/** 启动一个被 GetRepoRoot 挂起的 loadOldestModel，供“慢请求过期”类用例复用 */
async function setupPendingRoot(): Promise<{
  resolveFirst: (v: string) => void;
  rejectFirst: (e: Error) => void;
  container: HTMLDivElement;
  loadPromise: Promise<() => void>;
}> {
  let resolveFirst!: (v: string) => void;
  let rejectFirst!: (e: Error) => void;
  const firstRoot = new Promise<string>((resolve, reject) => {
    resolveFirst = resolve;
    rejectFirst = reject;
  });
  mocks.ScanModelEntries.mockResolvedValue(sampleEntries);
  mocks.GetRepoRoot.mockImplementationOnce(() => firstRoot);
  const { loadOldestModel } = await import("./oldest-models.ts");
  const container = document.createElement("div");
  const loadPromise = loadOldestModel(container, (s) => s);
  return { resolveFirst, rejectFirst, container, loadPromise };
}

describe("loadOldestModel", () => {
  it("container 为空 → 返回空清理函数", async () => {
    const { loadOldestModel } = await import("./oldest-models.ts");
    const cleanup = await loadOldestModel(null as unknown as HTMLElement, (s) => s);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("未配置目录 → 显示请先配置提示", async () => {
    mocks.GetRepoRoot.mockResolvedValue("");
    const { loadOldestModel } = await import("./oldest-models.ts");
    const container = document.createElement("div");
    const cleanup = await loadOldestModel(container, (s) => s);
    expect(container.textContent).toContain("请先配置该资源类型目录");
    cleanup();
  });

  it("空仓库 → 显示该类型仓库为空", async () => {
    mocks.ScanModelEntries.mockResolvedValue([]);
    const { loadOldestModel } = await import("./oldest-models.ts");
    const container = document.createElement("div");
    const cleanup = await loadOldestModel(container, (s) => s);
    await flush();
    expect(container.textContent).toContain("该类型仓库为空");
    cleanup();
  });

  it("正常渲染：评分/热力图/资历最深/推荐都在", async () => {
    mocks.ScanModelEntries.mockResolvedValue(sampleEntries);
    const { loadOldestModel } = await import("./oldest-models.ts");
    const container = document.createElement("div");
    const cleanup = await loadOldestModel(container, (s) => s);
    await flush();
    await flush();

    const html = container.innerHTML;
    expect(html).toContain("仓库评分");
    expect(html).toContain("资历最深");
    expect(html).toContain("月度活动");
    expect(html).toContain("每日推荐");
    // 资历最深卡片按 ModTime 升序：oldest.ysm（-365d）→ banned（-5s）→ new（-1s）
    const paths = [...container.querySelectorAll(".model-card-sm")].map(
      (el) => el.getAttribute("data-path"),
    );
    expect(paths).toEqual(["/repo/oldest.ysm", "/repo/banned.ysm.ban", "/repo/new.ysm"]);
    // 评分/禁用/重复统计均来自 RepoHealthAudit（mock 报告 score=87, banned=1）
    expect(mocks.RepoHealthAudit).toHaveBeenCalledWith("/repo");
    expect(html).toContain('oldest-health-ring-num">87<');
    expect(html).toContain("🚫 1");
    expect(html).toContain("🔗 0");
    // 同屏双口径修复：count pill 走 audit 仓库域 total_files（=7），
    // 不再用 ScanModelEntriesWithLabel 的类型域 entries.length（=3）
    expect(html).toContain("📄 7");
    expect(html).not.toContain("📄 3");
    cleanup();
  });

  it("点击卡片 → bus.emit model:select", async () => {
    mocks.ScanModelEntries.mockResolvedValue(sampleEntries);
    const selected: Array<{ path: string }> = [];
    unsubModelSelect = bus.on("model:select", (p) => selected.push(p as { path: string }));
    const { loadOldestModel } = await import("./oldest-models.ts");
    const container = document.createElement("div");
    const cleanup = await loadOldestModel(container, (s) => s);
    await flush();
    await flush();

    const card = container.querySelector('[data-path="/repo/oldest.ysm"]') as HTMLElement | null;
    expect(card).not.toBeNull();
    card!.click();
    expect(selected.length).toBe(1);
    expect(selected[0].path).toBe("/repo/oldest.ysm");
    cleanup();
  });

  it("rtype 切换 → 重新渲染且清理后无泄漏", async () => {
    mocks.ScanModelEntries.mockResolvedValue(sampleEntries);
    const { loadOldestModel } = await import("./oldest-models.ts");
    const container = document.createElement("div");
    const cleanup = await loadOldestModel(container, (s) => s);
    await flush();
    await flush();

    // 切换类型
    bus.emit("repo:rtype-changed", "mmd");
    await flush();
    await flush();

    expect(mocks.ScanModelEntries).toHaveBeenCalledTimes(2);
    expect(mocks.GetRepoRoot).toHaveBeenLastCalledWith("mmd");
    cleanup();
    // 清理后再次切换不应再触发渲染
    const callsBefore = mocks.ScanModelEntries.mock.calls.length;
    bus.emit("repo:rtype-changed", "ysm");
    await flush();
    expect(mocks.ScanModelEntries.mock.calls.length).toBe(callsBefore);
  });

  it("加载失败 → 显示错误信息", async () => {
    mocks.ScanModelEntries.mockRejectedValue(new Error("scan crashed"));
    const { loadOldestModel } = await import("./oldest-models.ts");
    const container = document.createElement("div");
    const cleanup = await loadOldestModel(container, (s) => s);
    await flush();
    await flush();
    expect(container.textContent).toContain("加载失败");
    expect(container.textContent).toContain("scan crashed");
    cleanup();
  });

  it("GetRepoRoot 失败 → 显示错误信息", async () => {
    mocks.ScanModelEntries.mockResolvedValue(sampleEntries);
    mocks.GetRepoRoot.mockRejectedValue(new Error("root boom"));
    const { loadOldestModel } = await import("./oldest-models.ts");
    const container = document.createElement("div");
    const cleanup = await loadOldestModel(container, (s) => s);
    await flush();
    await flush();
    expect(container.textContent).toContain("加载失败");
    expect(container.textContent).toContain("root boom");
    cleanup();
  });

  it("慢请求过期（幽灵路径防护）→ 结果丢弃，新类型正常渲染", async () => {
    const { resolveFirst, container, loadPromise } = await setupPendingRoot();

    // 挂起期间切换类型 → render#2 用新类型 root 走完整渲染
    bus.emit("repo:rtype-changed", "mmd");
    await flush();
    await flush();
    expect(mocks.GetRepoRoot).toHaveBeenLastCalledWith("mmd");
    expect(container.textContent).toContain("仓库评分");

    // 旧请求此刻才返回 → gen 已过期必须丢弃（不得再走 ScanModelEntries）
    resolveFirst("/stale-root");
    const cleanup = await loadPromise;
    await flush();

    expect(mocks.ScanModelEntries).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("/stale-root");
    cleanup();
  });

  it("过期加载失败 → 错误不覆盖新类型内容", async () => {
    const { rejectFirst, container, loadPromise } = await setupPendingRoot();

    bus.emit("repo:rtype-changed", "mmd");
    await flush();
    await flush();
    expect(container.textContent).toContain("仓库评分"); // render#2 已渲染

    rejectFirst(new Error("stale boom"));
    const cleanup = await loadPromise;
    await flush();

    // 过期错误被 gen 守卫丢弃，不得覆盖新内容
    expect(container.textContent).toContain("仓库评分");
    expect(container.textContent).not.toContain("stale boom");
    cleanup();
  });

  it("低评分健康 + 重复分组：分数/徽章/重复统计正确", async () => {
    mocks.RepoHealthAudit.mockResolvedValue(
      auditReport({ score: 45, dedup: { groups: 1, extra_files: 3, reclaim_bytes: 30 } }),
    );
    mocks.ScanModelEntries.mockResolvedValue([
      { Name: "a.ysm.ban", Size: 10, Path: "/r/a.ysm.ban", Ext: ".ban", ModTime: Date.now() - 1000 },
      { Name: "b.ysm.ban", Size: 10, Path: "/r/b.ysm.ban", Ext: ".ban", ModTime: Date.now() - 2000 },
      { Name: "c.ysm", Size: 10, Path: "/r/c.ysm", Ext: ".ysm", ModTime: Date.now() - 3000 },
    ]);
    const { loadOldestModel } = await import("./oldest-models.ts");
    const container = document.createElement("div");
    const cleanup = await loadOldestModel(container, (s) => s);
    await flush();
    await flush();

    const html = container.innerHTML;
    // 分数/徽章直接来自 Go 审计报告（score=45, dedup.groups=1）
    expect(html).toContain('oldest-health-ring-num">45<');
    expect(html).toContain('health-tag bad');
    expect(html).toContain("🔗 1");
    cleanup();
  });

  it("RepoHealthAudit 失败 → 显示错误信息", async () => {
    mocks.RepoHealthAudit.mockRejectedValue(new Error("audit crashed"));
    const { loadOldestModel } = await import("./oldest-models.ts");
    const container = document.createElement("div");
    const cleanup = await loadOldestModel(container, (s) => s);
    await flush();
    await flush();
    expect(container.textContent).toContain("加载失败");
    expect(container.textContent).toContain("audit crashed");
    cleanup();
  });

  it("RepoHealthAudit 返回后端业务错误 → 显示错误信息", async () => {
    mocks.RepoHealthAudit.mockRejectedValue(new Error("审计目录不可用"));
    const { loadOldestModel } = await import("./oldest-models.ts");
    const container = document.createElement("div");
    const cleanup = await loadOldestModel(container, (s) => s);
    await flush();
    await flush();
    expect(container.textContent).toContain("加载失败");
    expect(container.textContent).toContain("审计目录不可用");
    cleanup();
  });

  it("全部条目 ModTime 无效 → 资历最深区为空但不报错", async () => {
    const badEntries = [
      { Name: "x.ysm", Size: 10, Path: "/r/x.ysm", Ext: ".ysm", Hash: "h1", ModTime: 0 },
      { Name: "y.ysm", Size: 10, Path: "/r/y.ysm", Ext: ".ysm", Hash: "h2", ModTime: NaN },
    ];
    mocks.ScanModelEntries.mockResolvedValue(badEntries);
    const { loadOldestModel } = await import("./oldest-models.ts");
    const container = document.createElement("div");
    const cleanup = await loadOldestModel(container, (s) => s);
    await flush();
    await flush();

    expect(container.querySelectorAll(".model-card-sm").length).toBe(0);
    expect(container.querySelectorAll(".oldest-cards-row").length).toBe(0);
    expect(container.textContent).toContain("仓库评分");
    cleanup();
  });

  it("rtype 相同 → 不触发重新渲染", async () => {
    mocks.ScanModelEntries.mockResolvedValue(sampleEntries);
    const { loadOldestModel } = await import("./oldest-models.ts");
    const container = document.createElement("div");
    const cleanup = await loadOldestModel(container, (s) => s);
    await flush();
    await flush();

    const callsBefore = mocks.ScanModelEntries.mock.calls.length;
    bus.emit("repo:rtype-changed", "ysm"); // 当前即 ysm
    await flush();
    expect(mocks.ScanModelEntries.mock.calls.length).toBe(callsBefore);
    cleanup();
  });
});
