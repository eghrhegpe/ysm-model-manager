// ===== 站点视图 HTML 构建（纯函数，从 site-view.ts 拆出）=====
import { stagger } from "../../../utils/animation/stagger.ts";
import { getSiteIcon, getTagIconFromRole } from "../../../utils/icon/workshop-icons.ts";
import {
  getTagFromRole,
  loadFavs,
} from "../workshop-data.ts";
import type { WorkshopSite } from "../../../../bindings/ysm-model-manager/go/types/models.ts";
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
}

/** 创作者卡片工厂 */
export function createCrCard(cr: LocalCreatorLike, ctx: CrCardCtx): HTMLElement {
  const { esc, isFaved, authorCountMap, avatarCache, creators } = ctx;
  const isGitHub = cr.type && cr.type.includes("github");
  const repoParts = isGitHub ? cr.name.split("/") : null;
  const hasRepo = isGitHub && repoParts && repoParts.length >= 2;
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
  card.className = "gh-card cr-creator-card";
  card.tabIndex = 0;
  card.style.animationDelay = idx * 0.03 + "s";
  card.dataset.name = cr.name;
  card.dataset.tag = getTagFromRole(cr.role);
  card.title = "搜索: " + cr.name;
  if (tierRank) card.dataset.tier = tierRank;

  const fallbackChar = cr.name ? esc(cr.name.charAt(0)).toUpperCase() : "?";
  const fallbackDiv = '<div class="cr-avatar cr-avatar-fallback">' + fallbackChar + "</div>";
  const avatarHtml = hasAvatar
    ? '<img class="cr-avatar" src="' + esc(avatarCache[cr.name]) + '" data-debug-avatar="' + esc(cr.name) + '" onerror="this.outerHTML=\'' + fallbackDiv.replace(/"/g, '&quot;') + '\'">'
    : fallbackDiv;

  const localBadge = cr._fromLocal && authorCount > 0
    ? '<span class="cr-card-local-count">📁' + authorCount + "</span>"
    : cr._fromLocal
      ? '<span class="cr-card-local-count">📁</span>'
      : "";

  const platformBadges = (cr.type || "")
    .split(";")
    .filter(Boolean)
    .map((t: string) => '<span class="cr-platform-badge">' + esc(t) + "</span>")
    .join("");

  const repoBtn = hasRepo
    ? '<button class="cr-card-repo-btn gh-card-external" data-repo="' + esc(cr.name) + '">📦 浏览仓库</button>'
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
    '<span class="cr-star-btn" data-star="' + esc(cr.name) + '">' + (isFaved(cr.name) ? "⭐" : "☆") + "</span>" +
    localBadge +
    "</div>" +
    "</div>" +
    '<div class="cr-card-desc">' + esc(cr.desc) + "</div>" +
    '<div class="cr-card-footer">' +
    platformBadges +
    '<span class="cr-tag cr-tag-' + esc(getTagFromRole(cr.role)) + '">' +
    getTagIconFromRole(cr.role) + " <span>" + esc(getTagFromRole(cr.role)) + "</span>" +
    "</span>" +
    "</div>" +
    repoBtn;
  return card;
}

/**
 * 构建站点视图 HTML 字符串（纯函数，不碰 DOM）。
 * 返回 parts.join("") 的完整 HTML，由主入口负责写入 searchResults.innerHTML。
 */
export function buildSiteHtml(ctx: BuildSiteHtmlCtx): string {
  const { esc, site, creators, allSites, wsEditModeRef, authorCountMap } = ctx;
  const parts: string[] = [];
  parts.push('<div class="cr-scroll">');

  // 搜索词分区
  if (site.presetSearches && site.presetSearches.length) {
    parts.push(
      '<div class="cr-section">' +
      '<span class="cr-section-title-lg">🔍 网页搜索词</span>' +
      '<span class="cr-section-sub">(' +
      site.presetSearches.length +
      ")</span>" +
      '<span class="cr-section-fill"></span>' +
      '<button id="cr-mode-toggle" class="cr-mode-switch">' +
      '<span class="cr-mode-opt cr-mode-ext active">↗ 外链</span>' +
      '<span class="cr-mode-opt cr-mode-emb">🔍 内嵌</span>' +
      "</button>" +
      "</div>" +
      '<div class="cr-preset-area">' +
      site.presetSearches
        .map(
          (ps, i) =>
            '<button class="cr-preset-btn" style="animation-delay:' + stagger(i, 25, 300) + 'ms" data-q="' +
            esc(ps.q || ps.label) +
            '">' +
            esc(ps.label) +
            "</button>",
        )
        .join("") +
        "</div>",
    );
  }

  // 创作者列表 — 标题栏始终显示，确保「更新配置」按钮可点击
  if (!wsEditModeRef.v) {
    parts.push(
      '<div class="cr-section cr-section-wrap">' +
      '<span class="cr-section-title-lg">🎨 活跃创作者</span>' +
      '<span class="cr-section-sub" id="ws-cr-count">(' +
      creators.length +
      ")</span>" +
      '<input type="text" id="ws-cr-search" class="cr-search-input" placeholder="搜创作者名...">' +
      '<span class="cr-section-fill"></span>' +
      '<button class="cr-fetch-btn" title="从 GitHub 拉取最新创作者 + 站点 + GitHub 仓库 + 资源类型">🌐 更新配置</button>' +
      '<button class="cr-edit-btn">✏️ 编辑</button>' +
      "</div>",
    );
    if (creators.length) {
      // 收藏置顶
      const faved = loadFavs();
      creators.sort((a, b) => {
        const af = faved.includes(a.name) ? 1 : 0;
        const bf = faved.includes(b.name) ? 1 : 0;
        if (af !== bf) return bf - af;
        return (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0);
      });
      // 收集所有标签
      const tagSet = new Set<string>();
      creators.forEach((cr) => {
        const t = getTagFromRole(cr.role);
        if (t) tagSet.add(t);
      });
      const tags = [...tagSet];
      parts.push(
        '<div class="cr-tag-filter-row">' +
          '<button class="cr-tag-filter-btn active" style="animation-delay:0ms" data-tag="">🎯 全部</button>' +
          '<button class="cr-tag-filter-btn" style="animation-delay:30ms" data-tag="creator">🎮 模型创作者</button>' +
          '<button class="cr-tag-filter-btn" style="animation-delay:60ms" data-tag="official">🏠 官方IP</button>' +
          tags
            .filter((t) => t !== "creator" && t !== "official")
            .map(
              (t, i) =>
                '<button class="cr-tag-filter-btn" style="animation-delay:' + stagger(i + 3, 30, 300) + 'ms" data-tag="' +
                esc(t) +
                '">' +
                getTagIconFromRole(t) +
                " <span>" +
                esc(t) +
                "</span>" +
                "</button>",
            )
            .join("") +
          "</div>",
      );
      parts.push(
        '<div class="cr-creator-grid" id="cr-creator-grid"></div>',
      );
    } else {
      parts.push(
        '<div class="cr-empty-site">暂无创作者数据。<br>点击上方「🌐 更新配置」从 GitHub 拉取最新创作者列表。' +
        '<br><br><button class="cr-local-btn" data-local-empty>📂 浏览本地模型</button></div>',
      );
    }
  } else if (wsEditModeRef.v) {
    // 🔍 搜索词编辑（即使为空也渲染，让用户能新增）
    parts.push(
      '<div class="cr-section">' +
      '<span class="cr-section-title-lg">🔍 搜索词</span>' +
      "</div>",
    );
    (site.presetSearches || []).forEach((ps, idx) => {
      parts.push(
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
          '" class="cr-input cr-input-name" placeholder="搜索关键词">' +
          '<button data-idx="' +
          idx +
          '" class="cr-btn-icon cr-order-up" title="上移">↑</button>' +
          '<button data-idx="' +
          idx +
          '" class="cr-btn-icon cr-order-down" title="下移">↓</button>' +
          '<button data-idx="' +
          idx +
          '" class="cr-btn-icon cr-del-preset" title="删除">🗑️</button>' +
          "</div>" +
          "</div>",
      );
    });
    parts.push(
      '<div class="cr-add-area">' +
        '<button class="cr-add-preset">➕ 新增搜索词</button>' +
        "</div>",
    );
    // ✏️ 创作者编辑
    parts.push(
      '<div class="cr-section">' +
      '<span class="cr-section-title-lg">✏️ 编辑创作者</span>' +
      '<span class="cr-section-fill"></span>' +
      '<button class="cr-save-btn cr-action-btn-accent">💾 保存</button>' +
      '<button class="cr-cancel-btn">取消</button>' +
      "</div>" +
      '<div class="cr-drop-zone" id="cr-drop-zone">' +
        '<span class="cr-drop-icon">📥</span>' +
        '<span class="cr-drop-text">拖拽 JSON 文件到此处，导入创作者/站点配置</span>' +
      "</div>",
    );
    creators.forEach((cr, idx) => {
      const roleEmoji = getTagIconFromRole(cr.role);
      parts.push(
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
          '" class="cr-input cr-input-name" placeholder="名称">' +
          '<button data-idx="' +
          idx +
          '" class="cr-btn-icon cr-del" title="删除">🗑️</button>' +
          "</div>" +
          '<div class="cr-edit-card-body">' +
          '<div class="cr-edit-card-row">' +
          '<span class="cr-edit-label">描述</span>' +
          '<input data-idx="' +
          idx +
          '" data-fld="desc" value="' +
          esc(cr.desc) +
          '" class="cr-input cr-input-desc" placeholder="关键词、顿号分隔">' +
          "</div>" +
          '<div class="cr-edit-card-row">' +
          '<span class="cr-edit-label">平台</span>' +
          '<select data-idx="' +
          idx +
          '" data-fld="type" class="cr-input-type" multiple title="Ctrl+点击多选">' +
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
          ">创作者</option>" +
          '<option value="official"' +
          (cr.role === "official" ? " selected" : "") +
          ">官方</option>" +
          '<option value="vup"' +
          (cr.role === "vup" ? " selected" : "") +
          ">VUP</option>" +
          '<option value="oc"' +
          (cr.role === "oc" ? " selected" : "") +
          ">OC</option>" +
          '<option value="repo"' +
          (cr.role === "repo" ? " selected" : "") +
          ">仓库</option>" +
          "</select>" +
          "</div>" +
          "</div>" +
          "</div>",
      );
    });
    parts.push(
      '<div class="cr-add-area">' +
        '<button class="cr-add">➕ 新增</button>' +
        "</div>",
    );
  }

  parts.push("</div>");
  return parts.join("");
}
