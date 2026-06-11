// ===== 创意工坊站点视图（为 _initWorkshop 减负） =====
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
 * @param {Function} ctx.backToSite - 返回站点视图的回调
 */
export function renderSiteView(site, ctx) {
  const {
    esc,
    searchResults,
    creatorView,
    allCreators,
    wsEditModeRef,
    showRepoModels,
    fillSearch,
    repoModelCache,
    backToSite,
  } = ctx;

  searchResults.innerHTML = "";
  creatorView.style.display = "none";

  const creators = allCreators.filter(
    (cr) => cr.type && cr.type.split(";").includes(site.id),
  );

  // 构建 HTML
  let parts = [];
  parts.push('<div class="cr-scroll">');

  // 预设搜索按钮
  if (site.presetSearches && site.presetSearches.length) {
    parts.push(
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
        '<span class="cr-section-sub">(' +
        creators.length +
        ")</span>" +
        '<button class="cr-edit-btn cr-action-btn cr-action-btn-muted" style="margin-left:auto">✏️ 管理</button>' +
        "</div>",
    );
    parts.push(
      creators
        .map((cr) => {
          const isGitHub = cr.type && cr.type.includes("github");
          const repoParts = isGitHub ? cr.name.split("/") : null;
          const hasRepo = isGitHub && repoParts && repoParts.length >= 2;
          return (
            '<div class="cr-creator-card' +
            (hasRepo ? ' cr-has-repo"' : '"') +
            ' data-name="' +
            esc(cr.name) +
            '">' +
            '<div class="cr-creator-icon">🎨</div>' +
            '<div class="cr-creator-body">' +
            '<div class="cr-creator-name">' +
            esc(cr.name) +
            "</div>" +
            '<div class="cr-creator-desc">' +
            esc(cr.desc) +
            "</div>" +
            "</div>" +
            (hasRepo
              ? '<button class="cr-browse-repo cr-action-btn cr-action-btn-accent" data-repo="' +
                esc(cr.name) +
                '">📦 浏览</button>'
              : "") +
            '<div class="cr-creator-action">↗</div>' +
            "</div>"
          );
        })
        .join(""),
    );
  } else if (wsEditModeRef.v) {
    parts.push(
      '<div class="cr-section">' +
        '<span class="cr-section-title-lg">✏️ 编辑创作者</span>' +
        '<span style="flex:1"></span>' +
        '<button class="cr-view-btn cr-action-btn cr-action-btn-muted">✅ 完成</button>' +
        '<button class="cr-save-btn cr-action-btn">💾 保存</button>' +
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
      if (site.searchUrl) {
        window.open(fillSearch(site.searchUrl, btn.dataset.q), "_blank");
      }
    });
  });

  // 创作者卡片点击 → 用网站的 searchUrl + 名字搜索
  searchResults
    .querySelectorAll(".cr-creator-card[data-name]")
    .forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".cr-browse-repo")) return;
        const name = card.dataset.name;
        if (site.searchUrl && name) {
          const url = site.searchUrl.replace(
            /\{\{q\}\}/g,
            encodeURIComponent(name),
          );
          window.open(url, "_blank");
        }
      });
    });

  // 📦 浏览 GitHub 仓库模型
  const refreshView = () => renderSiteView(site, ctx);

  searchResults.querySelectorAll(".cr-browse-repo").forEach((btn) => {
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

  searchResults.querySelector(".cr-view-btn")?.addEventListener("click", () => {
    wsEditModeRef.v = false;
    refreshView();
  });

  // 保存
  searchResults
    .querySelector(".cr-save-btn")
    ?.addEventListener("click", async () => {
      try {
        const { SaveWorkshopCreators } =
          await import("../../../wailsjs/go/main/App.js");
        await SaveWorkshopCreators(allCreators);
        wsEditModeRef.v = false;
        bus.emit("toast:show", {
          msg: "✅ 创作者已保存",
          duration: 2000,
          type: "success",
        });
        refreshView();
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ 保存失败: " + String(e),
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
          msg: "❌ 导出失败: " + String(e),
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
          msg: "❌ 导入失败: " + String(e),
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

  // 删除
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

  // 新增
  searchResults.querySelector(".cr-add")?.addEventListener("click", () => {
    creators.push({ name: "新作者", desc: "描述", type: site.id });
    allCreators.push(creators[creators.length - 1]);
    refreshView();
  });
}
