// ===== loadOldestModel 资历最深/评分/热力图/每日推荐测试 =====
// 覆盖：空仓库、未配置目录、正常渲染（评分/热力图/资历最深/推荐）、rtype 切换、清理函数、点击选模型
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../bus.ts";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    ScanModelEntries: vi.fn(),
    GetRepoRoot: vi.fn(),
  };
  return { mocks };
});

vi.mock("../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ScanModelEntries: mocks.ScanModelEntries,
    GetRepoRoot: mocks.GetRepoRoot,
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

const sampleEntries = [
  { Name: "oldest.ysm", Size: 2048, Path: "/repo/oldest.ysm", Ext: ".ysm", Hash: "h1", ModTime: Date.now() - 365 * 86400000 },
  { Name: "new.ysm", Size: 1048576, Path: "/repo/new.ysm", Ext: ".ysm", Hash: "h2", ModTime: Date.now() - 1000 },
  { Name: "banned.ysm.ban", Size: 512, Path: "/repo/banned.ysm.ban", Ext: ".ban", Hash: "h3", ModTime: Date.now() - 5000 },
];

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
    // 资历最深卡片：oldest.ysm 应出现（最早 ModTime）
    expect(html).toContain("oldest.ysm");
    expect(html).toContain("data-path");
    // 评分：3 个条目 1 个 ban → 100 - round(1/3*40)=100-13=87
    expect(html).toContain("87");
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
});
