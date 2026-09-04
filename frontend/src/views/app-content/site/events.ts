// ===== 站点视图浏览态事件绑定（从 site-view.ts 拆出，ADR-034 方向①）=====

import { getApp } from "../../../backend/app.ts";
import type { bus } from "../../../bus.ts";
import { t } from "../../../core/i18n/t.ts";
import { dbg } from "../../../utils/debug/debug.ts";
import { getSiteIcon, getTagIconFromRole } from "../../../utils/icon/workshop-icons.ts";
import type { LocalCreatorLike } from "../site-view.ts";
import type { BrowseMode, BrowseModeRef } from "../workshop-browse-mode.ts";
import {
  type CreatorIdentityInput,
  getCreatorIdentity,
  getTagFromRole,
  isFaved,
  loadFavs,
  parseDescTags,
  toggleFav,
} from "../workshop-data.ts";
import { type CrCardCtx, createCrCard } from "./render.ts";
import type { CleanupFn, SiteViewState } from "./types.ts";

// storage 监听器模块私有变量（防泄漏，bindBrowseEvents 返回的 cleanup 会清）
let _storageSyncFn: ((e: StorageEvent) => void) | null = null;

// ============================================================
// cmCr* 共用包级函数：详情浮层创建 + 内部 4 子事件绑定
// ============================================================

function cmCrBuildDetailHtml(
  cr: LocalCreatorLike,
  esc: (s: unknown) => string,
  avatarCache: Record<string, string> | undefined,
  authorCountMap: Record<string, number>,
): { html: string; isFav: boolean } {
  const identity = getCreatorIdentity(cr as CreatorIdentityInput);
  const descTags = parseDescTags(cr.desc);
  const isFav = isFaved(cr.name);
  const localCount = authorCountMap[cr.name] || 0;
  const detailFallbackChar = esc(cr.name.charAt(0)).toUpperCase();
  const detailFallbackDiv =
    '<div class="cr-avatar cr-detail-avatar-text">' + detailFallbackChar + "</div>";
  const html =
    '<div class="cr-detail-box">' +
    '<div class="cr-detail-header">' +
    '<div class="cr-avatar-container cr-detail-avatar-container">' +
    (avatarCache && avatarCache[cr.name]
      ? '<img class="cr-avatar cr-detail-avatar-img" src="' +
        esc(avatarCache[cr.name]) +
        '" data-debug-avatar="' +
        esc(cr.name) +
        '" onerror="this.outerHTML=\'' +
        detailFallbackDiv.replace(/"/g, "&quot;") +
        "'\">"
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
            (platform: string) =>
              '<span class="cr-platform-badge">' +
              getSiteIcon(platform) +
              " <span>" +
              esc(platform) +
              "</span>",
          )
          .join("") +
        "</div>"
      : "") +
    '<div class="cr-detail-identity">' +
    identity.icon +
    "<span>" +
    esc(identity.label) +
    "</span>" +
    "</div>" +
    "</div>" +
    '<span class="cr-star-btn" data-star="' +
    esc(cr.name) +
    '">' +
    (isFav ? "⭐" : "☆") +
    "</span>" +
    "</div>" +
    '<div class="cr-detail-desc">' +
    descTags.map((tag) => '<span class="cr-desc-tag">#' + esc(tag) + "</span>").join("") +
    (!descTags.length ? esc(cr.desc) : "") +
    "</div>" +
    '<div class="cr-detail-row cr-local-card">' +
    '<span class="cr-local-icon">📂</span>' +
    '<span class="cr-local-text">' +
    t("content.downloadedModels", { n: localCount }) +
    "</span>" +
    '<button class="cr-local-btn" data-local>' +
    t("content.viewArrow") +
    "</button>" +
    "</div>" +
    '<div class="cr-detail-actions">' +
    '<button class="secondary" data-search="' +
    esc(cr.name) +
    '">' +
    t("content.searchMoreModels") +
    "</button>" +
    '<button class="secondary" data-close>' +
    t("common.close") +
    "</button>" +
    "</div>" +
    "</div>";
  return { html, isFav };
}

function cmCrBindOverlayEvents(
  overlay: HTMLDivElement,
  cr: LocalCreatorLike,
  searchResults: HTMLElement,
  site: { searchUrl?: string },
  openUrl: ((url: string) => void) | undefined,
  fillSearch: (tpl: string, q: string) => string,
  busRef: typeof bus,
): void {
  overlay.querySelector("[data-star]")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const now = toggleFav(cr.name);
    (ev.target as HTMLElement).textContent = now ? "⭐" : "☆";
    const cardStar = searchResults.querySelector(
      '.cr-star-btn[data-star="' + CSS.escape(cr.name) + '"]',
    );
    if (cardStar) cardStar.textContent = now ? "⭐" : "☆";
    busRef.emit("toast:show", {
      msg: now ? t("content.favAdded") : t("content.favRemoved"),
      duration: 1500,
      type: "success",
    });
  });

  overlay.querySelector("[data-close]")?.addEventListener("click", () => overlay.remove());

  const searchBtn = overlay.querySelector("[data-search]") as HTMLElement | null;
  if (searchBtn) {
    searchBtn.addEventListener("click", () => {
      overlay.remove();
      if (site.searchUrl && openUrl) {
        openUrl(fillSearch(site.searchUrl, searchBtn.dataset.search || ""));
      }
    });
  }

  const localBtn = overlay.querySelector("[data-local]");
  if (localBtn) {
    localBtn.addEventListener("click", () => {
      overlay.remove();
      busRef.emit("repo:search-creator", cr.name);
    });
  }
}

function cmCrCreateDetailOverlay(
  cr: LocalCreatorLike,
  esc: (s: unknown) => string,
  avatarCache: Record<string, string> | undefined,
  authorCountMap: Record<string, number>,
): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.className = "cr-detail-overlay";
  overlay.onclick = (ev) => {
    if (ev.target === overlay) overlay.remove();
  };
  const { html } = cmCrBuildDetailHtml(cr, esc, avatarCache, authorCountMap);
  overlay.innerHTML = html;
  return overlay;
}

// ============================================================
// cmBb* 包级函数：bindBrowseEvents 子函数（本地视图绑定）
// ============================================================

function cmBbBindEmptyLocalBtn(searchResults: HTMLElement, busRef: typeof bus): void {
  const emptyLocalBtn = searchResults.querySelector("[data-local-empty]");
  if (emptyLocalBtn) {
    emptyLocalBtn.addEventListener("click", () => {
      busRef.emit("nav:changed", { page: "repository" });
    });
  }
}

function cmBbPopulateCreatorGrid(
  searchResults: HTMLElement,
  wsEditModeRef: { v: boolean },
  creators: LocalCreatorLike[],
  cardCtx: CrCardCtx,
): void {
  const grid = searchResults.querySelector("#cr-creator-grid");
  if (grid && !wsEditModeRef.v && creators.length) {
    creators.forEach((cr) => {
      const card = createCrCard(cr, cardCtx);
      grid.appendChild(card);
    });
  }
}

function cmBbBindPresetSearchBtns(
  searchResults: HTMLElement,
  site: { searchUrl?: string; url: string },
  openUrl: ((url: string) => void) | undefined,
  fillSearch: (tpl: string, q: string) => string,
): void {
  searchResults.querySelectorAll(".cr-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = (btn as HTMLElement).dataset.q || "";
      if (site.searchUrl && openUrl) {
        openUrl(fillSearch(site.searchUrl, q));
      } else if (openUrl) {
        openUrl(site.url);
      }
    });
  });
}

function cmBbBindModeToggle(
  searchResults: HTMLElement,
  ctx: { setBrowseMode: (mode: BrowseMode) => void },
  refreshView: () => void,
): void {
  searchResults.querySelectorAll(".cr-mode-opt[data-mode]").forEach((el) => {
    el.addEventListener("click", () => {
      ctx.setBrowseMode((el as HTMLElement).dataset.mode as BrowseMode);
      refreshView();
    });
  });
}

function cmBbBindStarBtns(searchResults: HTMLElement, busRef: typeof bus): void {
  searchResults.querySelectorAll(".cr-star-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = (btn as HTMLElement).dataset.star || "";
      const now = toggleFav(name);
      btn.textContent = now ? "⭐" : "☆";
      const card = btn.closest(".gh-card");
      if (card) {
        const grid2 = card.closest(".cr-creator-grid");
        if (now) {
          grid2?.insertBefore(card, grid2.firstChild);
        } else {
          grid2?.appendChild(card);
        }
      }
      busRef.emit("toast:show", {
        msg: now ? t("content.favAddedName", { name }) : t("content.favRemovedName", { name }),
        duration: 1500,
        type: "success",
      });
    });
  });
}

function cmBbBindSearchBtns(
  searchResults: HTMLElement,
  site: { searchUrl?: string; url: string },
  openUrl: ((url: string) => void) | undefined,
  fillSearch: (tpl: string, q: string) => string,
): void {
  searchResults.querySelectorAll(".cr-card-search").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = (btn as HTMLElement).dataset.searchCreator || "";
      if (site.searchUrl && openUrl) {
        openUrl(fillSearch(site.searchUrl, name));
      } else if (openUrl) {
        openUrl(site.url);
      }
    });
  });
}

function cmBbBindLocalBadges(searchResults: HTMLElement, busRef: typeof bus): void {
  searchResults.querySelectorAll(".cr-card-local-jump").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = (el as HTMLElement).dataset.localCreator || "";
      busRef.emit("repo:search-creator", name);
    });
  });
}

function cmBbBindDebugAvatar(searchResults: HTMLElement, getDisposed: () => boolean): void {
  searchResults.querySelectorAll("[data-debug-avatar]").forEach((img) => {
    img.addEventListener("click", async (e) => {
      e.stopPropagation();
      const name = (img as HTMLElement).dataset.debugAvatar;
      if (!name) return;
      try {
        const { DebugExtractCreatorAvatar } = await getApp();
        if (getDisposed()) return;
        const info = await DebugExtractCreatorAvatar(name);
        dbg("avatar-debug", name, info);
      } catch (err) {
        dbg("avatar-debug", "调用失败", err);
      }
    });
  });
}

function cmBbBindCardClicks(
  searchResults: HTMLElement,
  creators: LocalCreatorLike[],
  esc: (s: unknown) => string,
  avatarCache: Record<string, string> | undefined,
  authorCountMap: Record<string, number>,
  site: { searchUrl?: string; url: string },
  openUrl: ((url: string) => void) | undefined,
  fillSearch: (tpl: string, q: string) => string,
  busRef: typeof bus,
): void {
  searchResults.querySelectorAll(".gh-card[data-name]").forEach((card) => {
    card.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(".cr-star-btn") ||
        target.closest(".cr-card-search") ||
        target.closest(".cr-card-local-jump")
      )
        return;
      const name = (card as HTMLElement).dataset.name;
      const cr = creators.find((c) => c.name === name);
      if (!cr) return;
      const overlay = cmCrCreateDetailOverlay(cr, esc, avatarCache, authorCountMap);
      (searchResults.getRootNode() as Node).appendChild(overlay);
      cmCrBindOverlayEvents(overlay, cr, searchResults, site, openUrl, fillSearch, busRef);
    });
  });
}

function cmBbBindKeyboardNav(searchResults: HTMLElement): void {
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
}

// ============================================================
// cmSe* 包级函数：_storageSyncFn 子函数（跨标签同步处理）
// ============================================================

function cmSeSyncFavButtons(searchResults: HTMLElement): void {
  const favs = loadFavs();
  searchResults.querySelectorAll(".cr-star-btn").forEach((btn) => {
    btn.textContent = favs.includes((btn as HTMLElement).dataset.star || "") ? "⭐" : "☆";
  });
}

function cmSeSyncLocalBadges(searchResults: HTMLElement): void {
  searchResults.querySelectorAll(".cr-card-local-jump").forEach(() => {
    // 占位：本地徽章跨标签同步（当前无额外状态，保留分派槽）
  });
}

function cmSeSyncAvatarCache(
  searchResults: HTMLElement,
  avatarCache: Record<string, string> | undefined,
): void {
  if (!avatarCache) return;
  searchResults.querySelectorAll("[data-debug-avatar]").forEach(() => {
    // 占位：头像缓存跨标签同步（当前无额外状态，保留分派槽）
  });
}

function cmSeSyncBrowseMode(ctx: { browseMode: BrowseModeRef }, refreshView: () => void): void {
  // 占位：跨标签同步浏览模式（ref 单源，重渲染读 ctx.browseMode.v 自动最新）
  void ctx;
  void refreshView;
}

function cmSeSyncKeyboardFocus(searchResults: HTMLElement): void {
  const crGrid = searchResults.querySelector(".cr-creator-grid");
  if (!crGrid) return;
  const cards = crGrid.querySelectorAll(".gh-card[tabindex]");
  if (!cards.length) return;
  // 占位：creator 增删后调整焦点（当前仅在本地绑定，保留分派槽）
}

function cmSeSyncOverlayState(
  searchResults: HTMLElement,
  esc: (s: unknown) => string,
  avatarCache: Record<string, string> | undefined,
  authorCountMap: Record<string, number>,
): void {
  const root = searchResults.getRootNode() as Document | ShadowRoot;
  const openOverlay = root.querySelector(".cr-detail-overlay") as HTMLDivElement | null;
  if (!openOverlay) return;
  // 占位：已打开浮层的跨标签刷新（当前由本地子事件直接处理，保留分派槽）
  void esc;
  void avatarCache;
  void authorCountMap;
}

function cmSeSyncCreatorDelta(
  searchResults: HTMLElement,
  creators: LocalCreatorLike[],
  wsEditModeRef: { v: boolean },
  cardCtx: CrCardCtx,
): void {
  const grid = searchResults.querySelector("#cr-creator-grid");
  if (!grid || wsEditModeRef.v) return;
  // 占位：creator 增删后的网格局部刷新（当前仅由本地填充，保留分派槽）
  void creators;
  void cardCtx;
}

// ============================================================
// 主函数 A：_storageSyncFn（跨标签 storage 同步分派）
// ============================================================

function cmSeMakeSyncFn(
  searchResults: HTMLElement,
  esc: (s: unknown) => string,
  avatarCache: Record<string, string> | undefined,
  authorCountMap: Record<string, number>,
  creators: LocalCreatorLike[],
  wsEditModeRef: { v: boolean },
  cardCtx: CrCardCtx,
  ctx: { browseMode: BrowseModeRef },
  refreshView: () => void,
): (e: StorageEvent) => void {
  return (e: StorageEvent) => {
    if (e.key === "ysm-fav-creators") {
      cmSeSyncFavButtons(searchResults);
      cmSeSyncLocalBadges(searchResults);
      cmSeSyncAvatarCache(searchResults, avatarCache);
      cmSeSyncBrowseMode(ctx, refreshView);
      cmSeSyncKeyboardFocus(searchResults);
      cmSeSyncOverlayState(searchResults, esc, avatarCache, authorCountMap);
      cmSeSyncCreatorDelta(searchResults, creators, wsEditModeRef, cardCtx);
    }
  };
}

// ============================================================
// 主函数 B：bindBrowseEvents（本地视图事件分派，签名不变）
// ============================================================

/**
 * 绑定浏览态事件：空状态按钮 / 创作者卡片网格 / 预设搜索 / 收藏 / 头像调试 /
 * 卡片点击详情浮层 / 键盘导航 / storage 同步。
 * 返回 cleanup：移除 storage 监听，供主入口在切页/重渲染时统一调用。
 */
export function bindBrowseEvents(state: SiteViewState, refreshView: () => void): CleanupFn {
  const {
    esc,
    searchResults,
    allCreators,
    wsEditModeRef,
    avatarCache,
    site,
    creators,
    authorCountMap,
    fillSearch,
    openUrl,
    bus: busRef,
    ctx,
  } = state;

  let disposed = false;
  const getDisposed = () => disposed;

  const cardCtx: CrCardCtx = {
    esc,
    isFaved,
    authorCountMap,
    avatarCache,
    creators,
    allCreators,
    site,
  };

  cmBbBindEmptyLocalBtn(searchResults, busRef);
  cmBbPopulateCreatorGrid(searchResults, wsEditModeRef, creators, cardCtx);
  cmBbBindPresetSearchBtns(searchResults, site, openUrl, fillSearch);
  cmBbBindModeToggle(searchResults, state, refreshView);
  cmBbBindStarBtns(searchResults, busRef);
  cmBbBindSearchBtns(searchResults, site, openUrl, fillSearch);
  cmBbBindLocalBadges(searchResults, busRef);
  cmBbBindDebugAvatar(searchResults, getDisposed);
  cmBbBindCardClicks(
    searchResults,
    creators,
    esc,
    avatarCache,
    authorCountMap,
    site,
    openUrl,
    fillSearch,
    busRef,
  );
  cmBbBindKeyboardNav(searchResults);

  if (_storageSyncFn) {
    window.removeEventListener("storage", _storageSyncFn);
  }
  _storageSyncFn = cmSeMakeSyncFn(
    searchResults,
    esc,
    avatarCache,
    authorCountMap,
    creators,
    wsEditModeRef,
    cardCtx,
    ctx,
    refreshView,
  );
  window.addEventListener("storage", _storageSyncFn);

  return () => {
    disposed = true;
    if (_storageSyncFn) {
      window.removeEventListener("storage", _storageSyncFn);
      _storageSyncFn = null;
    }
  };
}
