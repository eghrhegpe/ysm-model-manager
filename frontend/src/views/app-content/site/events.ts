// ===== 站点视图浏览态事件绑定（从 site-view.ts 拆出，ADR-034 方向①）=====

import type { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { isDevMode } from "@/utils/debug/dev-mode.ts";
import { deepActiveElement, deepActiveElementOf } from "@/utils/dom/deep-active-element.ts";
import { qs, qsa } from "@/utils/dom/qsa.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { trapFocusAcrossShadow } from "@/utils/dom/trap-focus-across-shadow.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
// 视图片段单源（ADR-034-d1）：头像/星标/身份 tag/平台徽章与卡片共用同一份标记代码
import {
  creatorAvatarHtml,
  creatorPlatformBadgesHtml,
  creatorStarBtnHtml,
  creatorTagChipHtml,
} from "./render.ts";
import type { CleanupFn, LocalCreatorLike, SiteViewState } from "./types.ts";
import type { BrowseMode } from "./workshop-browse-mode.ts";
import {
  type CreatorIdentityInput,
  compareFavFirst,
  FAV_CREATORS_KEY,
  getCreatorIdentity,
  getTagFromRole,
  isFaved,
  loadFavs,
  parseDescTags,
  toggleFav,
} from "./workshop-data.ts";

// storage 监听器引用收进 bindBrowseEvents 闭包随 cleanup 返回——谁注册谁清理。
// 模块级单例会被后一个视图覆盖，导致先注册者的 cleanup 误删后者的监听。

// 浮层焦点陷阱释放函数注册表：aria-modal 声明了模态就必须有 trapFocus，且**所有**关闭路径
// （data-close / data-search / Esc / 遮罩点击）都要释放，否则 doc keydown 监听残留。
// WeakMap 随元素 GC 回收，不污染 HTMLElement 全局类型。
const _overlayTrapReleases = new WeakMap<HTMLElement, () => void>();

// ============================================================
// cmCr* 共用包级函数：详情浮层创建 + 内部 4 子事件绑定
// ============================================================

/**
 * 详情浮层 HTML（ADR-034-d1）：头像 / 星标 / 身份 tag / 平台徽章四段全部走 render.ts 的
 * **片段单源**，浮层只保留自己的布局与变体 class——**不要在此重写标记**（详见知识卡 §不变量）。
 */
function cmCrBuildDetailHtml(
  cr: LocalCreatorLike,
  esc: (s: unknown) => string,
  avatarCache: Record<string, string> | undefined,
  authorCountMap: Record<string, number>,
): { html: string; fallbackChar: string } {
  const identity = getCreatorIdentity(cr as CreatorIdentityInput);
  // 身份行只在 role 能映射到真实身份时渲染（否则 chip 显示原样 role、身份行显示「YSM 创作者」，
  // 同一浮层自相矛盾）。本式是**往返校验**，不可「简化」成 identity.tag 的真值判断：
  // 缺省 role → getTagFromRole 补 "creator" → 与 identity.tag 相等 → 已知身份（渲染该行）；
  // 未知 role（如 "modeler"）→ 两侧不等 → 整行省略，而非改成回退文案（不冒充别的身份）。
  const showIdentityRow = identity.tag === getTagFromRole(cr.role);
  const descTags = parseDescTags(cr.desc);
  const localCount = authorCountMap[cr.name] || 0;
  const { html: avatarHtml, fallbackChar } = creatorAvatarHtml(cr.name, avatarCache, esc, {
    imgClass: "cr-avatar cr-detail-avatar-img",
    fallbackClass: "cr-avatar cr-detail-avatar-text",
    // 浮层自持 img 引用直接绑 error（见 cmCrCreateDetailOverlay），不走声明式属性
    withFallbackAttr: false,
  });
  const html =
    `<div class="cr-detail-box">` +
    `<div class="cr-detail-header">` +
    `<div class="cr-avatar-container cr-detail-avatar-container">${avatarHtml}</div>` +
    `<div class="cr-detail-fill">` +
    `<div class="cr-detail-name-row"><span class="cr-detail-name">${esc(
      cr.name,
    )}</span>${cr.role ? creatorTagChipHtml(cr.role, esc) : ""}</div>` +
    (cr.type
      ? `<div class="cr-detail-platforms">${creatorPlatformBadgesHtml(cr.type, esc)}</div>`
      : "") +
    (showIdentityRow
      ? `<div class="cr-detail-identity">${identity.icon}<span>${esc(identity.label)}</span></div>`
      : "") +
    `</div>` +
    creatorStarBtnHtml(cr.name, isFaved(cr.name), esc) +
    `</div>` +
    `<div class="cr-detail-desc">${
      descTags.length
        ? descTags.map((tag) => `<span class="cr-desc-tag">#${esc(tag)}</span>`).join("")
        : // descTags 仅在确为标签串时非空，此分支即**全文兜底**（不得只渲染 chips 而丢弃原文）；
          // 本地条目空 desc 在此现取当前语言提示，而非数据层落 i18n 串（详见知识卡 §不变量）。
          esc(cr.desc || (cr._fromLocal ? t("community.fromLocal") : ""))
    }</div>` +
    `<div class="cr-detail-row cr-local-card">` +
    `<span class="cr-local-icon">${UI_ICONS.folderOpen}</span>` +
    `<span class="cr-local-text">${t("content.downloadedModels", { n: localCount })}</span>` +
    `<button class="cr-local-btn" data-local>${t("content.viewArrow")}</button>` +
    `</div>` +
    `<div class="cr-detail-actions">` +
    `<button class="secondary" data-search="${esc(cr.name)}">${t(
      "content.searchMoreModels",
    )}</button>` +
    `<button class="secondary" data-close>${t("common.close")}</button>` +
    `</div>` +
    `</div>`;
  return { html, fallbackChar };
}

function cmCrBindOverlayEvents(
  overlay: HTMLDivElement,
  cr: LocalCreatorLike,
  searchResults: HTMLElement,
  site: { searchUrl?: string },
  openUrl: ((url: string) => void) | undefined,
  fillSearch: (tpl: string, q: string) => string,
  busRef: typeof bus,
  authorCountMap: Record<string, number>,
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
    // 同卡片路径：浮层星标也须同步 aria-pressed（2026-10-15 a11y）
    overlayStar?.setAttribute("aria-pressed", String(now));
    const cardStar = searchResults.querySelector(
      `.cr-star-btn[data-star="${CSS.escape(cr.name)}"]`,
    );
    if (cardStar) cardStar.innerHTML = starHtml;
    // 收藏序就地重排（锐评高危修复，2026-10-14）。病：本handler 只改两处星标图标、
    // **不调 cmCrReorderCard**，而卡片星标路径（cmBbBindStarBtns）调了——同仓两条收藏
    // 路径行为不对称。用户点开详情浮层 → 浮层内点星标 → toast 说成功 → 关浮层，
    // 卡片仍留在原位而非跳到收藏区首位：星标实心但位置未置顶，UI 自相矛盾，
    // 且错乱持续到下一次整树重渲染（切tab / 进编辑态）才自愈。
    // 违反知识卡 app-content-site.md「渲染排序与就地重排同口径」不变量。
    const card = cardStar?.closest(".gh-card");
    const grid = card?.closest(".cr-creator-grid");
    if (card instanceof HTMLElement && grid instanceof HTMLElement) {
      cmCrReorderCard(grid, card, authorCountMap);
    }
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
  // 深焦解析取触发元素：网格在 shadow root 内，document.activeElement 是 host，
  // 直接取会让「关闭浮层后焦点归还触发卡片」失效（归还到 host = 用户视觉上丢失焦点）。
  const openerEl = deepActiveElement();
  const opener = openerEl instanceof HTMLElement ? openerEl : null;
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

function cmBbBindStarBtns(
  searchResults: HTMLElement,
  authorCountMap: Record<string, number>,
  busRef: typeof bus,
): void {
  qsa<HTMLElement>(searchResults, ".cr-star-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = btn.dataset.star || "";
      const now = toggleFav(name);
      // 预构建 SVG 常量先取到局部变量（R8 豁免：RHS=裸变量，无三元/拼接）
      const starHtml = now ? UI_ICONS.starFilled : UI_ICONS.star;
      btn.innerHTML = starHtml;
      // 2026-10-15 a11y：aria-pressed 与视觉双态同步——只换 SVG 会让读屏播报陈旧收藏态
      btn.setAttribute("aria-pressed", String(now));
      const card = btn.closest(".gh-card");
      const grid = card?.closest(".cr-creator-grid");
      if (card instanceof HTMLElement && grid instanceof HTMLElement) {
        cmCrReorderCard(grid, card, authorCountMap);
      }
      busRef.emit("toast:show", {
        msg: now ? t("content.favAddedName", { name }) : t("content.favRemovedName", { name }),
        duration: TOAST_MS.quick,
        type: "success",
      });
    });
  });
}

/**
 * 收藏状态变更后，就地把该卡片移动到**规则应处的位次**。
 * 用同一比较器（workshop-data.ts|compareFavFirst 单源）重排，**不得手写「收藏插队首 /
 * 取消收藏扔队尾」**——那与渲染期排序反向，高产创作者取消收藏会被沉到队尾。
 * 只搬运被点的那一张卡（其余节点不动），保滚动位置与展开态；用 insertBefore(anchor)
 * 表达目标位次，避免 appendChild 盲插。
 */
function cmCrReorderCard(
  grid: HTMLElement,
  card: HTMLElement,
  authorCountMap: Record<string, number>,
): void {
  const faved = loadFavs();
  const cardName = card.dataset.name || "";
  // 目标位次 = 在「其余卡 + 本卡」的全量序里，本卡应排第几。比较器与渲染期完全一致。
  const rankOf = (el: HTMLElement): number => {
    const elName = el.dataset.name || "";
    const self = { name: elName };
    const thisCard = { name: cardName };
    return compareFavFirst(self, thisCard, faved, authorCountMap);
  };
  // 找到第一张「排在本卡之后」的卡，插到它前面；本卡应在最后则 appendChild。
  const others = qsa<HTMLElement>(grid, ".gh-card").filter((el) => el !== card);
  const anchor = others.find((el) => rankOf(el) > 0);
  if (anchor) {
    grid.insertBefore(card, anchor);
  } else {
    grid.appendChild(card);
  }
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

/**
 * 头像节点绑定：error→字母 fallback 恒绑（功能性降级，破图不留）；
 * **调试提取探针只在 `isDevMode()` 下绑**——非开发态根本不绑 click，让点击冒泡回卡片开浮层。
 * 探针会触发 Go 侧整库 ScanModelEntries，生产态既无可见反馈又付全库扫描代价，其 stopPropagation
 * 还会吞掉正常的卡片点击。⚠️ 门必须用 `isDevMode()`（默认关）；`isDebugEnabled()` 默认开，门等于没关。
 */
function cmBbBindDebugAvatar(searchResults: HTMLElement, getDisposed: () => boolean): void {
  qsa<HTMLElement>(searchResults, "[data-debug-avatar]").forEach((img) => {
    // 头像加载失败 → 字母 fallback（声明式 data-avatar-fallback 属性；单点实现见 bindAvatarFallback）
    if (img instanceof HTMLImageElement && img.dataset.avatarFallback) {
      bindAvatarFallback(img, "cr-avatar cr-avatar-fallback", img.dataset.avatarFallback);
    }
    if (!isDevMode()) return; // 生产态不绑 click：点击冒泡到卡片，正常打开详情浮层
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
      cmCrBindOverlayEvents(
        overlay,
        cr,
        searchResults,
        site,
        openUrl,
        fillSearch,
        busRef,
        authorCountMap,
      );
    });
  });
}

/** 网格方向键 + Enter/Space 键导航 handler（深焦解析 + 循环焦点） */
function makeGridKeydownHandler(crGrid: HTMLElement): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    const cards = qsa<HTMLElement>(crGrid, ".gh-card[tabindex]");
    // 深焦解析：网格在 app-content 的 shadow root 内，DOM retargeting 下 document.activeElement
    // 返回的是 **shadow host** 而非内层卡片 → cards.indexOf(cur) 恒 -1，方向键与 Enter/Space
    // 全线早退。必须走 utils/dom/deep-active-element.ts（单源出口，勿直读 document.activeElement）。
    const cur = deepActiveElementOf(cards);
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
  };
}

function cmBbBindKeyboardNav(searchResults: HTMLElement): void {
  const crGrid = searchResults.querySelector<HTMLElement>(".cr-creator-grid");
  if (crGrid) {
    crGrid.addEventListener("keydown", makeGridKeydownHandler(crGrid) as EventListener);
  }
}

// ============================================================
// cmSe* 包级函数：_storageSyncFn 子函数（跨标签同步处理）
// ============================================================

function cmSeSyncFavButtons(
  searchResults: HTMLElement,
  authorCountMap: Record<string, number>,
): void {
  const favs = loadFavs();
  // 收藏态变动的卡片收集：跨标签同步后需就地重排（锐评中危修复，2026-10-14）。
  // 病：原实现只写星标 innerHTML，与同标签的 cmBbBindStarBtns 路径**行为不对称**——
  // 用户在窗口 A 收藏，窗口 B 收到 storage 事件 → 星标变实心但卡片不动，
  // 用户视角「收藏没生效」，直到切 tab 才重排。同违反 app-content-site.md
  // 「渲染排序与就地重排同口径」不变量。
  const moved = new Set<HTMLElement>();
  qsa<HTMLElement>(searchResults, ".cr-star-btn").forEach((btn) => {
    // 预构建 SVG 常量先取到局部变量（R8 豁免：RHS=裸变量）
    const isFav = favs.includes(btn.dataset.star || "");
    const starHtml = isFav ? UI_ICONS.starFilled : UI_ICONS.star;
    btn.innerHTML = starHtml;
    btn.setAttribute("aria-pressed", String(isFav)); // 跨标签同步同样要正 a11y 状态
    const card = btn.closest(".gh-card");
    if (card instanceof HTMLElement) moved.add(card);
  });
  const grid = searchResults.querySelector(".cr-creator-grid");
  if (grid instanceof HTMLElement) {
    // 逐张就地重排（比较器与渲染期同源，见 cmCrReorderCard）；moved 去重防同一卡多个星标按钮
    for (const card of moved) {
      cmCrReorderCard(grid, card, authorCountMap);
    }
  }
}

// ============================================================
// 主函数 A：_storageSyncFn（跨标签 storage 同步分派）
// ============================================================

function cmSeMakeSyncFn(
  searchResults: HTMLElement,
  authorCountMap: Record<string, number>,
): (e: StorageEvent) => void {
  return (e: StorageEvent) => {
    if (e.key === FAV_CREATORS_KEY) {
      cmSeSyncFavButtons(searchResults, authorCountMap);
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
  cmBbBindStarBtns(searchResults, authorCountMap, busRef);
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

  // storage 监听器收进闭包：谁注册谁清理（模块级单例会被后一个视图覆盖，见文件头）
  const storageSyncFn = cmSeMakeSyncFn(searchResults, authorCountMap);
  window.addEventListener("storage", storageSyncFn);

  return () => {
    disposed = true;
    window.removeEventListener("storage", storageSyncFn);
  };
}
