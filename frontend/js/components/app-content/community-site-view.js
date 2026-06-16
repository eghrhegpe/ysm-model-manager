// ===== 创意工坊站点视图（为 _initWorkshop 减负） =====
import { friendlyError } from "../../utils/errors.js";
import { bus } from "../../bus.js";
import { dbg } from "../../utils/debug.js";
import { showProgress, tryFetchModels } from "../../features/community/data.js";
import { getSiteIcon, getTagIconFromRole } from "./workshop-icons.js";
import { getCreatorIdentity, getTagFromRole, parseDescTags, loadFavs, isFaved, toggleFav } from "./workshop-data.js";

/**
 * 渲染并绑定站点视图（预设搜索 + 创作者列表 + 浏览仓库 + 编辑模式）
 * @param {Object} site - 站点配置
 * @param {Object} ctx
 * @param {Function} ctx.esc - HTML 转义
 * @param {Element} ctx.searchResults - 搜索结果容器
 * @param {Element} ctx.creatorView - 创作者视图容器
 * @param {Array} ctx.allCreators - 创作者列表（可变引用）
 * @param {{ v: boolean }} ctx.wsEditModeRef - 编辑模式标记对象
 * @param {Function} ctx.showRepoModels - 显示仓库模型
 * @param {Function} ctx.fillSearch - 填充搜索模板 (tpl, q) => string
 * @param {Object} ctx.repoModelCache - 模型缓存 {}
 * @param {Function} ctx.openUrl - 按开关模式打开 URL (url) => void
 * @param {Function} ctx.backToSite - 返回站点视图的回调
 */
// ===== 创作者卡片工厂 =====
function createCrCard(cr, ctx) {
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

  const avatarHtml = hasAvatar
    ? '<img class="cr-avatar" src="' + esc(avatarCache[cr.name]) + '" data-debug-avatar="' + esc(cr.name) + '">'
    : '<div class="cr-avatar cr-avatar-fallback">' + (cr.name ? esc(cr.name.charAt(0)).toUpperCase() : "?") + "</div>";

  const localBadge = cr._fromLocal && authorCount > 0
    ? '<span class="cr-card-local-count">📁' + authorCount + "</span>"
    : cr._fromLocal
      ? '<span class="cr-card-local-count">📁</span>'
      : "";

  const platformBadges = cr.type.split(";").map(function(t) {
    return '<span class="cr-platform-badge">' + t + "</span>";
  }).join("");

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

export function renderSiteView(site, ctx) {
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
  const authorCountMap = {};
  if (repoAuthors) {
    repoAuthors.forEach((a) => {
      const name = typeof a === "string" ? a : a.Name;
      const count = typeof a === "object" ? a.Count : 0;
      authorCountMap[name] = count;
    });
  }

  // 按仓库模型数降序排列（高产创作者优先）
  creators.sort(
    (a, b) => (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0),
  );

  // 构建 HTML
  let parts = [];
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
            (ps) =>
              '<button class="cr-preset-btn" data-q="' +
              esc(ps.q || ps.label) +
              '">' +
              esc(ps.label) +
              "</button>",
          )
          .join("") +
        "</div>",
    );
  }

  // 创作者列表
  if (!wsEditModeRef.v && creators.length) {
    // 收集所有标签
    // 收藏置顶
    const faved = loadFavs();
    creators.sort((a, b) => {
      const af = faved.includes(a.name) ? 1 : 0;
      const bf = faved.includes(b.name) ? 1 : 0;
      if (af !== bf) return bf - af;
      return (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0);
    });

    const tagSet = new Set();
    creators.forEach((cr) => {
      const t = getTagFromRole(cr.role);
      if (t) tagSet.add(t);
    });
    const tags = [...tagSet];
    parts.push(
      '<div class="cr-section" style="flex-wrap:wrap">' +
        '<span class="cr-section-title-lg">🎨 活跃创作者</span>' +
        '<span class="cr-section-sub" id="ws-cr-count">(' +
        creators.length +
        ")</span>" +
        '<input type="text" id="ws-cr-search" class="cr-search-input" placeholder="搜创作者名...">' +
        '<span class="cr-section-fill"></span>' +
        '<button class="cr-fetch-btn" title="\u4ECE GitHub \u62C9\u53D6\u6700\u65B0\u521B\u4F5C\u8005 + \u7AD9\u70B9 + GitHub \u4ED3\u5E93 + \u8D44\u6E90\u7C7B\u578B">\uD83C\uDF10 \u66F4\u65B0\u914D\u7F6E</button>' +
        '<button class="cr-edit-btn">✏️ 编辑</button>' +
        "</div>" +
        '<div class="cr-tag-filter-row">' +
        '<button class="cr-tag-filter-btn active" data-tag="">🎯 全部</button>' +
        '<button class="cr-tag-filter-btn" data-tag="creator">🎮 模型创作者</button>' +
        '<button class="cr-tag-filter-btn" data-tag="official">🏠 官方IP</button>' +
        tags
          .filter((t) => t !== "creator" && t !== "official")
          .map(
            (t) =>
              '<button class="cr-tag-filter-btn" data-tag="' +
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
  } else if (wsEditModeRef.v) {
    // 🔍 搜索词编辑（即使为空也渲染，让用户能新增）
    if (site.presetSearches || !site.presetSearches) {
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
            '<span style="font-size:12px">🔍</span>' +
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
    }
    // ✏️ 创作者编辑
    parts.push(
      '<div class="cr-section">' +
        '<span class="cr-section-title-lg">✏️ 编辑创作者</span>' +
        '<span class="cr-section-fill"></span>' +
        '<button class="cr-save-btn cr-action-btn-accent">💾 保存</button>' +
        '<button class="cr-cancel-btn">取消</button>' +
        "</div>" +
        '<div class="cr-hint-text">📄 数据文件：exe 同目录下的 creators.json，可直接编辑</div>',
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

  let html = parts.join("");

  if (!site.presetSearches?.length && !creators.length && !wsEditModeRef.v) {
    html =
      '<div class="cr-empty-site">此站点无可操作内容。<br>点击「浏览器打开」访问：<br><a href="' +
      esc(site.url) +
      '" target="_blank" class="cr-site-link">' +
      esc(site.url) +
      "</a></div>";
  }

  searchResults.innerHTML = html;

  // 用工厂函数填充创作者网格（替代内联字符串）
  const grid = searchResults.querySelector("#cr-creator-grid");
  if (grid && !wsEditModeRef.v && creators.length) {
    const cardCtx = {
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
      if (site.searchUrl && openUrl) {
        openUrl(fillSearch(site.searchUrl, btn.dataset.q));
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
      const name = btn.dataset.star;
      const now = toggleFav(name);
      btn.textContent = now ? "⭐" : "☆";
      const card = btn.closest(".gh-card");
      if (card) {
        // 重新排序：收藏→移到首部，取消→移到尾部（不 remove 以免丢失事件）
        const grid = card.closest(".cr-creator-grid");
        if (now) {
          grid?.insertBefore(card, grid.firstChild);
        } else {
          grid?.appendChild(card);
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
      const name = img.dataset.debugAvatar;
      if (!name) return;
      try {
        const { DebugExtractCreatorAvatar } =
          await import("../../../wailsjs/go/main/App.js");
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
      if (
        e.target.closest(".gh-card-external[data-repo]") ||
        e.target.closest(".cr-star-btn")
      )
        return;
      const name = card.dataset.name;
      const cr = creators.find((c) => c.name === name);
      if (!cr) return;

      const overlay = document.createElement("div");
      overlay.className = "cr-detail-overlay";
      overlay.onclick = (ev) => {
        if (ev.target === overlay) overlay.remove();
      };

      const identity = getCreatorIdentity(cr);
      const descTags = parseDescTags(cr.desc);
      const isFav = isFaved(cr.name);
      const localCount = authorCountMap[cr.name] || 0;
      overlay.innerHTML =
        '<div class="cr-detail-box">' +
        '<div class="cr-detail-header">' +
        '<div class="cr-avatar-container cr-detail-avatar-container">' +
        (avatarCache && avatarCache[cr.name]
          ? '<img class="cr-avatar cr-detail-avatar-img" src="' +
            esc(avatarCache[cr.name]) +
            '" data-debug-avatar="' +
            esc(cr.name) +
            '">'
          : '<div class="cr-avatar cr-detail-avatar-text">' +
            esc(cr.name.charAt(0)).toUpperCase() +
            "</div>") +
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
        (localCount > 0
          ? '<div class="cr-detail-row cr-local-card">' +
            '<span class="cr-local-icon">📂</span>' +
            '<span class="cr-local-text">已下载 ' +
            localCount +
            " 个模型</span>" +
            '<button class="cr-local-btn" data-local>查看 →</button>' +
            "</div>"
          : "") +
        '<div class="cr-detail-row cr-detail-row-platforms">' +
        cr.type
          .split(";")
          .map(
            (t) =>
              '<span class="cr-platform-badge">' +
              getSiteIcon(t) +
              " <span>" +
              esc(t) +
              "</span>",
          )
          .join("") +
        "</div>" +
        '<div class="cr-detail-actions">' +
        '<button class="primary" data-search="' +
        esc(cr.name) +
        '">🔍 搜索更多</button>' +
        '<button class="secondary" data-close>关闭</button>' +
        "</div>" +
        "</div>";

      searchResults.getRootNode().appendChild(overlay);

      // ⭐ 浮层内的收藏
      overlay.querySelector("[data-star]")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const now = toggleFav(cr.name);
        ev.target.textContent = now ? "⭐" : "☆";
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

      const searchBtn = overlay.querySelector("[data-search]");
      if (searchBtn) {
        searchBtn.addEventListener("click", () => {
          overlay.remove();
          if (site.searchUrl && openUrl) {
            openUrl(fillSearch(site.searchUrl, searchBtn.dataset.search));
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
    crGrid.addEventListener("keydown", (e) => {
      const cards = [...crGrid.querySelectorAll(".gh-card[tabindex]")];
      const cur = document.activeElement;
      const idx = cards.indexOf(cur);
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
        cur.click();
      }
    });
  }

  // storage 事件：多标签页收藏同步（先清理再注册，防泄漏）
  if (window.__ysmStorageSync) {
    window.removeEventListener("storage", window.__ysmStorageSync);
  }
  const _storageSync = (e) => {
    if (e.key === "ysm-fav-creators") {
      const favs = loadFavs();
      searchResults.querySelectorAll(".cr-star-btn").forEach((btn) => {
        btn.textContent = favs.includes(btn.dataset.star) ? "⭐" : "☆";
      });
    }
  };
  window.__ysmStorageSync = _storageSync;
  window.addEventListener("storage", _storageSync);

  // 📦 浏览 GitHub 仓库模型
  const refreshView = () => renderSiteView(site, ctx);

  searchResults
    .querySelectorAll(".gh-card-external[data-repo]")
    .forEach((btn) => {
      btn.addEventListener("click", async () => {
        const repo = btn.dataset.repo;
        btn.textContent = "⏳";

        let mirror = "";
        try {
          const { LoadAppConfig } =
            await import("../../../wailsjs/go/main/App.js");
          const cfg = await LoadAppConfig();
          mirror = cfg.mirror || "";
        } catch (_) {}

        showProgress(searchResults, 10, "⏳ 准备中…");
        try {
          if (repoModelCache[repo]) {
            const cached = repoModelCache[repo];
            showProgress(searchResults, 100, "✅ 加载完成（缓存）");
            await new Promise((r) => setTimeout(r, 100));
            await showRepoModels(repo, cached.models, cached.source);
            btn.textContent = "📦 浏览";
            return;
          }
          const { models, source } = await tryFetchModels(
            repo,
            mirror,
            (pct, label) => showProgress(searchResults, pct, label),
          );
          repoModelCache[repo] = { models, source };
          showProgress(searchResults, 100, "✅ 加载完成");
          await new Promise((r) => setTimeout(r, 200));
          await showRepoModels(repo, models, source);
        } catch (e) {
          const isTimeout = e?.name === "AbortError";
          const isNoIndex = e?.message === "NoIndex";
          const isOffline = e?.message === "NetworkOffline";
          const isRateLimited = e?.message === "RateLimited";
          const isAllFailed = e?.message === "AllFailed";
          let errMsg, btnLabel;
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
            '<button class="btn-base sm cr-back-repo" style="margin-bottom:12px">← 返回</button>' +
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
          import("../../../wailsjs/go/main/App.js").then(({ OpenInBrowser }) =>
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
      var btn = searchResults.querySelector(".cr-fetch-btn");
      btn.textContent = "\u23F3";
      btn.disabled = true;
      try {
        var m = await import("./community-core.js");
        var results = await Promise.all([
          m.fetchCommunityCreators(m.DEFAULT_COMMUNITY_URL),
          m.fetchCommunitySites(),
          m.fetchCommunityGitHubRepos(),
          m.fetchCommunityResourceTypes(),
        ]);
        var community = results[0],
          sitesData = results[1],
          gitHubRepos = results[2],
          resourceTypes = results[3];
        var logs = [];
        var changed = false;

        if (community && community.length) {
          var r1 = m.mergeCommunityCreators(allCreators, community);
          var App = await import("../../../wailsjs/go/main/App.js");
          await App.SaveWorkshopCreators(allCreators);
          if (r1.added || r1.updated) {
            logs.push(
              "\u521B\u4F5C\u8005: +" + r1.added + " \u8865" + r1.updated,
            );
            changed = true;
          }
        }
        if (sitesData && sitesData.length) {
          var r2 = m.mergeCommunitySites(allSites, sitesData);
          if (r2.added > 0) {
            var App2 = await import("../../../wailsjs/go/main/App.js");
            await App2.SaveWorkshopSites(allSites);
            logs.push("\u7AD9\u70B9: +" + r2.added);
            changed = true;
          }
        }
        if (gitHubRepos && gitHubRepos.length) {
          logs.push("GitHub: " + gitHubRepos.length + " \u4ED3\u5E93");
          changed = true;
        }
        if (resourceTypes && resourceTypes.length) {
          logs.push("\u7C7B\u578B: " + resourceTypes.length + " \u79CD");
          changed = true;
        }

        if (changed) {
          bus.emit("toast:show", {
            msg: "\uD83C\uDF10 " + logs.join(" \u00B7 "),
            duration: 4000,
            type: "success",
          });
          refreshView();
        } else {
          bus.emit("toast:show", {
            msg: "\uD83C\uDF10 \u5DF2\u662F\u6700\u65B0\u914D\u7F6E",
            duration: 3000,
            type: "success",
          });
        }
      } catch (e) {
        const errMsg = e.message === "NetworkOffline"
          ? "🌐 无网络连接，请检查网络后重试"
          : e.message === "NoIndex"
            ? "📭 社区索引文件不存在"
            : e.message === "RateLimited"
              ? "⏱️ GitHub API 频率限制，请稍后重试"
              : "🌐 " + friendlyError(e, "拉取失败");
        bus.emit("toast:show", {
          msg: errMsg,
          duration: 5000,
          type: "error",
        });
      } finally {
        btn.textContent = "\uD83C\uDF10 \u66F4\u65B0\u914D\u7F6E";
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
            await import("../../../wailsjs/go/main/App.js");
          const newPresets = [];
          searchResults
            .querySelectorAll(
              ".cr-edit-card[data-edit='preset'] input[data-fld='label']",
            )
            .forEach((inp) => {
              const val = inp.value.trim();
              if (val) newPresets.push({ label: val });
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
          await import("../../../wailsjs/go/main/App.js");
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

  // 创作者导出
  searchResults
    .querySelector(".cr-export-btn")
    ?.addEventListener("click", async () => {
      try {
        // 导出前全量保存并校验完整性
        if (allCreators.length < 100) {
          bus.emit("toast:show", {
            msg: "❌ 数据异常：仅 " + allCreators.length + " 条，拒绝导出",
            duration: 4000,
            type: "error",
          });
          return;
        }
        const { SaveWorkshopCreators, ExportWorkshopCreatorsJSONFile } =
          await import("../../../wailsjs/go/main/App.js");
        await SaveWorkshopCreators(allCreators);
        const path = await ExportWorkshopCreatorsJSONFile();
        bus.emit("toast:show", {
          msg: "📤 已导出: " + path,
          duration: 2000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e, "导出失败"),
          duration: 4000,
          type: "error",
        });
      }
    });

  // 创作者导入
  searchResults
    .querySelector(".cr-import-btn")
    ?.addEventListener("click", async () => {
      try {
        const { LoadWorkshopCreators, SaveWorkshopCreators } =
          await import("../../../wailsjs/go/main/App.js");
        const fresh = await LoadWorkshopCreators();
        fresh.forEach((cr) => {
          if (!allCreators.find((c) => c.name === cr.name)) {
            allCreators.push(cr);
          }
        });
        if (allCreators.length < 100) {
          bus.emit("toast:show", {
            msg:
              "❌ 合并后数据异常（" + allCreators.length + " 条），已取消保存",
            duration: 4000,
            type: "error",
          });
          // 从文件重新加载
          allCreators.length = 0;
          allCreators.push(...fresh);
          return;
        }
        wsEditModeRef.v = false;
        bus.emit("toast:show", {
          msg: "✅ 已合并导入，共 " + allCreators.length + " 位创作者",
          duration: 2000,
          type: "success",
        });
        refreshView();
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e, "导入失败"),
          duration: 4000,
          type: "error",
        });
      }
    });

  // 行内编辑
  searchResults.querySelectorAll("[data-idx][data-fld]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const idx = parseInt(inp.dataset.idx, 10);
      if (creators[idx]) {
        if (inp.tagName === "SELECT") {
          creators[idx][inp.dataset.fld] = Array.from(inp.selectedOptions)
            .map((o) => o.value)
            .filter(Boolean)
            .join(";");
        } else {
          creators[idx][inp.dataset.fld] = inp.value.trim();
        }
      }
    });
  });

  // 删除创作者
  searchResults.querySelectorAll(".cr-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncAllEditInputs();
      const idx = parseInt(btn.dataset.idx, 10);
      if (creators[idx]) {
        const realIdx = allCreators.indexOf(creators[idx]);
        if (realIdx >= 0) allCreators.splice(realIdx, 1);
        refreshView();
      }
    });
  });

  // 创作者拖拽排序 — 仅拖拽柄触发
  let dragSrcIdx = -1;
  let dragState = null; // { card, el, originalLeft, originalTop, rect }
  searchResults
    .querySelectorAll(".cr-edit-card:not([data-edit='preset'])")
    .forEach((card) => {
      const handle = card.querySelector(".cr-drag-handle");
      if (!handle) return;
      // 点拖拽柄时暂时让卡片可拖拽
      handle.addEventListener("mousedown", () => {
        card.draggable = true;
      });
      card.addEventListener("dragstart", (e) => {
        card.draggable = false;
        dragSrcIdx = parseInt(card.dataset.editIdx, 10);
        card.classList.add("cr-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("cr-dragging");
        card.draggable = false;
        searchResults.querySelectorAll(".cr-edit-card").forEach((c) => {
          c.classList.remove("cr-drag-target","cr-drag-before","cr-drag-after");
        });
      });
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });
      card.addEventListener("dragenter", (e) => {
        e.preventDefault();
        card.classList.add("cr-drag-target");
        if (dragSrcIdx >= 0) {
          const tgt = parseInt(card.dataset.editIdx, 10);
          if (dragSrcIdx < tgt) {
            card.classList.add("cr-drag-before");
          } else if (dragSrcIdx > tgt) {
            card.classList.add("cr-drag-after");
          }
        }
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("cr-drag-target","cr-drag-before","cr-drag-after");
      });
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("cr-drag-target");
        const targetIdx = parseInt(card.dataset.editIdx, 10);
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
        card.draggable = true;
      });
      card.addEventListener("dragstart", (e) => {
        card.draggable = false;
        dragPresetSrcIdx = parseInt(card.dataset.editIdx, 10);
        card.classList.add("cr-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("cr-dragging");
        card.draggable = false;
        searchResults.querySelectorAll(".cr-edit-card").forEach((c) => {
          c.classList.remove("cr-drag-target","cr-drag-before","cr-drag-after");
        });
      });
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });
      card.addEventListener("dragenter", (e) => {
        e.preventDefault();
        card.classList.add("cr-drag-target");
        if (dragPresetSrcIdx >= 0) {
          const tgt = parseInt(card.dataset.editIdx, 10);
          if (dragPresetSrcIdx < tgt) {
            card.classList.add("cr-drag-before");
          } else if (dragPresetSrcIdx > tgt) {
            card.classList.add("cr-drag-after");
          }
        }
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("cr-drag-target","cr-drag-before","cr-drag-after");
      });
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("cr-drag-target");
        const targetIdx = parseInt(card.dataset.editIdx, 10);
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
  function syncAllEditInputs() {
    // 同步创作者输入框
    searchResults
      .querySelectorAll(
        ".cr-edit-card:not([data-edit='preset']) [data-idx][data-fld]",
      )
      .forEach((inp) => {
        const idx = parseInt(inp.dataset.idx, 10);
        if (creators[idx]) {
          if (inp.tagName === "SELECT") {
            creators[idx][inp.dataset.fld] = Array.from(inp.selectedOptions)
              .map((o) => o.value)
              .filter(Boolean)
              .join(";");
          } else {
            creators[idx][inp.dataset.fld] = inp.value.trim();
          }
        }
      });
    // 同步搜索词输入框
    searchResults
      .querySelectorAll(
        ".cr-edit-card[data-edit='preset'] input[data-fld='label']",
      )
      .forEach((inp) => {
        const idx = parseInt(inp.dataset.idx, 10);
        if (site.presetSearches && site.presetSearches[idx]) {
          site.presetSearches[idx].label = inp.value.trim();
        }
      });
  }
  // 删除搜索词
  searchResults.querySelectorAll(".cr-del-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncAllEditInputs();
      const idx = parseInt(btn.dataset.idx, 10);
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
      const idx = parseInt(btn.dataset.idx, 10);
      if (site.presetSearches && idx > 0) {
        [site.presetSearches[idx - 1], site.presetSearches[idx]] = [
          site.presetSearches[idx],
          site.presetSearches[idx - 1],
        ];
        refreshView();
      }
    });
  });
  searchResults.querySelectorAll(".cr-order-down").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncAllEditInputs();
      const idx = parseInt(btn.dataset.idx, 10);
      if (site.presetSearches && idx < site.presetSearches.length - 1) {
        [site.presetSearches[idx], site.presetSearches[idx + 1]] = [
          site.presetSearches[idx + 1],
          site.presetSearches[idx],
        ];
        refreshView();
      }
    });
  });

  // 新增创作者
  searchResults.querySelector(".cr-add")?.addEventListener("click", () => {
    syncAllEditInputs();
    creators.push({ name: "新作者", desc: "描述", type: site.id, tag: "" });
    allCreators.push(creators[creators.length - 1]);
    refreshView();
  });
  // 新增搜索词
  searchResults
    .querySelector(".cr-add-preset")
    ?.addEventListener("click", () => {
      syncAllEditInputs();
      if (!site.presetSearches) site.presetSearches = [];
      site.presetSearches.push({ label: "" });
      refreshView();
    });

  // 🔍 创作者搜索 + 标签过滤
  let _activeTag = "";
  const applyFilters = () => {
    const kw = (searchInput?.value || "").trim().toLowerCase();
    const cards = searchResults.querySelectorAll(".gh-card[data-name]");
    let visible = 0;
    cards.forEach((card) => {
      const name = (card.dataset.name || "").toLowerCase();
      const desc = (
        card.querySelector(".cr-card-desc")?.textContent || ""
      ).toLowerCase();
      const cardTag = (card.dataset.tag || "").toLowerCase();
      const matchName = !kw || name.includes(kw) || desc.includes(kw);
      const matchTag = !_activeTag || _activeTag === cardTag;
      card.style.display = matchName && matchTag ? "" : "none";
      if (matchName && matchTag) visible++;
    });
    const countEl = searchResults.querySelector("#ws-cr-count");
    if (countEl) countEl.textContent = "(" + visible + "/" + cards.length + ")";
  };

  const searchInput = searchResults.querySelector("#ws-cr-search");
  if (searchInput) {
    searchInput.addEventListener("input", applyFilters);
  }

  // 标签筛选按钮
  searchResults.querySelectorAll(".cr-tag-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      _activeTag = btn.dataset.tag || "";
      searchResults
        .querySelectorAll(".cr-tag-filter-btn")
        .forEach((b) => b.classList.toggle("active", b === btn));
      applyFilters();
    });
  });
}
