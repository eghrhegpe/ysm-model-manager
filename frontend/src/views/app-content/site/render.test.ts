// ===== 站点视图 HTML 构建组件测试（G-1 — ADR-035 / Design.md §19.1）=====
// 纯函数 buildSiteHtml / createCrCard：浏览态/编辑态/空态分支、搜索词分区、
// 模式切换 active 类、标签过滤行、收藏置顶排序、排名分档/本地徽章/头像/平台徽章分支。
// t() 由 test-setup 全局查表 mock（zhCN）；workshop-data / workshop-icons 用 hoisted mock 隔离，
// 但**身份映射（getCreatorIdentity / getTagDisplayLabel）走真实实现**——它们是 i18n label 与
// 「未知 tag 原样」规则的唯一真值源，整段 mock 掉等于没锁（复核 P1-3 假锁批评）。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getTagFromRole, getTagIconFromRole, loadFavs } = vi.hoisted(() => ({
  getTagFromRole: vi.fn((role?: string) => role || "creator"),
  getTagIconFromRole: vi.fn(() => "🏷️"),
  loadFavs: vi.fn<() => string[]>(() => []),
}));

vi.mock("./workshop-data.ts", async () => {
  const actual = await vi.importActual<typeof import("./workshop-data.ts")>("./workshop-data.ts");
  return { ...actual, getTagFromRole, loadFavs };
});
vi.mock("@/utils/icon/workshop-icons.ts", async () => {
  // ICONS 必须为真：真实 getCreatorIdentity 用它填充 icon 字段
  const actual = await vi.importActual<typeof import("@/utils/icon/workshop-icons.ts")>(
    "@/utils/icon/workshop-icons.ts",
  );
  return { ...actual, getSiteIcon: vi.fn(() => "🌐"), getTagIconFromRole };
});

import { buildSiteHtml, computeCreatorTiers, createCrCard } from "./render.ts";
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

function cardCtx(overrides: Partial<CrCardCtx> = {}): CrCardCtx {
  return {
    esc,
    isFaved: () => false,
    authorCountMap: {},
    avatarCache: null,
    site: {} as WorkshopSite,
    staggerIdx: 0,
    tier: "",
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
    expect(root.querySelector("#ws-cr-count")?.textContent).toBe("(0/0)");
    expect(root.querySelector(".cr-fetch-btn")).toBeTruthy();
    expect(root.querySelector(".cr-edit-btn")).toBeTruthy();
    expect(root.querySelector(".cr-tag-filter-row")).toBeNull();
    expect(root.querySelector(".cr-preset-area")).toBeNull();
  });

  it("2. 有创作者 → 计数 + 搜索框回填 searchKw + 收藏置顶排序（P2-8 不再就地改入参）", () => {
    loadFavs.mockReturnValue(["乙"]);
    const creators = [{ name: "甲" }, { name: "乙" }] as LocalCreatorLike[];
    const ctx = makeCtx({ creators, searchKw: "猫" });
    const root = renderHtml(ctx);
    expect(root.querySelector("#ws-cr-count")?.textContent).toBe("(2/2)");
    expect(
      (root.querySelector("#ws-cr-search") as HTMLInputElement).value,
    ).toBe("猫");
    // P2-8 锐评：buildSiteHtml 不再就地改 ctx.creators（纯函数），收藏置顶体现在渲染顺序
    expect(creators.map((c) => c.name)).toEqual(["甲", "乙"]);
    const grid = root.querySelector("#cr-creator-grid");
    expect(grid).toBeTruthy();
    // 声明式契约：卡片由 buildSiteHtml 直接产出（不再留空 grid 交由 events 填充），
    // 渲染顺序 = 收藏置顶优先（乙在前）
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
    // 锐评 P0-4：动态 tag 按钮的展示文案走真实 getTagDisplayLabel（i18n label 单源），
    // 不再是裸 role id（ja/en 用户曾直接看到 "vup"/"oc"）；data-tag 仍为过滤键原始 id。
    const vupBtn = root.querySelector<HTMLElement>('.cr-tag-filter-btn[data-tag="vup"]');
    expect(vupBtn?.textContent).toContain("VTuber 创作者");
    expect(vupBtn?.textContent).not.toContain("vup"); // 裸 id 不再露给用户
    expect(vupBtn?.dataset.tag).toBe("vup");
    expect(
      root.querySelector('.cr-tag-filter-btn[data-tag="official"]')?.classList.contains("active"),
    ).toBe(true);
    expect(root.querySelector('.cr-tag-filter-btn[data-tag=""]')?.classList.contains("active")).toBe(false);

    // activeTag 为空 → 「全部」按钮 active
    const root2 = renderHtml(makeCtx({ creators }));
    expect(root2.querySelector('.cr-tag-filter-btn[data-tag=""]')?.classList.contains("active")).toBe(true);
  });

  it("3b. 未知 tag → 原样显示（不冒充 YSM 创作者，否则文案与 data-tag 过滤语义不符）", () => {
    const creators = [{ name: "丙", role: "modeler" }] as LocalCreatorLike[];
    const root = renderHtml(makeCtx({ creators }));
    const btn = root.querySelector<HTMLElement>('.cr-tag-filter-btn[data-tag="modeler"]');
    expect(btn?.textContent).toContain("modeler");
    expect(btn?.textContent).not.toContain("YSM 创作者");
    // 卡片 tag 与筛选行同口径（复核 P1-3：同一 tag 曾两种呈现）
    const cardTag = root.querySelector(".cr-creator-card .cr-tag");
    expect(cardTag?.textContent).toContain("modeler");
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

  it("8. 编辑态创作者卡：name/desc 回填 + type badge 组 active 命中 + role 单选 selected（P1-5）", () => {
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
    // P1-5：platform 控件从 `<select multiple>` 改 badge 组——不再有 select[data-fld="type"]
    const typeGroup = card.querySelector('.cr-site-chip-group[data-fld="type"]') as HTMLElement;
    expect(typeGroup).toBeTruthy();
    const chips = [...typeGroup.querySelectorAll<HTMLElement>(".cr-site-chip")];
    expect(chips.map((c) => c.dataset.siteId)).toEqual(["siteA", "siteB"]);
    expect(chips[0]?.classList.contains("active")).toBe(true); // type="siteA" 命中
    expect(chips[1]?.classList.contains("active")).toBe(false);
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
    const card = parseCardHtml(createCrCard(cr, cardCtx({ site: { searchUrl: "u" } as WorkshopSite })));
    expect(card.dataset.name).toBe("张三");
    expect(card.classList.contains("cr-creator-card")).toBe(true);
    expect(card.querySelector(".cr-card-name")?.textContent).toBe("张三");
    expect(card.querySelector(".cr-card-desc")?.textContent).toBe("好<模型");
    expect(card.querySelectorAll(".cr-platform-badge")).toHaveLength(2);
    // ADR-238：星标走 UI_ICONS 语义 SVG（未收藏 = 空心 star，无 fill 属性），不再 "☆" 字符
    const star = card.querySelector(".cr-star-btn svg");
    expect(star).toBeTruthy();
    expect(star?.getAttribute("fill")).toBeNull();
    expect(card.querySelector(".cr-card-search")).toBeTruthy();
    expect(card.querySelector(".cr-avatar-fallback")?.textContent).toBe("张");
    expect(card.querySelector(".cr-card-local-count")).toBeNull();
    expect(card.querySelector(".cr-tag")).toBeTruthy();
  });

  it("10. 已收藏 → starFilled；无 searchUrl → 无搜索按钮；单作者 pct=0 → gold 级 + 顶部条", () => {
    const cr = { name: "甲" } as LocalCreatorLike;
    // 分档预计算（O(n log n) 一次）后传入卡片 ctx——单作者 pct=0 → gold
    const tiers = computeCreatorTiers([cr], {});
    const card = parseCardHtml(
      createCrCard(cr, cardCtx({ isFaved: () => true, avatarCache: {}, tier: tiers[cr.name] ?? "" })),
    );
    // 已收藏星标 = starFilled（svg 带 fill 属性）
    const starFav = card.querySelector(".cr-star-btn svg");
    expect(starFav).toBeTruthy();
    expect(starFav?.hasAttribute("fill")).toBe(true);
    expect(card.querySelector(".cr-card-search")).toBeNull();
    expect(card.dataset.tier).toBe("gold");
    expect(card.querySelector(".cr-card-tier-bar")).toBeTruthy();
    expect(card.querySelector(".cr-avatar-ring")?.getAttribute("data-spin")).toBe("gold");
  });

  it("11. 本地徽章三态：有数量 / 无数量 / 非本地不渲染", () => {
    const mk = (cr: LocalCreatorLike, counts: Record<string, number>) =>
      parseCardHtml(createCrCard(cr, cardCtx({ authorCountMap: counts, avatarCache: {} })));
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
    const c1 = parseCardHtml(createCrCard(cr1, cardCtx({ avatarCache: { 张三: "https://x/a.png" } })));
    const img = c1.querySelector(".cr-avatar") as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("https://x/a.png");
    expect(img.getAttribute("data-debug-avatar")).toBe("张三");
    const cr2 = { name: "" } as LocalCreatorLike;
    const c2 = parseCardHtml(createCrCard(cr2, cardCtx()));
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
    // 分档改由 computeCreatorTiers 一次性预计算（替代原卡片内逐张全量排序），按 name 取值传入
    const tiers = computeCreatorTiers(creators, counts);
    expect(tiers["甲"]).toBe("gold");
    expect(tiers["乙"]).toBe("silver");
    expect(tiers["丙"]).toBe("");
    const c0 = parseCardHtml(createCrCard(creators[0], cardCtx({ authorCountMap: counts, tier: tiers["甲"] }) ));
    expect(c0.dataset.tier).toBe("gold");
    const c1 = parseCardHtml(createCrCard(creators[1], cardCtx({ authorCountMap: counts, tier: tiers["乙"] })));
    expect(c1.dataset.tier).toBe("silver");
    const c2 = parseCardHtml(createCrCard(creators[2], cardCtx({ authorCountMap: counts, tier: tiers["丙"] })));
    expect(c2.dataset.tier).toBeUndefined();
    expect(c2.querySelector(".cr-card-tier-bar")).toBeNull();
  });

  it("13b. tier 图例：有分档卡才渲染，含两档 swatch 与 i18n 文案；位次语义 = 相对排名（全 0 时首作者仍 gold，图例照渲）", () => {
    // 有分档：计数 {甲:10, 乙:9} → 甲 gold、乙 silver
    const c1 = [{ name: "甲" }, { name: "乙" }] as LocalCreatorLike[];
    const root1 = renderHtml(makeCtx({ creators: c1, authorCountMap: { 甲: 10, 乙: 9 } }));
    const legend1 = root1.querySelector('[data-testid="cr-tier-legend"]');
    expect(legend1).toBeTruthy();
    expect(legend1?.querySelector(".cr-tier-swatch--gold")).toBeTruthy();
    expect(legend1?.querySelector(".cr-tier-swatch--silver")).toBeTruthy();
    expect(legend1?.textContent).toContain("Top 10%");
    expect(legend1?.textContent).toContain("Top 25%");
    // computeCreatorTiers 按相对位次分档（全 0 时首作者 pct=0 → gold）——图例语义忠实于该位次规则
    const c2 = [{ name: "甲" }, { name: "乙" }] as LocalCreatorLike[];
    const root2 = renderHtml(makeCtx({ creators: c2, authorCountMap: {} }));
    expect(root2.querySelector('[data-testid="cr-tier-legend"]')).toBeTruthy();
  });

  it("14. 本地条目空 desc → 卡片回退 i18n 提示（数据面不落语言串，锐评 P0-2b）", () => {
    const cr = { name: "本地甲", desc: "", _fromLocal: true } as LocalCreatorLike;
    const card = parseCardHtml(createCrCard(cr, cardCtx({ avatarCache: {} })));
    expect(card.querySelector(".cr-card-desc")?.textContent).toBe("来自本地仓库");

    // 非本地条目空 desc → 留白（不冒充本地来源）
    const plain = { name: "普通乙", desc: "" } as LocalCreatorLike;
    const card2 = parseCardHtml(createCrCard(plain, cardCtx({ avatarCache: {} })));
    expect(card2.querySelector(".cr-card-desc")?.textContent).toBe("");
  });

  it("15. 非空 desc 优先于本地提示（真实描述不被兜底覆盖）", () => {
    const cr = { name: "本地丙", desc: "真实描述", _fromLocal: true } as LocalCreatorLike;
    const card = parseCardHtml(createCrCard(cr, cardCtx({ avatarCache: {} })));
    expect(card.querySelector(".cr-card-desc")?.textContent).toBe("真实描述");
  });

  it("16. 卡片 tag 显示 i18n label，class 仍按原始 role id（复核 P1-3 另一半）", () => {
    const cr = { name: "丁", role: "vup" } as LocalCreatorLike;
    const card = parseCardHtml(createCrCard(cr, cardCtx({ avatarCache: {} })));
    const tag = card.querySelector(".cr-tag");
    expect(tag?.textContent).toContain("VTuber 创作者");
    expect(tag?.className).toContain("cr-tag-vup"); // 样式 key 仍是原始 id
  });

  it("17. stagger 入场延迟取展示位次（staggerIdx），带 300ms 封顶——收藏置顶卡按视觉顺序入场", () => {
    const cr = { name: "甲" } as LocalCreatorLike;
    const at0 = parseCardHtml(createCrCard(cr, cardCtx({ staggerIdx: 0 })));
    expect(at0.getAttribute("style")).toContain("animation-delay:0ms");
    const at5 = parseCardHtml(createCrCard(cr, cardCtx({ staggerIdx: 5 })));
    expect(at5.getAttribute("style")).toContain("animation-delay:150ms");
    // 封顶：展示位次 20 → min(20*30,300)=300ms（旧实现无封顶，随名次线性累加）
    const at20 = parseCardHtml(createCrCard(cr, cardCtx({ staggerIdx: 20 })));
    expect(at20.getAttribute("style")).toContain("animation-delay:300ms");
  });
});
