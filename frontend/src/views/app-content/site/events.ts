// ===== 站点视图浏览态事件绑定（从 site-view.ts 拆出，ADR-034 方向①）=====

import type { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { qs, qsa } from "@/utils/dom/qsa.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { trapFocusAcrossShadow } from "@/utils/dom/trap-focus-across-shadow.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { getSiteIcon, getTagIconFromRole } from "@/utils/icon/workshop-icons.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import type { CleanupFn, LocalCreatorLike, SiteViewState } from "./types.ts";
import type { BrowseMode } from "./workshop-browse-mode.ts";
import {
  type CreatorIdentityInput,
  getCreatorIdentity,
  getTagDisplayLabel,
  getTagFromRole,
  isFaved,
  loadFavs,
  parseDescTags,
  parseSiteIds,
  toggleFav,
} from "./workshop-data.ts";

// storage 监听器原先的模块级 let _storageSyncFn 是「假装单例」：bindBrowseEvents 每次覆盖它，
// A 视图注册 → B 视图覆盖 → A 的 cleanup 会误删 B 的监听（removeEventListener 拿到的是 B 的引用）。
// P1-8 锐评：监听器引用收进 bindBrowseEvents 闭包随 cleanup 返回，谁注册谁清理，互不干扰。

// 浮层焦点陷阱释放函数的注册表（P0-3 锐评：aria-modal 声明了模态却无 trapFocus）。
// WeakMap 随元素 GC 回收，不污染 HTMLElement 全局类型；所有浮层关闭路径统一释放
// （data-close / data-search / Esc / 遮罩点击），防 doc keydown 监听残留。
const _overlayTrapReleases = new WeakMap<HTMLElement, () => void>();

// ============================================================
// cmCr* 共用包级函数：详情浮层创建 + 内部 4 子事件绑定
// ============================================================

function cmCrBuildDetailHtml(
  cr: LocalCreatorLike,
  esc: (s: unknown) => string,
  avatarCache: Record<string, string> | undefined,
  authorCountMap: Record<string, number>,
): { html: string; fallbackChar: string; isFav: boolean } {
  const identity = getCreatorIdentity(cr as CreatorIdentityInput);
  // 身份行与 tag chip 同口径（复核 N1）：role 能映射到真实身份才渲染该行。未知 role 时
  // getCreatorIdentity 会回退「YSM 创作者」，而 chip 已按 getTagDisplayLabel 原样显示该 role
  // → 同一浮层自相矛盾。既定原则是「不冒充别的身份」，故整行省略而非改成回退文案。
  const showIdentityRow = identity.tag === getTagFromRole(cr.role);
  const descTags = parseDescTags(cr.desc);
  const isFav = isFaved(cr.name);
  const localCount = authorCountMap[cr.name] || 0;
  const detailFallbackChar = esc(cr.name.charAt(0)).toUpperCase();
  const detailFallbackDiv = `<div class="cr-avatar cr-detail-avatar-text">${detailFallbackChar}</div>`;
  const html =
    '<div class="cr-detail-box">' +
    '<div class="cr-detail-header">' +
    '<div class="cr-avatar-container cr-detail-avatar-container">' +
    (avatarCache?.[cr.name]
      ? '<img class="cr-avatar cr-detail-avatar-img" src="' +
        esc(avatarCache[cr.name]) +
        '" data-debug-avatar="' +
        esc(cr.name) +
        '">'
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
        // 锐评 P0-4 / 复核 P1-3：展示文案走 i18n 单源（未知 tag 原样），与卡片/筛选行同口径；
        // class 仍用原始 role id。
        esc(getTagDisplayLabel(getTagFromRole(cr.role))) +
        "</span>" +
        "</span>"
      : "") +
    "</div>" +
    (cr.type
      ? '<div class="cr-detail-platforms">' +
        parseSiteIds(cr.type)
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
    (showIdentityRow
      ? '<div class="cr-detail-identity">' +
        identity.icon +
        "<span>" +
        esc(identity.label) +
        "</span>" +
        "</div>"
      : "") +
    "</div>" +
    '<span class="cr-star-btn" data-star="' +
    esc(cr.name) +
    '">' +
    (isFav ? UI_ICONS.starFilled : UI_ICONS.star) +
    "</span>" +
    "</div>" +
    '<div class="cr-detail-desc">' +
    (descTags.length
      ? descTags.map((tag) => `<span class="cr-desc-tag">#${esc(tag)}</span>`).join("")
      : // 锐评 P0-3：descTags 现仅在确为标签串时非空（单段/长句均回 []），此分支即全文兜底——
        // 原逻辑对任意非空 desc 都只渲染 chips 且丢弃原文。
        // 锐评 P0-2b：本地条目空 desc 在此现取当前语言提示，而非数据层落 i18n 串。
        esc(cr.desc || (cr._fromLocal ? t("community.fromLocal") : ""))) +
    "</div>" +
    '<div class="cr-detail-row cr-local-card">' +
    '<span class="cr-local-icon">' +
    UI_ICONS.folderOpen +
    "</span>" +
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
  return { html, fallbackChar: detailFallbackChar, isFav };
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
  const overlayStar = qs<HTMLElement>(overlay, "[data-star]");
  overlayStar?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const now = toggleFav(cr.name);
    // 星标切 SVG 双态（ADR-238）：用闭包按钮引用改写——点进 SVG 内部时 ev.target 是
    // SVGElement，旧 `instanceof HTMLElement` 守卫会漏更新图标。icon 先取到局部变量再赋
    // innerHTML（RHS 为预构建 SVG 常量，命中 R8 豁免「预构建 HTML 变量」）
    const starHtml = now ? UI_ICONS.starFilled : UI_ICONS.star;
    if (overlayStar) overlayStar.innerHTML = starHtml;
    const cardStar = searchResults.querySelector(
      `.cr-star-btn[data-star="${CSS.escape(cr.name)}"]`,
    );
    if (cardStar) cardStar.innerHTML = starHtml;
    busRef.emit("toast:show", {
      msg: now ? t("content.favAdded") : t("content.favRemoved"),
      duration: TOAST_MS.quick,
      type: "success",
    });
  });

  overlay.querySelector("[data-close]")?.addEventListener("click", () => {
    // P0-3 锐评：关闭路径统一释放 trap（防 doc keydown 监听残留），remove 前先 release
    _overlayTrapReleases.get(overlay)?.();
    overlay.remove();
  });

  const searchBtn = qs<HTMLElement>(overlay, "[data-search]");
  if (searchBtn) {
    searchBtn.addEventListener("click", () => {
      _overlayTrapReleases.get(overlay)?.();
      overlay.remove();
      if (site.searchUrl && openUrl) {
        openUrl(fillSearch(site.searchUrl, searchBtn.dataset.search || ""));
      }
    });
  }

  const localBtn = overlay.querySelector("[data-local]");
  if (localBtn) {
    localBtn.addEventListener("click", () => {
      _overlayTrapReleases.get(overlay)?.();
      overlay.remove();
      busRef.emit("repo:search-creator", cr.name);
    });
  }
}

/**
 * 头像加载失败 → 用字母 fallback 替换 img（单点实现：grid 卡片与详情浮层共用）。
 * 两处仅 fallback 元素的 class 不同，由调用方显式传入，避免助手内猜语义。
 */
function bindAvatarFallback(img: HTMLImageElement, fallbackClass: string, char: string): void {
  img.addEventListener("error", () => {
    const fb = document.createElement("div");
    fb.className = fallbackClass;
    fb.textContent = char;
    img.replaceWith(fb);
  });
}

function cmCrCreateDetailOverlay(
  cr: LocalCreatorLike,
  esc: (s: unknown) => string,
  avatarCache: Record<string, string> | undefined,
  authorCountMap: Record<string, number>,
): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.className = "cr-detail-overlay";
  // a11y：自建模态须与 features/dialogs/modal.ts 基座一致——role + aria-modal + Esc 关闭 + 焦点归还
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.tabIndex = -1;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const close = () => {
    // P0-3 锐评：aria-modal 承诺了模态，必须 trapFocus（Tab 不许逃到页面背后）；
    // 关闭即释放，防 doc keydown 监听残留（WeakMap 注册表见模块头）
    _overlayTrapReleases.get(overlay)?.();
    overlay.remove();
    opener?.focus?.();
  };
  overlay.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
    }
  });
  overlay.onclick = (ev) => {
    if (ev.target === overlay) close();
  };
  const { html, fallbackChar } = cmCrBuildDetailHtml(cr, esc, avatarCache, authorCountMap);
  overlay.innerHTML = html;
  const detailImg = overlay.querySelector<HTMLImageElement>("img.cr-detail-avatar-img");
  if (detailImg) {
    bindAvatarFallback(detailImg, "cr-avatar cr-detail-avatar-text", fallbackChar);
  }
  // P0-3 锐评：trapFocusAcrossShadow 是专为「overlay 挂 shadow root、需穿透深焦解析」设计的
  // 跨 Shadow 版本（modal-core.trapFocus 的 document.activeElement 判定对 shadow 内元素恒失效）。
  // 注册进 WeakMap，供 close / data-close / data-search / data-local 各关闭路径统一释放。
  _overlayTrapReleases.set(overlay, trapFocusAcrossShadow(overlay));
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

function cmBbBindPresetSearchBtns(
  searchResults: HTMLElement,
  site: { searchUrl?: string; url: string },
  openUrl: ((url: string) => void) | undefined,
  fillSearch: (tpl: string, q: string) => string,
): void {
  qsa<HTMLElement>(searchResults, ".cr-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = btn.dataset.q || "";
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
  qsa<HTMLElement>(searchResults, ".cr-mode-opt[data-mode]").forEach((el) => {
    el.addEventListener("click", () => {
      ctx.setBrowseMode(el.dataset.mode as BrowseMode);
      refreshView();
    });
  });
}

function cmBbBindStarBtns(searchResults: HTMLElement, busRef: typeof bus): void {
  qsa<HTMLElement>(searchResults, ".cr-star-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = btn.dataset.star || "";
      const now = toggleFav(name);
      // 预构建 SVG 常量先取到局部变量（R8 豁免：RHS=裸变量，无三元/拼接）
      const starHtml = now ? UI_ICONS.starFilled : UI_ICONS.star;
      btn.innerHTML = starHtml;
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
        duration: TOAST_MS.quick,
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
  qsa<HTMLElement>(searchResults, ".cr-card-search").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = btn.dataset.searchCreator || "";
      if (site.searchUrl && openUrl) {
        openUrl(fillSearch(site.searchUrl, name));
      } else if (openUrl) {
        openUrl(site.url);
      }
    });
  });
}

function cmBbBindLocalBadges(searchResults: HTMLElement, busRef: typeof bus): void {
  qsa<HTMLElement>(searchResults, ".cr-card-local-jump").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = el.dataset.localCreator || "";
      busRef.emit("repo:search-creator", name);
    });
  });
}

function cmBbBindDebugAvatar(searchResults: HTMLElement, getDisposed: () => boolean): void {
  qsa<HTMLElement>(searchResults, "[data-debug-avatar]").forEach((img) => {
    // 头像加载失败 → 字母 fallback（声明式 data-avatar-fallback 属性；单点实现见 bindAvatarFallback）
    if (img instanceof HTMLImageElement && img.dataset.avatarFallback) {
      bindAvatarFallback(img, "cr-avatar cr-avatar-fallback", img.dataset.avatarFallback);
    }
    img.addEventListener("click", async (e) => {
      e.stopPropagation();
      const name = img.dataset.debugAvatar;
      if (!name) return;
      try {
        const { DebugExtractCreatorAvatar } = await backendGetApp();
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
  qsa<HTMLElement>(searchResults, ".gh-card[data-name]").forEach((card) => {
    card.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        target.closest(".cr-star-btn") ||
        target.closest(".cr-card-search") ||
        target.closest(".cr-card-local-jump")
      )
        return;
      const name = card.dataset.name;
      const cr = creators.find((c) => c.name === name);
      if (!cr) return;
      const overlay = cmCrCreateDetailOverlay(cr, esc, avatarCache, authorCountMap);
      (searchResults.getRootNode() as Node).appendChild(overlay);
      overlay.focus();
      cmCrBindOverlayEvents(overlay, cr, searchResults, site, openUrl, fillSearch, busRef);
    });
  });
}

function cmBbBindKeyboardNav(searchResults: HTMLElement): void {
  const crGrid = searchResults.querySelector(".cr-creator-grid");
  if (crGrid) {
    crGrid.addEventListener("keydown", ((e: KeyboardEvent) => {
      const cards = qsa<HTMLElement>(crGrid, ".gh-card[tabindex]");
      const cur = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const idx = cur ? cards.indexOf(cur) : -1;
      if (idx < 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const next = cards[idx + 1] || cards[0];
        next.focus();
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = cards[idx - 1] || cards[cards.length - 1];
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
  qsa<HTMLElement>(searchResults, ".cr-star-btn").forEach((btn) => {
    // 预构建 SVG 常量先取到局部变量（R8 豁免：RHS=裸变量）
    const starHtml = favs.includes(btn.dataset.star || "") ? UI_ICONS.starFilled : UI_ICONS.star;
    btn.innerHTML = starHtml;
  });
}

// ============================================================
// 主函数 A：_storageSyncFn（跨标签 storage 同步分派）
// ============================================================

function cmSeMakeSyncFn(searchResults: HTMLElement): (e: StorageEvent) => void {
  return (e: StorageEvent) => {
    if (e.key === "ysm-fav-creators") {
      cmSeSyncFavButtons(searchResults);
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
    avatarCache,
    site,
    creators,
    authorCountMap,
    fillSearch,
    openUrl,
    bus: busRef,
  } = state;

  let disposed = false;
  const getDisposed = () => disposed;

  cmBbBindEmptyLocalBtn(searchResults, busRef);
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

  // P1-8 锐评：storage 监听器收进闭包——谁注册谁清理。原模块级单例在 A/B 视图快速切换时
  // A 的 cleanup 会误删 B 的监听（模块变量已指向 B）。现引用私有化，互不干扰。
  const storageSyncFn = cmSeMakeSyncFn(searchResults);
  window.addEventListener("storage", storageSyncFn);

  return () => {
    disposed = true;
    window.removeEventListener("storage", storageSyncFn);
  };
}
