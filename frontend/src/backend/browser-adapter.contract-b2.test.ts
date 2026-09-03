// @vitest-environment node
// ===== B2 社区/工坊契约测试（反推源码问题）=====
// 对照 Go 真实契约 internal/app/app_workshop.go，校验网页桥接（browser-adapter.ts）
// 中 LoadWorkshopCreators / SaveWorkshopCreators / LoadGitHubRepos /
// DefaultWorkshopSites / SaveWorkshopSites 的 bundled 默认 + localStorage 覆盖层
// 行为是否与 Go 契约一致。本文件只新增、不改源码。
//
// Go 契约速查（internal/app/app_workshop.go）：
//   DefaultWorkshopSites : 用户配置 workshop_sites.json > 内联 bundled > 硬编码 defaultWorkshopSites() (3 站)
//   SaveWorkshopSites    : 整体覆盖写盘（签名 []WorkshopSite，无 null）
//   LoadWorkshopCreators : 用户配置 creators.json > 内联 bundled > nil
//   SaveWorkshopCreators : 整体覆盖写盘（签名 []WorkshopCreator，无 null）
//   LoadGitHubRepos      : 用户配置 workshop-github.json > 内联 bundled > nil  ← 可被用户覆盖！
// 关键差异：Go 全部从「用户配置目录优先」读取，覆盖层存在于磁盘；网页版创作者/站点/GitHub
// 仓库均有 localStorage 覆盖层（WEB_CREATORS_KEY / WEB_SITES_KEY / web:github-repos，见 browser-adapter.ts）。
// 共享 idb mock：setup 层 globalThis.__YSM_TEST_IDB__ 注入（isolate:false 穿透修复，2026-08-17）
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
const idbMock = (globalThis as unknown as {
  __YSM_TEST_IDB__: {
    idbGet: Mock;
    idbSet: Mock;
    idbKeys: Mock;
    idbGetAll: Mock;
    idbDel: Mock;
    _store: Map<string, unknown>;
  };
}).__YSM_TEST_IDB__;
import { browserAdapter } from "./browser-adapter.ts";
import type { WorkshopSite } from "../../bindings/ysm-model-manager/go/types/models.ts";

// 复刻 harness：idb 层内存实现 + vi.mock；localStorage 由 happy-dom 提供。

// 各覆盖层 key（与 browser-adapter.ts 中保持一致，供测试直接探查）。
const WEB_CREATORS_KEY = "web:workshop-creators";
const WEB_SITES_KEY = "web:workshop-sites";
// 注意：网页版 GitHub 仓库覆盖层 key 为 web:github-repos（browser-adapter.ts:518），与 Go workshop-github.json 覆盖同构。

beforeEach(() => {
  vi.clearAllMocks();
  idbMock._store.clear();
  localStorage.clear();
});

describe("B2 契约：LoadWorkshopCreators — 覆盖层优先级", () => {
  it("无覆盖层时返回 bundled 默认（非空、含 name/desc）", async () => {
    const c = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string; desc: string }>;
    expect(Array.isArray(c)).toBe(true);
    expect(c.length).toBeGreaterThan(0);
    expect(typeof c[0].name).toBe("string");
    expect(typeof c[0].desc).toBe("string");
  });

  it("有覆盖层时返回覆盖值（覆盖优先于 bundled，对齐 Go 用户配置优先）", async () => {
    const custom = [{ name: "测试作者", desc: "单测注入", type: "bilibili" }];
    localStorage.setItem(WEB_CREATORS_KEY, JSON.stringify(custom));
    const got = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("测试作者");
  });

  it("覆盖层 JSON 损坏 → 回退 bundled 不抛错（对齐 Go 读取失败回退 bundled）", async () => {
    localStorage.setItem(WEB_CREATORS_KEY, "{broken json");
    const c = (await browserAdapter.LoadWorkshopCreators()) as Array<unknown>;
    expect(c.length).toBeGreaterThan(0);
  });

  it("返回值为深拷贝：外部 mutate 不影响后续 Load（对齐 Go 每次重新反序列化）", async () => {
    const a = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    const len = a.length;
    a.push({ name: "被污染" });
    const b = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    expect(b.length).toBe(len);
  });

  // Go 契约偏离点（不抛失败，仅记录）：Go LoadWorkshopCreators 在 bundled 缺失/损坏时
  // 返回 nil（app_workshop.go:164）；网页版始终返回 bundled 数组（永不 null）。
  // 因 bundled 在 build 期内联，实践中等价；但契约形态不同，属低危偏差。
});

describe("B2 契约：SaveWorkshopCreators / SaveWorkshopSites — 写入与重置", () => {
  it("SaveWorkshopCreators(data) 后 LoadWorkshopCreators 返回新值", async () => {
    const custom = [{ name: "新作者", desc: "x", type: "bilibili" }];
    await browserAdapter.SaveWorkshopCreators(custom);
    const got = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("新作者");
  });

  it("SaveWorkshopSites(data) 后 DefaultWorkshopSites 返回新值（覆盖优先）", async () => {
    const custom = [{ id: "mysite", icon: "⭐", label: "我的站", url: "https://x.test", desc: "t", group: "search" }];
    await browserAdapter.SaveWorkshopSites(custom);
    const got = (await browserAdapter.DefaultWorkshopSites()) as Array<{ id: string }>;
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe("mysite");
  });

  it("SaveWorkshopCreators(null) 重置覆盖层 → 回退 bundled（网页版自身约定）", async () => {
    await browserAdapter.SaveWorkshopCreators([{ name: "临时", desc: "x", type: "b" }]);
    await browserAdapter.SaveWorkshopCreators(null);
    const got = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    expect(got.length).toBeGreaterThan(1); // bundled 默认远大于 1
  });

  it("SaveWorkshopSites(null) 重置覆盖层 → 回退 bundled（网页版自身约定）", async () => {
    await browserAdapter.SaveWorkshopSites([{ id: "x", url: "https://x.test" }] as unknown as WorkshopSite[]);
    await browserAdapter.SaveWorkshopSites(null);
    const got = (await browserAdapter.DefaultWorkshopSites()) as Array<{ id: string }>;
    expect(got.length).toBeGreaterThan(1);
  });

  // 契约偏离（不抛失败，仅记录）：Go SaveWorkshopCreators/SaveWorkshopSites 签名为
  // 非空切片，无 null 重置语义；重置走 ResetWorkshopConfigs（app_workshop.go:217）。
  // 网页版 SaveX(null) 是额外约定，非 Go 契约。属设计性偏差，非源码 bug。
});

describe("B2 契约：站点级编辑保存（R3-P0 web 补齐，镜像 Go app_workshop.go）", () => {
  it("SaveWorkshopCreatorsBySite 只替换指定站点，其他站点保留", async () => {
    // 先写一个多站点覆盖层
    const base = [
      { name: "A站作者", desc: "a", type: "siteA" },
      { name: "B站作者", desc: "b", type: "siteB" },
    ];
    await browserAdapter.SaveWorkshopCreators(base);
    await browserAdapter.SaveWorkshopCreatorsBySite(
      "siteA",
      [{ name: "A站新作者", desc: "a2", type: "siteA" }],
    );
    const got = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string; type: string }>;
    const names = got.map((c) => c.name);
    expect(names).toContain("A站新作者");
    expect(names).not.toContain("A站作者"); // 旧站点条目被替换
    expect(names).toContain("B站作者"); // 其他站点保留
  });

  it("SaveWorkshopPresetsBySite 只改指定站点 presetSearches", async () => {
    const site = { id: "siteA", label: "A", url: "https://a.test", presetSearches: [{ label: "旧", q: "old" }] };
    await browserAdapter.SaveWorkshopSites([site] as unknown as WorkshopSite[]);
    await browserAdapter.SaveWorkshopPresetsBySite(
      "siteA",
      [{ label: "新", q: "new" }],
    );
    const got = (await browserAdapter.DefaultWorkshopSites()) as Array<{ id: string; presetSearches: Array<{ q: string }> }>;
    expect(got.find((s) => s.id === "siteA")?.presetSearches?.[0]?.q).toBe("new");
  });

  it("MergeWorkshopCreatorsFromJSON 合并新增/更新并返回 [added, updated]", async () => {
    await browserAdapter.SaveWorkshopCreators([{ name: "已存在", desc: "", type: "x" }]);
    // 构造 >=100 条（Go 完整性校验：合并后 >=100 才通过）：1 条已存在（更新 desc），其余新增
    const list = Array.from({ length: 100 }, (_, i) => ({
      name: i === 0 ? "已存在" : `新作者${i}`,
      desc: i === 0 ? "补充描述" : `desc${i}`,
      type: "test",
    }));
    const [added, updated] = (await browserAdapter.MergeWorkshopCreatorsFromJSON(
      JSON.stringify(list),
    )) as [number, number];
    expect(updated).toBe(1); // "已存在" 更新 desc
    expect(added).toBe(99); // 其余 99 条新增
    const got = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string; desc: string }>;
    expect(got.find((c) => c.name === "已存在")?.desc).toBe("补充描述");
  });

  it("MergeWorkshopCreatorsFromJSON 少于 20 条拒绝", async () => {
    await expect(
      browserAdapter.MergeWorkshopCreatorsFromJSON(JSON.stringify([{ name: "a", desc: "" }])),
    ).rejects.toThrow();
  });

  it("多站点分号 type 连续按站点保存不丢数据（累积语义，审核验证）", async () => {
    // 逐站点 SaveWorkshopCreatorsBySite：每次 load 读到前次 save 结果（localStorage
    // 同步事务），后一次追加不覆盖前一次——多站点分号 type 拆组保存后各站点都在
    await browserAdapter.SaveWorkshopCreators([]); // 清空覆盖层
    await browserAdapter.SaveWorkshopCreatorsBySite("siteA", [{ name: "A1", desc: "", type: "siteA" }]);
    await browserAdapter.SaveWorkshopCreatorsBySite("siteB", [{ name: "B1", desc: "", type: "siteB" }]);
    const got = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    const names = got.map((c) => c.name);
    expect(names).toContain("A1");
    expect(names).toContain("B1");
  });

  it("MergeWorkshopCreatorsFromJSON 合并后 <100 条回滚不保存（覆盖层保持旧值）", async () => {
    const before = [{ name: "旧作者", desc: "old", type: "x" }];
    await browserAdapter.SaveWorkshopCreators(before);
    // 导入 30 条（<100 合并后 → reject），内存已合并但不应落盘
    const list = Array.from({ length: 30 }, (_, i) => ({
      name: `作者${i}`, desc: `d${i}`, type: "t",
    }));
    await expect(
      browserAdapter.MergeWorkshopCreatorsFromJSON(JSON.stringify(list)),
    ).rejects.toThrow();
    const got = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string; desc: string }>;
    // 覆盖层仍是旧的 1 条（合并失败未保存）
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("旧作者");
  });
});

// ADR-172：社区索引增量并入契约——语义镜像 Go MergeCommunityCreatorsFromJSON：
// type 分号段并入（非覆盖）/ desc/role 空补 / 无 ≥20/≥100 硬校验 / 幂等短路不写覆盖层。
// 与 MergeWorkshopCreatorsFromJSON（type 覆盖 + 条数硬校验）刻意区分（ADR-172 §2 差异表）。
describe("B2 契约：MergeCommunityCreatorsFromJSON（ADR-172 段并入）", () => {
  it("type 分号段并入（本地段不丢）+ desc 空补 + 新增，返回 [added, updated]", async () => {
    await browserAdapter.SaveWorkshopCreators([
      { name: "A", desc: "", type: "bilibili" },
      { name: "B", desc: "", type: "afdian" },
    ]);
    const [added, updated] = (await browserAdapter.MergeCommunityCreatorsFromJSON(
      JSON.stringify([
        { name: "A", desc: "社区补", type: "bilibili;afdian" },
        { name: "C", desc: "新", type: "github" },
      ]),
    )) as [number, number];
    expect(added).toBe(1);
    expect(updated).toBe(1);
    const got = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string; desc: string; type: string }>;
    const a = got.find((c) => c.name === "A");
    expect(a?.desc).toBe("社区补");
    // 段并入：本地 bilibili 段保留 + 社区 afdian 段并入（覆盖会丢本地段）
    expect(a?.type).toContain("bilibili");
    expect(a?.type).toContain("afdian");
    expect(got.map((c) => c.name)).toContain("C");
    // B 原样保留
    expect(got.some((c) => c.name === "B" && c.type === "afdian")).toBe(true);
  });

  it("幂等短路：同索引再并 → [0,0]，覆盖层不重写", async () => {
    await browserAdapter.SaveWorkshopCreators([{ name: "A", type: "bilibili" }]);
    const payload = JSON.stringify([
      { name: "A", type: "bilibili;afdian" },
      { name: "B", type: "github" },
    ]);
    const [a1, u1] = (await browserAdapter.MergeCommunityCreatorsFromJSON(payload)) as [number, number];
    expect([a1, u1]).toEqual([1, 1]);
    // 第二次：A 段已含、B 已存在 → 零变更，不写覆盖层
    const [a2, u2] = (await browserAdapter.MergeCommunityCreatorsFromJSON(payload)) as [number, number];
    expect([a2, u2]).toEqual([0, 0]);
  });

  it("空输入 / 全非法条目 → reject 不落盘", async () => {
    const before = [{ name: "旧", type: "x" }];
    await browserAdapter.SaveWorkshopCreators(before);
    await expect(browserAdapter.MergeCommunityCreatorsFromJSON("[]")).rejects.toThrow();
    await expect(
      browserAdapter.MergeCommunityCreatorsFromJSON('[{"name":"","type":"x"}]'),
    ).rejects.toThrow();
    const got = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("旧");
  });

  it("少条数不设门槛（与 MergeWorkshopCreatorsFromJSON ≥20 硬校验区分）", async () => {
    await browserAdapter.SaveWorkshopCreators([]);
    const [added] = (await browserAdapter.MergeCommunityCreatorsFromJSON(
      JSON.stringify([{ name: "唯一", type: "x" }]),
    )) as [number, number];
    expect(added).toBe(1); // 1 条也并入——社区增量合并不要求全量索引
  });
});

describe("B2 契约：DefaultWorkshopSites — 恒返回站点列表", () => {
  it("默认返回 bundled 站点（含 id/url，非空）", async () => {
    const s = (await browserAdapter.DefaultWorkshopSites()) as Array<{ id: string; url: string }>;
    expect(Array.isArray(s)).toBe(true);
    expect(s.length).toBeGreaterThan(0);
    expect(typeof s[0].id).toBe("string");
    expect(typeof s[0].url).toBe("string");
  });

  it("覆盖层损坏 → 回退 bundled 不抛错", async () => {
    localStorage.setItem(WEB_SITES_KEY, "{broken");
    const s = (await browserAdapter.DefaultWorkshopSites()) as Array<unknown>;
    expect(s.length).toBeGreaterThan(0);
  });

  it("返回值为深拷贝：外部 mutate 不影响后续调用", async () => {
    const a = (await browserAdapter.DefaultWorkshopSites()) as Array<{ id: string }>;
    const len = a.length;
    a.push({ id: "污染" });
    const b = (await browserAdapter.DefaultWorkshopSites()) as Array<{ id: string }>;
    expect(b.length).toBe(len);
  });
});

describe("B2 契约：LoadGitHubRepos — 覆盖层（已对齐 Go 用户配置优先语义）", () => {
  it("Go 契约：LoadGitHubRepos 应优先读取用户覆盖（workshop-github.json）；网页版覆盖层已对齐", async () => {
    // 模拟用户编辑了 GitHub 仓库列表（对照 Go 用户配置优先语义）
    const custom = [{ name: "user/repo-custom", desc: "用户覆盖", type: "github" }];
    // 网页版覆盖层使用与创作者/站点同构的 key（web:github-repos，见 browser-adapter.ts:518 / loadWebGitHubRepos）
    localStorage.setItem("web:github-repos", JSON.stringify(custom));

    const got = (await browserAdapter.LoadGitHubRepos()) as Array<{ name: string }>;
    // 契约守门：web 已实现覆盖层优先返回用户覆盖（loadWebGitHubRepos 先读 web:github-repos）
    expect(got.some((r) => r.name === "user/repo-custom")).toBe(true);
  });

  it("LoadGitHubRepos 返回 bundled 列表（非 null、type=github）— 既有正确性基线", async () => {
    const r = (await browserAdapter.LoadGitHubRepos()) as Array<{ name: string; type: string }>;
    expect(Array.isArray(r)).toBe(true);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].type).toBe("github");
  });
});
