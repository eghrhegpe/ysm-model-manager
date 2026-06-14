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

// ===== 创作者身份工具 =====
const PLATFORM_LABELS = {
  bilibili: "B站",
  afdian: "爱发电",
  github: "GitHub",
  mzhouse: "模之屋",
  bowlroll: "Bowlroll",
  vroid: "VRoid",
  nicovideo: "NicoNico 3D",
  deviantart: "DeviantArt",
};
const PLATFORM_ICONS = {
  bilibili: "📺",
  afdian: "❤️",
  github: "🐙",
  mzhouse: "🏠",
  bowlroll: "🍚",
  vroid: "🤖",
  nicovideo: "🧊",
  deviantart: "🎨",
};
function getCreatorIdentity(cr) {
  const role = cr.role || "";
  const tag = cr.tag || "";
  switch (role) {
    case "official":
      return { label: "🏠 官方IP模型库", icon: "🏠", tag: "official" };
    case "creator":
      return { label: "🎮 YSM 创作者", icon: "🎮", tag: "creator" };
    case "vup":
      return { label: "🎤 VTuber 创作者", icon: "🎤", tag: "vup" };
    case "repo":
      return { label: "📦 社区模型仓库", icon: "📦", tag: "repo" };
    case "oc":
      return { label: "🎨 OC 原创角色", icon: "🎨", tag: "oc" };
  }
  // fallback: detect from old tag field
  if (tag === "vup")
    return { label: "🎤 VTuber 创作者", icon: "🎤", tag: "vup" };
  if (tag === "oc") return { label: "🎨 OC 原创角色", icon: "🎨", tag: "oc" };
  return { label: "🎮 YSM 创作者", icon: "🎮", tag: "creator" };
}

function getTagFromRole(role) {
  return role || "creator";
}
function getTagEmojiFromRole(role) {
  switch (role) {
    case "official":
      return "🏷️";
    case "vup":
      return "🎤";
    case "oc":
      return "🎨";
    case "repo":
      return "📦";
    default:
      return "🎮";
  }
}
function parseDescTags(desc) {
  if (!desc) return [];
  return desc
    .split(/[、，,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

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
      const t = getTagFromRole(cr.role);
      if (t) tagSet.add(t);
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
        '<button class="cr-tag-filter-btn" data-tag="creator">🎮 模型创作者</button>' +
        '<button class="cr-tag-filter-btn" data-tag="official">🏠 官方IP</button>' +
        tags
          .filter((t) => t !== "creator" && t !== "official")
          .map(
            (t) =>
              '<button class="cr-tag-filter-btn" data-tag="' +
              esc(t) +
              '">' +
              getTagEmojiFromRole(t) +
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
              esc(getTagFromRole(cr.role)) +
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
              (avatarCache && avatarCache[cr.name]
                ? '<img class="cr-avatar" src="' + esc(avatarCache[cr.name]) + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover">'
                : '<div class="cr-avatar" style="width:28px;height:28px;font-size:12px">' +
                  (cr.name ? esc(cr.name.charAt(0)).toUpperCase() : "?") +
                  "</div>") +
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
                ? '<span style="font-size:9px;color:var(--muted);margin-left:auto">📁' +
                  authorCount +
                  "</span>"
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
              '<span class="cr-tag cr-tag-' +
              esc(getTagFromRole(cr.role)) +
              '">' +
              getTagEmojiFromRole(cr.role) +
              " " +
              esc(getTagFromRole(cr.role)) +
              "</span>" +
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
            '" class="cr-input cr-input-name" style="flex:1;border:none;background:transparent;color:var(--txt);font-size:var(--fs-sm);font-family:inherit;outline:none" placeholder="搜索关键词">' +
            '<button data-idx="' +
            idx +
            '" class="cr-order-up" title="上移" style="font-size:12px;padding:0 4px;background:none;border:none;color:var(--muted);cursor:pointer;font-family:inherit">↑</button>' +
            '<button data-idx="' +
            idx +
            '" class="cr-order-down" title="下移" style="font-size:12px;padding:0 4px;background:none;border:none;color:var(--muted);cursor:pointer;font-family:inherit">↓</button>' +
            '<button data-idx="' +
            idx +
            '" class="cr-del-preset" title="删除" style="font-size:12px;padding:0 4px;background:none;border:none;color:var(--muted);cursor:pointer;font-family:inherit">🗑️</button>' +
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
        '<span style="flex:1"></span>' +
        '<button class="cr-save-btn cr-action-btn cr-action-btn-accent">💾 保存</button>' +
        '<button class="cr-cancel-btn cr-action-btn cr-action-btn-muted">取消</button>' +
        "</div>" +
        '<div class="cr-hint-text">📄 数据文件：exe 同目录下的 creators.json，可直接编辑</div>',
    );
    creators.forEach((cr, idx) => {
      const roleEmoji = getTagEmojiFromRole(cr.role);
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
          '" class="cr-input cr-input-name" style="flex:1;min-width:60px;border:none;background:transparent;color:var(--txt);font-size:var(--fs-sm);font-family:inherit;outline:none" placeholder="名称">' +
          '<button data-idx="' +
          idx +
          '" class="cr-del" title="删除" style="font-size:12px;padding:0 4px;background:none;border:none;color:var(--muted);cursor:pointer;font-family:inherit">🗑️</button>' +
          "</div>" +
          '<div class="cr-edit-card-body">' +
          '<div class="cr-edit-card-row">' +
          '<span style="font-size:10px;color:var(--muted);width:28px;flex-shrink:0">描述</span>' +
          '<input data-idx="' +
          idx +
          '" data-fld="desc" value="' +
          esc(cr.desc) +
          '" class="cr-input cr-input-desc" style="flex:1;border:none;background:transparent;color:var(--txt);font-size:var(--fs-xs);font-family:inherit;outline:none" placeholder="关键词、顿号分隔">' +
          "</div>" +
          '<div class="cr-edit-card-row">' +
          '<span style="font-size:10px;color:var(--muted);width:28px;flex-shrink:0">平台</span>' +
          '<select data-idx="' +
          idx +
          '" data-fld="type" class="cr-input-type" multiple style="flex:1;height:auto;min-height:50px;padding:2px 4px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-xs);font-family:inherit" title="Ctrl+点击多选">' +
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
          '" data-fld="role" class="cr-input-role" style="width:auto;min-width:70px;padding:2px 4px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-xs);font-family:inherit">' +
          '<option value="creator"' +
          (cr.role === "creator" ? " selected" : "") +
          ">🎮 创作者</option>" +
          '<option value="official"' +
          (cr.role === "official" ? " selected" : "") +
          ">🏠 官方</option>" +
          '<option value="vup"' +
          (cr.role === "vup" ? " selected" : "") +
          ">🎤 VUP</option>" +
          '<option value="oc"' +
          (cr.role === "oc" ? " selected" : "") +
          ">🎨 OC</option>" +
          '<option value="repo"' +
          (cr.role === "repo" ? " selected" : "") +
          ">📦 仓库</option>" +
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
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center";
      overlay.onclick = (ev) => {
        if (ev.target === overlay) overlay.remove();
      };

      // 注入全局样式（Shadow DOM 样式不穿透主文档浮层）
      if (!document.getElementById("cr-detail-global-style")) {
        const st = document.createElement("style");
        st.id = "cr-detail-global-style";
        st.textContent =
          ".cr-detail-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;animation:fade-in .15s ease}" +
          ".cr-detail-box{background:var(--bg);border:1px solid var(--bd);border-radius:16px;padding:20px 24px;max-width:400px;width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:10px;animation:detail-in .25s cubic-bezier(.34,1.56,.64,1)}" +
          "@keyframes detail-in{from{opacity:0;transform:scale(.88) translateY(16px)}to{opacity:1;transform:scale(1) translateY(0)}}" +
          "@keyframes fade-in{from{opacity:0}to{opacity:1}}" +
          ".cr-detail-header{display:flex;align-items:center;gap:10px}" +
          ".cr-detail-name{font-size:17px;font-weight:700;color:var(--txt);letter-spacing:.3px}" +
          ".cr-detail-desc{font-size:var(--fs-sm);color:var(--txt);opacity:.65;line-height:1.5;padding:6px 10px;background:var(--surf);border-radius:8px}" +
          ".cr-detail-row{font-size:var(--fs-sm);color:var(--muted);display:flex;align-items:center;gap:8px}" +
          ".cr-detail-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}" +
          ".cr-detail-actions button{padding:6px 16px;border-radius:8px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;font-size:var(--fs-sm);font-family:inherit;transition:all .12s}" +
          ".cr-detail-actions button:hover{border-color:var(--accent);background:var(--hover)}" +
          ".cr-detail-actions .primary{background:var(--accent);color:#fff;border-color:var(--accent)}" +
          ".cr-detail-actions .primary:hover{opacity:.85}" +
          ".cr-detail-actions .secondary{border-color:transparent;color:var(--muted)}" +
          ".cr-detail-actions .secondary:hover{border-color:var(--bd);color:var(--txt)}" +
          ".cr-local-btn{transition:all .12s}" +
          ".cr-local-btn:hover{background:var(--accent);color:#fff!important}" +
          ".cr-platform-badge{font-size:9px;padding:2px 6px;border-radius:4px;display:inline-flex;align-items:center;gap:3px;background:var(--surf);color:var(--muted);border:1px solid var(--bd);font-weight:500}" +
          ".cr-tag{font-size:10px;padding:1px 7px;border-radius:4px;line-height:18px;font-weight:600;display:inline-flex;align-items:center}" +
          ".cr-tag-game{background:var(--tag-game-bg);color:var(--tag-game)}" +
          ".cr-tag-vup{background:var(--tag-vup-bg);color:var(--tag-vup)}" +
          ".cr-tag-oc{background:var(--tag-oc-bg);color:var(--tag-oc)}" +
          ".cr-star-btn{cursor:pointer;font-size:18px;transition:transform .15s;flex-shrink:0}" +
          ".cr-star-btn:hover{transform:scale(1.15)}";
        document.head.appendChild(st);
      }

      const identity = getCreatorIdentity(cr);
      const descTags = parseDescTags(cr.desc);
      const isFav = isFaved(cr.name);
      const localCount = authorCountMap[cr.name] || 0;
      overlay.innerHTML =
        '<div class="cr-detail-box">' +
        '<div class="cr-detail-header">' +
        '<div class="cr-avatar-container" style="width:36px;height:36px;margin:0">' +
        (avatarCache && avatarCache[cr.name]
          ? '<img class="cr-avatar" src="' + esc(avatarCache[cr.name]) + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover">'
          : '<div class="cr-avatar" style="width:36px;height:36px;font-size:16px">' +
            esc(cr.name.charAt(0)).toUpperCase() +
            "</div>") +
        "</div>" +
        '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<span class="cr-detail-name">' +
        esc(cr.name) +
        "</span>" +
        (cr.role
          ? '<span class="cr-tag cr-tag-' +
            esc(getTagFromRole(cr.role)) +
            '">' +
            getTagEmojiFromRole(cr.role) +
            " " +
            esc(getTagFromRole(cr.role)) +
            "</span>"
          : "") +
        "</div>" +
        '<div style="font-size:10px;color:var(--muted);margin-top:1px">' +
        esc(identity.label) +
        "</div>" +
        "</div>" +
        '<span class="cr-star-btn" data-star="' +
        esc(cr.name) +
        '">' +
        (isFav ? "⭐" : "☆") +
        "</span>" +
        "</div>" +
        '<div class="cr-detail-desc" style="display:flex;flex-wrap:wrap;gap:4px;padding:0;background:transparent">' +
        descTags
          .map(
            (t) =>
              '<span style="font-size:10px;padding:1px 7px;border-radius:4px;line-height:18px;background:var(--surf);color:var(--txt);opacity:.75;border:1px solid var(--bd)">#' +
              esc(t) +
              "</span>",
          )
          .join("") +
        (!descTags.length ? esc(cr.desc) : "") +
        "</div>" +
        (localCount > 0
          ? '<div class="cr-detail-row" style="background:var(--surf);border-radius:8px;padding:8px 10px;border:1px solid var(--bd)">' +
            '<span style="font-size:13px">📂</span>' +
            '<span style="flex:1;font-size:var(--fs-sm);color:var(--txt)">已下载 ' +
            localCount +
            " 个模型</span>" +
            '<button class="cr-local-btn" data-local style="font-size:var(--fs-xs);padding:2px 8px;border-radius:4px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-family:inherit">查看 →</button>' +
            "</div>"
          : "") +
        '<div class="cr-detail-row" style="gap:4px;flex-wrap:wrap">' +
        cr.type
          .split(";")
          .map(
            (t) =>
              '<span class="cr-platform-badge">' +
              (PLATFORM_ICONS[t] || "🔗") +
              " " +
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
  searchResults.querySelectorAll(".cr-edit-card:not([data-edit='preset'])").forEach((card) => {
    const handle = card.querySelector(".cr-drag-handle");
    if (!handle) return;
    // 点拖拽柄时暂时让卡片可拖拽
    handle.addEventListener("mousedown", () => { card.draggable = true; });
    card.addEventListener("dragstart", (e) => {
      card.draggable = false;
      dragSrcIdx = parseInt(card.dataset.editIdx, 10);
      card.style.opacity = "0.4";
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
    });
    card.addEventListener("dragend", () => {
      card.style.opacity = "";
      card.draggable = false;
      searchResults
        .querySelectorAll(".cr-edit-card")
        .forEach((c) => { c.style.borderColor = ""; c.style.marginTop = ""; c.style.marginBottom = ""; });
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    card.addEventListener("dragenter", (e) => {
      e.preventDefault();
      card.style.borderColor = "var(--accent)";
      if (dragSrcIdx >= 0) {
        const tgt = parseInt(card.dataset.editIdx, 10);
        if (dragSrcIdx < tgt) { card.style.marginTop = "8px"; card.style.transition = "margin-top .15s ease"; }
        else if (dragSrcIdx > tgt) { card.style.marginBottom = "8px"; card.style.transition = "margin-bottom .15s ease"; }
      }
    });
    card.addEventListener("dragleave", () => {
      card.style.borderColor = "";
      card.style.marginTop = "";
      card.style.marginBottom = "";
    });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.style.borderColor = "";
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
  searchResults.querySelectorAll(".cr-edit-card[data-edit='preset']").forEach((card) => {
    const handle = card.querySelector(".cr-drag-handle");
    if (!handle) return;
    handle.addEventListener("mousedown", () => { card.draggable = true; });
    card.addEventListener("dragstart", (e) => {
      card.draggable = false;
      dragPresetSrcIdx = parseInt(card.dataset.editIdx, 10);
      card.style.opacity = "0.4";
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
    });
    card.addEventListener("dragend", () => {
      card.style.opacity = "";
      card.draggable = false;
      searchResults
        .querySelectorAll(".cr-edit-card")
        .forEach((c) => { c.style.borderColor = ""; c.style.marginTop = ""; c.style.marginBottom = ""; });
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    card.addEventListener("dragenter", (e) => {
      e.preventDefault();
      card.style.borderColor = "var(--accent)";
      if (dragPresetSrcIdx >= 0) {
        const tgt = parseInt(card.dataset.editIdx, 10);
        if (dragPresetSrcIdx < tgt) { card.style.marginTop = "8px"; card.style.transition = "margin-top .15s ease"; }
        else if (dragPresetSrcIdx > tgt) { card.style.marginBottom = "8px"; card.style.transition = "margin-bottom .15s ease"; }
      }
    });
    card.addEventListener("dragleave", () => {
      card.style.borderColor = "";
      card.style.marginTop = "";
      card.style.marginBottom = "";
    });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.style.borderColor = "";
      const targetIdx = parseInt(card.dataset.editIdx, 10);
      if (dragPresetSrcIdx < 0 || dragPresetSrcIdx === targetIdx || !site.presetSearches) return;
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
        card.querySelector(".gh-card-desc")?.textContent || ""
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
