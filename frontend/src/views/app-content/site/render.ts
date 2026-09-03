// ===== 站点视图 HTML 构建（纯函数，从 site-view.ts 拆出）=====
import { stagger } from "../../../utils/animation/stagger.ts";
import { getTagIconFromRole } from "../../../utils/icon/workshop-icons.ts";
import {
  getTagFromRole,
  loadFavs,
} from "../workshop-data.ts";
import { t } from "../../../core/i18n/t.ts";
import type { BrowseModeRef } from "../workshop-browse-mode.ts";
import type { WorkshopSite } from "../../../utils/types-re-export.ts";
import type { LocalCreatorLike, RepoAuthorLike } from "../site-view.ts";

/** 创作者卡片工厂上下文 */
export interface CrCardCtx {
  esc: (s: unknown) => string;
  isFaved: (name: string) => boolean;
  authorCountMap: Record<string, number>;
  avatarCache?: Record<string, string> | null;
  creators: LocalCreatorLike[];
  allCreators: LocalCreatorLike[];
  site: WorkshopSite;
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
}

/** 创作者卡片工厂 */
export function createCrCard(cr: LocalCreatorLike, ctx: CrCardCtx): HTMLElement {
  const { esc, isFaved, authorCountMap, avatarCache, creators, site } = ctx;
  const authorCount = authorCountMap[cr.name] || 0;
  const sorted = [...creators].sort(
    (a, b) => (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0),
  );
  const idx = sorted.indexOf(cr);
  const pct = sorted.length > 1 ? idx / (sorted.length - 1) : 0;
  const tierRank =
    pct < 0.1 ? "gold" : pct < 0.25 ? "silver" : "";
  const hasAvatar = avatarCache && avatarCache[cr.name];

  const card = document.createElement("div");
  card.className = "gh-card cr-creator-card cr-creator-card--grid";
  card.tabIndex = 0;
  card.style.animationDelay = idx * 0.03 + "s";
  card.dataset.name = cr.name;
  card.dataset.tag = getTagFromRole(cr.role);
  card.title = t("content.searchFor", { name: cr.name });
  if (tierRank) card.dataset.tier = tierRank;

  const fallbackChar = cr.name ? esc(cr.name.charAt(0)).toUpperCase() : "?";
  const fallbackDiv = '<div class="cr-avatar cr-avatar-fallback">' + fallbackChar + "</div>";
  const avatarHtml = hasAvatar
    ? '<img class="cr-avatar" src="' + esc(avatarCache[cr.name]) + '" data-debug-avatar="' + esc(cr.name) + '" onerror="this.outerHTML=\'' + fallbackDiv.replace(/"/g, '&quot;') + '\'">'
    : fallbackDiv;

  const localBadge = cr._fromLocal && authorCount > 0
    ? '<span class="cr-card-local-count cr-card-local-jump" data-local-creator="' +
      esc(cr.name) +
      '" title="' +
      t("content.viewLocalModels") +
      '">📁' +
      authorCount +
      "</span>"
    : cr._fromLocal
      ? '<span class="cr-card-local-count cr-card-local-jump" data-local-creator="' +
        esc(cr.name) +
        '" title="' +
        t("content.viewLocalModels") +
        '">📁</span>'
      : "";

  const platformBadges = (cr.type || "")
    .split(";")
    .filter(Boolean)
    .map((platform: string) => '<span class="cr-platform-badge">' + esc(platform) + "</span>")
    .join("");

  // 🔍 搜索快捷按钮（与星标对称）：有站点搜索能力才渲染，点击联网搜索创作者，免进详情
  const searchBtn = site.searchUrl
    ? '<span class="cr-card-search" data-search-creator="' +
      esc(cr.name) +
      '" title="' +
      t("content.searchMoreModels") +
      '">🔍</span>'
    : "";

  card.innerHTML =
    (tierRank ? '<div class="cr-card-tier-bar"></div>' : "") +
    '<div class="cr-card-header">' +
    '<div class="cr-avatar-container">' +
    '<div class="cr-avatar-ring"' + (tierRank ? ' data-spin="' + tierRank + '"' : "") + "></div>" +
    avatarHtml +
    "</div>" +
    '<div class="cr-card-name-row">' +
    '<span class="cr-card-name">' + esc(cr.name) + "</span>" +
    localBadge +
    '<span class="cr-star-btn" data-star="' + esc(cr.name) + '">' + (isFaved(cr.name) ? "⭐" : "☆") + "</span>" +
    searchBtn +
    "</div>" +
    "</div>" +
    '<div class="cr-card-desc">' + esc(cr.desc) + "</div>" +
    '<div class="cr-card-footer">' +
    platformBadges +
    '<span class="cr-tag cr-tag-' + esc(getTagFromRole(cr.role)) + '">' +
    getTagIconFromRole(cr.role) + " <span>" + esc(getTagFromRole(cr.role)) + "</span>" +
    "</span>" +
    "</div>";
  return card;
}

/** 搜索词分区：模式切换按钮 + 预设搜索按钮。无 preset 时返回空串（由主函数按条件跳过）。 */
function buildSiteSearchSection(ctx: BuildSiteHtmlCtx): string {
  const { esc, site, browseMode } = ctx;
  return (
    '<div class="cr-section">' +
    '<span class="cr-section-title-lg">' + t("content.webSearchTerms") + "</span>" +
    '<span class="cr-section-sub">(' +
    site.presetSearches!.length +
    ")</span>" +
    '<span class="cr-section-fill"></span>' +
    '<button id="cr-mode-toggle" class="cr-mode-switch">' +
    '<span class="cr-mode-opt cr-mode-ext' + (browseMode.v === 'external' ? ' active' : '') + '" data-mode="external" title="' + t("content.modeExternal") + '">' + t("content.modeExternal") + "</span>" +
    '<span class="cr-mode-opt cr-mode-emb' + (browseMode.v === 'embed' ? ' active' : '') + '" data-mode="embed" title="' + t("content.modeEmbed") + '">' + t("content.modeEmbed") + "</span>" +
    '<span class="cr-mode-opt cr-mode-win' + (browseMode.v === 'window' ? ' active' : '') + '" data-mode="window" title="' + t("content.modeWindow") + '">' + t("content.modeWindow") + "</span>" +
    "</button>" +
    "</div>" +
    '<div class="cr-preset-area">' +
    site.presetSearches!
      .map(
        (ps, i) =>
          '<button class="cr-preset-btn" style="animation-delay:' + stagger(i, 25, 300) + 'ms" data-q="' +
          esc(ps.q || ps.label) +
          '">' +
          esc(ps.label) +
          "</button>",
      )
      .join("") +
    "</div>"
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

/** 分类标签过滤按钮行：固定 全部/creator/official + 动态角色标签。 */
function buildSiteTagFilterRow(ctx: BuildSiteHtmlCtx): string {
  const { esc, creators, activeTag } = ctx;
  const tagSet = new Set<string>();
  creators.forEach((cr) => {
    const tag = getTagFromRole(cr.role);
    if (tag) tagSet.add(tag);
  });
  const tags = [...tagSet];
  return (
    '<div class="cr-tag-filter-row">' +
      '<button class="cr-tag-filter-btn' + (activeTag ? '' : ' active') + '" style="animation-delay:0ms" data-tag="">' + t("content.filterAll") + "</button>" +
      '<button class="cr-tag-filter-btn' + (activeTag === 'creator' ? ' active' : '') + '" style="animation-delay:30ms" data-tag="creator">' + t("content.filterCreator") + "</button>" +
      '<button class="cr-tag-filter-btn' + (activeTag === 'official' ? ' active' : '') + '" style="animation-delay:60ms" data-tag="official">' + t("content.filterOfficial") + "</button>" +
      tags
        .filter((tag) => tag !== "creator" && tag !== "official")
        .map(
          (tag, i) =>
            '<button class="cr-tag-filter-btn' + (activeTag === tag ? ' active' : '') + '" style="animation-delay:' + stagger(i + 3, 30, 300) + 'ms" data-tag="' +
            esc(tag) +
            '">' +
            getTagIconFromRole(tag) +
            " <span>" +
            esc(tag) +
            "</span>" +
            "</button>",
        )
        .join("") +
      "</div>"
  );
}

/** 创作者浏览区：标题栏 + 收藏置顶 + 标签行 + grid / 空态。 */
function buildSiteBrowseSection(ctx: BuildSiteHtmlCtx): string {
  const { esc, creators, authorCountMap } = ctx;
  const parts: string[] = [];
  // 标题栏始终显示，确保「更新配置」按钮可点击
  parts.push(
    '<div class="cr-section cr-section-wrap">' +
    '<span class="cr-section-title-lg">' + t("content.activeCreators") + "</span>" +
    '<span class="cr-section-sub" id="ws-cr-count">(' +
    creators.length +
    ")</span>" +
    '<input type="text" id="ws-cr-search" class="cr-search-input" placeholder="' + t("content.searchCreatorPlaceholder") + '" value="' + esc(ctx.searchKw) + '">' +
    '<span class="cr-section-fill"></span>' +
    '<button class="cr-fetch-btn" title="' + t("content.fetchConfigTitle") + '">' + t("content.fetchConfig") + "</button>" +
    (ctx.viewerMode ? "" : '<button class="cr-edit-btn">' + t("content.edit") + "</button>") +
    "</div>",
  );
  if (creators.length) {
    // 收藏置顶
    sortCreatorsFavedFirst(creators, authorCountMap);
    parts.push(buildSiteTagFilterRow(ctx));
    parts.push(
      '<div class="cr-creator-grid" id="cr-creator-grid"></div>',
    );
  } else {
    parts.push(
      '<div class="cr-empty-site">' + t("content.emptyCreators") +
      '<br><br><button class="cr-local-btn" data-local-empty>' + t("content.browseLocalModels") + "</button></div>",
    );
  }
  return parts.join("");
}

/** 搜索词编辑卡列表 + 新增区（空 preset 也渲染，让用户能新增）。 */
function buildSitePresetEditCards(ctx: BuildSiteHtmlCtx): string {
  const { esc, site } = ctx;
  let html =
    '<div class="cr-section">' +
    '<span class="cr-section-title-lg">' + t("content.searchTerms") + "</span>" +
    "</div>";
  (site.presetSearches || []).forEach((ps, idx) => {
    html +=
      '<div class="cr-edit-card" draggable="false" data-edit="preset" data-edit-idx="' +
        idx +
        '">' +
        '<div class="cr-edit-card-head">' +
        '<span class="cr-drag-handle">⠿</span>' +
        '<span class="cr-preset-icon">🔍</span>' +
        '<input data-idx="' +
        idx +
        '" data-fld="label" value="' +
        esc(ps.label) +
        '" class="cr-input cr-input-name" placeholder="' + t("content.searchKeywordPlaceholder") + '">' +
        '<button data-idx="' +
        idx +
        '" class="cr-btn-icon cr-order-up" title="' + t("content.moveUp") + '">↑</button>' +
        '<button data-idx="' +
        idx +
        '" class="cr-btn-icon cr-order-down" title="' + t("content.moveDown") + '">↓</button>' +
        '<button data-idx="' +
        idx +
        '" class="cr-btn-icon cr-del-preset" title="' + t("content.delete") + '">🗑️</button>' +
        "</div>" +
        "</div>";
  });
  html +=
    '<div class="cr-add-area">' +
      '<button class="cr-add-preset">' + t("content.addSearchTerm") + "</button>" +
      "</div>";
  return html;
}

/** 创作者编辑区：保存/取消/dropzone + 各创作者编辑卡 + 新增区。 */
function buildSiteCreatorEditCards(ctx: BuildSiteHtmlCtx): string {
  const { esc, creators, allSites } = ctx;
  let html =
    '<div class="cr-section">' +
    '<span class="cr-section-title-lg">' + t("content.editCreators") + "</span>" +
    '<span class="cr-section-fill"></span>' +
    '<button class="cr-save-btn cr-action-btn-accent">' + t("content.save") + "</button>" +
    '<button class="cr-cancel-btn">' + t("common.cancel") + "</button>" +
    "</div>" +
    '<div class="cr-drop-zone" id="cr-drop-zone">' +
      '<span class="cr-drop-icon">📥</span>' +
      '<span class="cr-drop-text">' + t("content.dropZoneHint") + "</span>" +
    "</div>";
  creators.forEach((cr, idx) => {
    const roleEmoji = getTagIconFromRole(cr.role);
    html +=
      '<div class="cr-edit-card" draggable="false" data-edit-idx="' +
        idx +
        '">' +
        '<div class="cr-edit-card-head">' +
        '<span class="cr-drag-handle">⠿</span>' +
        '<span class="cr-edit-card-avatar">' +
        roleEmoji +
        "</span>" +
        '<input data-idx="' +
        idx +
        '" data-fld="name" value="' +
        esc(cr.name) +
        '" class="cr-input cr-input-name" placeholder="' + t("content.namePlaceholder") + '">' +
        '<button data-idx="' +
        idx +
        '" class="cr-btn-icon cr-del" title="' + t("content.delete") + '">🗑️</button>' +
        "</div>" +
        '<div class="cr-edit-card-body">' +
        '<div class="cr-edit-card-row">' +
        '<span class="cr-edit-label">' + t("content.labelDesc") + "</span>" +
        '<input data-idx="' +
        idx +
        '" data-fld="desc" value="' +
        esc(cr.desc) +
        '" class="cr-input cr-input-desc" placeholder="' + t("content.descPlaceholder") + '">' +
        "</div>" +
        '<div class="cr-edit-card-row">' +
        '<span class="cr-edit-label">' + t("content.labelPlatform") + "</span>" +
        '<select data-idx="' +
        idx +
        '" data-fld="type" class="cr-input-type" multiple title="' + t("content.multiSelectHint") + '">' +
        (allSites || [])
          .map(
            (s) =>
              '<option value="' +
              esc(s.id) +
              '"' +
              (cr.type && cr.type.split(";").includes(s.id)
                ? " selected"
                : "") +
              ">" +
              esc(s.label) +
              "</option>",
          )
          .join("") +
        '</select><select data-idx="' +
        idx +
        '" data-fld="role" class="cr-input-role">' +
        '<option value="creator"' +
        (cr.role === "creator" ? " selected" : "") +
        ">" + t("content.roleCreator") + "</option>" +
        '<option value="official"' +
        (cr.role === "official" ? " selected" : "") +
        ">" + t("content.roleOfficial") + "</option>" +
        '<option value="vup"' +
        (cr.role === "vup" ? " selected" : "") +
        ">VUP</option>" +
        '<option value="oc"' +
        (cr.role === "oc" ? " selected" : "") +
        ">OC</option>" +
        '<option value="repo"' +
        (cr.role === "repo" ? " selected" : "") +
        ">" + t("content.roleRepo") + "</option>" +
        "</select>" +
        "</div>" +
        "</div>" +
        "</div>";
  });
  html +=
    '<div class="cr-add-area">' +
      '<button class="cr-add">' + t("content.addCreator") + "</button>" +
      "</div>";
  return html;
}

/**
 * 构建站点视图 HTML 字符串（纯函数，不碰 DOM）。
 * 返回 parts.join("") 的完整 HTML，由主入口负责写入 searchResults.innerHTML。
 * 按分区委托给 buildSiteSearchSection / buildSiteBrowseSection / buildSiteEditSection。
 */
export function buildSiteHtml(ctx: BuildSiteHtmlCtx): string {
  const parts: string[] = [];
  parts.push('<div class="cr-scroll">');

  // 搜索词分区
  if (ctx.site.presetSearches && ctx.site.presetSearches.length) {
    parts.push(buildSiteSearchSection(ctx));
  }

  // 创作者分区：浏览态（标题栏始终显示）或编辑态
  if (!ctx.wsEditModeRef.v) {
    parts.push(buildSiteBrowseSection(ctx));
  } else {
    parts.push(
      buildSitePresetEditCards(ctx) + buildSiteCreatorEditCards(ctx),
    );
  }

  parts.push("</div>");
  return parts.join("");
}
