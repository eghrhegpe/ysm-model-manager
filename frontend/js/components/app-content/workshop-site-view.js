// ===== 创意工坊站点视图（为 _initWorkshop 减负） =====
import { bus } from "../../bus.js";
import { showProgress, tryFetchModels } from "./workshop-data.js";

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
  parts.push('<div style="flex:1;overflow-y:auto">');

  // 预设搜索按钮
  if (site.presetSearches && site.presetSearches.length) {
    parts.push(
      '<div style="padding:8px 12px 4px;display:flex;gap:4px;flex-wrap:wrap">' +
        site.presetSearches
          .map(
            (ps) =>
              '<button class="ws-preset-btn" data-q="' +
              esc(ps.q) +
              '" style="padding:2px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--accent);cursor:pointer;font-size:9px">' +
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
      '<div style="padding:6px 12px 4px;display:flex;align-items:center;gap:4px">' +
        '<span style="font-size:10px;font-weight:600;color:var(--txt)">🎨 活跃创作者</span>' +
        '<span style="font-size:9px;color:var(--muted)">(' +
        creators.length +
        ")</span>" +
        '<button class="ws-cr-edit-btn" style="margin-left:auto;padding:4px 12px;border-radius:6px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">✏️ 管理</button>' +
        "</div>",
    );
    parts.push(
      creators
        .map((cr) => {
          const isGitHub = cr.type && cr.type.includes("github");
          const repoParts = isGitHub ? cr.name.split("/") : null;
          const hasRepo = isGitHub && repoParts && repoParts.length >= 2;
          return (
            '<div class="ws-creator-card' +
            (hasRepo ? ' ws-cr-has-repo"' : '"') +
            ' data-name="' +
            esc(cr.name) +
            '">' +
            '<div class="ws-creator-icon">🎨</div>' +
            '<div class="ws-creator-body">' +
            '<div class="ws-creator-name">' +
            esc(cr.name) +
            "</div>" +
            '<div class="ws-creator-desc">' +
            esc(cr.desc) +
            "</div>" +
            "</div>" +
            (hasRepo
              ? '<button class="ws-browse-repo" data-repo="' +
                esc(cr.name) +
                '" style="padding:4px 12px;border-radius:6px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:11px;flex-shrink:0">📦 浏览</button>'
              : "") +
            '<div class="ws-creator-action">↗</div>' +
            "</div>"
          );
        })
        .join(""),
    );
  } else if (wsEditModeRef.v) {
    parts.push(
      '<div style="padding:6px 12px 4px;display:flex;align-items:center;gap:4px">' +
        '<span style="font-size:10px;font-weight:600;color:var(--txt)">✏️ 编辑创作者</span>' +
        '<span style="flex:1"></span>' +
        '<button class="ws-cr-view-btn" style="padding:4px 12px;border-radius:6px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">✅ 完成</button>' +
        '<button class="ws-cr-save-btn" style="padding:4px 14px;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:11px">💾 保存</button>' +
        "</div>" +
        '<div style="font-size:8px;color:var(--muted);padding:0 12px 4px">📄 数据文件：exe 同目录下的 workshop_creators.json，可直接编辑</div>',
    );
    creators.forEach((cr, idx) => {
      parts.push(
        '<div style="display:flex;align-items:center;gap:3px;padding:4px 6px;border-radius:4px;border:1px solid var(--bd);font-size:10px;margin:1px 12px">' +
          "<span>🎨</span>" +
          '<input class="ws-cr-ed" data-idx="' +
          idx +
          '" data-fld="name" value="' +
          esc(cr.name) +
          '" style="flex:2;min-width:30px;padding:2px 4px;border-radius:3px;border:1px solid transparent;background:transparent;color:var(--txt);font-size:10px">' +
          '<input class="ws-cr-ed" data-idx="' +
          idx +
          '" data-fld="desc" value="' +
          esc(cr.desc) +
          '" style="flex:2;min-width:30px;padding:2px 4px;border-radius:3px;border:1px solid transparent;background:transparent;color:var(--muted);font-size:9px">' +
          '<input class="ws-cr-ed" data-idx="' +
          idx +
          '" data-fld="type" value="' +
          esc(cr.type) +
          '" style="flex:1;min-width:30px;padding:2px 4px;border-radius:3px;border:1px solid transparent;background:transparent;color:var(--accent);font-size:9px;text-align:center" placeholder="bilibili">' +
          '<button class="ws-cr-del" data-idx="' +
          idx +
          '" style="padding:1px 4px;border-radius:3px;border:1px solid transparent;background:transparent;color:#e5534b;cursor:pointer;font-size:10px">🗑️</button>' +
          "</div>",
      );
    });
    parts.push(
      '<div style="padding:4px 12px">' +
        '<button class="ws-cr-add" style="padding:2px 8px;border-radius:4px;border:1px dashed var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:10px;width:100%">➕ 新增</button>' +
        "</div>",
    );
  }

  parts.push("</div>");

  let html = parts.join("");

  if (!site.presetSearches?.length && !creators.length && !wsEditModeRef.v) {
    html =
      '<div style="flex:1;overflow-y:auto;padding:12px;color:var(--muted);font-size:10px">此站点无可操作内容。<br>点击「浏览器打开」访问：<br><a href="' +
      esc(site.url) +
      '" target="_blank" style="color:var(--accent)">' +
      esc(site.url) +
      "</a></div>";
  }

  searchResults.innerHTML = html;

  // 预设搜索按钮
  searchResults.querySelectorAll(".ws-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (site.searchUrl) {
        window.open(fillSearch(site.searchUrl, btn.dataset.q), "_blank");
      }
    });
  });

  // 创作者卡片点击 → 用网站的 searchUrl + 名字搜索
  searchResults
    .querySelectorAll(".ws-creator-card[data-name]")
    .forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".ws-browse-repo")) return;
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

  searchResults.querySelectorAll(".ws-browse-repo").forEach((btn) => {
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
          '<div style="padding:12px;text-align:center">' +
          '<button class="ws-back-repo" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:10px;margin-bottom:12px">← 返回</button>' +
          '<div style="color:var(--muted);font-size:10px;line-height:1.6">' +
          (isTimeout
            ? "⏱️ 连接超时"
            : "❌ 无 index.json<br>" +
              "此仓库尚未建立创意工坊索引，请你使用浏览器下载。<br>" +
              '<span style="font-size:9px;opacity:.6">（这个仓库需要有 index.json 文件，才能调用 API 下载文件）</span>') +
          "</div></div>";
        searchResults
          .querySelector(".ws-back-repo")
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
  searchResults
    .querySelector(".ws-cr-edit-btn")
    ?.addEventListener("click", () => {
      wsEditModeRef.v = true;
      refreshView();
    });

  searchResults
    .querySelector(".ws-cr-view-btn")
    ?.addEventListener("click", () => {
      wsEditModeRef.v = false;
      refreshView();
    });

  // 保存
  searchResults
    .querySelector(".ws-cr-save-btn")
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
    .querySelector(".ws-cr-export-btn")
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
    .querySelector(".ws-cr-import-btn")
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
  searchResults.querySelectorAll(".ws-cr-ed").forEach((inp) => {
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
  searchResults.querySelectorAll(".ws-cr-del").forEach((btn) => {
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
  searchResults.querySelector(".ws-cr-add")?.addEventListener("click", () => {
    creators.push({ name: "新作者", desc: "描述", type: site.id });
    allCreators.push(creators[creators.length - 1]);
    refreshView();
  });
}
