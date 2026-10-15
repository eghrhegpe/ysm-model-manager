// ===== 站点视图 HTML 构建（纯函数，从 site-view.ts 拆出）=====
//
// 全部 HTML 以模板字面量拼装（与 views 层 tpl.ts / tpl-oldest.ts 同口径），
// 不再手搓 `+` 字符串接龙。esc() 仍在插值点显式调用，保持「结构在代码、内容经转义」红线。

import type { LocaleKey } from "@/core/i18n/t.ts";
import { t } from "@/core/i18n/t.ts";
import { stagger } from "@/utils/animation/stagger.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { getSiteIcon, getTagIconFromRole } from "@/utils/icon/workshop-icons.ts";
import type { WorkshopSite } from "@/utils/types-re-export.ts";
import type { LocalCreatorLike, RepoAuthorLike } from "./types.ts";
import type { BrowseModeRef } from "./workshop-browse-mode.ts";
import {
  compareFavFirst,
  getTagDisplayLabel,
  getTagFromRole,
  parseSiteIds,
} from "./workshop-data.ts";

/**
 * ===== 创作者视图片段单源（ADR-034-d1）=====
 *
 * 卡片（createCrCard）与详情浮层（events.ts|cmCrBuildDetailHtml）是同一视图模型的两种布局
 * （网格项 vs role=dialog 模态），视图不合并不假，但重复的标记必须单源。
 * 四个片段（头像/平台徽章/星标/身份 tag）各写一份时已漂过两次——卡片漏站点图标、浮层 span 未闭合。
 * 改这里即同时改两处布局；不要在任一布局里重写标记。历史见知识卡 app-content-site.md §不变量。
 */

/** class 名片段白名单：role 取自 creators.json（用户数据），含空白会把一个 class 劈成两个。 */
function tagClassOf(role?: string): string {
  const r = getTagFromRole(role);
  return `cr-tag-${/^[A-Za-z0-9_-]+$/.test(r) ? r : "unknown"}`;
}

/** 身份 tag chip：图标 + 展示文案（`getTagDisplayLabel` 单源；未知 tag 原样，不冒充别的身份）。 */
export function creatorTagChipHtml(role: string | undefined, esc: (s: unknown) => string): string {
  return `<span class="cr-tag ${tagClassOf(role)}">${getTagIconFromRole(role)} <span>${esc(
    getTagDisplayLabel(getTagFromRole(role)),
  )}</span></span>`;
}

/**
 * 平台徽章组：站点图标 + 站点 id。
 * 刻意不用 `workshop_sites.json` 的 `label`——那是中文优先的捆绑内容（"B站"/"爱发电"），
 * 塞进 en/ja 界面属新增中文硬编码；站点名多语化是独立产品决策（见知识卡 app-content-site）。
 */
export function creatorPlatformBadgesHtml(
  type: string | undefined,
  esc: (s: unknown) => string,
): string {
  return parseSiteIds(type)
    .map(
      (platform: string) =>
        `<span class="cr-platform-badge">${getSiteIcon(platform)}<span>${esc(platform)}</span></span>`,
    )
    .join("");
}

/**
 * 收藏星标按钮（双态 SVG 随主题 currentColor；`data-star` 是事件委托键）。
 *
 * 2026-10-15 a11y：由 `<span>` 升格为 `<button type="button">`——span 不进 Tab 序、无 role、
 * 无可达名，键盘/读屏用户此前**无法直接收藏**（唯一通路是开浮层→点浮层星标→关浮层）。
 * `aria-pressed` 承载双态语义（三条切换路径须同步改写它，见 site/events.ts）。
 */
export function creatorStarBtnHtml(
  name: string,
  faved: boolean,
  esc: (s: unknown) => string,
): string {
  return `<button type="button" class="cr-star-btn" data-star="${esc(name)}" aria-pressed="${faved}" aria-label="${esc(
    t("content.favToggleLabel", { name }),
  )}">${faved ? UI_ICONS.starFilled : UI_ICONS.star}</button>`;
}

/** 头像变体：卡片与浮层的 class / 降级属性不同（结构差异，非口径差异）。 */
export interface AvatarVariant {
  imgClass: string;
  fallbackClass: string;
  /** 卡片走声明式 data-avatar-fallback + 单点 bindAvatarFallback；浮层由调用方持引用直接绑 */
  withFallbackAttr: boolean;
}

/**
 * 头像（含加载失败降级字符）。`fallbackChar` 一并返回供调用方绑 error。
 * 空名兜底（"?"）也收在此处——浮层曾漏掉该守卫（空名渲染成空字母块）。
 */
export function creatorAvatarHtml(
  name: string,
  avatarCache: Record<string, string> | undefined,
  esc: (s: unknown) => string,
  variant: AvatarVariant,
): { html: string; fallbackChar: string } {
  const fallbackChar = name ? esc(name.charAt(0)).toUpperCase() : "?";
  const fallbackDiv = `<div class="${variant.fallbackClass}">${fallbackChar}</div>`;
  const uri = avatarCache?.[name];
  const html = uri
    ? `<img class="${variant.imgClass}" src="${esc(uri)}" data-debug-avatar="${esc(name)}"${
        variant.withFallbackAttr ? ` data-avatar-fallback="${fallbackChar}"` : ""
      }>`
    : fallbackDiv;
  return { html, fallbackChar };
}

/** 创作者卡片工厂上下文 */
export interface CrCardCtx {
  esc: (s: unknown) => string;
  isFaved: (name: string) => boolean;
  authorCountMap: Record<string, number>;
  avatarCache?: Record<string, string> | null;
  site: WorkshopSite;
  /** 展示位次（调用方按排序后展示序计）：stagger 入场延迟 = stagger(staggerIdx)，带 300ms 封顶 */
  staggerIdx: number;
  /** 位置色带（`creatorBandOf(staggerIdx)` 同源取值）：**位置地标，不是荣誉**——
   *  与产量/名次无关，仅按展示序每 `CREATOR_BAND_SIZE` 张换一色。 */
  band: CreatorBand;
}

/** buildSiteHtml 依赖的渲染上下文 */
export interface BuildSiteHtmlCtx {
  esc: (s: unknown) => string;
  site: WorkshopSite;
  creators: LocalCreatorLike[];
  allSites: WorkshopSite[];
  wsEditModeRef: { v: boolean };
  repoAuthors: RepoAuthorLike[];
  authorCountMap: Record<string, number>;
  avatarCache: Record<string, string>;
  /** 创作者频道浏览模式 { v }，决定 pill 开关当前 active */
  browseMode: BrowseModeRef;
  /** 分类标签过滤（localStorage 持久化），""=全部。
   *  ⚠️ 渲染期**只**用于「筛选按钮 active 高亮」，不参与可见性过滤——真正的隐显切换由
   *  `site/edit.ts|eeApplyFilters` 在 DOM 层 toggle `.cr-card-hidden`（逐键不重渲整树）。
   *  改这个值不会少渲染任何一张卡，勿当成过滤开关（2026-10-15 注释澄清）。 */
  activeTag: string;
  /** 创作者搜索关键词（localStorage 持久化）。⚠️ 渲染期**只**回填搜索框 value，
   *  真正的关键词过滤同样在 `site/edit.ts|eeApplyFilters`（DOM 层），见上条。 */
  searchKw: string;
  /** 查看器模式（网页版/Android ADR-049 能力门控）：隐藏桌面专属的创作者编辑入口（保存走未桥接 BySite 绑定） */
  viewerMode: boolean;
  /** 收藏名单：调用方每轮渲染注入一份。渲染层是纯函数——禁止在 N 张卡的循环里各调一次
   *  isFaved/loadFavs（那是每轮 N+1 次 localStorage 解析）；可执行契约锁在 render.test.ts。 */
  favedNames: readonly string[];
}

/** 创作者卡片工厂 */
export function createCrCard(cr: LocalCreatorLike, ctx: CrCardCtx): string {
  const { esc, isFaved, authorCountMap, avatarCache, site, staggerIdx, band } = ctx;
  const authorCount = authorCountMap[cr.name] || 0;

  // 头像 / 平台徽章 / 星标 / 身份 tag 全部走片段单源（ADR-034-d1），卡片只保留布局与差异变体
  const { html: avatarHtml } = creatorAvatarHtml(cr.name, avatarCache ?? undefined, esc, {
    imgClass: "cr-avatar",
    fallbackClass: "cr-avatar cr-avatar-fallback",
    withFallbackAttr: true,
  });

  // 本地徽章/联网搜索同为卡内交互，2026-10-15 a11y 一并由 span 升格为真按钮
  // （aria-label 兼可达名；纯展示态无 title/aria 差异时仍复用既有 i18n 文案）。
  const localBadge = cr._fromLocal
    ? authorCount > 0
      ? `<button type="button" class="cr-card-local-count cr-card-local-jump" data-local-creator="${esc(
          cr.name,
        )}" title="${t("content.localModelsCount", { n: authorCount })}" aria-label="${esc(
          t("content.localModelsCount", { n: authorCount }),
        )}">${UI_ICONS.folder}${authorCount}</button>`
      : `<button type="button" class="cr-card-local-count cr-card-local-jump" data-local-creator="${esc(
          cr.name,
        )}" title="${t("content.viewLocalModels")}" aria-label="${esc(
          t("content.viewLocalModels"),
        )}">${UI_ICONS.folder}</button>`
    : "";

  const platformBadges = creatorPlatformBadgesHtml(cr.type, esc);

  // 🔍 搜索快捷按钮（与星标对称）：有站点搜索能力才渲染，点击联网搜索创作者，免进详情
  const searchBtn = site.searchUrl
    ? `<button type="button" class="cr-card-search" data-search-creator="${esc(
        cr.name,
      )}" title="${t("content.searchMoreModels")}" aria-label="${esc(
        t("content.searchCreatorAria", { name: cr.name }),
      )}">${UI_ICONS.search}</button>`
    : "";

  // 位置色带条：每张卡都有（位置装饰，不再有「无牌」态）
  const bandBar = `<div class="cr-card-band-bar"></div>`;
  const starBtn = creatorStarBtnHtml(cr.name, isFaved(cr.name), esc);
  const tagChip = creatorTagChipHtml(cr.role, esc);
  // data-tag 仍是原始 role id（过滤键 = 数据语义），与展示层的 class 白名单解耦
  const tagRole = getTagFromRole(cr.role);

  // 锐评 P0-2b：desc 展示兜底从数据层上收视图层——mergeLocalAuthorsInto 不再把
  // t("community.fromLocal") 写进 desc（语言串落盘污染数据面），本地条目以
  // 空 desc 存储、渲染时按 _fromLocal 标记现取当前语言的提示。
  const descText = cr.desc || (cr._fromLocal ? t("community.fromLocal") : "");

  return (
    // 2026-10-15 a11y：卡片成「列表项」——与网格的 role=list 配对，读屏可播报「列表，共 N 项」；
    // tabindex 保留（键盘导航的原语选择器 `.gh-card[tabindex]` 与 focus-visible 都依赖它）。
    `<div class="gh-card cr-creator-card cr-creator-card--grid" role="listitem" tabindex="0" style="animation-delay:${stagger(
      staggerIdx,
    )}ms" data-name="${esc(cr.name)}" data-tag="${esc(tagRole)}" data-band="${esc(
      band,
    )}" title="${esc(t("common.viewDetail", { name: cr.name }))}">` +
    bandBar +
    `<div class="cr-card-header"><div class="cr-avatar-container"><div class="cr-avatar-ring"></div>${avatarHtml}</div>` +
    `<div class="cr-card-name-row"><span class="cr-card-name">${esc(
      cr.name,
    )}</span>${localBadge}${starBtn}${searchBtn}</div></div>` +
    `<div class="cr-card-desc">${esc(descText)}</div>` +
    `<div class="cr-card-footer">${platformBadges}${tagChip}</div></div>`
  );
}

/** 搜索词分区：模式切换按钮 + 预设搜索按钮。无 preset 时返回空串（由主函数按条件跳过）。 */
function buildSiteSearchSection(ctx: BuildSiteHtmlCtx): string {
  const { esc, site, browseMode } = ctx;
  const presets = site.presetSearches ?? [];
  // 图标（UI_ICONS）在模板层拼装，i18n 值只留纯文本（ADR-238：结构在代码，内容在 i18n）。
  const modeOpt = (
    cls: string,
    mode: "external" | "embed" | "window",
    icon: string,
    key: LocaleKey,
  ) =>
    `<span class="cr-mode-opt ${cls}${browseMode.v === mode ? " active" : ""}" data-mode="${mode}" title="${t(
      key,
    )}">${icon} ${t(key)}</span>`;
  return (
    `<div class="cr-section"><span class="cr-section-title-lg">${UI_ICONS.search} ${t(
      "content.webSearchTerms",
    )}</span><span class="cr-section-sub">(${
      presets.length
    })</span><span class="cr-section-fill"></span><button id="cr-mode-toggle" class="cr-mode-switch">` +
    modeOpt("cr-mode-ext", "external", UI_ICONS.external, "content.modeExternal") +
    modeOpt("cr-mode-emb", "embed", UI_ICONS.web, "content.modeEmbed") +
    modeOpt("cr-mode-win", "window", UI_ICONS.window, "content.modeWindow") +
    `</button></div>` +
    `<div class="cr-preset-area">` +
    presets
      .map(
        (ps, i) =>
          `<button class="cr-preset-btn" style="animation-delay:${stagger(
            i,
            25,
            300,
          )}ms" data-q="${esc(ps.q || ps.label)}">${esc(ps.label)}</button>`,
      )
      .join("") +
    `</div>`
  );
}

/** 收藏置顶排序：比较器 compareFavFirst（workshop-data.ts 单源），与收藏后 DOM 就地重排同口径。
 *  返回新数组——buildSiteHtml 保持纯函数无副作用，不得就地改 ctx.creators。
 *  收藏名单由调用方注入；在此自取 loadFavs 会放大成每轮 N+1 次解析。 */
function sortCreatorsFavedFirst(
  creators: LocalCreatorLike[],
  authorCountMap: Record<string, number>,
  favedNames: readonly string[],
): LocalCreatorLike[] {
  return [...creators].sort((a, b) => compareFavFirst(a, b, favedNames, authorCountMap));
}

/**
 * 位置色带（2026-10-15 语义重做，替代原「按产量百分位分档」）：
 *  **色带 = 展示序上的位置地标，不是荣誉**——循环发生在 TS 侧，CSS 只看见 gold/silver 两值。
 *
 * 历史病灶（重做理由）：原 `computeCreatorTiers` 按 authorCountMap（本地已下载模型数）
 * 取前 10% gold / 前 25% silver，需要三条发牌纪律 + 并列组裁断 + 银档底保共 60 行，
 * 只为一条 3px 色条；且语义错位——「顶级创作者」实际度量的是**用户自己的下载习惯**，
 * 新用户全站无牌（功能静默死亡）。现改为纯位置装饰：每 `CREATOR_BAND_SIZE` 张换一色，
 * 交替即斑马纹，零信号依赖、零排序、O(1)。
 *
 * ⚠️ 节奏参数只此一处：改 9→12 或改三色循环都只动本常量与 `creatorBandOf`，CSS 零改动
 * （这也是「不把循环交给 CSS `:nth-child`」的理由：那要按组写 9 个选择器且无法单测）。
 */
export const CREATOR_BAND_SIZE = 9;

/** 色带取值 = 视觉 token 名（`--band-gold`/`--band-silver`），不含任何强弱含义。 */
export type CreatorBand = "gold" | "silver";

/**
 * 展示位次 → 色带：第 0 组 gold、第 1 组 silver、第 2 组 gold…（组号奇偶决定颜色）。
 * 纯函数、O(1)；展示序变化（收藏置顶重排）后须重新盖章，见 `site/events.ts|applyBandSequence`。
 */
export function creatorBandOf(displayIndex: number): CreatorBand {
  return Math.floor(Math.max(0, displayIndex) / CREATOR_BAND_SIZE) % 2 === 0 ? "gold" : "silver";
}

/**
 * 分类标签过滤按钮行：固定「全部」+ 按本站实际存在的身份派生（**按钮必须由数据算出**）。
 * 曾硬编码「全部 / 创作者 / 官方」三按钮，与本站数据无关——多数站点的「官方」必得 0 结果（死按钮）。
 * 含 getTagFromRole 的 ""→creator 默认归类，故默认身份者仍归「创作者」档，不会漏；「全部」恒在。
 * 新增 role 时须同补 ORDERED_ROLES，否则按钮序不更新。详见知识卡 app-content-site.md §不变量。
 */
function buildSiteTagFilterRow(ctx: BuildSiteHtmlCtx): string {
  const { esc, creators, activeTag } = ctx;
  const tagSet = new Set<string>();
  creators.forEach((cr) => {
    const tag = getTagFromRole(cr.role);
    if (tag) tagSet.add(tag);
  });
  // 顺序稳定：creator → official → 其余按 role 枚举顺序，保证同数据多次渲染按钮序一致。
  // 类型取 string[] 而非 as const 字面量联合——未知 role 需能 push 进同一数组。
  const ORDERED_ROLES: readonly string[] = ["creator", "official", "vup", "oc", "repo"];
  const tags: string[] = ORDERED_ROLES.filter((r) => tagSet.has(r));
  // tagSet 中的未知 role（非枚举内）追加在后，保证未来新增身份不丢
  for (const tag of tagSet) {
    if (!tags.includes(tag)) tags.push(tag);
  }
  const filterBtn = (tag: string, delay: number, inner: string) =>
    `<button class="cr-tag-filter-btn${
      activeTag === tag ? " active" : ""
    }" style="animation-delay:${delay}ms" data-tag="${esc(tag)}">${inner}</button>`;
  const displayLabel = (tag: string) =>
    `${getTagIconFromRole(tag)} <span>${esc(getTagDisplayLabel(tag))}</span>`;
  return (
    `<div class="cr-tag-filter-row">` +
    filterBtn("", 0, t("content.filterAll")) +
    tags.map((tag, i) => filterBtn(tag, stagger(i + 1, 30, 300), displayLabel(tag))).join("") +
    `</div>`
  );
}

/** 创作者浏览区：标题栏 + 收藏置顶 + 标签行 + grid / 空态。 */
function buildSiteBrowseSection(ctx: BuildSiteHtmlCtx): string {
  const { esc, creators, authorCountMap } = ctx;
  const parts: string[] = [];
  // 标题栏始终显示，确保「更新配置」按钮可点击
  parts.push(
    `<div class="cr-section cr-section-wrap"><span class="cr-section-title-lg">${UI_ICONS.appearance} ${t(
      "content.activeCreators",
    )}</span><span class="cr-section-sub" id="ws-cr-count" title="${esc(
      // 计数分母 = 本站卡片总数（DOM 口径），此前无任何说明——(3/47) 里的 47 是什么全靠猜
      t("content.creatorCountTitle", { n: creators.length }),
    )}">(${creators.length}/${creators.length})</span><input type="text" id="ws-cr-search" class="cr-search-input" placeholder="${t(
      "content.searchCreatorPlaceholder",
    )}" value="${esc(
      ctx.searchKw,
    )}"><span class="cr-section-fill"></span><button class="btn-base sm cr-fetch-btn" title="${t(
      "content.fetchConfigTitle",
    )}">${UI_ICONS.download} ${t("content.fetchConfig")}</button>${
      ctx.viewerMode
        ? ""
        : `<button class="btn-base sm cr-edit-btn">${UI_ICONS.edit} ${t("content.edit")}</button>`
    }</div>`,
  );
  if (creators.length) {
    // favedNames 由调用方注入 → 整轮零 localStorage 访问；Set 化一次供排序与 N 张卡共用
    const favSet = new Set(ctx.favedNames);
    const isFavedNow = (name: string): boolean => favSet.has(name);
    // 返回新数组，不就地改 ctx.creators（原数组保持 allCreators 过滤序）
    const sortedCreators = sortCreatorsFavedFirst(creators, authorCountMap, ctx.favedNames);
    parts.push(buildSiteTagFilterRow(ctx));
    // 卡片声明式生成（不留空 grid 给 events 填充）；色带按**展示序**当场算：
    // band = f(i)，无预计算表、无 O(n log n)、无信号依赖（2026-10-15 语义重做后无需图例）
    const cardsHtml = sortedCreators
      .map((cr, i) =>
        createCrCard(cr, {
          esc: ctx.esc,
          isFaved: isFavedNow,
          authorCountMap: ctx.authorCountMap,
          avatarCache: ctx.avatarCache,
          site: ctx.site,
          staggerIdx: i,
          band: creatorBandOf(i),
        }),
      )
      .join("");
    // role=list + aria-label：把「一堆卡片」声明成读屏可计数的列表（子项 role=listitem 见 createCrCard）
    parts.push(
      `<div class="cr-creator-grid" id="cr-creator-grid" role="list" aria-label="${esc(
        t("content.activeCreators"),
      )}">${cardsHtml}</div>`,
    );
  } else {
    parts.push(
      `<div class="placeholder-box placeholder-box--roomy">${t("content.emptyCreators")}<br><br><button class="cr-local-btn" data-local-empty>${
        UI_ICONS.folderOpen
      } ${t("content.browseLocalModels")}</button></div>`,
    );
  }
  return parts.join("");
}

/** 搜索词编辑卡列表 + 新增区（空 preset 也渲染，让用户能新增）。 */
function buildSitePresetEditCards(ctx: BuildSiteHtmlCtx): string {
  const { esc, site } = ctx;
  let html = `<div class="cr-section"><span class="cr-section-title-lg">${t("content.searchTerms")}</span></div>`;
  // 同 q 出现序号（锐评修复，2026-10-14）：`data-preset-q` 用 `ps.q || ps.label` 作
  // focus-restore 的稳定身份，但**多个 preset 共享同一 q 是常见配置**（bowroll 站实测
  // 「热门日系模型」/「日系模型」可同为 q=MMD，知识卡 app-content-site 有记）——q 重复时
  // 身份不唯一，按 q 恢复焦点会跳到错误行。故追加「同一 q 内的第几次出现」作消歧位：
  // 重排/增删都不改变某个 preset 的 (q, occ)（除非重排两个 q 相同的 preset，那本就不可区分）。
  const occOf = new Map<string, number>();
  (site.presetSearches || []).forEach((ps, idx) => {
    const q = ps.q || ps.label;
    const occ = occOf.get(q) ?? 0;
    occOf.set(q, occ + 1);
    html +=
      `<div class="cr-edit-card" draggable="false" data-edit="preset" data-edit-idx="${idx}" data-preset-q="${esc(q)}" data-preset-occ="${occ}">` +
      `<div class="cr-edit-card-head"><span class="cr-drag-handle">${UI_ICONS.dragHandle}</span><span class="cr-preset-icon">${UI_ICONS.search}</span>` +
      `<input data-idx="${idx}" data-fld="label" value="${esc(ps.label)}" class="cr-input cr-input-name" placeholder="${t(
        "content.searchKeywordPlaceholder",
      )}">` +
      `<button data-idx="${idx}" class="cr-btn-icon cr-order-up" title="${t("content.moveUp")}">${UI_ICONS.chevronUp}</button>` +
      `<button data-idx="${idx}" class="cr-btn-icon cr-order-down" title="${t("content.moveDown")}">${UI_ICONS.chevronDown}</button>` +
      `<button data-idx="${idx}" class="cr-btn-icon cr-del-preset" title="${t("content.delete")}">${UI_ICONS.delete}</button>` +
      `</div></div>`;
  });
  html += `<div class="cr-add-area"><button class="cr-add-preset">${t("content.addSearchTerm")}</button></div>`;
  return html;
}

/**
 * 单张创作者编辑卡 HTML（纯函数：编辑态「新增」走局部 DOM 追加时复用它，避免整树重建丢焦点）。
 * 注意 idx 是**编辑视图索引**（creators 过滤后数组的下标），对应 data-edit-idx / data-idx。
 */
export function buildCreatorEditCard(
  cr: LocalCreatorLike,
  idx: number,
  allSites: WorkshopSite[],
  esc: (s: unknown) => string,
): string {
  const roleEmoji = getTagIconFromRole(cr.role);
  const roleOption = (value: string, label: string) =>
    `<option value="${value}"${cr.role === value ? " selected" : ""}>${label}</option>`;
  return (
    `<div class="cr-edit-card" draggable="false" data-edit-idx="${idx}">` +
    `<div class="cr-edit-card-head"><span class="cr-drag-handle">${UI_ICONS.dragHandle}</span><span class="cr-edit-card-avatar">${roleEmoji}</span>` +
    `<input data-idx="${idx}" data-fld="name" value="${esc(
      cr.name,
    )}" class="cr-input cr-input-name" placeholder="${t("content.namePlaceholder")}">` +
    `<button data-idx="${idx}" class="cr-btn-icon cr-del" title="${t("content.delete")}">${UI_ICONS.delete}</button>` +
    `</div><div class="cr-edit-card-body"><div class="cr-edit-card-row"><span class="cr-edit-label">${t(
      "content.labelDesc",
    )}</span>` +
    `<input data-idx="${idx}" data-fld="desc" value="${esc(
      cr.desc,
    )}" class="cr-input cr-input-desc" placeholder="${t("content.descPlaceholder")}"></div>` +
    `<div class="cr-edit-card-row"><span class="cr-edit-label">${t(
      "content.labelPlatform",
    )}</span>` +
    // 平台字段走可点击 chip 组（与浏览态 .cr-platform-badge 同语义）——原 `<select multiple>`
    // 需 Ctrl/Cmd 多选、移动端不可用、与浏览态视觉脱节。点 chip 即 toggle type 的站点段。
    `<div class="cr-site-chip-group" data-fld="type" data-idx="${idx}">${(allSites || [])
      .map(
        (s) =>
          `<button type="button" class="cr-site-chip${
            parseSiteIds(cr.type).includes(s.id) ? " active" : ""
          }" data-site-id="${esc(s.id)}" title="${esc(s.label)}">${esc(s.label)}</button>`,
      )
      .join("")}</div>` +
    // 五项 role option 的展示文案统一走 getTagDisplayLabel（与卡片 chip / 筛选行同一单源），
    // value 仍是原始 role id（数据语义）。曾三短两长两套词族，详见知识卡 §不变量。
    `<select data-idx="${idx}" data-fld="role" class="cr-input-role">${(
      ["creator", "official", "vup", "oc", "repo"] as const
    )
      .map((r) => roleOption(r, getTagDisplayLabel(r)))
      .join("")}</select></div></div></div>`
  );
}

/** 创作者编辑区：保存/取消/dropzone + 各创作者编辑卡 + 新增区。 */
function buildSiteCreatorEditCards(ctx: BuildSiteHtmlCtx): string {
  const { esc, creators, allSites } = ctx;
  let html =
    `<div class="cr-section"><span class="cr-section-title-lg">${UI_ICONS.edit} ${t(
      "content.editCreators",
    )}</span><span class="cr-section-fill"></span>` +
    `<button class="btn-base sm accent cr-save-btn">${t("content.save")}</button>` +
    `<button class="btn-base sm cr-cancel-btn">${t("common.cancel")}</button></div>` +
    `<div class="cr-drop-zone" id="cr-drop-zone"><span class="cr-drop-icon">${UI_ICONS.import}</span>` +
    `<span class="cr-drop-text">${t("content.dropZoneHint")}</span></div>`;
  creators.forEach((cr, idx) => {
    html += buildCreatorEditCard(cr, idx, allSites, esc);
  });
  html += `<div class="cr-add-area"><button class="cr-add">${t("content.addCreator")}</button></div>`;
  return html;
}

/**
 * 构建站点视图 HTML 字符串（纯函数，不碰 DOM）。
 * 返回 parts.join("") 的完整 HTML，由主入口负责写入 searchResults.innerHTML。
 * 按分区委托给 buildSiteSearchSection / buildSiteBrowseSection（浏览态）与
 * buildSitePresetEditCards + buildSiteCreatorEditCards（编辑态）。
 */
export function buildSiteHtml(ctx: BuildSiteHtmlCtx): string {
  const parts: string[] = [];
  parts.push(`<div class="cr-scroll">`);

  // 搜索词分区
  if (ctx.site.presetSearches?.length) {
    parts.push(buildSiteSearchSection(ctx));
  }

  // 创作者分区：浏览态（标题栏始终显示）或编辑态
  if (!ctx.wsEditModeRef.v) {
    parts.push(buildSiteBrowseSection(ctx));
  } else {
    parts.push(buildSitePresetEditCards(ctx) + buildSiteCreatorEditCards(ctx));
  }

  parts.push(`</div>`);
  return parts.join("");
}
