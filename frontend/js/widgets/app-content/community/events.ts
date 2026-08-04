// ===== 站点视图浏览态事件绑定（从 site-view.ts 拆出，ADR-034 方向①）=====
import { bus } from "../../../bus.ts";
import { dbg } from "../../../utils/debug.ts";
import { showProgress, tryFetchModels } from "../../../features/community/data.ts";
import {
  getCreatorIdentity,
  getTagFromRole,
  parseDescTags,
  loadFavs,
  isFaved,
  toggleFav,
  type CreatorIdentityInput,
} from "./workshop-data.ts";
import { getSiteIcon, getTagIconFromRole } from "./workshop-icons.ts";
import { createCrCard, type CrCardCtx } from "./render.ts";
import { getApp } from "../../../wails/app.ts";
import type { SiteViewState, CleanupFn } from "./types.ts";

// storage 监听器模块私有变量（防泄漏，bindBrowseEvents 返回的 cleanup 会清）
let _storageSyncFn: ((e: StorageEvent) => void) | null = null;

/**
 * 绑定浏览态事件：空状态按钮 / 创作者卡片网格 / 预设搜索 / 收藏 / 头像调试 /
 * 卡片点击详情浮层 / 键盘导航 / storage 同步 / 浏览仓库模型。
 * 返回 cleanup：移除 storage 监听，供主入口在切页/重渲染时统一调用。
 */
export function bindBrowseEvents(state: SiteViewState, refreshView: () => void): CleanupFn {
  const {
    esc, searchResults, allCreators, wsEditModeRef, avatarCache,
    site, creators, authorCountMap, repoModelCache, showRepoModels,
    fillSearch, openUrl, backToSite, bus: busRef,
  } = state;

  // 无创作者时「浏览本地模型」按钮
  const emptyLocalBtn = searchResults.querySelector("[data-local-empty]");
  if (emptyLocalBtn) {
    emptyLocalBtn.addEventListener("click", () => {
      busRef.emit("nav:change", { page: "repository" });
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
      busRef.emit("toast:show", {
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
        const { DebugExtractCreatorAvatar } = await getApp();
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
        busRef.emit("toast:show", {
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
          busRef.emit("repo:search-creator", cr.name);
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
  searchResults
    .querySelectorAll(".gh-card-external[data-repo]")
    .forEach((btn) => {
      btn.addEventListener("click", async () => {
        const repo = (btn as HTMLElement).dataset.repo || "";
        btn.textContent = "⏳";

        let mirror = "";
        try {
          const { LoadAppConfig } = await getApp();
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
            btnLabel = "🌐 禔线";
          } else if (isTimeout) {
            errMsg = "⏱️ 连接超时";
            btnLabel = "⏱️ 超时";
          } else if (isRateLimited) {
            errMsg = "⏱️ GitHub API 预率限制，请稍后重试";
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
          busRef.emit("toast:show", { msg, duration: 6000, type: "warn" });
          getApp().then(({ OpenInBrowser }) =>
            OpenInBrowser("https://github.com/" + repo),
          );
        }
      });
    });

  // cleanup：移除 storage 监听
  return () => {
    if (_storageSyncFn) {
      window.removeEventListener("storage", _storageSyncFn);
      _storageSyncFn = null;
    }
  };
}
