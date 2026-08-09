// ===== loadCommunityData 集成测试 =====
// 覆盖：本地作者与社区创作者合并（type 分号分段去重）、失败降级
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    DefaultWorkshopSites: vi.fn(),
    LoadWorkshopCreators: vi.fn(),
    ListModelAuthors: vi.fn(),
    ScanLocalAuthors: vi.fn(),
  };
  return { mocks };
});

vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    DefaultWorkshopSites: mocks.DefaultWorkshopSites,
    LoadWorkshopCreators: mocks.LoadWorkshopCreators,
    ListModelAuthors: mocks.ListModelAuthors,
    ScanLocalAuthors: mocks.ScanLocalAuthors,
    SaveWorkshopCreatorsBySite: vi.fn(),
  }),
}));

vi.mock("../../utils/debug/debug.ts", () => ({
  dbg: vi.fn(),
}));

import { loadCommunityData } from "./community-data.ts";

beforeEach(() => {
  vi.clearAllMocks();
  // 默认空数据 + 网络 fetch 失败（tryAutoMergeCommunity 静默 catch）
  mocks.DefaultWorkshopSites.mockResolvedValue([{ id: "bilibili" }]);
  mocks.LoadWorkshopCreators.mockResolvedValue([]);
  mocks.ListModelAuthors.mockResolvedValue([]);
  mocks.ScanLocalAuthors.mockResolvedValue([]);
});

describe("loadCommunityData", () => {
  it("本地作者 type 与现有 type 分段去重（子串不误判）", async () => {
    mocks.LoadWorkshopCreators.mockResolvedValue([
      { name: "A", type: "bilibili" },
    ]);
    mocks.ScanLocalAuthors.mockResolvedValue([
      { name: "A", type: "bili" }, // "bilibili" 的子串，原 includes 实现会误判已包含
    ]);

    const data = await loadCommunityData();

    const a = data.creators.find((c) => c.name === "A");
    expect(a?.type).toBe("bilibili;bili");
    expect(a?._fromLocal).toBe(true);
  });

  it("已存在的 type 不重复追加", async () => {
    mocks.LoadWorkshopCreators.mockResolvedValue([
      { name: "A", type: "bilibili;x" },
    ]);
    mocks.ScanLocalAuthors.mockResolvedValue([
      { name: "A", type: "x" },
    ]);

    const data = await loadCommunityData();

    const a = data.creators.find((c) => c.name === "A");
    expect(a?.type).toBe("bilibili;x");
  });

  it("本地独有作者追加为 _fromLocal 条目", async () => {
    mocks.ScanLocalAuthors.mockResolvedValue([
      { name: "新作者", desc: "本地描述" },
    ]);

    const data = await loadCommunityData();

    const c = data.creators.find((x) => x.name === "新作者");
    expect(c?._fromLocal).toBe(true);
    expect(c?.desc).toBe("本地描述");
  });

  it("Go 绑定失败 → 降级为空数据不抛", async () => {
    mocks.DefaultWorkshopSites.mockRejectedValue(new Error("net down"));
    const data = await loadCommunityData();
    expect(data.sites).toEqual([]);
    expect(data.creators).toEqual([]);
  });
});
