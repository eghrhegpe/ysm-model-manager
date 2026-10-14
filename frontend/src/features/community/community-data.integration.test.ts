// @vitest-environment node
// ===== loadCommunityData 集成测试 =====
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mocks, logWarnMock } = vi.hoisted(() => ({
  mocks: {
    DefaultWorkshopSites: vi.fn(),
    LoadWorkshopCreators: vi.fn(),
    ListModelAuthors: vi.fn(),
    ScanLocalAuthors: vi.fn(),
    SaveWorkshopCreators: vi.fn(),
    // ADR-172：写回下沉后自动合并直传 Go binding，SaveWorkshopCreators 前端零调用
    MergeCommunityCreatorsFromJSON: vi.fn().mockResolvedValue([0, 0]),
    isWebPlatform: vi.fn().mockReturnValue(false),
  },
  // 静默「社区数据加载失败」的预期告警噪声（Go 绑定失败用例故意触发降级路径）
  logWarnMock: vi.fn(),
}));

vi.mock("@/backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    DefaultWorkshopSites: mocks.DefaultWorkshopSites,
    LoadWorkshopCreators: mocks.LoadWorkshopCreators,
    ListModelAuthors: mocks.ListModelAuthors,
    ScanLocalAuthors: mocks.ScanLocalAuthors,
    SaveWorkshopCreators: mocks.SaveWorkshopCreators,
    MergeCommunityCreatorsFromJSON: mocks.MergeCommunityCreatorsFromJSON,
  }),
}));

vi.mock("@/backend/platform-web.ts", () => ({
  isWebPlatform: mocks.isWebPlatform,
}));

vi.mock("@/utils/debug/debug.ts", () => ({
  dbg: vi.fn(),
}));

// logWarn 经命名导入绑定，spyOn 无法拦截，须整模块 mock 才能静默 + 断言
vi.mock("@/utils/base/primitives/log.ts", () => ({ logWarn: logWarnMock }));

import {
  loadCommunityData,
  loadLocalAuthors,
  mergeLocalAuthorsInto,
  forceRefreshCommunityMerge,
  forceRefreshScanAuthors,
  type LocalCreator,
} from "./community-data.ts";

import { stubFetch } from "@/test-utils/fetch.ts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isWebPlatform.mockReturnValue(false);
  forceRefreshCommunityMerge();
  forceRefreshScanAuthors();
  stubFetch(); // 默认 ok 空 json（夹具沉淀：stubFetch 工厂）
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

  it("ADR-337：本地作者只打 _fromLocal 标记，绝不并入创作者的站点 type", async () => {
    // rtype（资源类型）与创作者的 type（站点归属）是两套词汇表——并进去会让卡片
    // 多出一个 👤「ysm」式幻影平台徽章（getSiteIcon 对未知 id 回退创作者图标）
    mocks.ScanLocalAuthors.mockResolvedValue([{ name: "A", desc: "", rTypes: ["ysm"] }]);
    const localAuthors = await loadLocalAuthors();
    const merged = mergeLocalAuthorsInto(
      [{ name: "A", type: "bilibili" }] as LocalCreator[],
      localAuthors,
    );
    const a = merged.find((c) => c.name === "A");
    expect(a?.type).toBe("bilibili");
    expect(a?._fromLocal).toBe(true);
  });

  it("ScanLocalAuthors 失败 -> loadLocalAuthors 降级为空不抛", async () => {
    mocks.ScanLocalAuthors.mockRejectedValue(new Error("scan boom"));
    await expect(loadLocalAuthors()).resolves.toEqual([]);
  });

  it("ADR-337：多站点段也不被本地作者改动", () => {
    const merged = mergeLocalAuthorsInto(
      [{ name: "A", type: "bilibili;x" }] as LocalCreator[],
      [
        { name: "A", desc: "", rTypes: ["x"] },
        { name: "A", desc: "", rTypes: ["ysm"] },
      ],
    );
    expect(merged.find((c) => c.name === "A")?.type).toBe("bilibili;x");
  });

  it("ADR-337：本地独有作者不追加条目（匹配不到任何站点 tab，追加是纯死重）", () => {
    const merged = mergeLocalAuthorsInto(
      [{ name: "已知", type: "bilibili" }] as LocalCreator[],
      [
        { name: "新作者", desc: "", rTypes: ["ysm"] },
        { name: "已知", desc: "", rTypes: ["ysm"] },
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged.find((x) => x.name === "新作者")).toBeUndefined();
    expect(merged.find((x) => x.name === "已知")?._fromLocal).toBe(true);
  });

  it("Go 绑定失败 -> 降级为空数据不抛", async () => {
    mocks.DefaultWorkshopSites.mockRejectedValue(new Error("net down"));
    const data = await loadCommunityData();
    expect(data.sites).toEqual([]);
    expect(data.creators).toEqual([]);
    // 降级路径确实被走到（留痕，而非静默丢弃）
    expect(logWarnMock).toHaveBeenCalledWith("community", "社区数据加载失败", expect.anything());
  });

  it("自动合并：社区索引 JSON 直传 Go binding，前端不再整存", async () => {
    stubFetch(() =>
      Promise.resolve({ ok: true, json: async () => [{ name: "社区新作者", desc: "c", type: "bilibili" }] }),
    );
    await loadCommunityData();
    await vi.waitFor(() => expect(mocks.MergeCommunityCreatorsFromJSON).toHaveBeenCalled());
    // ADR-172：前端只传拉取结果（JSON 字符串），合并/去重派生在 Go
    const payload = JSON.parse(mocks.MergeCommunityCreatorsFromJSON.mock.calls[0][0]) as Array<{ name: string }>;
    expect(payload.map((c) => c.name)).toContain("社区新作者");
    // 红线验证：写回彻底不在前端——SaveWorkshopCreators 零调用
    expect(mocks.SaveWorkshopCreators).not.toHaveBeenCalled();
  });

  it("6h 内重复调用 -> 第二次跳过社区索引拉取，仅幂等转发 Go", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve({ ok: true, json: async () => [{ name: "社区新作者", type: "bilibili" }] }),
    ).fetchMock;
    await loadCommunityData();
    await vi.waitFor(() => expect(mocks.MergeCommunityCreatorsFromJSON).toHaveBeenCalledTimes(1));
    // 重置 fetchMock 与 binding 计数，追踪第二次调用
    fetchMock.mockClear();
    mocks.MergeCommunityCreatorsFromJSON.mockClear();
    await loadCommunityData();
    // 6h 缓存命中 → 不重拉 fetch；缓存 community 仍幂等转发 Go（Go 侧无变更短路，
    // 不备份不落盘——integration mock 返回 [0,0] 即模拟该短路结果）
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.MergeCommunityCreatorsFromJSON).toHaveBeenCalledTimes(1));
    expect(mocks.SaveWorkshopCreators).not.toHaveBeenCalled();
  });

  it("6h 窗口过期后再次调用 -> 重新触发社区索引拉取", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve({ ok: true, json: async () => [{ name: "社区新作者B", type: "bilibili" }] }),
    ).fetchMock;
    await loadCommunityData();
    await vi.waitFor(() => expect(mocks.MergeCommunityCreatorsFromJSON).toHaveBeenCalledTimes(1));
    // 模拟过期：清缓存后再次加载应重拉社区索引并转发
    forceRefreshCommunityMerge();
    await loadCommunityData();
    await vi.waitFor(() => expect(mocks.MergeCommunityCreatorsFromJSON).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(fetchMock).toHaveBeenCalled();
  });

  // 锐评修正（2026-10-14）：TTL 过期后必须并入**新值**而非 6h 旧值。
  // 病：tryAutoMergeCommunity 原用 withCached STALE——过期时立即返回旧值 + 后台刷新，
  // 于是本函数拿着 6 小时前的社区索引就去调 MergeCommunityCreatorsFromJSON 落盘，
  // 用户「进了工坊页但内容没变」，真值要等下一次进页（届时缓存已被后台刷成新值）才并入。
  // 为何改 NORMAL 无代价：本函数是**即发即忘**的（调用点不 await），STALE「不阻塞调用方」
  // 的收益为零，NORMAL 只是在后台多等一次网络换来「本次就并入真值」。
  // ⚠️ 本条与上一条（forceRefresh 清缓存）**判别力不同**：清缓存后 STALE 也走 miss 拉新，
  // 上条对 STALE/NORMAL 无区分度；本条用假定时器把时间推过 TTL **但保留过期条目**，
  // 才真正区分两种策略——STALE 会拿旧值，NORMAL 拿新值。
  it("TTL 过期（条目仍在）-> 并入的是新拉取值，不是 6h 旧值", async () => {
    vi.useFakeTimers();
    try {
      // 第一次：旧值进缓存并合并
      stubFetch(() =>
        Promise.resolve({ ok: true, json: async () => [{ name: "旧作者", type: "bilibili" }] }),
      );
      await loadCommunityData();
      await vi.waitFor(() => expect(mocks.MergeCommunityCreatorsFromJSON).toHaveBeenCalledTimes(1));
      const firstPayload = JSON.parse(
        mocks.MergeCommunityCreatorsFromJSON.mock.calls[0][0],
      ) as Array<{ name: string }>;
      expect(firstPayload.map((c) => c.name)).toContain("旧作者");

      // 换新值 + 把系统时间推过 6h TTL（条目仍在缓存里，只是过期）
      mocks.MergeCommunityCreatorsFromJSON.mockClear();
      stubFetch(() =>
        Promise.resolve({ ok: true, json: async () => [{ name: "新作者", type: "bilibili" }] }),
      );
      vi.setSystemTime(Date.now() + 7 * 3600 * 1000);

      await loadCommunityData();
      await vi.waitFor(() => expect(mocks.MergeCommunityCreatorsFromJSON).toHaveBeenCalledTimes(1));
      const payload = JSON.parse(
        mocks.MergeCommunityCreatorsFromJSON.mock.calls[0][0],
      ) as Array<{ name: string }>;
      // STALE 实现下此处会拿到「旧作者」（过期条目被直接返回）→ 本条转红即策略回退
      expect(payload.map((c) => c.name)).toContain("新作者");
      expect(payload.map((c) => c.name)).not.toContain("旧作者");
    } finally {
      vi.useRealTimers();
    }
  });
});