// @vitest-environment node
// ===== sidebar 数据加载层测试 =====
// loadInstances：失败路径 toast / 在途去重 / force 绕过 / ADR-310 计数消费口径。
// （旧 groupMmdVariants 前端本地聚合已删除——MMD 变体聚合回归 Go 面板链）
import { describe, it, expect, vi } from "vitest";
import { loadInstances } from "./loader.ts";
import { bus } from "@/bus";

// 阻断 Wails runtime 加载链：loader.ts 顶部静态 import bindings → @wailsio/runtime
// （其 drag.js 在模块加载时访问 window，jsdom teardown 后延迟回调触发
// "window is not defined" 环境噪声）。
vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  LoadAppConfig: vi.fn(),
  ListVersionInstances: vi.fn(),
  GetResourceInstanceStatus: vi.fn(),
  GetRepoRoot: vi.fn(),
}));

// node 环境无 window，getApp() 在 app.ts 中访问 window.go 前就崩溃。
// mock 整个 app.ts 使 loadInstances 直接拿到 mock bindings。
const { getAppMock } = vi.hoisted(() => ({ getAppMock: vi.fn() }));
vi.mock("@/backend/app.ts", () => ({ getApp: getAppMock }));

describe("loadInstances", () => {
  /** 设置 getAppMock 返回 mock bindings，返回各 mock 函数供测试配置 */
  function mockBindings() {
    const mocks = {
      LoadAppConfig: vi.fn(),
      ListVersionInstances: vi.fn(),
      GetResourceInstanceStatus: vi.fn(),
      GetRepoRoot: vi.fn(),
    };
    getAppMock.mockResolvedValue(mocks);
    return mocks;
  }

  // 2026-10 P0 修复回归锁：失败不再伪装成空列表——原 catch 吞错 return []，
  // 调用方（_reload）无法区分「真没装整合包」与「读取失败」，把加载失败渲染成
  // 空态 + 配目录按钮，误导用户。现契约：reject（toast 保留，供无调用方场景兜底）。
  it("加载失败 → reject + toast 提示（不再 resolve 空列表伪装成功）", async () => {
    const { LoadAppConfig } = mockBindings();
    LoadAppConfig.mockRejectedValue(new Error("boom"));
    const toasts: Array<{ msg?: string }> = [];
    const offs = [
      bus.on("toast:show", (p) => toasts.push(p)),
    ];
    try {
      await expect(loadInstances("ysm")).rejects.toThrow("boom");
      // 失败不静默：toast 提示；loading 孤儿已删除，不再配对
      expect(toasts.some((t) => (t.msg || "").includes("整合包列表加载失败"))).toBe(true);
    } finally {
      offs.forEach((fn) => fn());
    }
  });

  it("mcRoot 未配置 → 空列表且不 toast（非错误场景）", async () => {
    const { LoadAppConfig } = mockBindings();
    LoadAppConfig.mockResolvedValue({ mcRoot: "" });
    const toasts: Array<{ msg?: string }> = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    try {
      const result = await loadInstances("ysm");
      expect(result).toEqual([]);
      expect(toasts).toHaveLength(0);
    } finally {
      off();
    }
  });

  it("成功加载 → 转换实例并按 hasMod 优先 + synced 降序排序", async () => {
    const { LoadAppConfig, ListVersionInstances, GetResourceInstanceStatus, GetRepoRoot } = mockBindings();
    LoadAppConfig.mockResolvedValue({ mcRoot: "/mc" });
    ListVersionInstances.mockResolvedValue([
      { Name: "NoMod", VersionDir: "/v/nomod", Exists: true },
      { Name: "A", VersionDir: "/v/a", Exists: true },
      { Name: "B", VersionDir: "/v/b", Exists: true },
    ]);
    GetRepoRoot.mockResolvedValue("/repo");
    GetResourceInstanceStatus.mockResolvedValue([
      // ADR-310：计数取 Go 的 MissingCount（单元级），非 Missing 清单长度
      { Name: "NoMod", MissingCount: 1, Missing: ["x"], Extra: [], Synced: 5, HasMod: false },
      { Name: "A", MissingCount: 0, Missing: [], Extra: [], Synced: 3, HasMod: true },
      { Name: "B", MissingCount: 0, Missing: [], Extra: [], Synced: 9, HasMod: true },
    ]);
    const result = await loadInstances("ysm");
    // hasMod 优先；同 hasMod 按 synced 降序；无 mod 排最后
    expect(result.map((i) => i.name)).toEqual(["B", "A", "NoMod"]);
    expect(result[0].status).toBe("complete");
    expect(result[2].hasMod).toBe(false);
    expect(result[2].status).toBe("missing");
    expect(result[2].missing).toBe(1);
  });

  it("ADR-310：badge 数取 Go 单元计数（≠清单长度），disabled 计数被消费", async () => {
    const { LoadAppConfig, ListVersionInstances, GetResourceInstanceStatus, GetRepoRoot } = mockBindings();
    LoadAppConfig.mockResolvedValue({ mcRoot: "/mc" });
    ListVersionInstances.mockResolvedValue([{ Name: "A", VersionDir: "/v/a", Exists: true }]);
    GetRepoRoot.mockResolvedValue("/repo");
    GetResourceInstanceStatus.mockResolvedValue([
      {
        Name: "A",
        // 1 个缺失模型夹（单元）→ 展开成 3 条仓库侧文件路径；另有 2 个实例独有、1 个禁用
        MissingCount: 1,
        Missing: ["/repo/m/model.pmx", "/repo/m/tex.pmd", "/repo/m/extra.pmx"],
        Extra: ["/inst/m3", "/inst/m4"],
        Disabled: ["/inst/banned.pmx.ban"],
        Synced: 7,
        HasMod: true,
      },
    ]);
    const [ins] = await loadInstances("ysm");
    expect(ins.missing).toBe(1); // 单元数，不是 3
    expect(ins.extra).toBe(2);
    expect(ins.disabled).toBe(1); // 不再硬编码 0
    expect(ins.synced).toBe(7);
    expect(ins.status).toBe("missing");
  });

  it("ADR-310：diverged 已在 Go 折叠进 MissingCount（无第四态），状态红优先于橙", async () => {
    const { LoadAppConfig, ListVersionInstances, GetResourceInstanceStatus, GetRepoRoot } = mockBindings();
    LoadAppConfig.mockResolvedValue({ mcRoot: "/mc" });
    ListVersionInstances.mockResolvedValue([{ Name: "A", VersionDir: "/v/a", Exists: true }]);
    GetRepoRoot.mockResolvedValue("/repo");
    GetResourceInstanceStatus.mockResolvedValue([
      { Name: "A", MissingCount: 1, Missing: ["/repo/m/x.pmx"], Extra: ["/inst/e"], Synced: 0, HasMod: true },
    ]);
    const [ins] = await loadInstances("ysm");
    expect(ins.status).toBe("missing"); // 红优先，橙不得盖过
  });

  it("并发同 rtype → 在途去重：只发一次状态请求（空 rtype 归一到 ysm 同键）", async () => {
    const { LoadAppConfig, ListVersionInstances, GetResourceInstanceStatus, GetRepoRoot } = mockBindings();
    LoadAppConfig.mockResolvedValue({ mcRoot: "/mc" });
    ListVersionInstances.mockResolvedValue([{ Name: "A", VersionDir: "/v/a", Exists: true }]);
    GetRepoRoot.mockResolvedValue("/repo");
    // 挂起状态请求制造在途窗口；resolvers 收集全部请求的放行器
    const resolvers: Array<() => void> = [];
    GetResourceInstanceStatus.mockImplementation(
      () => new Promise((resolve) => { resolvers.push(() => resolve([])); }),
    );
    const p1 = loadInstances("ysm");
    const p2 = loadInstances("ysm");
    const p3 = loadInstances(""); // 空 rtype 回退 ysm → 与 p1/p2 同键合并（入口同步判定）
    // 等首个请求真正到达状态接口（loadInstances 前置还有数步 await）
    await vi.waitFor(() => {
      expect(GetResourceInstanceStatus).toHaveBeenCalled();
    });
    resolvers.forEach((r) => r());
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(GetResourceInstanceStatus).toHaveBeenCalledTimes(1);
    expect(r1.map((i) => i.name)).toEqual(["A"]);
    expect(r2).toEqual(r1); // 等待方共享同一结果
    expect(r3).toEqual(r1);
  });

  it("完成后同 rtype 再次请求 → 重新发起（在途表清理，不陈旧共享）", async () => {
    const { LoadAppConfig, ListVersionInstances, GetResourceInstanceStatus, GetRepoRoot } = mockBindings();
    LoadAppConfig.mockResolvedValue({ mcRoot: "/mc" });
    ListVersionInstances.mockResolvedValue([{ Name: "A", VersionDir: "/v/a", Exists: true }]);
    GetRepoRoot.mockResolvedValue("/repo");
    GetResourceInstanceStatus.mockResolvedValue([]);
    await loadInstances("ysm");
    await loadInstances("ysm");
    expect(GetResourceInstanceStatus).toHaveBeenCalledTimes(2);
  });

  it("变异后刷新 force=true → 绕过在途去重，重新发起请求（sync/导入完成场景）", async () => {
    const { LoadAppConfig, ListVersionInstances, GetResourceInstanceStatus, GetRepoRoot } = mockBindings();
    LoadAppConfig.mockResolvedValue({ mcRoot: "/mc" });
    ListVersionInstances.mockResolvedValue([{ Name: "A", VersionDir: "/v/a", Exists: true }]);
    GetRepoRoot.mockResolvedValue("/repo");
    // 首次请求挂起（变异前的在途读请求）
    const resolvers: Array<() => void> = [];
    GetResourceInstanceStatus.mockImplementation(
      () => new Promise((resolve) => { resolvers.push(() => resolve([])); }),
    );
    const p1 = loadInstances("ysm");
    await vi.waitFor(() => {
      expect(GetResourceInstanceStatus).toHaveBeenCalled();
    });
    // 变异完成触发的刷新：force=true 不得并入 p1，必须新发请求拿最新数据
    const p2 = loadInstances("ysm", { force: true });
    await vi.waitFor(() => {
      expect(GetResourceInstanceStatus).toHaveBeenCalledTimes(2);
    });
    // force 请求仍在途时，普通读请求恢复去重 → 并入 p2（force 只对变异刷新生效）
    const p3 = loadInstances("ysm");
    expect(p3).toBe(p2);
    resolvers.forEach((r) => r());
    await Promise.all([p1, p2]);
    expect(GetResourceInstanceStatus).toHaveBeenCalledTimes(2);
  });

  // 2026-10 修复回归锁：原 finally 无条件 `_inflight.delete(key)`——force 刷新后，先收尾的
  // 旧请求会把新请求的登记项与 30s 淘汰表一起抹掉，后续普通读请求不再合并、重发第三次 IPC
  //（在途去重存在的意义正是防「同秒重复扫描」）。本例精确构造「旧先收尾、新仍在途」时序。
  it("force 在途时旧请求先收尾 → 不得抹掉新请求登记（普通读仍并入 force 请求）", async () => {
    const { LoadAppConfig, ListVersionInstances, GetResourceInstanceStatus, GetRepoRoot } = mockBindings();
    LoadAppConfig.mockResolvedValue({ mcRoot: "/mc" });
    ListVersionInstances.mockResolvedValue([{ Name: "A", VersionDir: "/v/a", Exists: true }]);
    GetRepoRoot.mockResolvedValue("/repo");
    const resolvers: Array<() => void> = [];
    GetResourceInstanceStatus.mockImplementation(
      () => new Promise((resolve) => { resolvers.push(() => resolve([])); }),
    );

    const p1 = loadInstances("ysm");
    await vi.waitFor(() => {
      expect(GetResourceInstanceStatus).toHaveBeenCalledTimes(1);
    });
    const p2 = loadInstances("ysm", { force: true });
    await vi.waitFor(() => {
      expect(GetResourceInstanceStatus).toHaveBeenCalledTimes(2);
    });

    // 只放行旧请求 p1（其收尾 finally 是竞态当事者），p2 保持挂起
    resolvers[0]!();
    await p1;

    // p1 收尾后，p2 的登记项必须仍在 → 普通读并入 p2，而不是新发第三次请求
    const p3 = loadInstances("ysm");
    expect(p3).toBe(p2);
    expect(GetResourceInstanceStatus).toHaveBeenCalledTimes(2);

    resolvers[1]!();
    await Promise.all([p2, p3]);
    expect(GetResourceInstanceStatus).toHaveBeenCalledTimes(2);
  });

  // 兜底淘汰回归锁：卡死请求（永不 settle）的登记项必须在 30s 后被清掉，否则后续普通读
  // 会永久并入僵尸请求、不再重新发起 IPC（该定时器存在的唯一意义）。
  // 2026-10 复查记录：曾怀疑「旧请求的 timer 会无条件删 `_inflightTimers[key]`，从而解除
  // 新请求的兜底」——实测**不成立**：条目清除由「当前登记项自己的 timer」负责（`=== p` 守卫
  // 正确），旧 timer 烧到时只会摘掉注册表里的句柄，不影响新 timer 自身的烧制。故本锁只锁
  // 「兜底仍然生效」这一真行为，不为未证实的猜测加复杂度。
  it("卡死请求 → 30s 兜底淘汰生效（后续普通读重新发起，不永久并入僵尸）", async () => {
    vi.useFakeTimers();
    try {
      const { LoadAppConfig, ListVersionInstances, GetResourceInstanceStatus, GetRepoRoot } =
        mockBindings();
      LoadAppConfig.mockResolvedValue({ mcRoot: "/mc" });
      ListVersionInstances.mockResolvedValue([{ Name: "A", VersionDir: "/v/a", Exists: true }]);
      GetRepoRoot.mockResolvedValue("/repo");
      // p1 永不 settle：只能靠 30s 兜底淘汰解套
      GetResourceInstanceStatus.mockImplementation(() => new Promise(() => {}));

      const p1 = loadInstances("ysm");
      await vi.advanceTimersByTimeAsync(0);
      expect(GetResourceInstanceStatus).toHaveBeenCalledTimes(1);

      // 推过 30s：p1 尚未 settle，但兜底淘汰必须把条目清掉
      await vi.advanceTimersByTimeAsync(30_001);

      const p2 = loadInstances("ysm");
      await vi.advanceTimersByTimeAsync(0);
      // 条目已清 → 重新发起（总数 2）；兜底失效则永久并入 p1（仍是 1）
      expect(GetResourceInstanceStatus).toHaveBeenCalledTimes(2);
      expect(p2).not.toBe(p1);
    } finally {
      vi.useRealTimers();
    }
  });
});
