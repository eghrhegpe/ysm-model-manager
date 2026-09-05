// @vitest-environment node
// ===== sidebar MMD 变体聚合纯函数测试 =====
// groupMmdVariants：按父文件夹聚合 .pmx 变体 / 单层路径自身为组 / Windows 分隔符归一 / 去重。
// loadInstances：失败路径 toast（loading 孤儿已删除）。
import { describe, it, expect, vi } from "vitest";
import { groupMmdVariants, loadInstances } from "./loader.ts";
import { bus } from "../../bus.ts";

// 阻断 Wails runtime 加载链：loader.ts 顶部静态 import bindings → @wailsio/runtime
// （其 drag.js 在模块加载时访问 window，jsdom teardown 后延迟回调触发
// "window is not defined" 环境噪声）。groupMmdVariants 是纯函数不依赖 bindings，mock 安全。
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

describe("groupMmdVariants", () => {
  it("按父文件夹聚合 missing/extra 变体", () => {
    const r = groupMmdVariants(
      ["char/a.pmx", "char/b.pmx"],
      ["char/c.pmx"],
    );
    expect(r.missingGroups).toEqual(["char"]);
    expect(r.extraGroups).toEqual(["char"]);
    expect(r.variantMap["char"]).toEqual({
      items: ["char/a.pmx", "char/b.pmx", "char/c.pmx"],
      count: 3,
    });
  });

  it("单层路径无父文件夹 → 自身为组", () => {
    const r = groupMmdVariants(["solo.pmx"], []);
    expect(r.missingGroups).toEqual(["solo.pmx"]);
    expect(r.variantMap["solo.pmx"].items).toEqual(["solo.pmx"]);
    expect(r.variantMap["solo.pmx"].count).toBe(1);
  });

  it("Windows 分隔符归一为 / 后聚合（items 保留原始路径供展示）", () => {
    const r = groupMmdVariants(["dir\\sub\\a.pmx"], []);
    expect(r.missingGroups).toEqual(["dir/sub"]);
    expect(r.variantMap["dir/sub"].items).toEqual(["dir\\sub\\a.pmx"]);
  });

  it("同父文件夹缺失+多余 → missing 与 extra 组都保留（seen 隔离）", () => {
    const r = groupMmdVariants(
      ["char/a.pmx", "char/b.pmx"],
      ["char/c.pmx", "other/d.pmx"],
    );
    expect(r.missingGroups).toEqual(["char"]);
    expect(r.extraGroups.sort()).toEqual(["char", "other"]);
  });

  it("多个目录分别聚合，组列表去重", () => {
    const r = groupMmdVariants(["x/a.pmx", "x/b.pmx", "y/c.pmx"], []);
    expect(r.missingGroups.sort()).toEqual(["x", "y"]);
  });

  it("空列表 → 空组与空 map", () => {
    const r = groupMmdVariants([], []);
    expect(r.missingGroups).toEqual([]);
    expect(r.extraGroups).toEqual([]);
    expect(Object.keys(r.variantMap)).toHaveLength(0);
  });
});

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

  it("加载失败 → 空列表 + toast 提示（loading 孤儿已删除）", async () => {
    const { LoadAppConfig } = mockBindings();
    LoadAppConfig.mockRejectedValue(new Error("boom"));
    const toasts: Array<{ msg?: string }> = [];
    const offs = [
      bus.on("toast:show", (p) => toasts.push(p)),
    ];
    try {
      const result = await loadInstances("ysm");
      expect(result).toEqual([]);
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
      { Name: "NoMod", Missing: ["x"], Extra: [], Synced: 5, HasMod: false },
      { Name: "A", Missing: [], Extra: [], Synced: 3, HasMod: true },
      { Name: "B", Missing: [], Extra: [], Synced: 9, HasMod: true },
    ]);
    const result = await loadInstances("ysm");
    // hasMod 优先；同 hasMod 按 synced 降序；无 mod 排最后
    expect(result.map((i) => i.name)).toEqual(["B", "A", "NoMod"]);
    expect(result[0].status).toBe("complete");
    expect(result[2].hasMod).toBe(false);
    expect(result[2].status).toBe("missing");
    expect(result[2].missing).toBe(1);
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
});
