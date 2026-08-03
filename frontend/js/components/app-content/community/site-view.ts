// ===== 创意工坊站点视图（为 _initWorkshop 减负） =====
import { friendlyError } from "../../../utils/errors.ts";
import { bus } from "../../../bus.ts";
import { dbg } from "../../../utils/debug.ts";
import { showProgress, tryFetchModels } from "../../../features/community/data.ts";
import { stagger } from "../../../utils/stagger.ts";
import { getSiteIcon, getTagIconFromRole } from "./workshop-icons.ts";
import {
  getCreatorIdentity,
  getTagFromRole,
  parseDescTags,
  loadFavs,
  isFaved,
  toggleFav,
  type CreatorIdentityInput,
} from "./workshop-data.ts";
import type { WorkshopSite, WorkshopCreator, WorkshopPresetSearch } from "../../../../bindings/ysm-model-manager/go/types/models.ts";

import { getApp } from "../../../wails/app.ts";

/** 创作者卡片工厂上下文 */
interface CrCardCtx {
  esc: (s: unknown) => string;
  isFaved: (name: string) => boolean;
  authorCountMap: Record<string, number>;
  avatarCache?: Record<string, string> | null;
  creators: LocalCreatorLike[];
  allCreators: LocalCreatorLike[];
  site: WorkshopSite;
  searchResults: HTMLElement;
  bus: typeof bus;
}

/** 作者计数条目（绑定 ListModelAuthors 元素：string 或 {Name, Count}） */
export type RepoAuthorLike = string | { Name?: string; Count?: number };

/** 站点视图渲染上下文（index.ts _initWorkshop 传入） */
export interface RenderSiteViewCtx {
  esc: (s: unknown) => string;
  searchResults: HTMLElement;
  creatorView: HTMLElement;
  allSites: WorkshopSite[];
  allCreators: LocalCreatorLike[];
  repoAuthors: RepoAuthorLike[];
  wsEditModeRef: { v: boolean };
  showRepoModels: (repo: string, models: unknown[], source: string) => Promise<void>;
  fillSearch: (tpl: string, q: string) => string;
  repoModelCache: Map<string, { models: unknown[]; source: string }>;
  openUrl: (url: string) => void;
  backToSite: () => void;
  avatarCache: Record<string, string>;
}

/** 本地创作者（绑定 + 运行时附加字段） */
export interface LocalCreatorLike extends WorkshopCreator {
  _fromLocal?: boolean;
  _fromCommunity?: boolean;
  [key: string]: unknown;
}

/** @type {Function|null} 当前注册的 storage 监听器（模块私有，防泄漏） */
let _storageSyncFn: ((e: StorageEvent) => void) | null = null;

// ===== 创作者卡片工厂 =====
function createCrCard(cr: LocalCreatorLike, ctx: CrCardCtx): HTMLElement {
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

export function renderSiteView(site: WorkshopSite, ctx: RenderSiteViewCtx): void {
  const {
    esc,
    searchResults,
    creatorView,
    allCreators,
    allSites,
    repoAuthors,
    wsEditModeRef,
    showRepoModels,
    fillSearch,
    repoModelCache,
    openUrl,
    backToSite,
    avatarCache,
  } = ctx;

  searchResults.innerHTML = "";
  creatorView.style.display = "none";

  const creators = allCreators.filter(
    (cr) => cr.type && cr.type.split(";").includes(site.id),
  );

  // 作者模型计数查找表
  const authorCountMap: Record<string, number> = {};
  if (repoAuthors) {
    repoAuthors.forEach((a) => {
      const name = typeof a === "string" ? a : a.Name;
      const count = typeof a === "object" && a ? a.Count || 0 : 0;
      if (name) authorCountMap[name] = count;
    });
  }

  // 按仓库模型数降序排列（高产创作者优先）
  creators.sort(
    (a, b) => (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0),
  );

  // 构建 HTML
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

  const html = parts.join("");
  searchResults.innerHTML = html;

  // 无创作者时「浏览本地模型」按钮
  const emptyLocalBtn = searchResults.querySelector("[data-local-empty]");
  if (emptyLocalBtn) {
    emptyLocalBtn.addEventListener("click", () => {
      bus.emit("nav:change", { page: "repository" });
    });
  }

  // 用工厂函数填充创作者网格（替代内联字符串）
  const grid = searchResults.querySelector("#cr-creator-grid");
  if (grid && !wsEditModeRef.v && creators.length) {
    const cardCtx: CrCardCtx = {
      esc,
      isFaved,
      authorCountMap,
      avatarCache,
      creators,
      allCreators,
      site,
      searchResults,
      bus,
    };
    creators.forEach((cr) => {
      const card = createCrCard(cr, cardCtx);
      grid.appendChild(card);
    });
  }

  // 预设搜索按钮
  searchResults.querySelectorAll(".cr-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = (btn as HTMLElement).dataset.q || "";
      if (site.searchUrl && openUrl) {
        openUrl(fillSearch(site.searchUrl, q));
      } else if (openUrl) {
        // 没有 searchUrl（如分类索引站），直接打开站点首页
        openUrl(site.url);
      }
    });
  });

  // ⭐ 收藏点击（阻止冒泡，不触发详情浮层）
  searchResults.querySelectorAll(".cr-star-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = (btn as HTMLElement).dataset.star || "";
      const now = toggleFav(name);
      btn.textContent = now ? "⭐" : "☆";
      const card = btn.closest(".gh-card");
      if (card) {
        // 重新排序：收藏→移到首部，取消→移到尾部（不 remove 以免丢失事件）
        const grid2 = card.closest(".cr-creator-grid");
        if (now) {
          grid2?.insertBefore(card, grid2.firstChild);
        } else {
          grid2?.appendChild(card);
        }
      }
      bus.emit("toast:show", {
        msg: now ? "⭐ 已收藏 " + name : "取消收藏 " + name,
        duration: 1500,
        type: "success",
      });
    });
  });

  // 头像调试点击 → 控制台输出调试信息
  searchResults.querySelectorAll("[data-debug-avatar]").forEach((img) => {
    img.addEventListener("click", async (e) => {
      e.stopPropagation();
      const name = (img as HTMLElement).dataset.debugAvatar;
      if (!name) return;
      try {
        const { DebugExtractCreatorAvatar } =
          await getApp();
        const info = await DebugExtractCreatorAvatar(name);
        dbg("avatar-debug", name, info);
      } catch (err) {
        dbg("avatar-debug", "调用失败", err);
      }
    });
  });

  // 创作者卡片点击 → 弹出详情浮层
  searchResults.querySelectorAll(".gh-card[data-name]").forEach((card) => {
    card.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(".gh-card-external[data-repo]") ||
        target.closest(".cr-star-btn")
      )
        return;
      const name = (card as HTMLElement).dataset.name;
      const cr = creators.find((c) => c.name === name);
      if (!cr) return;

      const overlay = document.createElement("div");
      overlay.className = "cr-detail-overlay";
      overlay.onclick = (ev) => {
        if (ev.target === overlay) overlay.remove();
      };

      const identity = getCreatorIdentity(cr as CreatorIdentityInput);
      const descTags = parseDescTags(cr.desc);
      const isFav = isFaved(cr.name);
      const localCount = authorCountMap[cr.name] || 0;
      const detailFallbackChar = esc(cr.name.charAt(0)).toUpperCase();
      const detailFallbackDiv = '<div class="cr-avatar cr-detail-avatar-text">' + detailFallbackChar + "</div>";
      overlay.innerHTML =
        '<div class="cr-detail-box">' +
        '<div class="cr-detail-header">' +
        '<div class="cr-avatar-container cr-detail-avatar-container">' +
        (avatarCache && avatarCache[cr.name]
          ? '<img class="cr-avatar cr-detail-avatar-img" src="' +
            esc(avatarCache[cr.name]) +
            '" data-debug-avatar="' +
            esc(cr.name) +
            '" onerror="this.outerHTML=\'' + detailFallbackDiv.replace(/"/g, '&quot;') + '\'">'
          : detailFallbackDiv) +
        "</div>" +
        '<div class="cr-detail-fill">' +
        '<div class="cr-detail-name-row">' +
        '<span class="cr-detail-name">' +
        esc(cr.name) +
        "</span>" +
        (cr.role
          ? '<span class="cr-tag cr-tag-' +
            esc(getTagFromRole(cr.role)) +
            '">' +
            getTagIconFromRole(cr.role) +
            " <span>" +
            esc(getTagFromRole(cr.role)) +
            "</span>" +
            "</span>"
          : "") +
        "</div>" +
        (cr.type
          ? '<div class="cr-detail-platforms">' +
            cr.type
              .split(";")
              .filter(Boolean)
              .map(
                (t: string) =>
                  '<span class="cr-platform-badge">' +
                  getSiteIcon(t) +
                  " <span>" +
                  esc(t) +
                  "</span>",
              )
              .join("") +
            "</div>"
          : "") +
        '<div class="cr-detail-identity">' +
        identity.icon +
        '<span>' + esc(identity.label) + "</span>" +
        "</div>" +
        "</div>" +
        '<span class="cr-star-btn" data-star="' +
        esc(cr.name) +
        '">' +
        (isFav ? "⭐" : "☆") +
        "</span>" +
        "</div>" +
        '<div class="cr-detail-desc">' +
        descTags
          .map(
            (t) =>
              '<span class="cr-desc-tag">#' +
              esc(t) +
              "</span>",
          )
          .join("") +
        (!descTags.length ? esc(cr.desc) : "") +
        "</div>" +
        '<div class="cr-detail-row cr-local-card">' +
        '<span class="cr-local-icon">📂</span>' +
        '<span class="cr-local-text">已下载 ' + localCount + ' 个模型</span>' +
        '<button class="cr-local-btn" data-local>查看 →</button>' +
        "</div>" +
        '<div class="cr-detail-actions">' +
        '<button class="secondary" data-search="' +
        esc(cr.name) +
        '">🔍 搜索更多模型</button>' +
        '<button class="secondary" data-close>关闭</button>' +
        "</div>" +
        "</div>";

      (searchResults.getRootNode() as Node).appendChild(overlay);

      // ⭐ 浮层内的收藏
      overlay.querySelector("[data-star]")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const now = toggleFav(cr.name);
        (ev.target as HTMLElement).textContent = now ? "⭐" : "☆";
        // 同时更新卡片
        const cardStar = searchResults.querySelector(
          '.cr-star-btn[data-star="' + esc(cr.name) + '"]',
        );
        if (cardStar) cardStar.textContent = now ? "⭐" : "☆";
        bus.emit("toast:show", {
          msg: now ? "⭐ 已收藏" : "取消收藏",
          duration: 1500,
          type: "success",
        });
      });

      overlay
        .querySelector("[data-close]")
        ?.addEventListener("click", () => overlay.remove());

      const searchBtn = overlay.querySelector("[data-search]") as HTMLElement | null;
      if (searchBtn) {
        searchBtn.addEventListener("click", () => {
          overlay.remove();
          if (site.searchUrl && openUrl) {
            openUrl(fillSearch(site.searchUrl, searchBtn.dataset.search || ""));
          }
        });
      }

      // 📦 查看本地模型
      const localBtn = overlay.querySelector("[data-local]");
      if (localBtn) {
        localBtn.addEventListener("click", () => {
          overlay.remove();
          bus.emit("repo:search-creator", cr.name);
        });
      }
    });
  });

  // 键盘导航 ←↑↓→
  const crGrid = searchResults.querySelector(".cr-creator-grid");
  if (crGrid) {
    crGrid.addEventListener("keydown", ((e: KeyboardEvent) => {
      const cards = [...crGrid.querySelectorAll(".gh-card[tabindex]")];
      const cur = document.activeElement as HTMLElement | null;
      const idx = cards.indexOf(cur as Element);
      if (idx < 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const next = (cards[idx + 1] || cards[0]) as HTMLElement;
        next.focus();
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = (cards[idx - 1] || cards[cards.length - 1]) as HTMLElement;
        prev.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        cur?.click();
      }
    }) as EventListener);
  }

  // storage 事件：多标签页收藏同步（模块私有变量，不挂 window）
  if (_storageSyncFn) {
    window.removeEventListener("storage", _storageSyncFn);
  }
  _storageSyncFn = (e) => {
    if (e.key === "ysm-fav-creators") {
      const favs = loadFavs();
      searchResults.querySelectorAll(".cr-star-btn").forEach((btn) => {
        btn.textContent = favs.includes((btn as HTMLElement).dataset.star || "") ? "⭐" : "☆";
      });
    }
  };
  window.addEventListener("storage", _storageSyncFn);

  // 📦 浏览 GitHub 仓库模型
  const refreshView = (): void => renderSiteView(site, ctx);

  searchResults
    .querySelectorAll(".gh-card-external[data-repo]")
    .forEach((btn) => {
      btn.addEventListener("click", async () => {
        const repo = (btn as HTMLElement).dataset.repo || "";
        btn.textContent = "⏳";

        let mirror = "";
        try {
          const { LoadAppConfig } =
            await getApp();
          const cfg = await LoadAppConfig();
          mirror = cfg.mirror || "";
        } catch (_) {}

        showProgress(searchResults, 10, "⏳ 准备中…");
        try {
          if (repoModelCache.has(repo)) {
            const cached = repoModelCache.get(repo);
            if (cached) {
              showProgress(searchResults, 100, "✅ 加载完成（缓存）");
              await new Promise((r) => setTimeout(r, 100));
              await showRepoModels(repo, cached.models, cached.source);
              btn.textContent = "📦 浏览";
              return;
            }
          }
          const { models, source } = await tryFetchModels(
            repo,
            (mirror || "") as "" | "jsdelivr" | "githubapi",
            (pct, label) => showProgress(searchResults, pct, label),
          );
          repoModelCache.set(repo, { models, source });
          showProgress(searchResults, 100, "✅ 加载完成");
          await new Promise((r) => setTimeout(r, 200));
          await showRepoModels(repo, models, source);
        } catch (e) {
          const err = e as Error;
          const isTimeout = err?.name === "AbortError";
          const isNoIndex = err?.message === "NoIndex";
          const isOffline = err?.message === "NetworkOffline";
          const isRateLimited = err?.message === "RateLimited";
          const isAllFailed = err?.message === "AllFailed";
          let errMsg: string, btnLabel: string;
          if (isNoIndex) {
            errMsg =
              "❌ 无 index.json<br>" +
              "此仓库尚未建立创意工坊索引，请你使用浏览器下载。<br>" +
              '<span class="cr-error-hint">（这个仓库需要有 index.json 文件，才能调用 API 下载文件）</span>';
            btnLabel = "❌ 无索引";
          } else if (isOffline) {
            errMsg = "🌐 无网络连接，请检查网络后重试";
            btnLabel = "🌐 离线";
          } else if (isTimeout) {
            errMsg = "⏱️ 连接超时";
            btnLabel = "⏱️ 超时";
          } else if (isRateLimited) {
            errMsg = "⏱️ GitHub API 频率限制，请稍后重试";
            btnLabel = "⏱️ 限流";
          } else if (isAllFailed) {
            errMsg = "❌ 加载失败，请检查网络或稍后重试";
            btnLabel = "❌ 失败";
          } else {
            errMsg = "❌ 加载失败";
            btnLabel = "❌ 失败";
          }
          btn.textContent = btnLabel;
          btn.classList.add("cr-fetch-failed");
          searchResults.innerHTML =
            '<div class="cr-error-page">' +
            '<button class="btn-base sm cr-back-repo">← 返回</button>' +
            '<div class="cr-error-msg">' +
            errMsg +
            "</div></div>";
          searchResults
            .querySelector(".cr-back-repo")
            ?.addEventListener("click", backToSite);
          const msg = isTimeout
            ? "⏱️ " +
              repo +
              " 链接超时（raw.githubusercontent.com 可能被屏蔽），已在浏览器中打开仓库"
            : "📦 " + repo + " 没有 index.json，已在浏览器中打开仓库";
          bus.emit("toast:show", { msg, duration: 6000, type: "warn" });
          getApp().then(({ OpenInBrowser }) =>
            OpenInBrowser("https://github.com/" + repo),
          );
        }
      });
    });

  // ===== 创作者编辑模式 =====
  searchResults.querySelector(".cr-edit-btn")?.addEventListener("click", () => {
    wsEditModeRef.v = true;
    refreshView();
  });

  // 拉取社区索引（creators + sites + github 仓库 + 资源类型）
  searchResults
    .querySelector(".cr-fetch-btn")
    ?.addEventListener("click", async () => {
      const btn = searchResults.querySelector(".cr-fetch-btn") as HTMLButtonElement;
      btn.textContent = "⏳";
      btn.disabled = true;
      try {
        const m = await import("./core.ts");
        const App = await getApp();
        const results = await Promise.all([
          m.fetchCommunityCreators(m.DEFAULT_COMMUNITY_URL),
          m.fetchCommunitySites(),
          App.LoadGitHubRepos().catch(function () {
            return [];
          }),
          App.LoadResourceTypes().catch(function () {
            return "{}";
          }),
        ]);
        const community = results[0],
          sitesData = results[1],
          gitHubRepos = results[2],
          resourceTypesRaw = results[3];
        const logs: string[] = [];
        let changed = false;

        if (community && community.length) {
          const r1 = m.mergeCommunityCreators(allCreators, community);
          await App.SaveWorkshopCreators(allCreators);
          if (r1.added || r1.updated) {
            logs.push(
              "创作者: +" + r1.added + " 补" + r1.updated,
            );
            changed = true;
          }
        }
        if (sitesData && sitesData.length) {
          const r2 = m.mergeCommunitySites(allSites, sitesData);
          if (r2.added > 0) {
            await App.SaveWorkshopSites(allSites);
            logs.push("站点: +" + r2.added);
            changed = true;
          }
        }
        if (gitHubRepos && gitHubRepos.length) {
          logs.push("GitHub: " + gitHubRepos.length + " 仓库");
          changed = true;
        }
        // resourceTypesRaw 是 JSON 字符串，解析后取 resourceTypes 数组
        let resourceTypes: unknown[] = [];
        try {
          const parsed = JSON.parse(resourceTypesRaw || "{}") as { resourceTypes?: unknown[] };
          resourceTypes = parsed.resourceTypes || [];
        } catch (_) {}
        if (resourceTypes.length) {
          logs.push("类型: " + resourceTypes.length + " 种");
          changed = true;
        }

        if (changed) {
          bus.emit("toast:show", {
            msg: "🌐 " + logs.join(" · "),
            duration: 4000,
            type: "success",
          });
          refreshView();
        } else {
          bus.emit("toast:show", {
            msg: "🌐 已是最新配置",
            duration: 3000,
            type: "success",
          });
        }
      } catch (e) {
        const err = e as Error;
        const errMsg = err.message === "NetworkOffline"
          ? "🌐 无网络连接，请检查网络后重试"
          : err.message === "NoIndex"
            ? "📭 社区索引文件不存在"
            : err.message === "RateLimited"
              ? "⏱️ GitHub API 频率限制，请稍后重试"
              : "🌐 " + friendlyError(e, "拉取失败");
        bus.emit("toast:show", {
          msg: errMsg,
          duration: 5000,
          type: "error",
        });
      } finally {
        btn.textContent = "🌐 更新配置";
        btn.disabled = false;
      }
    });

  searchResults
    .querySelector(".cr-cancel-btn")
    ?.addEventListener("click", () => {
      wsEditModeRef.v = false;
      refreshView();
    });

  // 保存（创作者 + 搜索词）
  searchResults
    .querySelector(".cr-save-btn")
    ?.addEventListener("click", async () => {
      try {
        // 校验数据完整性
        if (!site || !site.id) {
          bus.emit("toast:show", {
            msg: "❌ 站点信息丢失",
            duration: 3000,
            type: "error",
          });
          return;
        }

        // 保存搜索词 — 按站点原子保存
        if (allSites && site) {
          const { SaveWorkshopPresetsBySite } =
            await getApp();
          const newPresets: WorkshopPresetSearch[] = [];
          searchResults
            .querySelectorAll(
              ".cr-edit-card[data-edit='preset'] input[data-fld='label']",
            )
            .forEach((inp) => {
              const val = (inp as HTMLInputElement).value.trim();
              // 原 JS 仅传 {label}，q 字段 Go 端 JSON 缺省兼容——类型上 cast 补齐
              if (val) newPresets.push({ label: val } as WorkshopPresetSearch);
            });
          await SaveWorkshopPresetsBySite(site.id, newPresets);
          site.presetSearches = newPresets;
        }
        // 保存创作者：先收集输入框值
        syncAllEditInputs();
        // 按站点保存 — 只传当前站点的创作者
        const siteCreators = creators.filter(
          (cr) => cr.type && cr.type.split(";").includes(site.id),
        );
        const { SaveWorkshopCreatorsBySite } =
          await getApp();
        await SaveWorkshopCreatorsBySite(site.id, siteCreators);
        wsEditModeRef.v = false;
        bus.emit("toast:show", {
          msg: "✅ 已保存",
          duration: 2000,
          type: "success",
        });
        refreshView();
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e, "保存失败"),
          duration: 4000,
          type: "error",
        });
      }
    });

  // ===== 拖拽 JSON 导入创作者/站点配置 =====
  const dropZone = searchResults.querySelector("#cr-drop-zone");
  if (dropZone) {
    let _dragCounter = 0;

    const onDragEnter = (e: DragEvent): void => {
      e.preventDefault();
      _dragCounter++;
      dropZone.classList.add("cr-drop-zone-active");
    };
    const onDragLeave = (): void => {
      _dragCounter--;
      if (_dragCounter <= 0) {
        _dragCounter = 0;
        dropZone.classList.remove("cr-drop-zone-active");
      }
    };
    const onDrop = async (e: DragEvent): Promise<void> => {
      e.preventDefault();
      _dragCounter = 0;
      dropZone.classList.remove("cr-drop-zone-active");

      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.name.endsWith(".json")) {
        bus.emit("toast:show", {
          msg: "❌ 请拖拽 .json 文件",
          duration: 3000,
          type: "error",
        });
        return;
      }

      const resetLabel = (): void => {
        dropZone.innerHTML =
          '<span class="cr-drop-icon">📥</span>' +
          '<span class="cr-drop-text">拖拽 JSON 文件到此处，导入创作者/站点配置</span>';
      };

      try {
        const text = await file.text();
        const data = JSON.parse(text) as Array<Record<string, unknown>>;
        if (!Array.isArray(data) || !data.length) {
          throw new Error("JSON 必须是对象数组");
        }

        const first = data[0];
        if (first && typeof first.name === "string") {
          // 创作者 JSON → Go 端 MergeWorkshopCreatorsFromJSON
          dropZone.textContent = "⏳ 正在合并创作者…";
          const { MergeWorkshopCreatorsFromJSON, LoadWorkshopCreators } =
            await getApp();
          const result = await MergeWorkshopCreatorsFromJSON(text);
          let added: number, updated: number;
          if (Array.isArray(result)) {
            added = result[0]; updated = result[1];
          } else {
            added = result; updated = 0;
          }
          // 刷新内存中的 allCreators
          const fresh = (await LoadWorkshopCreators()) || [];
          allCreators.length = 0;
          allCreators.push(...(fresh as LocalCreatorLike[]));
          bus.emit("toast:show", {
            msg: "✅ 创作者: 新增 " + added + "，更新 " + updated,
            duration: 3000,
            type: "success",
          });
        } else if (first && typeof first.id === "string" && typeof first.label === "string") {
          // 站点 JSON → 前端合并后调用 SaveWorkshopSites
          dropZone.textContent = "⏳ 正在合并站点…";
          const { SaveWorkshopSites } =
            await getApp();
          const existMap = new Map(allSites.map((s) => [s.id, s]));
          let added = 0, updated = 0;
          data.forEach((s) => {
            const sid = String(s.id);
            if (existMap.has(sid)) {
              Object.assign(existMap.get(sid) as object, s);
              updated++;
            } else {
              existMap.set(sid, s as unknown as WorkshopSite);
              allSites.push(s as unknown as WorkshopSite);
              added++;
            }
          });
          await SaveWorkshopSites(allSites);
          bus.emit("toast:show", {
            msg: "✅ 站点: 新增 " + added + "，更新 " + updated,
            duration: 3000,
            type: "success",
          });
        } else {
          throw new Error("JSON 格式无法识别（需含 name 字段或 id+label 字段）");
        }
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e, "导入失败"),
          duration: 4000,
          type: "error",
        });
      } finally {
        resetLabel();
        refreshView();
      }
    };

    dropZone.addEventListener("dragenter", onDragEnter as EventListener);
    dropZone.addEventListener("dragover", (e) => e.preventDefault());
    dropZone.addEventListener("dragleave", onDragLeave);
    dropZone.addEventListener("drop", onDrop as unknown as EventListener);
  }

  // 行内编辑
  searchResults.querySelectorAll("[data-idx][data-fld]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const idx = parseInt((inp as HTMLElement).dataset.idx || "-1", 10);
      const fld = (inp as HTMLElement).dataset.fld || "";
      if (creators[idx]) {
        if (inp.tagName === "SELECT") {
          creators[idx][fld] = Array.from((inp as HTMLSelectElement).selectedOptions)
            .map((o) => o.value)
            .filter(Boolean)
            .join(";");
        } else {
          creators[idx][fld] = (inp as HTMLInputElement).value.trim();
        }
      }
    });
  });

  // 删除创作者
  searchResults.querySelectorAll(".cr-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncAllEditInputs();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "-1", 10);
      if (creators[idx]) {
        const realIdx = allCreators.indexOf(creators[idx]);
        if (realIdx >= 0) allCreators.splice(realIdx, 1);
        refreshView();
      }
    });
  });

  // 创作者拖拽排序 — 仅拖拽柄触发
  let dragSrcIdx = -1;
  // 拖拽状态清理：防止 JS 异常后 class 卡死在 DOM 上
  const clearDragState = (): void => {
    dragSrcIdx = -1;
    dragPresetSrcIdx = -1;
    searchResults.querySelectorAll(".cr-edit-card").forEach((c) => {
      c.classList.remove("cr-dragging", "cr-drag-target", "cr-drag-before", "cr-drag-after");
    });
  };

  searchResults
    .querySelectorAll(".cr-edit-card:not([data-edit='preset'])")
    .forEach((card) => {
      const handle = card.querySelector(".cr-drag-handle");
      if (!handle) return;
      // 点拖拽柄时暂时让卡片可拖拽
      handle.addEventListener("mousedown", () => {
        (card as HTMLElement).draggable = true;
      });
      card.addEventListener("dragstart", (e: Event) => {
        const de = e as DragEvent;
        (card as HTMLElement).draggable = false;
        dragSrcIdx = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
        card.classList.add("cr-dragging");
        de.dataTransfer!.effectAllowed = "move";
        de.dataTransfer!.setData("text/plain", "");
      });
      card.addEventListener("dragend", () => {
        (card as HTMLElement).draggable = false;
        clearDragState();
      });
      card.addEventListener("dragover", (e: Event) => {
        e.preventDefault();
        (e as DragEvent).dataTransfer!.dropEffect = "move";
      });
      card.addEventListener("dragenter", (e) => {
        e.preventDefault();
        card.classList.add("cr-drag-target");
        if (dragSrcIdx >= 0) {
          const tgt = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
          if (dragSrcIdx < tgt) {
            card.classList.add("cr-drag-before");
          } else if (dragSrcIdx > tgt) {
            card.classList.add("cr-drag-after");
          }
        }
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("cr-drag-target", "cr-drag-before", "cr-drag-after");
      });
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("cr-drag-target");
        const targetIdx = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
        if (dragSrcIdx < 0 || dragSrcIdx === targetIdx) return;
        syncAllEditInputs();
        const [removed] = creators.splice(dragSrcIdx, 1);
        creators.splice(targetIdx, 0, removed);
        allCreators.length = 0;
        allCreators.push(...creators);
        dragSrcIdx = -1;
        refreshView();
      });
    });

  // 搜索词拖拽排序 — 仅拖拽柄触发
  let dragPresetSrcIdx = -1;
  searchResults
    .querySelectorAll(".cr-edit-card[data-edit='preset']")
    .forEach((card) => {
      const handle = card.querySelector(".cr-drag-handle");
      if (!handle) return;
      handle.addEventListener("mousedown", () => {
        (card as HTMLElement).draggable = true;
      });
      card.addEventListener("dragstart", (e: Event) => {
        const de = e as DragEvent;
        (card as HTMLElement).draggable = false;
        dragPresetSrcIdx = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
        card.classList.add("cr-dragging");
        de.dataTransfer!.effectAllowed = "move";
        de.dataTransfer!.setData("text/plain", "");
      });
      card.addEventListener("dragend", () => {
        (card as HTMLElement).draggable = false;
        clearDragState();
      });
      card.addEventListener("dragover", (e: Event) => {
        e.preventDefault();
        (e as DragEvent).dataTransfer!.dropEffect = "move";
      });
      card.addEventListener("dragenter", (e) => {
        e.preventDefault();
        card.classList.add("cr-drag-target");
        if (dragPresetSrcIdx >= 0) {
          const tgt = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
          if (dragPresetSrcIdx < tgt) {
            card.classList.add("cr-drag-before");
          } else if (dragPresetSrcIdx > tgt) {
            card.classList.add("cr-drag-after");
          }
        }
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("cr-drag-target", "cr-drag-before", "cr-drag-after");
      });
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("cr-drag-target");
        const targetIdx = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
        if (
          dragPresetSrcIdx < 0 ||
          dragPresetSrcIdx === targetIdx ||
          !site.presetSearches
        )
          return;
        syncAllEditInputs();
        const [removed] = site.presetSearches.splice(dragPresetSrcIdx, 1);
        site.presetSearches.splice(targetIdx, 0, removed);
        dragPresetSrcIdx = -1;
        refreshView();
      });
    });
  function syncAllEditInputs(): void {
    // 同步创作者输入框
    searchResults
      .querySelectorAll(
        ".cr-edit-card:not([data-edit='preset']) [data-idx][data-fld]",
      )
      .forEach((inp) => {
        const idx = parseInt((inp as HTMLElement).dataset.idx || "-1", 10);
        const fld = (inp as HTMLElement).dataset.fld || "";
        if (creators[idx]) {
          if (inp.tagName === "SELECT") {
            creators[idx][fld] = Array.from((inp as HTMLSelectElement).selectedOptions)
              .map((o) => o.value)
              .filter(Boolean)
              .join(";");
          } else {
            creators[idx][fld] = (inp as HTMLInputElement).value.trim();
          }
        }
      });
    // 同步搜索词输入框
    searchResults
      .querySelectorAll(
        ".cr-edit-card[data-edit='preset'] input[data-fld='label']",
      )
      .forEach((inp) => {
        const idx = parseInt((inp as HTMLElement).dataset.idx || "-1", 10);
        if (site.presetSearches && site.presetSearches[idx]) {
          site.presetSearches[idx].label = (inp as HTMLInputElement).value.trim();
        }
      });
  }
  // 删除搜索词
  searchResults.querySelectorAll(".cr-del-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncAllEditInputs();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "-1", 10);
      if (site.presetSearches && site.presetSearches[idx]) {
        site.presetSearches.splice(idx, 1);
        refreshView();
      }
    });
  });
  // 搜索词排序
  searchResults.querySelectorAll(".cr-order-up").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncAllEditInputs();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "-1", 10);
      if (site.presetSearches && idx > 0) {
        const arr = site.presetSearches;
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        refreshView();
      }
    });
  });
  searchResults.querySelectorAll(".cr-order-down").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncAllEditInputs();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "-1", 10);
      if (site.presetSearches && idx < site.presetSearches.length - 1) {
        const arr = site.presetSearches;
        [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
        refreshView();
      }
    });
  });

  // 新增创作者
  searchResults.querySelector(".cr-add")?.addEventListener("click", () => {
    syncAllEditInputs();
    creators.push({ name: "新作者", desc: "描述", type: site.id, tag: "" } as LocalCreatorLike);
    allCreators.push(creators[creators.length - 1]);
    refreshView();
  });
  // 新增搜索词
  searchResults
    .querySelector(".cr-add-preset")
    ?.addEventListener("click", () => {
      syncAllEditInputs();
      if (!site.presetSearches) site.presetSearches = [];
      site.presetSearches.push({ label: "", q: "" });
      refreshView();
    });

  // 🔍 创作者搜索 + 标签过滤
  let _activeTag = "";
  const applyFilters = (): void => {
    const kw = (searchInput?.value || "").trim().toLowerCase();
    const cards = searchResults.querySelectorAll(".gh-card[data-name]");
    let visible = 0;
    cards.forEach((card) => {
      const name = ((card as HTMLElement).dataset.name || "").toLowerCase();
      const desc = (
        card.querySelector(".cr-card-desc")?.textContent || ""
      ).toLowerCase();
      const cardTag = ((card as HTMLElement).dataset.tag || "").toLowerCase();
      const matchName = !kw || name.includes(kw) || desc.includes(kw);
      const matchTag = !_activeTag || _activeTag === cardTag;
      card.classList.toggle("cr-card-hidden", !(matchName && matchTag));
      if (matchName && matchTag) visible++;
    });
    const countEl = searchResults.querySelector("#ws-cr-count");
    if (countEl) countEl.textContent = "(" + visible + "/" + cards.length + ")";
  };

  const searchInput = searchResults.querySelector("#ws-cr-search") as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener("input", applyFilters);
  }

  // 标签筛选按钮
  searchResults.querySelectorAll(".cr-tag-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      _activeTag = (btn as HTMLElement).dataset.tag || "";
      searchResults
        .querySelectorAll(".cr-tag-filter-btn")
        .forEach((b) => b.classList.toggle("active", b === btn));
      applyFilters();
    });
  });
}
