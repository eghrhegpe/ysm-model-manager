// @vitest-environment node
// ===== loadCommunityData 集成测试 =====
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    DefaultWorkshopSites: vi.fn(),
    LoadWorkshopCreators: vi.fn(),
    ListModelAuthors: vi.fn(),
    ScanLocalAuthors: vi.fn(),
    SaveWorkshopCreators: vi.fn(),
    isWebPlatform: vi.fn().mockReturnValue(false),
  };
  return { mocks };
});

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    DefaultWorkshopSites: mocks.DefaultWorkshopSites,
    LoadWorkshopCreators: mocks.LoadWorkshopCreators,
    ListModelAuthors: mocks.ListModelAuthors,
    ScanLocalAuthors: mocks.ScanLocalAuthors,
    SaveWorkshopCreators: mocks.SaveWorkshopCreators,
  }),
}));

vi.mock("../../backend/platform-web.ts", () => ({
  isWebPlatform: mocks.isWebPlatform,
}));

vi.mock("../../utils/debug/debug.ts", () => ({
  dbg: vi.fn(),
}));

import {
  loadCommunityData,
  loadLocalAuthors,
  mergeLocalAuthorsInto,
  forceRefreshCommunityMerge,
  forceRefreshScanAuthors,
  type LocalCreator,
} from "./community-data.ts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isWebPlatform.mockReturnValue(false);
  forceRefreshCommunityMerge();
  forceRefreshScanAuthors();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  mocks.DefaultWorkshopSites.mockResolvedValue([{ id: "bilibili" }]);
  mocks.LoadWorkshopCreators.mockResolvedValue([]);
  mocks.ListModelAuthors.mockResolvedValue([]);
  mocks.ScanLocalAuthors.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadCommunityData", () => {
  it("首屏快路径不等本地扫描：ScanLocalAuthors 挂起也立即返回", async () => {
    mocks.ScanLocalAuthors.mockReturnValue(new Promise(() => {})); // 永不 resolve
    const data = await loadCommunityData(); // 若仍 await 扫描则本行超时挂死
    expect(data.sites).toEqual([{ id: "bilibili" }]);
    expect(data.creators).toEqual([]);
  });

  it("本地作者 type 与现有 type 分段去重（子串不误判）", async () => {
    mocks.ScanLocalAuthors.mockResolvedValue([{ name: "A", type: "bili" }]);
    const localAuthors = await loadLocalAuthors();
    const merged = mergeLocalAuthorsInto(
      [{ name: "A", type: "bilibili" }] as LocalCreator[],
      localAuthors,
    );
    const a = merged.find((c) => c.name === "A");
    expect(a?.type).toBe("bilibili;bili");
    expect(a?._fromLocal).toBe(true);
  });

  it("ScanLocalAuthors 失败 -> loadLocalAuthors 降级为空不抛", async () => {
    mocks.ScanLocalAuthors.mockRejectedValue(new Error("scan boom"));
    await expect(loadLocalAuthors()).resolves.toEqual([]);
  });

  it("已存在的 type 不重复追加", () => {
    const merged = mergeLocalAuthorsInto(
      [{ name: "A", type: "bilibili;x" }] as LocalCreator[],
      [{ name: "A", type: "x" }],
    );
    expect(merged.find((c) => c.name === "A")?.type).toBe("bilibili;x");
  });

  it("本地独有作者追加为 _fromLocal 条目", () => {
    const merged = mergeLocalAuthorsInto(
      [],
      [{ name: "新作者", desc: "本地描述" }],
    );
    const c = merged.find((x) => x.name === "新作者");
    expect(c?._fromLocal).toBe(true);
    expect(c?.desc).toBe("本地描述");
  });

  it("Go 绑定失败 -> 降级为空数据不抛", async () => {
    mocks.DefaultWorkshopSites.mockRejectedValue(new Error("net down"));
    const data = await loadCommunityData();
    expect(data.sites).toEqual([]);
    expect(data.creators).toEqual([]);
  });

  it("自动合并触发时单次 SaveWorkshopCreators 原子保存", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [{ name: "社区新作者", desc: "c", type: "bilibili" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mocks.LoadWorkshopCreators.mockResolvedValue([{ name: "老作者", type: "bilibili" }]);
    await loadCommunityData();
    await vi.waitFor(() => expect(mocks.SaveWorkshopCreators).toHaveBeenCalled());
    const saved = mocks.SaveWorkshopCreators.mock.calls[0][0] as Array<{ name: string; type: string }>;
    expect(mocks.SaveWorkshopCreators).toHaveBeenCalledTimes(1);
    const names = saved.map((c) => c.name);
    expect(names).toContain("社区新作者");
    expect(names).toContain("老作者");
  });

  it("6h 内重复调用 -> 第二次跳过社区索引拉取，不触发 SaveWorkshopCreators", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [{ name: "社区新作者", type: "bilibili" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mocks.LoadWorkshopCreators.mockResolvedValue([{ name: "老作者", type: "bilibili" }]);
    await loadCommunityData();
    await vi.waitFor(() => expect(mocks.SaveWorkshopCreators).toHaveBeenCalledTimes(1));
    // 重置 fetchMock 计数，追踪第二次调用
    fetchMock.mockClear();
    await loadCommunityData();
    // tryAutoMergeCommunity 因限流跳过，不应再调用 fetch
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.SaveWorkshopCreators).toHaveBeenCalledTimes(1);
    // 缓存已写入（withCached 内部状态）
  });

  it("6h 窗口过期后再次调用 -> 重新触发社区索引拉取", async () => {
    // 用不同名字避免 mergeCommunityCreators 修改原数组导致的重复命中
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [{ name: "社区新作者B", type: "bilibili" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mocks.LoadWorkshopCreators.mockResolvedValue([{ name: "老作者", type: "bilibili" }]);
    await loadCommunityData();
    await vi.waitFor(() => expect(mocks.SaveWorkshopCreators).toHaveBeenCalledTimes(1));
    // 模拟 7 小时前
    // 清除缓存模拟过期
    forceRefreshCommunityMerge();
    await loadCommunityData();
    await vi.waitFor(() => expect(mocks.SaveWorkshopCreators).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(fetchMock).toHaveBeenCalled();
  });
});