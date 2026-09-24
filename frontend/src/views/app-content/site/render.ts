// ===== 站点视图 HTML 构建（纯函数，从 site-view.ts 拆出）=====
//
// 全部 HTML 以模板字面量拼装（与 views 层 tpl.ts / tpl-oldest.ts 同口径），
// 不再手搓 `+` 字符串接龙。esc() 仍在插值点显式调用，保持「结构在代码、内容经转义」红线。

import type { LocaleKey } from "@/core/i18n/t.ts";
import { t } from "@/core/i18n/t.ts";
import { stagger } from "@/utils/animation/stagger.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { getTagIconFromRole } from "@/utils/icon/workshop-icons.ts";
import type { WorkshopSite } from "@/utils/types-re-export.ts";
import type { LocalCreatorLike, RepoAuthorLike } from "./types.ts";
import type { BrowseModeRef } from "./workshop-browse-mode.ts";
import { getTagDisplayLabel, getTagFromRole, loadFavs } from "./workshop-data.ts";

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
  /** 收藏状态查询函数（供卡片工厂声明式渲染星标） */
  isFaved: (name: string) => boolean;
}

/** 创作者卡片工厂 */
export function createCrCard(cr: LocalCreatorLike, ctx: CrCardCtx): string {
  const { esc, isFaved, authorCountMap, avatarCache, site, staggerIdx, tier: tierRank } = ctx;
  const authorCount = authorCountMap[cr.name] || 0;
  const hasAvatar = avatarCache?.[cr.name];

  const fallbackChar = cr.name ? esc(cr.name.charAt(0)).toUpperCase() : "?";
  const fallbackDiv = `<div class="cr-avatar cr-avatar-fallback">${fallbackChar}</div>`;
  const avatarHtml = hasAvatar
    ? `<img class="cr-avatar" src="${esc(avatarCache[cr.name])}" data-debug-avatar="${esc(
        cr.name,
      )}" data-avatar-fallback="${fallbackChar}">`
    : fallbackDiv;

  const localBadge = cr._fromLocal
    ? authorCount > 0
      ? `<span class="cr-card-local-count cr-card-local-jump" data-local-creator="${esc(
          cr.name,
        )}" title="${t("content.viewLocalModels")}">${UI_ICONS.folder}${authorCount}</span>`
      : `<span class="cr-card-local-count cr-card-local-jump" data-local-creator="${esc(
          cr.name,
        )}" title="${t("content.viewLocalModels")}">${UI_ICONS.folder}</span>`
    : "";

  const platformBadges = (cr.type || "")
    .split(";")
    .filter(Boolean)
    .map((platform: string) => `<span class="cr-platform-badge">${esc(platform)}</span>`)
    .join("");

  // 🔍 搜索快捷按钮（与星标对称）：有站点搜索能力才渲染，点击联网搜索创作者，免进详情
  const searchBtn = site.searchUrl
    ? `<span class="cr-card-search" data-search-creator="${esc(
        cr.name,
      )}" title="${t("content.searchMoreModels")}">${UI_ICONS.search}</span>`
    : "";

  const tierBar = tierRank ? `<div class="cr-card-tier-bar"></div>` : "";
  const dataSpin = tierRank ? ` data-spin="${tierRank}"` : "";
  // 星标双态走 UI_ICONS 语义图标（ADR-238）：实心 .ws-icon[fill] 切换，空心描边，随主题 currentColor
  const starIcon = isFaved(cr.name) ? UI_ICONS.starFilled : UI_ICONS.star;
  const tagRole = getTagFromRole(cr.role);
  const tagIcon = getTagIconFromRole(cr.role);
  // 锐评 P0-4 / 复核 P1-3：tag 展示文案走 i18n 单源（未知 tag 原样），与筛选行同口径；
  // class 仍用原始 id（`.cr-tag-<role>` 样式语义），data-tag 同为原始 id（过滤键）。
  const tagLabel = getTagDisplayLabel(tagRole);

  // 锐评 P0-2b：desc 展示兜底从数据层上收视图层——mergeLocalAuthorsInto 不再把
  // t("community.fromLocal") 写进 desc（语言串落盘污染数据面），本地条目以
  // 空 desc 存储、渲染时按 _fromLocal 标记现取当前语言的提示。
  const descText = cr.desc || (cr._fromLocal ? t("community.fromLocal") : "");

  return (
    `<div class="gh-card cr-creator-card cr-creator-card--grid" tabindex="0" style="animation-delay:${stagger(
      staggerIdx,
    )}ms" data-name="${esc(cr.name)}" data-tag="${esc(tagRole)}"${
      tierRank ? ` data-tier="${esc(tierRank)}"` : ""
    } title="${esc(t("content.searchFor", { name: cr.name }))}">` +
    tierBar +
    `<div class="cr-card-header"><div class="cr-avatar-container"><div class="cr-avatar-ring"${dataSpin}></div>${avatarHtml}</div>` +
    `<div class="cr-card-name-row"><span class="cr-card-name">${esc(
      cr.name,
    )}</span>${localBadge}<span class="cr-star-btn" data-star="${esc(cr.name)}">${starIcon}</span>${searchBtn}</div></div>` +
    `<div class="cr-card-desc">${esc(descText)}</div>` +
    `<div class="cr-card-footer">${platformBadges}<span class="cr-tag cr-tag-${esc(
      tagRole,
    )}">${tagIcon} <span>${esc(tagLabel)}</span></span></div></div>`
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
    modeOpt("cr-mode-emb", "embed", UI_ICONS.search, "content.modeEmbed") +
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

/** 收藏置顶排序（就地修改 ctx.creators 共享数组，副作用原样保留）。 */
function sortCreatorsFavedFirst(
  creators: LocalCreatorLike[],
  authorCountMap: Record<string, number>,
): void {
  const faved = loadFavs();
  creators.sort((a, b) => {
    const af = faved.includes(a.name) ? 1 : 0;
    const bf = faved.includes(b.name) ? 1 : 0;
    if (af !== bf) return bf - af;
    return (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0);
  });
}

/**
 * 创作者排名分档（纯函数）：产量降序百分位——前 10% gold、前 25% silver，
 * 单次 O(n log n)。调用方（buildSiteBrowseSection）预计算一次后按 name 取值，
 * 替代原「每张卡片内对全量列表重新排序」的 O(n² log n) 写法。
 * 单作者 → pct=0 → gold（与旧实现语义一致）。
 */
export function computeCreatorTiers(
  creators: LocalCreatorLike[],
  authorCountMap: Record<string, number>,
): Record<string, "" | "gold" | "silver"> {
  const sorted = [...creators].sort(
    (a, b) => (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0),
  );
  const total = sorted.length;
  const out: Record<string, "" | "gold" | "silver"> = {};
  sorted.forEach((cr, idx) => {
    const pct = total > 1 ? idx / (total - 1) : 0;
    out[cr.name] = pct < 0.1 ? "gold" : pct < 0.25 ? "silver" : "";
  });
  return out;
}

/** 分类标签过滤按钮行：固定 全部/creator/official + 动态角色标签。 */
function buildSiteTagFilterRow(ctx: BuildSiteHtmlCtx): string {
  const { esc, creators, activeTag } = ctx;
  const tagSet = new Set<string>();
  creators.forEach((cr) => {
    const tag = getTagFromRole(cr.role);
    if (tag) tagSet.add(tag);
  });
  const tags = [...tagSet];
  const filterBtn = (tag: string, delay: number, inner: string) =>
    `<button class="cr-tag-filter-btn${
      activeTag === tag ? " active" : ""
    }" style="animation-delay:${delay}ms" data-tag="${esc(tag)}">${inner}</button>`;
  return (
    `<div class="cr-tag-filter-row">` +
    filterBtn("", 0, t("content.filterAll")) +
    filterBtn("creator", 30, t("content.filterCreator")) +
    filterBtn("official", 60, t("content.filterOfficial")) +
    tags
      .filter((tag) => tag !== "creator" && tag !== "official")
      .map((tag, i) =>
        filterBtn(
          tag,
          stagger(i + 3, 30, 300),
          // 锐评 P0-4 / 复核 P1-3：展示文案走 getTagDisplayLabel 单源（已知身份 → i18n label；
          // 未知 tag 原样显示，不冒充 YSM 创作者）；data-tag 仍用原始 id（过滤键 = 数据语义）。
          `${getTagIconFromRole(tag)} <span>${esc(getTagDisplayLabel(tag))}</span>`,
        ),
      )
      .join("") +
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
    )}</span><span class="cr-section-sub" id="ws-cr-count">(${
      creators.length
    })</span><input type="text" id="ws-cr-search" class="cr-search-input" placeholder="${t(
      "content.searchCreatorPlaceholder",
    )}" value="${esc(
      ctx.searchKw,
    )}"><span class="cr-section-fill"></span><button class="cr-fetch-btn" title="${t(
      "content.fetchConfigTitle",
    )}">${UI_ICONS.download} ${t("content.fetchConfig")}</button>${
      ctx.viewerMode
        ? ""
        : `<button class="cr-edit-btn">${UI_ICONS.edit} ${t("content.edit")}</button>`
    }</div>`,
  );
  if (creators.length) {
    // 收藏置顶
    sortCreatorsFavedFirst(creators, authorCountMap);
    parts.push(buildSiteTagFilterRow(ctx));
    // 声明式生成创作者卡片（不再留空 grid 给 events 填充）
    // 分档预计算一次（O(n log n)）；stagger 延迟取展示位次——收藏置顶卡按视觉顺序入场
    //（旧实现按产量名次计延迟，置顶卡入场乱序），且经 stagger() 带 300ms 封顶
    const tiers = computeCreatorTiers(creators, authorCountMap);
    const cardsHtml = creators
      .map((cr, i) =>
        createCrCard(cr, {
          esc: ctx.esc,
          isFaved: ctx.isFaved,
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
      `<div class="cr-edit-card" draggable="false" data-edit="preset" data-edit-idx="${idx}">` +
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

/** 创作者编辑区：保存/取消/dropzone + 各创作者编辑卡 + 新增区。 */
function buildSiteCreatorEditCards(ctx: BuildSiteHtmlCtx): string {
  const { esc, creators, allSites } = ctx;
  let html =
    `<div class="cr-section"><span class="cr-section-title-lg">${UI_ICONS.edit} ${t(
      "content.editCreators",
    )}</span><span class="cr-section-fill"></span>` +
    `<button class="cr-save-btn cr-action-btn-accent">${t("content.save")}</button>` +
    `<button class="cr-cancel-btn">${t("common.cancel")}</button></div>` +
    `<div class="cr-drop-zone" id="cr-drop-zone"><span class="cr-drop-icon">${UI_ICONS.import}</span>` +
    `<span class="cr-drop-text">${t("content.dropZoneHint")}</span></div>`;
  creators.forEach((cr, idx) => {
    const roleEmoji = getTagIconFromRole(cr.role);
    const roleOption = (value: string, label: string) =>
      `<option value="${value}"${cr.role === value ? " selected" : ""}>${label}</option>`;
    html +=
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
      `<select data-idx="${idx}" data-fld="type" class="cr-input-type" multiple title="${t(
        "content.multiSelectHint",
      )}">${(allSites || [])
        .map(
          (s) =>
            `<option value="${esc(s.id)}"${
              cr.type?.split(";").includes(s.id) ? " selected" : ""
            }>${esc(s.label)}</option>`,
        )
        .join("")}</select>` +
      `<select data-idx="${idx}" data-fld="role" class="cr-input-role">${roleOption(
        "creator",
        t("content.roleCreator"),
      )}${roleOption("official", t("content.roleOfficial"))}${roleOption("vup", "VUP")}${roleOption(
        "oc",
        "OC",
      )}${roleOption("repo", t("content.roleRepo"))}</select></div></div></div>`;
  });
  html += `<div class="cr-add-area"><button class="cr-add">${t("content.addCreator")}</button></div>`;
  return html;
}

/**
 * 构建站点视图 HTML 字符串（纯函数，不碰 DOM）。
 * 返回 parts.join("") 的完整 HTML，由主入口负责写入 searchResults.innerHTML。
 * 按分区委托给 buildSiteSearchSection / buildSiteBrowseSection / buildSiteEditSection。
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
