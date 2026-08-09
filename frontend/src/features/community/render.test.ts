// ===== 创意工坊渲染层纯函数测试（ADR-023 L3）=====
import { formatBytes } from "../../utils/dom/format.ts";
import { describe, it, expect } from "vitest";
import {
  isModelMissing,
  countMissing,
  filterModels,
  groupSites,
  renderCardsHTML,
  renderRepoHeaderHTML,
  type WorkshopModel,
} from "./render.ts";

const local = new Map([
  ["角色A.ysm", "hash-a"],
  ["角色B.ysm", "hash-b"],
]);

describe("isModelMissing", () => {
  it("本地有同名 → 不缺失", () => {
    expect(isModelMissing({ name: "角色A.ysm", path: "x" }, local)).toBe(false);
  });
  it("本地有同哈希（不同名）→ 不缺失", () => {
    expect(
      isModelMissing({ name: "改名.ysm", path: "x", hash: "hash-b" }, local),
    ).toBe(false);
  });
  it("本地无 → 缺失", () => {
    expect(isModelMissing({ name: "角色C.ysm", path: "x" }, local)).toBe(true);
  });
  it("有 hash 但本地无匹配 → 缺失", () => {
    // 同名也不在本地、hash 也不匹配 → 缺失
    expect(
      isModelMissing({ name: "角色C.ysm", path: "x", hash: "hash-zzz" }, local),
    ).toBe(true);
  });
  it("同名在本地但 hash 不匹配 → 不缺失（name 优先）", () => {
    expect(
      isModelMissing({ name: "角色A.ysm", path: "x", hash: "hash-zzz" }, local),
    ).toBe(false);
  });
  it("空模型 → 缺失", () => {
    expect(isModelMissing(null, local)).toBe(true);
  });
});

describe("countMissing", () => {
  it("统计缺失数量", () => {
    const models = [
      { name: "角色A.ysm", path: "a" },
      { name: "角色C.ysm", path: "c" },
    ];
    expect(countMissing(models, local)).toBe(1);
  });
});

describe("formatBytes (community)", () => {
  it("0 → 空串", () => expect(formatBytes(0)).toBe(""));
  it("字节", () => expect(formatBytes(512)).toBe("512 B"));
  it("KB", () => expect(formatBytes(2048)).toBe("2.0 KB"));
  it("MB 保留一位", () => expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB"));
});

describe("filterModels", () => {
  const models: WorkshopModel[] = [
    { name: "角色A.ysm", path: "a", size: 1 },
    { name: "角色B.ysm", path: "b", size: 2 },
    { name: "怪物X.ysm", path: "c", size: 3 },
  ];
  // 仅 角色A 在本地（其余缺失）
  const partial = new Map([["角色A.ysm", "hash-a"]]);

  it("showAll=true 返回全部（含本地已有）", () => {
    expect(filterModels(models, "", true, partial)).toHaveLength(3);
  });

  it("showAll=false 只返回缺失项", () => {
    const r = filterModels(models, "", false, partial);
    expect(r.map((m) => m.name)).toEqual(["角色B.ysm", "怪物X.ysm"]);
  });

  it("关键词大小写不敏感", () => {
    const r = filterModels(models, " 角色 ", true, partial);
    expect(r.map((m) => m.name)).toEqual(["角色A.ysm", "角色B.ysm"]);
  });

  it("关键词 + 仅缺失叠加", () => {
    const r = filterModels(models, "角色", false, partial);
    expect(r.map((m) => m.name)).toEqual(["角色B.ysm"]);
  });
});

describe("groupSites", () => {
  it("按 group 分组，缺省 browse", () => {
    const g = groupSites([
      { label: "A", group: "search" },
      { label: "B" },
      { label: "C", group: "repo" },
    ]);
    expect(Object.keys(g).sort()).toEqual(["browse", "repo", "search"]);
    expect(g.search).toHaveLength(1);
    expect(g.browse).toHaveLength(1);
    expect(g.repo).toHaveLength(1);
  });
});

describe("renderRepoHeaderHTML", () => {
  const base = {
    esc: (s: string) => s,
    repo: "repo",
    sourceLabel: "",
    modelsLength: 3,
    missingCount: 0,
  };

  it("缺失数 >0 时显示 ⬇️ 徽章", () => {
    const html = renderRepoHeaderHTML({ ...base, missingCount: 2 });
    expect(html).toContain("⬇️ 2");
    expect(html).toContain("模型 3");
  });

  it("缺失数 =0 时不渲染缺失徽章（下载按钮的 ⬇️ 恒常存在）", () => {
    const html = renderRepoHeaderHTML({ ...base, missingCount: 0 });
    expect(html).not.toContain("gh-model-badge-missing");
  });

  it("仓库名经 esc 转义", () => {
    const html = renderRepoHeaderHTML({
      ...base,
      esc: (s) => s.replace(/</g, "&lt;"),
      repo: "a<b",
    });
    expect(html).toContain("a&lt;b");
    expect(html).not.toContain("a<b");
  });
});

describe("renderCardsHTML", () => {
  const esc = (s: string) => s;

  it("按 SITE_GROUP_ORDER 顺序渲染分组标题", () => {
    const html = renderCardsHTML(
      [
        { label: "S1", group: "search" },
        { label: "B1" },
        { label: "R1", group: "repo" },
      ],
      esc,
    );
    const si = html.indexOf("搜索平台");
    const ri = html.indexOf("模型仓库");
    const bi = html.indexOf("浏览平台");
    expect(si).toBeGreaterThan(-1);
    expect(ri).toBeGreaterThan(si);
    expect(bi).toBeGreaterThan(ri);
  });

  it("空分组跳过（不渲染空标题）", () => {
    const html = renderCardsHTML([{ label: "B1" }], esc);
    expect(html).not.toContain("搜索平台");
    expect(html).not.toContain("模型仓库");
    expect(html).toContain("浏览平台");
  });

  it("卡片含 data-group 与 data-index 定位", () => {
    const sites = [
      { label: "S1", group: "search" },
      { label: "B1" },
    ];
    const html = renderCardsHTML(sites, esc);
    expect(html).toContain('data-group="search"');
    expect(html).toContain('data-index="0"');
    expect(html).toContain('data-index="1"');
  });

  it("label/desc 经 esc 转义", () => {
    const html = renderCardsHTML(
      [{ label: "a<b", desc: "d>e" }],
      (s) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    );
    expect(html).toContain("a&lt;b");
    expect(html).toContain("d&gt;e");
    expect(html).not.toContain("a<b");
  });

  it("图标缺省 🔗", () => {
    const html = renderCardsHTML([{ label: "L" }], esc);
    expect(html).toContain("🔗");
  });
});
