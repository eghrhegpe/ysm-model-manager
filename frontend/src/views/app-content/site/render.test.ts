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

import { buildSiteHtml, CREATOR_BAND_SIZE, createCrCard, creatorBandOf } from "./render.ts";
import type { BuildSiteHtmlCtx, CrCardCtx } from "./render.ts";
import type { WorkshopSite } from "@/bindings/ysm-model-manager/go/types/models.ts";
import type { LocalCreatorLike } from "./site-view.ts";

import { escUnknown as esc } from "@/utils/html/html.ts";
import { t } from "@/core/i18n/t.ts";

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
    favedNames: [],
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
    band: "gold",
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
    const creators = [{ name: "甲" }, { name: "乙" }] as LocalCreatorLike[];
    const ctx = makeCtx({ creators, searchKw: "猫", favedNames: ["乙"] });
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
    // P1-c 锐评：收藏判定经 favedNames 一次性注入——整轮渲染对 loadFavs
    //（= localStorage.getItem + JSON.parse）**零调用**（原每卡一次 isFaved → N+1 次解析）。
    // 本断言把「渲染层是纯函数」钉成可执行契约：未来任何人把 isFaved/loadFavs 引回
    // createCrCard/sort 循环，这里立刻转红。
    expect(loadFavs).not.toHaveBeenCalled();
  });

  it("3. 标签过滤行：按本站实际身份派生 + active 高亮（不再硬编码三按钮）", () => {
    const creators = [
      { name: "甲", role: "vup" },
      { name: "乙", role: "official" },
    ] as LocalCreatorLike[];
    const root = renderHtml(makeCtx({ creators, activeTag: "official" }));
    const btns = [...root.querySelectorAll<HTMLElement>(".cr-tag-filter-btn")];
    // 恒有「全部」+ 本站实际存在的身份（此处 vup + official）。顺序 = 固定身份序。
    // 历史缺陷：曾硬编码 全部/creator/official 三项，与本站数据无关——实测 10 个站点
    // 中 9 个没有 official，那 9 站点「官方」必得 0 结果（实测 creators.json）。
    expect(btns.map((b) => b.dataset.tag)).toEqual(["", "official", "vup"]);
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

  it("3a. 本站不存在的身份不出按钮（死按钮回归：点了必 0 结果）", () => {
    // 全站 creator 场景（实测 bilibili/afdian/booth/deviantart 等 6 站如此）：
    // 「官方」按钮不该出现，「创作者」不该与「全部」等价重复出现
    const allCreator = [
      { name: "甲", role: "creator" },
      { name: "乙" }, // 无 role → getTagFromRole 归 creator
    ] as LocalCreatorLike[];
    const root = renderHtml(makeCtx({ creators: allCreator }));
    const tags = [...root.querySelectorAll<HTMLElement>(".cr-tag-filter-btn")].map(
      (b) => b.dataset.tag,
    );
    expect(tags).toEqual(["", "creator"]);
    expect(root.querySelector('.cr-tag-filter-btn[data-tag="official"]')).toBeNull();
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
    // 🟡4 锐评：五项身份 option 的展示文案统一走 getTagDisplayLabel 单源（与卡片 chip /
    // 筛选行同词）。value 仍是原始 role id（数据语义）。
    // 历史缺口：本用例此前只断言 vup/oc 两项，creator/official/repo 走的 content.role*
    // 短文案（「创作者/官方/仓库」）与 chip 长文案并存却无人测——「单源」宣称只覆盖 2/5。
    // 现五项全断言：任何一项回退到别的词族都会立刻转红。
    // layout-assert: option 顺序 = role 权威枚举序（creator 为首 = 新建条目默认档），非快照噪声
    const opts = [...roleSel.options].map((o) => [o.value, o.textContent]);
    expect(opts).toEqual([
      ["creator", t("workshop.roleCreator")],
      ["official", t("workshop.roleOfficial")],
      ["vup", t("workshop.roleVup")],
      ["oc", t("workshop.roleOc")],
      ["repo", t("workshop.roleRepo")],
    ]);
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
    // 平台徽章必须带站点图标（docs/guide/creators.md 明写「收录的平台图标」，且 CSS 基类
    // .cr-platform-badge 早就按 inline-flex + gap:2px 的「图标+文字」形状设计）——
    // 历史缺陷：createCrCard 只拼裸站点 id、从不取 getSiteIcon，图标只在详情浮层出现。
    const badge = card.querySelector(".cr-platform-badge") as HTMLElement;
    expect(badge.textContent).toContain("🌐"); // 本文件 mock getSiteIcon → "🌐"
    expect(badge.textContent).toContain("siteA"); // 文字仍是站点 id（label 无多语源，见注记）
    // ADR-238：星标走 UI_ICONS 语义 SVG（未收藏 = 空心 star，无 fill 属性），不再 "☆" 字符
    const star = card.querySelector(".cr-star-btn svg");
    expect(star).toBeTruthy();
    expect(star?.getAttribute("fill")).toBeNull();
    expect(card.querySelector(".cr-card-search")).toBeTruthy();
    expect(card.querySelector(".cr-avatar-fallback")?.textContent).toBe("张");
    expect(card.querySelector(".cr-card-local-count")).toBeNull();
    expect(card.querySelector(".cr-tag")).toBeTruthy();
  });

  it("9b. role 含空白 → class 归一为 cr-tag-unknown，data-tag 仍留原值（class 白名单）", () => {
    // role 取自 creators.json（用户数据）。原实现把 role 直接拼进 class，
    // 含空白的值会把一个 class 劈成两个（`cr-tag-a b` → 命中 .b 这条无关规则）。
    // 展示层必须消毒，数据语义（data-tag 过滤键）仍留原值。
    const cr = { name: "甲", role: "a b", type: "siteA" } as LocalCreatorLike;
    const card = parseCardHtml(createCrCard(cr, cardCtx()));
    const tag = card.querySelector(".cr-tag") as HTMLElement;
    expect(tag.className).toBe("cr-tag cr-tag-unknown");
    expect(card.dataset.tag).toBe("a b");
  });

  it("10. 已收藏 → starFilled；无 searchUrl → 无搜索按钮；色带恒有一档（位置装饰，与人数/产量无关）", () => {
    const cr = { name: "甲" } as LocalCreatorLike;
    const card = parseCardHtml(
      createCrCard(cr, cardCtx({ isFaved: () => true, avatarCache: {}, band: creatorBandOf(0) })),
    );
    // 已收藏星标 = starFilled（svg 带 fill 属性）
    const starFav = card.querySelector(".cr-star-btn svg");
    expect(starFav).toBeTruthy();
    expect(starFav?.hasAttribute("fill")).toBe(true);
    expect(card.querySelector(".cr-card-search")).toBeNull();
    // 2026-10-15 语义重做：原「单作者站点不发牌」的荣誉纪律随分档一起作废——
    // 色带是位置地标，单人站点同样有（第 0 组 = gold）。
    expect(card.dataset.band).toBe("gold");
    expect(card.querySelector(".cr-card-band-bar")).toBeTruthy();
    // P2-2 锐评：光环常转（data-spin + ring-spin hover）已删——avatar-ring 不再携带 data-spin
    expect(card.querySelector(".cr-avatar-ring")?.getAttribute("data-spin")).toBeNull();
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

  it("13. 位置色带：按展示序每 9 张交替 gold/silver（位置语义，与产量/名次无关）", () => {
    // 2026-10-15 语义重做：原「按本地模型数百分位分档（前 10% gold / 前 25% silver）」
    // 需三条发牌纪律 + 并列组裁断 + 银档底保共约 60 行，只为一条 3px 色条，
    // 且语义错位——度量的是**用户自己的下载习惯**，新用户全站无牌（功能静默死亡）。
    // 现为纯位置装饰：band = creatorBandOf(展示位次)。
    const at = (i: number) => creatorBandOf(i);
    expect(at(0)).toBe("gold");
    expect(at(CREATOR_BAND_SIZE - 1)).toBe("gold");
    expect(at(CREATOR_BAND_SIZE)).toBe("silver"); // 第 2 组（位次 9~17）
    expect(at(CREATOR_BAND_SIZE * 2 - 1)).toBe("silver");
    expect(at(CREATOR_BAND_SIZE * 2)).toBe("gold"); // 第 3 组回金（交替）
    expect(at(CREATOR_BAND_SIZE * 3)).toBe("silver");
    // 负位次归第 0 组（调用方传展示位次，正常不为负——防御性口径）
    expect(at(-1)).toBe("gold");
    // 卡片侧：data-band 恒在 + 色带条恒渲染（不再有「无牌」态）
    const c0 = parseCardHtml(createCrCard({ name: "甲" } as LocalCreatorLike, cardCtx()));
    expect(c0.dataset.band).toBe("gold");
    expect(c0.querySelector(".cr-card-band-bar")).toBeTruthy();
    const c9 = parseCardHtml(
      createCrCard({ name: "乙" } as LocalCreatorLike, cardCtx({ band: at(9) })),
    );
    expect(c9.dataset.band).toBe("silver");
    // 与产量彻底解耦：authorCountMap 再高也不改色带（原实现在此处会发 gold）
    const cRich = parseCardHtml(
      createCrCard(
        { name: "丙" } as LocalCreatorLike,
        cardCtx({ band: at(9), authorCountMap: { 丙: 999 } }),
      ),
    );
    expect(cRich.dataset.band).toBe("silver");
  });

  it("13b. 色带跟随展示序：收藏置顶后按**新位次**重新着色（不是跟着卡片身份走）", () => {
    // 20 张：位次 0~8 金、9~17 银、18~19 金。
    // 判别力前提：被判的卡片必须**跨档移动**，否则换不换色看不出差别。
    const creators = Array.from({ length: 20 }, (_, i) => ({ name: `c${i}` }) as LocalCreatorLike);
    const plain = renderHtml(makeCtx({ creators }));
    // 收藏 c19（末位）→ 置顶插队，其后每张卡位次 +1：原本位次 8 的 c8 落到 9 → 金变银
    const plainC8 = plain.querySelector<HTMLElement>('.cr-creator-card[data-name="c8"]');
    expect(plainC8?.dataset.band).toBe("gold"); // 位次 8 ∈ 第 1 组
    const faved = renderHtml(makeCtx({ creators, favedNames: ["c19"] }));
    const names = [...faved.querySelectorAll<HTMLElement>(".cr-creator-card")].map(
      (c) => c.dataset.name,
    );
    expect(names[0]).toBe("c19"); // 收藏置顶排序仍生效（本次重做不动排序）
    const favedC8 = faved.querySelector<HTMLElement>('.cr-creator-card[data-name="c8"]');
    expect(favedC8?.dataset.band).toBe("silver"); // 位次 9 ∈ 第 2 组 → 颜色跟着位置变
    // 未跨档者不受影响（c7 位次 7→8，仍在第 1 组）
    expect(
      faved.querySelector<HTMLElement>('.cr-creator-card[data-name="c7"]')?.dataset.band,
    ).toBe("gold");
  });

  it("13c. 色带图例已删（位置地标不需要解释性图例）", () => {
    const root = renderHtml(makeCtx({ creators: [{ name: "甲" }] as LocalCreatorLike[] }));
    expect(root.querySelector('[data-testid="cr-tier-legend"]')).toBeNull();
    expect(root.querySelector(".cr-tier-legend")).toBeNull();
    // 色带本身照常渲染（删的是图例，不是色带）
    expect(root.querySelector(".cr-card-band-bar")).toBeTruthy();
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

  it("18. 卡内交互控件为真 <button>（Tab 可达 + 可达名 + aria-pressed），网格/卡片带列表语义", () => {
    // 2026-10-15 a11y：三个卡内交互原为裸 <span>——不进 Tab 序、无 role、无可达名，
    // 键盘/读屏用户唯一收藏通路是「开浮层 → 点浮层星标 → 关浮层」。此处锁死升格结果。
    const cr = {
      name: "张三",
      desc: "",
      type: "siteA",
      _fromLocal: true,
    } as LocalCreatorLike;
    const card = parseCardHtml(
      createCrCard(
        cr,
        cardCtx({ site: { searchUrl: "u" } as WorkshopSite, authorCountMap: { 张三: 3 } }),
      ),
    );
    for (const sel of [".cr-star-btn", ".cr-card-search", ".cr-card-local-jump"]) {
      const el = card.querySelector(sel) as HTMLElement | null;
      expect(el, `${sel} 缺失`).toBeTruthy();
      expect(el!.tagName, `${sel} 必须是 <button>（键盘可达）`).toBe("BUTTON");
      expect(el!.getAttribute("type"), `${sel} 须 type=button（表单内不误提交）`).toBe("button");
      expect(el!.getAttribute("aria-label")?.trim(), `${sel} 缺可达名`).toBeTruthy();
    }
    // 星标双态语义：aria-pressed 与 SVG 双态同源；可达名带创作者名（图标按钮无可见文本）
    const star = card.querySelector(".cr-star-btn") as HTMLElement;
    expect(star.getAttribute("aria-pressed")).toBe("false");
    expect(star.getAttribute("aria-label")).toContain("张三");
    const favCard = parseCardHtml(createCrCard(cr, cardCtx({ isFaved: () => true })));
    expect(favCard.querySelector(".cr-star-btn")?.getAttribute("aria-pressed")).toBe("true");
    // 列表语义：卡片 role=listitem + 网格 role=list/aria-label（读屏可播报「列表，N 项」）
    expect(card.getAttribute("role")).toBe("listitem");
    const root = renderHtml(makeCtx({ creators: [cr] }));
    const grid = root.querySelector("#cr-creator-grid");
    expect(grid?.getAttribute("role")).toBe("list");
    expect(grid?.getAttribute("aria-label")).toBe(t("content.activeCreators"));
    // 计数分母有出处：(n/n) 里的 n 是什么此前全靠猜
    expect(root.querySelector("#ws-cr-count")?.getAttribute("title")).toBe(
      t("content.creatorCountTitle", { n: 1 }),
    );
  });
});
