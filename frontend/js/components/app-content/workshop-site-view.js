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
  creators.sort((a, b) => (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0));

  // 构建 HTML
  let parts = [];
  parts.push('<div class="cr-scroll">');

  // 搜索词分区
  if (site.presetSearches && site.presetSearches.length) {
    parts.push(
      '<div class="cr-section">' +
        '<span class="cr-section-title-lg">🔍 搜索词</span>' +
        '<span class="cr-section-sub">(' +
        site.presetSearches.length +
        ")</span>" +
        '<button id="cr-mode-toggle" class="cr-mode-switch" style="margin-left:auto;font-size:var(--fs-xs);padding:2px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-family:inherit">' +
        '<span class="cr-mode-opt cr-mode-ext active">↗ 外链</span>' +
        '<span class="cr-mode-opt cr-mode-emb">🔍 内嵌</span>' +
        "</button>" +
        "</div>" +
        '<div class="cr-preset-area">' +
        site.presetSearches
          .map(
            (ps) =>
              '<button class="cr-preset-btn" data-q="' +
              esc(ps.label) +
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
    parts.push(
      '<div class="cr-section">' +
        '<span class="cr-section-title-lg">🎨 活跃创作者</span>' +
        '<span class="cr-section-sub" id="ws-cr-count">(' +
        creators.length +
        ")</span>" +
        '<input type="text" id="ws-cr-search" placeholder="🔍 搜创作者名..." ' +
        'style="flex:1;max-width:180px;padding:3px 8px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-xs);font-family:inherit;outline:none;margin:0 6px">' +
        '<button class="cr-edit-btn cr-action-btn cr-action-btn-muted" style="margin-left:auto">✏️ 编辑</button>' +
        '<button class="cr-fetch-btn cr-action-btn" style="margin-left:4px" title="从 GitHub 社区索引拉取最新创作者">🌐 社区</button>' +
        "</div>",
    );
    parts.push(
      '<div style="display:flex;flex-wrap:wrap;gap:6px;width:100%">' +
        creators
          .map((cr, _, arr) => {
            const isGitHub = cr.type && cr.type.includes("github");
            const repoParts = isGitHub ? cr.name.split("/") : null;
            const hasRepo = isGitHub && repoParts && repoParts.length >= 2;
            const authorCount = authorCountMap[cr.name] || 0;
            // 按模型数排百分比：前10%金、前25%银，其余蓝色静态细边
            const sorted = [...arr].sort((a, b) => (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0));
            const idx = sorted.indexOf(cr);
            const pct = sorted.length > 1 ? idx / (sorted.length - 1) : 0;
            const tier = pct < 0.10
              ? { border: "#D4A017", glow: "rgba(212,160,23,0.4)", rank: "gold" }
              : pct < 0.25
              ? { border: "#9E9E9E", glow: "rgba(158,158,158,0.25)", rank: "silver" }
              : { border: "#6B9FFF", glow: "transparent", rank: "" };
            const spinAttr = tier.rank ? ' data-spin="' + tier.rank + '"' : '';
            return (
              '<div class="gh-card" style="min-width:200px;max-width:280px;flex:1 1 200px;cursor:pointer;animation:card-in .3s ease-out both;animation-delay:' +
              (idx * 0.03) +
              's" data-name="' +
              esc(cr.name) +
              '" title="搜索: ' +
              esc(cr.name) +
              '">' +
              '<div class="cr-avatar-container" style="position:relative;display:inline-flex;flex-shrink:0;align-self:flex-start;margin:6px 0 0 6px">' +
              '<div class="cr-avatar-ring"' +
              spinAttr +
              ' style="background:conic-gradient(from var(--grad-rot,0deg),' +
              tier.border +
              ',transparent 60%,' +
              tier.border +
              ');box-shadow:0 0 6px ' +
              tier.glow +
              '"></div>' +
              '<div class="cr-avatar" style="width:28px;height:28px;font-size:12px">' +
              (cr.name ? esc(cr.name.charAt(0)).toUpperCase() : "?") +
              "</div>" +
              "</div>" +
              '<div class="gh-card-body">' +
              '<div class="gh-card-label name">' +
              esc(cr.name) +
              (cr._fromLocal
                ? '<span style="font-size:9px;color:var(--muted);margin-left:4px">📁</span>'
                : "") +
              "</div>" +
              '<div class="gh-card-desc">' +
              esc(cr.desc) +
              "</div>" +
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
        '<div class="cr-row">' +
          "<span>🎨</span>" +
          '<input data-idx="' +
          idx +
          '" data-fld="name" value="' +
          esc(cr.name) +
          '" class="cr-input cr-input-name">' +
          '<input data-idx="' +
          idx +
          '" data-fld="desc" value="' +
          esc(cr.desc) +
          '" class="cr-input cr-input-desc">' +
          '<input data-idx="' +
          idx +
          '" data-fld="type" value="' +
          esc(cr.type) +
          '" class="cr-input-type" placeholder="bilibili">' +
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

  // 创作者卡片点击 → 用网站的 searchUrl + 名字搜索
  searchResults.querySelectorAll(".gh-card[data-name]").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".gh-card-external[data-repo]")) return;
      const name = card.dataset.name;
      if (site.searchUrl && name && openUrl) {
        const url = site.searchUrl.replace(
          /\{\{q\}\}/g,
          encodeURIComponent(name),
        );
        openUrl(url);
      }
    });
  });

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
            '<button class="cr-back-repo cr-back-btn" style="margin-bottom:12px">← 返回</button>';
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
      if (creators[idx]) creators[idx][inp.dataset.fld] = inp.value.trim();
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
    creators.push({ name: "新作者", desc: "描述", type: site.id });
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

  // 🔍 创作者搜索过滤
  const searchInput = searchResults.getElementById("ws-cr-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const kw = searchInput.value.trim().toLowerCase();
      const cards = searchResults.querySelectorAll(".gh-card[data-name]");
      let visible = 0;
      cards.forEach((card) => {
        const name = (card.dataset.name || "").toLowerCase();
        const match = !kw || name.includes(kw);
        card.style.display = match ? "" : "none";
        if (match) visible++;
      });
      const countEl = searchResults.getElementById("ws-cr-count");
      if (countEl)
        countEl.textContent = "(" + visible + "/" + cards.length + ")";
    });
  }
}
