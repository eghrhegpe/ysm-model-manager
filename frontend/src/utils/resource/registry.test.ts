// ===== loadResourceRegistry 单测（P2 补测：原 registry.ts 零测试覆盖）=====
// 覆盖：成功缓存命中、失败不缓存、空结果不缓存（Go 错误路径返回 "{}"）、
// 重复调用仅一次 Go 调用。mock getApp / LoadResourceTypes。
import { describe, it, expect, vi, beforeEach } from "vitest";

const loadMock = vi.fn();
vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({ LoadResourceTypes: loadMock }),
}));

// 模块级 _registry 缓存：每个用例重置模块再 import
async function freshLoad() {
  vi.resetModules();
  const mod = await import("./registry.ts");
  return mod.loadResourceRegistry;
}

beforeEach(() => {
  loadMock.mockReset();
});

describe("loadResourceRegistry", () => {
  it("成功加载 → 按 id 建 map 并缓存", async () => {
    loadMock.mockResolvedValue(
      JSON.stringify({ resourceTypes: [{ id: "ysm" }, { id: "mmd-skin" }] }),
    );
    const load = await freshLoad();
    const reg = await load();
    expect(reg["ysm"]).toBeTruthy();
    expect(reg["mmd-skin"]).toBeTruthy();
    // 缓存命中：第二次调用不触发 Go
    await load();
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  it("Go 返回空 {}（错误路径）→ 返回空且不缓存（下次可重试）", async () => {
    // Go 端 LoadResourceTypes 失败时返回 "{}"（resource_bindings.go:25），
    // P2 修复：不得把空结果写入 _registry（否则整会话空注册表）
    loadMock.mockResolvedValue("{}");
    const load = await freshLoad();
    const reg = await load();
    expect(Object.keys(reg)).toHaveLength(0);
    // 第二次调用应再次触发 Go（未缓存）
    await load();
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  it("Go 抛错 → 返回空且不缓存", async () => {
    loadMock.mockRejectedValue(new Error("bridge down"));
    const load = await freshLoad();
    const reg = await load();
    expect(Object.keys(reg)).toHaveLength(0);
    await load();
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  it("resourceTypes 非数组/空数组 → 不缓存", async () => {
    loadMock.mockResolvedValue(JSON.stringify({ resourceTypes: [] }));
    const load = await freshLoad();
    await load();
    await load();
    expect(loadMock).toHaveBeenCalledTimes(2);
  });
});
