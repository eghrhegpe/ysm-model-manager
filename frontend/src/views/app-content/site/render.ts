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

/** 收藏星标按钮（双态 SVG 随主题 currentColor；`data-star` 是事件委托键）。 */
export function creatorStarBtnHtml(
  name: string,
  faved: boolean,
  esc: (s: unknown) => string,
): string {
  return `<span class="cr-star-btn" data-star="${esc(name)}">${
    faved ? UI_ICONS.starFilled : UI_ICONS.star
  }</span>`;
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
  /** 排名分档：经 computeCreatorTiers 预计算（一次 O(n log n)），替代卡内逐张全量排序 */
  tier: "" | "gold" | "silver";
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
  /** 分类标签过滤（localStorage 持久化），""=全部 */
  activeTag: string;
  /** 创作者搜索关键词（localStorage 持久化） */
  searchKw: string;
  /** 查看器模式（网页版/Android ADR-049 能力门控）：隐藏桌面专属的创作者编辑入口（保存走未桥接 BySite 绑定） */
  viewerMode: boolean;
  /** 收藏名单：调用方每轮渲染注入一份。渲染层是纯函数——禁止在 N 张卡的循环里各调一次
   *  isFaved/loadFavs（那是每轮 N+1 次 localStorage 解析）；可执行契约锁在 render.test.ts。 */
  favedNames: readonly string[];
}

/** 创作者卡片工厂 */
export function createCrCard(cr: LocalCreatorLike, ctx: CrCardCtx): string {
  const { esc, isFaved, authorCountMap, avatarCache, site, staggerIdx, tier: tierRank } = ctx;
  const authorCount = authorCountMap[cr.name] || 0;

  // 头像 / 平台徽章 / 星标 / 身份 tag 全部走片段单源（ADR-034-d1），卡片只保留布局与差异变体
  const { html: avatarHtml } = creatorAvatarHtml(cr.name, avatarCache ?? undefined, esc, {
    imgClass: "cr-avatar",
    fallbackClass: "cr-avatar cr-avatar-fallback",
    withFallbackAttr: true,
  });

  const localBadge = cr._fromLocal
    ? authorCount > 0
      ? `<span class="cr-card-local-count cr-card-local-jump" data-local-creator="${esc(
          cr.name,
        )}" title="${t("content.localModelsCount", { n: authorCount })}">${UI_ICONS.folder}${authorCount}</span>`
      : `<span class="cr-card-local-count cr-card-local-jump" data-local-creator="${esc(
          cr.name,
        )}" title="${t("content.viewLocalModels")}">${UI_ICONS.folder}</span>`
    : "";

  const platformBadges = creatorPlatformBadgesHtml(cr.type, esc);

  // 🔍 搜索快捷按钮（与星标对称）：有站点搜索能力才渲染，点击联网搜索创作者，免进详情
  const searchBtn = site.searchUrl
    ? `<span class="cr-card-search" data-search-creator="${esc(
        cr.name,
      )}" title="${t("content.searchMoreModels")}">${UI_ICONS.search}</span>`
    : "";

  const tierBar = tierRank ? `<div class="cr-card-tier-bar"></div>` : "";
  const starBtn = creatorStarBtnHtml(cr.name, isFaved(cr.name), esc);
  const tagChip = creatorTagChipHtml(cr.role, esc);
  // data-tag 仍是原始 role id（过滤键 = 数据语义），与展示层的 class 白名单解耦
  const tagRole = getTagFromRole(cr.role);

  // 锐评 P0-2b：desc 展示兜底从数据层上收视图层——mergeLocalAuthorsInto 不再把
  // t("community.fromLocal") 写进 desc（语言串落盘污染数据面），本地条目以
  // 空 desc 存储、渲染时按 _fromLocal 标记现取当前语言的提示。
  const descText = cr.desc || (cr._fromLocal ? t("community.fromLocal") : "");

  return (
    `<div class="gh-card cr-creator-card cr-creator-card--grid" tabindex="0" style="animation-delay:${stagger(
      staggerIdx,
    )}ms" data-name="${esc(cr.name)}" data-tag="${esc(tagRole)}"${
      tierRank ? ` data-tier="${esc(tierRank)}"` : ""
    } title="${esc(t("common.viewDetail", { name: cr.name }))}">` +
    tierBar +
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
 * 创作者排名分档（纯函数）：按「本地仓库模型数」降序分档——前 10% gold、前 25% silver，
 * 单次 O(n log n)，调用方预计算一次后按 name 取值（卡内逐张全量重排的旧写法已废止）。
 *
 * 三条发牌纪律（缺一即退化成噪声分档）：
 * ① 无信号不发牌：榜首 count ≤ 0 时全体返回 ""；② 单人站点（n=1）不发牌——无比较对象；
 * ③ silver 底保：纯位次银档在 n=2~5 落空，故第 2 名兜底拿银。
 * 并列组同档（组内取最靠前位次）、组序裁断不腰斩；silver 位次恒 ≥ gold，不倒挂。
 *
 * 完整推导与历史缺陷见知识卡 app-content-site.md §不变量「排名分档预计算」。
 */
export function computeCreatorTiers(
  creators: LocalCreatorLike[],
  authorCountMap: Record<string, number>,
): Record<string, "" | "gold" | "silver"> {
  const out: Record<string, "" | "gold" | "silver"> = {};
  const sorted = [...creators].sort(
    (a, b) => (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0),
  );
  const total = sorted.length;
  if (total === 0) return out;
  const countOf = (cr: LocalCreatorLike) => authorCountMap[cr.name] || 0;
  // 纪律 ① 无信号 / 纪律 ② 单人站点 → 全员无牌（逐人建 key，缺席者同样归入「无牌」）
  if (total < 2 || countOf(sorted[0]) <= 0) {
    sorted.forEach((cr) => {
      out[cr.name] = "";
    });
    return out;
  }

  // 每个并列组的起始位次（组内并列者共享该位次，见上方并列口径）
  const groupStart: number[] = [];
  sorted.forEach((cr, idx) => {
    if (idx === 0 || countOf(cr) !== countOf(sorted[idx - 1])) {
      groupStart.push(idx);
    }
  });
  const tierOfRank = (rank: number): "" | "gold" | "silver" => {
    const pct = rank / (total - 1);
    return pct < 0.1 ? "gold" : pct < 0.25 ? "silver" : "";
  };
  // 组序裁断（组序 = 位次序，故天然递增）：gold = 榜首所在组；silver = 向后的 silver 组，
  // 末尾按组裁断而非按位次切片——并列组绝不腰斩
  let goldGroups = 0;
  while (goldGroups < groupStart.length && tierOfRank(groupStart[goldGroups]) === "gold") {
    goldGroups += 1;
  }
  let silverRanges: [number, number][] = [];
  for (let g = goldGroups; g < groupStart.length; g += 1) {
    if (tierOfRank(groupStart[g]) === "silver") silverRanges.push([groupStart[g], g]);
  }
  // 纪律 ③ 底保：纯位次银档落空（n=2..5 必现）→ 取排名第 2 的那位；若该位次在并列组内，
  // 则该组整组 silver（组首 = 最靠前的第 2 名）
  if (silverRanges.length === 0) {
    const secondGroup = groupStart.findIndex((start) => start > 0);
    silverRanges = [[Math.max(1, groupStart[Math.max(0, secondGroup)]), Math.max(0, secondGroup)]];
  }
  const silverFrom = silverRanges[0][0];
  const silverTo = silverRanges[silverRanges.length - 1][1];
  groupStart.forEach((start, g) => {
    const tier = g < goldGroups ? "gold" : start >= silverFrom && g <= silverTo ? "silver" : "";
    const end = groupStart[g + 1] ?? total;
    for (let i = start; i < end; i += 1) {
      out[sorted[i].name] = tier;
    }
  });
  return out;
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

/**
 * tier 图例行：gold/silver 只有 2px 色条与光环，无文字则用户无从得知分档依据，故补此图例。
 * 有任一分档卡才渲染（纯展示，不参与过滤）。
 * ⚠️ tiers 由调用方传入已算好的表：本函数只需「是否有分档卡」一个布尔——在此重算
 *   等于每轮渲染多跑一次 O(n log n) 排序。
 */
function buildTierLegendRow(
  creators: LocalCreatorLike[],
  tiers: Record<string, "" | "gold" | "silver">,
): string {
  const hasTierCard = creators.some((cr) => tiers[cr.name]);
  if (!hasTierCard) return "";
  return (
    `<div class="cr-tier-legend" data-testid="cr-tier-legend">` +
    `<span class="cr-tier-legend-item"><span class="cr-tier-swatch cr-tier-swatch--gold"></span>${t(
      "content.tierGold",
    )}</span>` +
    `<span class="cr-tier-legend-item"><span class="cr-tier-swatch cr-tier-swatch--silver"></span>${t(
      "content.tierSilver",
    )}</span>` +
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
    )}</span><span class="cr-section-sub" id="ws-cr-count">(${creators.length}/${
      creators.length
    })</span><input type="text" id="ws-cr-search" class="cr-search-input" placeholder="${t(
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
    // 卡片声明式生成（不留空 grid 给 events 填充）；分档预计算一次 O(n log n)
    const tiers = computeCreatorTiers(creators, authorCountMap);
    // 图例复用上面已算好的 tiers，不重复跑第二轮排序
    parts.push(buildTierLegendRow(creators, tiers));
    const cardsHtml = sortedCreators
      .map((cr, i) =>
        createCrCard(cr, {
          esc: ctx.esc,
          isFaved: isFavedNow,
          authorCountMap: ctx.authorCountMap,
          avatarCache: ctx.avatarCache,
          site: ctx.site,
          staggerIdx: i,
          tier: tiers[cr.name] ?? "",
        }),
      )
      .join("");
    parts.push(`<div class="cr-creator-grid" id="cr-creator-grid">${cardsHtml}</div>`);
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
  (site.presetSearches || []).forEach((ps, idx) => {
    html +=
      `<div class="cr-edit-card" draggable="false" data-edit="preset" data-edit-idx="${idx}" data-preset-q="${esc(ps.q || ps.label)}">` +
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
