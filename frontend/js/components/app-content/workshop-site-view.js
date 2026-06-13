// ===== 创意工坊站点视图（为 _initWorkshop 减负） =====
import { friendlyError } from "../../utils/errors.js";
import { bus } from "../../bus.js";
import { showProgress, tryFetchModels } from "../../features/workshop/data.js";

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
// ===== 收藏工具 =====
const STORAGE_KEY = "ysm-fav-creators";
function loadFavs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveFavs(names) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
}
function isFaved(name) {
  return loadFavs().includes(name);
}
function toggleFav(name) {
  const favs = loadFavs();
  const idx = favs.indexOf(name);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push(name);
  saveFavs(favs);
  return idx < 0; // true=now faved
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
      '<div class="cr-section" style="display:flex;align-items:center;gap:6px">' +
        '<span class="cr-section-title-lg">🔍 网页搜索词</span>' +
        '<span class="cr-section-sub">(' +
        site.presetSearches.length +
        ")</span>" +
        '<span style="flex:1"></span>' +
        '<button id="cr-mode-toggle" class="cr-mode-switch" style="font-size:10px;padding:1px 4px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-family:inherit;display:inline-flex;align-items:center">' +
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
      if (cr.tag) tagSet.add(cr.tag);
    });
    const tags = [...tagSet];
    parts.push(
      '<div class="cr-section" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<span class="cr-section-title-lg">🎨 活跃创作者</span>' +
        '<span class="cr-section-sub" id="ws-cr-count">(' +
        creators.length +
        ")</span>" +
        '<input type="text" id="ws-cr-search" placeholder="搜创作者名..." ' +
        'style="flex:1;min-width:120px;max-width:160px;padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-xs);font-family:inherit;outline:none">' +
        '<span style="flex:1"></span>' +
        '<button class="cr-fetch-btn cr-action-btn" style="margin-left:auto" title="从 GitHub 社区索引拉取最新创作者">🌐 社区</button>' +
        '<button class="cr-edit-btn cr-action-btn cr-action-btn-muted">✏️ 编辑</button>' +
        "</div>" +
        '<div class="cr-tag-filter-row">' +
        '<button class="cr-tag-filter-btn active" data-tag="">🎯 全部</button>' +
        '<button class="cr-tag-filter-btn" data-tag="game">🎮 游戏模型</button>' +
        tags
          .map(
            (t) =>
              '<button class="cr-tag-filter-btn" data-tag="' +
              esc(t) +
              '">' +
              (t === "vup" ? "🎤" : t === "oc" ? "🎨" : "🏷️") +
              " " +
              esc(t) +
              "</button>",
          )
          .join("") +
        "</div>",
    );
    parts.push(
      '<div class="cr-creator-grid" style="display:flex;flex-wrap:wrap;gap:6px;width:100%">' +
        creators
          .map((cr, _, arr) => {
            const isGitHub = cr.type && cr.type.includes("github");
            const repoParts = isGitHub ? cr.name.split("/") : null;
            const hasRepo = isGitHub && repoParts && repoParts.length >= 2;
            const authorCount = authorCountMap[cr.name] || 0;
            // 按模型数排百分比：前10%金、前25%银，其余蓝色静态细边
            const sorted = [...arr].sort(
              (a, b) =>
                (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0),
            );
            const idx = sorted.indexOf(cr);
            const pct = sorted.length > 1 ? idx / (sorted.length - 1) : 0;
            const tier =
              pct < 0.1
                ? {
                    border: "#D4A017",
                    glow: "rgba(212,160,23,0.4)",
                    rank: "gold",
                  }
                : pct < 0.25
                  ? {
                      border: "#9E9E9E",
                      glow: "rgba(158,158,158,0.25)",
                      rank: "silver",
                    }
                  : { border: "#6B9FFF", glow: "transparent", rank: "" };
            const spinAttr = tier.rank ? ' data-spin="' + tier.rank + '"' : "";
            return (
              '<div class="gh-card" tabindex="0" style="min-width:200px;max-width:280px;flex:1 1 200px;cursor:pointer;animation:card-in .3s ease-out both;animation-delay:' +
              idx * 0.03 +
              's" data-name="' +
              esc(cr.name) +
              '" data-tag="' +
              esc(cr.tag || "game") +
              '" title="搜索: ' +
              esc(cr.name) +
              '">' +
              '<div class="cr-avatar-container" style="position:relative;display:inline-flex;flex-shrink:0;align-self:flex-start;margin:6px 0 0 6px">' +
              '<div class="cr-avatar-ring"' +
              spinAttr +
              ' style="background:conic-gradient(from var(--grad-rot,0deg),' +
              tier.border +
              ",transparent 60%," +
              tier.border +
              ");box-shadow:0 0 6px " +
              tier.glow +
              '"></div>' +
              '<div class="cr-avatar" style="width:28px;height:28px;font-size:12px">' +
              (cr.name ? esc(cr.name.charAt(0)).toUpperCase() : "?") +
              "</div>" +
              "</div>" +
              '<div class="gh-card-body">' +
              '<div class="gh-card-label name">' +
              esc(cr.name) +
              '<span class="cr-star-btn" style="cursor:pointer;font-size:11px;margin-left:auto;flex-shrink:0" data-star="' +
              esc(cr.name) +
              '">' +
              (isFaved(cr.name) ? "⭐" : "☆") +
              "</span>" +
              (cr._fromLocal && authorCount > 0
                ? '<span style="font-size:9px;color:var(--muted);margin-left:auto">📁' + authorCount + "</span>"
                : cr._fromLocal
                ? '<span style="font-size:9px;color:var(--muted);margin-left:auto">📁</span>'
                : "") +
              "</div>" +
              '<div class="gh-card-desc">' +
              esc(cr.desc) +
              "</div>" +
              '<div class="hm-label" style="margin-top:1px;display:flex;gap:2px;flex-wrap:wrap">' +
              cr.type
                .split(";")
                .map(
                  (t) =>
                    '<span class="cr-platform-badge" style="display:none">' +
                    t +
                    "</span>",
                )
                .join("") +
              "</div>" +
              (cr.tag
                ? '<span class="cr-tag cr-tag-' +
                  esc(cr.tag) +
                  '">' +
                  (cr.tag === "vup" ? "🎤" : cr.tag === "oc" ? "🎨" : "🏷️") +
                  " " +
                  esc(cr.tag) +
                  "</span>"
                : '<span class="cr-tag cr-tag-game">🎮 game</span>') +
              "</div>" +
              (hasRepo
                ? '<button class="gh-card-external" style="width:auto;padding:0 6px;border-left:1px solid var(--bd);font-size:9px;color:var(--accent)" data-repo="' +
                  esc(cr.name) +
                  '">📦</button>'
                : "") +
              "</div>"
            );
          })
          .join("") +
        "</div>",
    );
  } else if (wsEditModeRef.v) {
    // 🔍 搜索词编辑
    if (site.presetSearches) {
      parts.push(
        '<div class="cr-section">' +
          '<span class="cr-section-title-lg">🔍 搜索词</span>' +
          "</div>",
      );
      site.presetSearches.forEach((ps, idx) => {
        parts.push(
          '<div class="cr-row">' +
            "<span>🔍</span>" +
            '<input data-idx="' +
            idx +
            '" data-fld="label" value="' +
            esc(ps.label) +
            '" class="cr-input cr-input-name">' +
            '<button data-idx="' +
            idx +
            '" class="cr-del-preset">🗑️</button>' +
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
        '<span style="flex:1"></span>' +
        '<button class="cr-save-btn cr-action-btn cr-action-btn-accent">💾 保存</button>' +
        '<button class="cr-cancel-btn cr-action-btn cr-action-btn-muted">取消</button>' +
        "</div>" +
        '<div class="cr-hint-text">📄 数据文件：exe 同目录下的 creators.json，可直接编辑</div>',
    );
    creators.forEach((cr, idx) => {
      parts.push(
        '<div class="cr-row" style="flex-wrap:wrap">' +
          "<span>🎨</span>" +
          '<input data-idx="' +
          idx +
          '" data-fld="name" value="' +
          esc(cr.name) +
          '" class="cr-input cr-input-name" style="min-width:80px">' +
          '<input data-idx="' +
          idx +
          '" data-fld="desc" value="' +
          esc(cr.desc) +
          '" class="cr-input cr-input-desc">' +
          '<select data-idx="' +
          idx +
          '" data-fld="type" class="cr-input-type" multiple style="width:130px;height:60px;padding:2px 4px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-xs);font-family:inherit" title="Ctrl+点击多选">' +
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
          "  </select>" +
          '<input data-idx="' +
          idx +
          '" data-fld="tag" value="' +
          esc(cr.tag || "") +
          '" class="cr-input-tag" placeholder="标签: game/vtuber/..." style="width:90px">' +
          '<button data-idx="' +
          idx +
          '" class="cr-del">🗑️</button>' +
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

  // 预设搜索按钮
  searchResults.querySelectorAll(".cr-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (site.searchUrl && openUrl) {
        openUrl(fillSearch(site.searchUrl, btn.dataset.q));
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
        // 重新排序：移除再插入首部/尾部
        const grid = card.closest(".cr-creator-grid");
        if (now) {
          grid?.insertBefore(card, grid.firstChild);
        } else {
          card.remove();
        }
      }
      bus.emit("toast:show", {
        msg: now ? "⭐ 已收藏 " + name : "取消收藏 " + name,
        duration: 1500,
        type: "success",
      });
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

      const tagEmoji = cr.tag === "vup" ? "🎤" : cr.tag === "oc" ? "🎨" : "🎮";
      const platformIcons = {
        bilibili: "📺",
        afdian: "❤️",
        github: "🐙",
        mzhouse: "🏠",
        bowlroll: "🍚",
        vroid: "🤖",
        nicovideo: "🧊",
        deviantart: "🎨",
      };
      const platformLinks = {
        bilibili: "https://search.bilibili.com/all?keyword=",
        afdian: "https://afdian.com/search?q=",
        github: "https://github.com/search?q=",
        nicovideo: "https://3d.nicovideo.jp/works/search?keyword=",
      };

      const isFav = isFaved(cr.name);
      overlay.innerHTML =
        '<div class="cr-detail-box">' +
        '<div class="cr-detail-header">' +
        '<div class="cr-avatar-container" style="width:32px;height:32px;margin:0">' +
        '<div class="cr-avatar" style="width:32px;height:32px;font-size:14px">' +
        esc(cr.name.charAt(0)).toUpperCase() +
        "</div>" +
        "</div>" +
        '<span class="cr-detail-name">' +
        esc(cr.name) +
        "</span>" +
        (cr.tag
          ? '<span class="cr-tag cr-tag-' +
            esc(cr.tag) +
            '">' +
            tagEmoji +
            " " +
            esc(cr.tag) +
            "</span>"
          : '<span class="cr-tag cr-tag-game">🎮 game</span>') +
        '<span class="cr-star-btn" style="cursor:pointer;font-size:14px;margin-left:auto" data-star="' +
        esc(cr.name) +
        '">' +
        (isFav ? "⭐" : "☆") +
        "</span>" +
        "</div>" +
        '<div class="cr-detail-desc">' +
        esc(cr.desc) +
        "</div>" +
        '<div class="cr-detail-row">📦 本地模型: <b>' +
        (authorCountMap[cr.name] || 0) +
        "</b></div>" +
        '<div class="cr-detail-row">🔗 平台: ' +
        cr.type
          .split(";")
          .map(
            (t) =>
              '<span class="cr-platform-badge">' +
              (platformIcons[t] || "🔗") +
              " " +
              esc(t) +
              "</span>",
          )
          .join(" ") +
        "</div>" +
        '<div class="cr-detail-actions">' +
        (authorCountMap[cr.name] > 0
          ? '<button class="primary" data-local>' +
            authorCountMap[cr.name] +
            " 个本地模型</button>"
          : "") +
        '<button class="primary" data-search="' +
        esc(cr.name) +
        '">🔍 平台搜索</button>' +
        '<button class="secondary" data-close>关闭</button>' +
        "</div>" +
        "</div>";

      document.body.appendChild(overlay);

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

  // storage 事件：多标签页收藏同步
  const _storageSync = (e) => {
    if (e.key === STORAGE_KEY) {
      // 刷新所有收藏按钮的状态
      const favs = loadFavs();
      searchResults.querySelectorAll(".cr-star-btn").forEach((btn) => {
        btn.textContent = favs.includes(btn.dataset.star) ? "⭐" : "☆";
      });
    }
  };
  window.addEventListener("storage", _storageSync);
  // 清理（renderSiteView 每次被调用都会重建，旧的 listener 会被 GC）

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
          btn.textContent = isTimeout ? "⏱️ 超时" : "❌ 无索引";
          btn.style.color = "var(--muted)";
          btn.style.cursor = "default";
          searchResults.innerHTML =
            '<div class="cr-error-page">' +
            '<button class="cr-back-repo cr-back-btn" style="margin-bottom:12px">← 返回</button>' +
            '<div class="cr-error-msg">' +
            (isTimeout
              ? "⏱️ 连接超时"
              : "❌ 无 index.json<br>" +
                "此仓库尚未建立创意工坊索引，请你使用浏览器下载。<br>" +
                '<span class="cr-error-hint">（这个仓库需要有 index.json 文件，才能调用 API 下载文件）</span>') +
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
          window.open("https://github.com/" + repo, "_blank");
        }
      });
    });

  // ===== 创作者编辑模式 =====
  searchResults.querySelector(".cr-edit-btn")?.addEventListener("click", () => {
    wsEditModeRef.v = true;
    refreshView();
  });

  // 🌐 拉取社区索引
  searchResults
    .querySelector(".cr-fetch-btn")
    ?.addEventListener("click", async () => {
      const btn = searchResults.querySelector(".cr-fetch-btn");
      btn.textContent = "⏳";
      btn.disabled = true;
      try {
        const {
          fetchCommunityCreators,
          mergeCommunityCreators,
          DEFAULT_COMMUNITY_URL,
        } = await import("./workshop-core.js");
        const community = await fetchCommunityCreators(DEFAULT_COMMUNITY_URL);
        if (!community.length) {
          bus.emit("toast:show", {
            msg: "🌐 社区索引为空或加载失败",
            duration: 3000,
            type: "warn",
          });
          return;
        }
        const { added, updated } = mergeCommunityCreators(
          allCreators,
          community,
        );
        // 保存到本地
        const { SaveWorkshopCreators } =
          await import("../../../wailsjs/go/main/App.js");
        await SaveWorkshopCreators(allCreators);
        bus.emit("toast:show", {
          msg: `🌐 社区索引合并完成：新增 ${added} 位，补充 ${updated} 位`,
          duration: 4000,
          type: "success",
        });
        refreshView();
      } catch (e) {
        bus.emit("toast:show", {
          msg: "🌐 " + friendlyError(e, "拉取失败"),
          duration: 3000,
          type: "error",
        });
      } finally {
        btn.textContent = "🌐 社区";
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
        // 保存搜索词
        if (allSites && site) {
          const { SaveWorkshopSites } =
            await import("../../../wailsjs/go/main/App.js");
          // 从输入框收集搜索词
          const newPresets = [];
          searchResults
            .querySelectorAll(".cr-row input[data-fld='label']")
            .forEach((inp) => {
              const val = inp.value.trim();
              if (val) newPresets.push({ label: val });
            });
          site.presetSearches = newPresets;
          // 更新 allSites 中的对应站点
          const idx = allSites.findIndex((s) => s.id === site.id);
          if (idx >= 0) allSites[idx] = site;
          await SaveWorkshopSites(allSites);
        }
        // 保存创作者
        const { SaveWorkshopCreators } =
          await import("../../../wailsjs/go/main/App.js");
        await SaveWorkshopCreators(allCreators);
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
  searchResults.querySelectorAll(".cr-ed").forEach((inp) => {
    inp.addEventListener("focus", () => {
      inp.style.borderColor = "var(--bd)";
      inp.style.background = "var(--surf)";
    });
    inp.addEventListener("blur", () => {
      inp.style.borderColor = "transparent";
      inp.style.background = "transparent";
    });
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
      const idx = parseInt(btn.dataset.idx, 10);
      if (creators[idx]) {
        const realIdx = allCreators.indexOf(creators[idx]);
        if (realIdx >= 0) allCreators.splice(realIdx, 1);
        refreshView();
      }
    });
  });
  // 删除搜索词
  searchResults.querySelectorAll(".cr-del-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx, 10);
      if (site.presetSearches && site.presetSearches[idx]) {
        site.presetSearches.splice(idx, 1);
        refreshView();
      }
    });
  });

  // 新增创作者
  searchResults.querySelector(".cr-add")?.addEventListener("click", () => {
    // 先把当前输入框的值同步回数组
    searchResults.querySelectorAll(".cr-row input[data-idx]").forEach((inp) => {
      const idx = parseInt(inp.dataset.idx, 10);
      const fld = inp.dataset.fld;
      if (!isNaN(idx) && creators[idx] && fld) {
        creators[idx][fld] = inp.value;
      }
    });
    creators.push({ name: "新作者", desc: "描述", type: site.id, tag: "" });
    allCreators.push(creators[creators.length - 1]);
    refreshView();
  });
  // 新增搜索词
  searchResults
    .querySelector(".cr-add-preset")
    ?.addEventListener("click", () => {
      // 先把当前输入框的值同步回数组
      searchResults
        .querySelectorAll(".cr-row input[data-fld='label']")
        .forEach((inp) => {
          const idx = parseInt(inp.dataset.idx, 10);
          if (!isNaN(idx) && site.presetSearches && site.presetSearches[idx]) {
            site.presetSearches[idx].label = inp.value;
          }
        });
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
        card.querySelector(".gh-card-desc")?.textContent || ""
      ).toLowerCase();
      const cardTag = (card.dataset.tag || "").toLowerCase();
      const matchName = !kw || name.includes(kw) || desc.includes(kw);
      const matchTag =
        !_activeTag ||
        _activeTag === cardTag ||
        (_activeTag === "game" && !cardTag);
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
