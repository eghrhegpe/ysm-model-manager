// ===== 站点视图 HTML 构建组件测试（G-1 — ADR-035 / Design.md §19.1）=====
// 纯函数 buildSiteHtml / createCrCard：浏览态/编辑态/空态分支、搜索词分区、
// 模式切换 active 类、标签过滤行、收藏置顶排序、排名分档/本地徽章/头像/平台徽章分支。
// t() 由 test-setup 全局查表 mock（zhCN）；workshop-data / workshop-icons 用 hoisted mock 隔离。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getTagFromRole, getTagIconFromRole, loadFavs } = vi.hoisted(() => ({
  getTagFromRole: vi.fn((role?: string) => role || "creator"),
  getTagIconFromRole: vi.fn(() => "🏷️"),
  loadFavs: vi.fn<() => string[]>(() => []),
}));

vi.mock("./workshop-data.ts", () => ({ getTagFromRole, loadFavs }));
vi.mock("@/utils/icon/workshop-icons.ts", () => ({
  getSiteIcon: vi.fn(() => "🌐"),
  getTagIconFromRole,
}));

import { buildSiteHtml, createCrCard } from "./render.ts";
import type { BuildSiteHtmlCtx, CrCardCtx } from "./render.ts";
import type { WorkshopSite } from "@/bindings/ysm-model-manager/go/types/models.ts";
import type { LocalCreatorLike } from "./site-view.ts";

const esc = (s: unknown): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** 解析 buildSiteHtml 产物 */
function renderHtml(ctx: BuildSiteHtmlCtx): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = buildSiteHtml(ctx);
  return root;
}

/** 解析 createCrCard 产物（声明式字符串 → DOM） */
function parseCardHtml(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root.firstElementChild as HTMLElement;
}

function makeCtx(overrides: Partial<BuildSiteHtmlCtx> = {}): BuildSiteHtmlCtx {
  return {
    esc,
    site: { id: "siteA", label: "站点A" } as WorkshopSite,
    creators: [],
    allSites: [],
    wsEditModeRef: { v: false },
    repoAuthors: [],
    authorCountMap: {},
    avatarCache: {},
    browseMode: { v: "external" },
    activeTag: "",
    searchKw: "",
    viewerMode: false,
    isFaved: () => false,
    ...overrides,
  };
}

function cardCtx(
  creators: LocalCreatorLike[],
  overrides: Partial<CrCardCtx> = {},
): CrCardCtx {
  return {
    esc,
    isFaved: () => false,
    authorCountMap: {},
    avatarCache: null,
    creators,
    site: {} as WorkshopSite,
    ...overrides,
  };
}


beforeEach(() => {
  vi.clearAllMocks();
  loadFavs.mockReturnValue([]);
});

describe("buildSiteHtml 浏览态", () => {
  it("1. 空创作者 → 空态区块 + 计数 0 + 编辑/更新入口，无标签行与搜索词分区", () => {
    const root = renderHtml(makeCtx());
    // 空态走居中空态原语（content-layout .placeholder-box--roomy），不再是站点私有的 .cr-empty-site
    expect(root.querySelector(".placeholder-box.placeholder-box--roomy")).toBeTruthy();
    expect(root.querySelector("[data-local-empty]")).toBeTruthy();
    expect(root.querySelector("#ws-cr-count")?.textContent).toBe("(0)");
    expect(root.querySelector(".cr-fetch-btn")).toBeTruthy();
    expect(root.querySelector(".cr-edit-btn")).toBeTruthy();
    expect(root.querySelector(".cr-tag-filter-row")).toBeNull();
    expect(root.querySelector(".cr-preset-area")).toBeNull();
  });

  it("2. 有创作者 → 计数 + 搜索框回填 searchKw + 收藏置顶排序（就地排序）", () => {
    loadFavs.mockReturnValue(["乙"]);
    const creators = [{ name: "甲" }, { name: "乙" }] as LocalCreatorLike[];
    const ctx = makeCtx({ creators, searchKw: "猫" });
    const root = renderHtml(ctx);
    expect(root.querySelector("#ws-cr-count")?.textContent).toBe("(2)");
    expect(
      (root.querySelector("#ws-cr-search") as HTMLInputElement).value,
    ).toBe("猫");
    // buildSiteHtml 在 ctx.creators 上就地排序（共享数组副作用），收藏置顶
    expect(creators.map((c) => c.name)).toEqual(["乙", "甲"]);
    const grid = root.querySelector("#cr-creator-grid");
    expect(grid).toBeTruthy();
    // 声明式契约：卡片由 buildSiteHtml 直接产出（不再留空 grid 交由 events 填充）
    expect(grid!.querySelectorAll(".cr-creator-card")).toHaveLength(2);
    expect(grid!.querySelector(".cr-card-name")?.textContent).toBe("乙");
    expect(root.querySelector(".placeholder-box")).toBeNull();
  });

  it("3. 标签过滤行：固定 全部/creator/official + 动态角色标签 + active 高亮", () => {
    const creators = [
      { name: "甲", role: "vup" },
      { name: "乙", role: "official" },
    ] as LocalCreatorLike[];
    const root = renderHtml(makeCtx({ creators, activeTag: "official" }));
    const btns = [...root.querySelectorAll<HTMLElement>(".cr-tag-filter-btn")];
    expect(btns.map((b) => b.dataset.tag)).toEqual(["", "creator", "official", "vup"]);
    expect(
      root.querySelector('.cr-tag-filter-btn[data-tag="official"]')?.classList.contains("active"),
    ).toBe(true);
    expect(root.querySelector('.cr-tag-filter-btn[data-tag=""]')?.classList.contains("active")).toBe(false);

    // activeTag 为空 → 「全部」按钮 active
    const root2 = renderHtml(makeCtx({ creators }));
    expect(root2.querySelector('.cr-tag-filter-btn[data-tag=""]')?.classList.contains("active")).toBe(true);
  });

  it("4. viewerMode → 隐藏编辑入口按钮，保留更新配置按钮", () => {
    const root = renderHtml(makeCtx({ viewerMode: true }));
    expect(root.querySelector(".cr-edit-btn")).toBeNull();
    expect(root.querySelector(".cr-fetch-btn")).toBeTruthy();
  });

  it("5. 搜索词分区：按钮 data-q + 计数 + 三种模式切换 active 类", () => {
    const site = {
      id: "siteA",
      presetSearches: [
        { label: "搜A", q: "a" },
        { label: "搜B", q: "b" },
      ],
    } as WorkshopSite;
    const root = renderHtml(makeCtx({ site }));
    const btns = [...root.querySelectorAll<HTMLElement>(".cr-preset-btn")];
    expect(btns.map((b) => b.dataset.q)).toEqual(["a", "b"]);
    expect(btns[0]?.textContent).toBe("搜A");
    expect(root.querySelector(".cr-section-sub")?.textContent).toBe("(2)");
    expect(root.querySelector(".cr-mode-opt.cr-mode-ext")?.classList.contains("active")).toBe(true);
    expect(root.querySelector(".cr-mode-opt.cr-mode-emb")?.classList.contains("active")).toBe(false);

    const rootEmb = renderHtml(makeCtx({ site, browseMode: { v: "embed" } }));
    expect(rootEmb.querySelector(".cr-mode-opt.cr-mode-emb")?.classList.contains("active")).toBe(true);
    const rootWin = renderHtml(makeCtx({ site, browseMode: { v: "window" } }));
    expect(rootWin.querySelector(".cr-mode-opt.cr-mode-win")?.classList.contains("active")).toBe(true);
  });
});

describe("buildSiteHtml 编辑态", () => {
  it("6. 编辑态基础骨架：保存/取消/新增区，无浏览态按钮；空 preset 也渲染新增区", () => {
    const root = renderHtml(makeCtx({ wsEditModeRef: { v: true } }));
    expect(root.querySelector(".cr-save-btn")).toBeTruthy();
    expect(root.querySelector(".cr-cancel-btn")).toBeTruthy();
    expect(root.querySelector(".cr-add-preset")).toBeTruthy();
    expect(root.querySelector(".cr-add")).toBeTruthy();
    expect(root.querySelector(".cr-edit-btn")).toBeNull();
    expect(root.querySelector(".cr-fetch-btn")).toBeNull();
    expect(root.querySelectorAll(".cr-edit-card[data-edit='preset']")).toHaveLength(0);
    // 编辑态不渲染浏览态创作者网格（原 cmBbPopulateCreatorGrid 的 wsEditModeRef 守卫已迁至此）
    expect(root.querySelector("#cr-creator-grid")).toBeNull();
  });

  it("7. 编辑态预设卡：label 回填 + 上移/下移/删除按钮", () => {
    const site = {
      id: "siteA",
      presetSearches: [
        { label: "搜A", q: "a" },
        { label: "搜B", q: "b" },
      ],
    } as WorkshopSite;
    const root = renderHtml(makeCtx({ wsEditModeRef: { v: true }, site }));
    const cards = [...root.querySelectorAll(".cr-edit-card[data-edit='preset']")];
    expect(cards).toHaveLength(2);
    expect((cards[0]?.querySelector('input[data-fld="label"]') as HTMLInputElement).value).toBe("搜A");
    expect(cards[0]?.querySelector(".cr-order-up")).toBeTruthy();
    expect(cards[0]?.querySelector(".cr-order-down")).toBeTruthy();
    expect(cards[0]?.querySelector(".cr-del-preset")).toBeTruthy();
    expect(cards[0]?.getAttribute("data-edit-idx")).toBe("0");
  });

  it("8. 编辑态创作者卡：name/desc 回填 + type 多选 selected 命中 + role 单选 selected", () => {
    const site = { id: "siteA" } as WorkshopSite;
    const allSites = [
      { id: "siteA", label: "站点A" },
      { id: "siteB", label: "站点B" },
    ] as WorkshopSite[];
    const creators = [{ name: "甲", desc: "描述甲", type: "siteA", role: "official" }] as LocalCreatorLike[];
    const root = renderHtml(makeCtx({ wsEditModeRef: { v: true }, site, allSites, creators }));
    const card = root.querySelector(".cr-edit-card:not([data-edit='preset'])") as HTMLElement;
    expect((card.querySelector('input[data-fld="name"]') as HTMLInputElement).value).toBe("甲");
    expect((card.querySelector('input[data-fld="desc"]') as HTMLInputElement).value).toBe("描述甲");
    const typeSel = card.querySelector('select[data-fld="type"]') as HTMLSelectElement;
    expect(typeSel.options).toHaveLength(2);
    expect(typeSel.options[0]?.selected).toBe(true);
    expect(typeSel.options[1]?.selected).toBe(false);
    const roleSel = card.querySelector('select[data-fld="role"]') as HTMLSelectElement;
    expect([...roleSel.options].find((o) => o.selected)?.value).toBe("official");
  });
});

describe("createCrCard 创作者卡片工厂（声明式字符串）", () => {
  it("9. 基础卡片：名称/描述 esc、平台徽章、星标未收藏、搜索按钮、头像兜底字符", () => {
    const cr = {
      name: "张三",
      desc: "好<模型",
      type: "siteA;siteB",
      role: "creator",
    } as LocalCreatorLike;
    const card = parseCardHtml(createCrCard(cr, cardCtx([cr], { site: { searchUrl: "u" } as WorkshopSite })));
    expect(card.dataset.name).toBe("张三");
    expect(card.classList.contains("cr-creator-card")).toBe(true);
    expect(card.querySelector(".cr-card-name")?.textContent).toBe("张三");
    expect(card.querySelector(".cr-card-desc")?.textContent).toBe("好<模型");
    expect(card.querySelectorAll(".cr-platform-badge")).toHaveLength(2);
    expect(card.querySelector(".cr-star-btn")?.textContent).toBe("☆");
    expect(card.querySelector(".cr-card-search")).toBeTruthy();
    expect(card.querySelector(".cr-avatar-fallback")?.textContent).toBe("张");
    expect(card.querySelector(".cr-card-local-count")).toBeNull();
    expect(card.querySelector(".cr-tag")).toBeTruthy();
  });

  it("10. 已收藏 → ⭐；无 searchUrl → 无搜索按钮；单作者 pct=0 → gold 级 + 顶部条", () => {
    const cr = { name: "甲" } as LocalCreatorLike;
    const card = parseCardHtml(createCrCard(cr, cardCtx([cr], { isFaved: () => true, avatarCache: {} })));
    expect(card.querySelector(".cr-star-btn")?.textContent).toBe("⭐");
    expect(card.querySelector(".cr-card-search")).toBeNull();
    expect(card.dataset.tier).toBe("gold");
    expect(card.querySelector(".cr-card-tier-bar")).toBeTruthy();
    expect(card.querySelector(".cr-avatar-ring")?.getAttribute("data-spin")).toBe("gold");
  });

  it("11. 本地徽章三态：有数量 / 无数量 / 非本地不渲染", () => {
    const mk = (cr: LocalCreatorLike, counts: Record<string, number>) =>
      parseCardHtml(createCrCard(cr, cardCtx([cr], { authorCountMap: counts, avatarCache: {} })));
    const c1 = mk({ name: "甲", desc: "", _fromLocal: true }, { 甲: 5 });
    expect(c1.querySelector(".cr-card-local-count")?.textContent).toBe("5");
    expect(c1.querySelector("[data-local-creator]")?.getAttribute("data-local-creator")).toBe("甲");
    const c2 = mk({ name: "乙", desc: "", _fromLocal: true }, {});
    // ADR-238：本地徽章图标由 emoji 📁 改走 SVG（含作者分支 c1 的 📁+数字，2026-09 收尽）
    const c2html = c2.querySelector(".cr-card-local-count")?.innerHTML ?? "";
    expect(c2html).toContain('<svg class="ws-icon"');
    const c3 = mk({ name: "丙", desc: "" }, {});
    expect(c3.querySelector(".cr-card-local-count")).toBeNull();
  });

  it("12. 头像：avatarCache 命中 → img；空名 → 兜底 '?'", () => {
    const cr1 = { name: "张三" } as LocalCreatorLike;
    const c1 = parseCardHtml(createCrCard(cr1, cardCtx([cr1], { avatarCache: { 张三: "https://x/a.png" } })));
    const img = c1.querySelector(".cr-avatar") as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("https://x/a.png");
    expect(img.getAttribute("data-debug-avatar")).toBe("张三");
    const cr2 = { name: "" } as LocalCreatorLike;
    const c2 = parseCardHtml(createCrCard(cr2, cardCtx([cr2])));
    expect(c2.querySelector(".cr-avatar-fallback")?.textContent).toBe("?");
  });

  it("13. 排名分档：gold（前 10%）/ silver（前 25%）/ 无", () => {
    const creators = [
      { name: "甲" },
      { name: "乙" },
      { name: "丙" },
      { name: "丁" },
      { name: "戊" },
      { name: "己" },
    ] as LocalCreatorLike[];
    const counts = { 甲: 10, 乙: 9, 丙: 1, 丁: 1, 戊: 1, 己: 1 };
    const ctx = cardCtx(creators, { authorCountMap: counts });
    const c0 = parseCardHtml(createCrCard(creators[0], ctx));
    expect(c0.dataset.tier).toBe("gold");
    const c1 = parseCardHtml(createCrCard(creators[1], ctx));
    expect(c1.dataset.tier).toBe("silver");
    const c2 = parseCardHtml(createCrCard(creators[2], ctx));
    expect(c2.dataset.tier).toBeUndefined();
    expect(c2.querySelector(".cr-card-tier-bar")).toBeNull();
  });
});
