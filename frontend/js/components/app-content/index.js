// ===== <app-content> 入口 =====
import { bus } from "../../bus.js";
import { contentCSS } from "./content-css.js";
import {
  repositoryHTML,
  instancesHTML,
  settingsHTML,
  downloadsHTML,
  diagnosticsHTML,
  recycleHTML,
  workshopHTML,
} from "./tpl.js";
import { registerGlobalHandlers } from "../../core/global-handlers.js";
import { renderDisplayName } from "../../utils/display.js";
import { modalConfirm } from "../../dialogs/modal.js";
import { initImportQueue } from "../../features/import-queue.js";
import { initRecycleBin } from "../../features/recycle-bin.js";
import { initVersionUpdater } from "../../features/version-updater.js";
import { initRepository } from "../../pages/repository.js";

class AppContent extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(contentCSS);
    this._current = "instances";
    this._globalUnsubs = [];
  }

  connectedCallback() {
    this._unsub = bus.on("nav:change", ({ page }) => {
      this._current = page;
      bus.emit("nav:changed", { page });
      this._render();
    });
    this._render();
    this._globalUnsubs = registerGlobalHandlers();
  }

  disconnectedCallback() {
    if (this._unsub) this._unsub();
    this._globalUnsubs.forEach((fn) => fn());
  }

  _render() {
    let inner = "";
    switch (this._current) {
      case "repository":
        inner = repositoryHTML();
        break;
      case "instances":
        inner = instancesHTML();
        break;
      case "downloads":
        inner = downloadsHTML();
        break;
      case "workshop":
        inner = workshopHTML();
        break;
      case "recycle":
        inner = recycleHTML();
        break;
      case "diagnostics":
        inner = diagnosticsHTML();
        break;
      case "settings":
        inner = settingsHTML();
        break;
      default:
        inner = instancesHTML();
    }
    this._root.innerHTML = `<div class="page">${inner}</div>`;

    if (this._current === "diagnostics") {
      this._initDiagnostics();
    } else if (this._current === "recycle") {
      this._initRecycle();
    } else if (this._current === "settings") {
      this._initSettings();
    } else if (this._current === "downloads") {
      this._initDownloads();
    } else if (this._current === "workshop") {
      this._initWorkshop();
    } else if (this._current === "repository") {
      this._initRepository();
    }
  }

  _initDiagnostics() {
    const root = this._root;

    root
      .getElementById("diag-refresh")
      ?.addEventListener("click", () => this._loadDiagnosticsLogs());
    root.getElementById("diag-clear")?.addEventListener("click", async () => {
      const { ClearImportLogs } =
        await import("../../../wailsjs/go/main/App.js");
      await ClearImportLogs();
      this._loadDiagnosticsLogs();
      bus.emit("toast:show", {
        msg: "🗑️ 日志已清空",
        duration: 2000,
        type: "info",
      });
    });
    root
      .getElementById("diag-scan-conflict")
      ?.addEventListener("click", () => this._scanConflicts());
    root
      .getElementById("diag-start-dedup")
      ?.addEventListener("click", () => this._startDedup());

    // 左栏按钮切换（含去重）
    root.querySelectorAll(".diag-btn[data-diag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.diag;
        root
          .querySelectorAll(".diag-btn[data-diag]")
          .forEach((b) => b.classList.toggle("active", b === btn));
        root.getElementById("diag-log").style.display =
          name === "log" ? "" : "none";
        root.getElementById("diag-dedup").style.display =
          name === "dedup" ? "" : "none";
        root.getElementById("diag-conflict").style.display =
          name === "conflict" ? "" : "none";
        if (name === "log") this._loadDiagnosticsLogs();
      });
    });

    this._loadDiagnosticsLogs();
  }

  _initRepository() {
    initRepository(this._root);
  }

  async _startDedup() {
    const list = this._root.getElementById("diag-dedup-list");
    if (!list) return;
    list.innerHTML =
      '<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">⏳ 扫描仓库文件哈希...</div>';
    try {
      const { LoadAppConfig, ScanModelEntries, MoveToRecycle } =
        await import("../../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const repoRoot = cfg.repoRoot || "";
      if (!repoRoot) {
        list.innerHTML =
          '<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">请先设置仓库目录</div>';
        return;
      }

      const entries = await ScanModelEntries(repoRoot);
      if (!entries || entries.length < 2) {
        list.innerHTML =
          '<div class="stat-row" style="padding:12px;color:#a6e3a1;font-size:11px">✅ 无需去重（文件不足 2 个）</div>';
        return;
      }

      // 按哈希分组
      const hashGroups = {};
      entries.forEach((e) => {
        if (!e.Hash) return;
        (hashGroups[e.Hash] ||= []).push(e);
      });

      const dupHashes = Object.entries(hashGroups).filter(
        ([, v]) => v.length > 1,
      );
      if (!dupHashes.length) {
        list.innerHTML =
          '<div class="stat-row" style="padding:12px;color:#a6e3a1;font-size:11px">✅ 没有重复文件</div>';
        return;
      }

      const totalDups = dupHashes.reduce((s, [, v]) => s + v.length - 1, 0);

      // 行内展示每组重复文件，让用户选择保留哪个
      let html = `<div style="padding:10px 12px;font-size:11px;color:var(--txt);border-bottom:1px solid var(--bd)">
发现 <strong>${dupHashes.length}</strong> 组重复文件，共 <strong>${totalDups}</strong> 个可清理
<span style="font-size:9px;color:var(--muted);margin-left:4px">每组选一个保留，其余移入回收站</span>
</div>`;
      dupHashes.forEach(([, group], gi) => {
        // 默认选中最大的文件（最可能保留完整数据）
        const defaultIdx = group.reduce(
          (best, e, i, arr) => (e.Size > arr[best].Size ? i : best),
          0,
        );
        html += `<div style="margin:6px 12px;border:1px solid var(--bd);border-radius:8px;overflow:hidden">
<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:10px;font-weight:600;color:var(--txt);background:var(--surf);border-bottom:1px solid var(--bd)">
<span>📎 组 ${gi + 1}</span>
<span style="flex:1"></span>
<span style="font-size:9px;color:var(--muted);font-weight:400">${group.length} 个文件 · ${group.reduce((s, e) => s + e.Size, 0)} 字节</span>
</div>`;
        group.forEach((e, fi) => {
          const checked = fi === defaultIdx ? " checked" : "";
          const isDefault = fi === defaultIdx;
          const dateStr = e.ModTime
            ? new Date(e.ModTime).toLocaleDateString()
            : "";
          html += `<label style="display:flex;align-items:center;gap:4px;padding:4px 8px;font-size:10px;cursor:pointer;transition:background .1s;background:${isDefault ? "var(--hover)" : "transparent"}"
>
<input type="radio" name="dedup-keep-${gi}" value="${fi}"${checked} style="flex-shrink:0;accent-color:var(--accent)">
<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)" title="${this._esc(e.Path)}">${this._esc(e.Name)}</span>
<span style="font-size:9px;color:var(--muted);flex-shrink:0;margin-right:4px">${(e.Size / 1024).toFixed(0)}KB</span>
${dateStr ? `<span style="font-size:8px;color:var(--muted);flex-shrink:0">${dateStr}</span>` : ""}
${isDefault ? '<span style="font-size:8px;padding:0 4px;border-radius:3px;background:#a6e3a122;color:#a6e3a1">推荐</span>' : ""}
</label>`;
        });
        html += `</div>`;
      });
      html += `<div style="display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--bd)">
<button id="diag-dedup-exec" style="flex:1;padding:7px 16px;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:11px">🗑️ 删除未选中的重复文件</button>
<button id="diag-dedup-cancel" style="padding:7px 16px;border-radius:6px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">取消</button>
</div>`;
      list.innerHTML = html;

      // 取消按钮
      list
        .querySelector("#diag-dedup-cancel")
        ?.addEventListener("click", () => {
          list.innerHTML =
            '<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">已取消去重</div>';
        });

      list
        .querySelector("#diag-dedup-exec")
        ?.addEventListener("click", async () => {
          let del = 0,
            fail = 0;
          for (let gi = 0; gi < dupHashes.length; gi++) {
            const [, group] = dupHashes[gi];
            const selected = parseInt(
              list.querySelector(`input[name="dedup-keep-${gi}"]:checked`)
                ?.value ?? "0",
              10,
            );
            for (let fi = 0; fi < group.length; fi++) {
              if (fi === selected) continue;
              try {
                await MoveToRecycle(group[fi].Path);
                del++;
              } catch {
                fail++;
              }
            }
          }
          if (del > 0) {
            bus.emit("stats:refresh");
            bus.emit("tree:reload");
          }
          list.innerHTML = `<div class="stat-row" style="padding:8px 12px;font-size:11px;color:${fail > 0 ? "#f9a826" : "#a6e3a1"}">
✅ 去重完成：移入回收站 ${del} 个，失败 ${fail} 个</div>`;
        });

      // 去掉旧实现遗留的死代码
    } catch (err) {
      list.innerHTML = `<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">去重失败: ${this._esc(String(err))}</div>`;
    }
  }

  async _loadDiagnosticsLogs() {
    const list = this._root.getElementById("diag-log-list");
    if (!list) return;
    try {
      const { GetImportLogs } = await import("../../../wailsjs/go/main/App.js");
      const logs = await GetImportLogs();
      if (!logs || !logs.length) {
        list.innerHTML =
          '<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">暂无日志</div>';
        return;
      }
      list.innerHTML = logs
        .slice(-500)
        .reverse()
        .map((l) => {
          const status =
            l.Status === "success"
              ? "success"
              : l.Status === "failed"
                ? "failed"
                : "skipped";
          const statusLabel =
            l.Status === "success" ? "✅" : l.Status === "failed" ? "❌" : "⏭️";
          const t = l.Timestamp
            ? new Date(l.Timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })
            : "";
          const msg =
            renderDisplayName(l.ModelName) +
            (l.TargetDir ? "<br>📂 " + this._esc(l.TargetDir) : "") +
            (l.ErrorMsg
              ? "<br>❌ " +
                this._esc(l.ErrorMsg).replace(
                  /\s+(问题描述|操作|源路径|目标路径|解决建议)[：:]?/g,
                  "<br>$1：",
                )
              : "");
          return `<div class="log-row">
<span class="log-status ${status}">${statusLabel}</span>
<span class="log-msg">${msg}</span>
<span class="log-time">${t}</span>
</div>`;
        })
        .join("");
    } catch (_) {
      list.innerHTML =
        '<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">加载日志失败</div>';
    }
  }

  async _scanConflicts() {
    const list = this._root.getElementById("diag-conflict-list");
    if (!list) return;
    list.innerHTML =
      '<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">扫描中...</div>';
    try {
      const { LoadAppConfig, ListVersionInstances, ScanModelEntries } =
        await import("../../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const mcRoot = cfg.mcRoot || cfg.McRoot || "";
      if (!mcRoot) {
        list.innerHTML =
          '<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">请先设置游戏路径</div>';
        return;
      }

      const instances = await ListVersionInstances(mcRoot);
      if (!instances || !instances.length) {
        list.innerHTML =
          '<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">没有找到整合包</div>';
        return;
      }

      const instanceFiles = {};
      for (const ins of instances) {
        if (!ins.Exists) continue;
        const entries = await ScanModelEntries(ins.CustomDir);
        instanceFiles[ins.Name] = (entries || []).map((e) => ({
          name: e.Name.replace(/\.ban$/i, ""),
        }));
      }

      const nameMap = {};
      for (const [insName, files] of Object.entries(instanceFiles)) {
        for (const f of files) {
          if (!nameMap[f.name]) nameMap[f.name] = [];
          nameMap[f.name].push(insName);
        }
      }

      const conflicts = Object.entries(nameMap)
        .filter(([, v]) => v.length > 1)
        .sort((a, b) => b[1].length - a[1].length);

      if (!conflicts.length) {
        list.innerHTML =
          '<div class="stat-row" style="padding:12px;color:#a6e3a1;font-size:11px">✅ 未检测到文件名冲突</div>';
        return;
      }

      let html = `<div class="stat-row" style="padding:8px 12px;color:#f38ba8;font-size:11px">⚠️ 发现 ${conflicts.length} 个文件存在于多个整合包</div>`;
      conflicts.slice(0, 50).forEach(([name, insNames]) => {
        html += `<div class="conflict-row">
<span class="conflict-name">${this._esc(name)}</span>
<span class="conflict-ver">${insNames.length} 个整合包</span>
</div>`;
        insNames.forEach((n) => {
          html += `<div class="conflict-ins">&nbsp;&nbsp;📦 ${this._esc(n)}</div>`;
        });
      });
      if (conflicts.length > 50) {
        html += `<div class="stat-row" style="padding:8px 12px;color:#6c7086;font-size:10px">...还有 ${conflicts.length - 50} 个</div>`;
      }
      list.innerHTML = html;
    } catch (err) {
      list.innerHTML = `<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">扫描失败: ${this._esc(String(err))}</div>`;
    }
  }

  _initDownloads() {
    initImportQueue(this);
  }

  _initWorkshop() {
    const root = this._root;
    const grid = root.getElementById("ws-grid");
    const browserEl = root.getElementById("ws-browser");
    const iframe = root.getElementById("ws-iframe");
    const urlEl = root.getElementById("ws-url");
    const blockedEl = root.getElementById("ws-blocked");
    const popup = root.getElementById("ws-popup");
    const sourceInfo = root.getElementById("ws-source-info");
    const searchResults = root.getElementById("ws-search-results");
    const creatorView = root.getElementById("ws-creator-view");
    const creatorList = root.getElementById("ws-cr-list");
    const creatorTitle = root.getElementById("ws-cr-title");
    let currentSite = null;
    let allCreators = [];
    let repoAuthors = [];
    let wsEditMode = false; // 创意工坊创作者编辑模式（放在外面以持久化）
    let repoModelCache = {}; // { repoName: { models, source, localMap } } 模型列表缓存

    // 分组定义
    const GROUP_LABELS = {
      search: { icon: "🔍", label: "搜索平台" },
      repo: { icon: "📦", label: "模型仓库" },
      browse: { icon: "👁️", label: "浏览平台" },
    };

    // 替换 {{q}} 为查询词
    const fillSearch = (tpl, q) =>
      tpl.replace(/\{\{q\}\}/g, encodeURIComponent(q));

    // 加载数据
    const loadSites = async () => {
      grid.innerHTML =
        '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">⏳ 加载中...</div>';
      try {
        const App = await import("../../../wailsjs/go/main/App.js");
        const [sites, creators, authors] = await Promise.all([
          App.LoadWorkshopSites(),
          App.LoadWorkshopCreators(),
          App.ListModelAuthors(),
        ]);
        allCreators = creators || [];
        repoAuthors = authors || [];
        renderCards(sites);
        grid._wsSites = sites;
        sourceInfo.textContent = sites.length + " 站点 · JSON驱动";
      } catch (e) {
        grid.innerHTML =
          '<div style="padding:24px;text-align:center;color:#f38ba8;font-size:11px">加载失败</div>';
      }
    };

    // 渲染左栏卡片（按分组）
    const renderCards = (sites) => {
      // 按分组排列
      const groups = {};
      sites.forEach((s) => {
        const g = s.group || "browse";
        if (!groups[g]) groups[g] = [];
        groups[g].push(s);
      });

      let html = "";
      const order = ["search", "repo", "browse"];
      order.forEach((g) => {
        if (!groups[g] || !groups[g].length) return;
        const info = GROUP_LABELS[g] || { icon: "🔗", label: g };
        html +=
          '<div style="font-size:9px;font-weight:600;color:var(--muted);padding:8px 8px 2px">' +
          info.icon +
          " " +
          info.label +
          "</div>";
        groups[g].forEach((s, i) => {
          const globalIdx = sites.indexOf(s);
          html +=
            '<div class="ws-card" data-index="' +
            globalIdx +
            '" data-group="' +
            g +
            '">' +
            '<div class="ws-card-icon">' +
            (s.icon || "🔗") +
            "</div>" +
            '<div class="ws-card-body">' +
            '<div class="ws-card-label">' +
            this._esc(s.label) +
            "</div>" +
            '<div class="ws-card-desc">' +
            this._esc(s.desc) +
            "</div>" +
            "</div>" +
            "</div>";
        });
      });

      grid.innerHTML = html;

      grid.querySelectorAll(".ws-card").forEach((card) => {
        card.addEventListener("click", () => {
          grid
            .querySelectorAll(".ws-card")
            .forEach((c) => c.classList.remove("active"));
          card.classList.add("active");
          const idx = parseInt(card.dataset.index, 10);
          const sitesData = grid._wsSites;
          if (sitesData && sitesData[idx]) {
            currentSite = sitesData[idx];
            showSiteView(currentSite);
            const rect = card.getBoundingClientRect();
            showPopup(rect);
          }
        });
      });
    };

    // 二级菜单
    const showPopup = (rect) => {
      popup.style.display = "";
      popup.style.top = rect.bottom + 4 + "px";
      popup.style.left = Math.max(4, rect.left) + "px";
    };
    const hidePopup = () => {
      popup.style.display = "none";
    };

    popup.querySelectorAll(".ws-popup-item").forEach((item) => {
      item.addEventListener("click", () => {
        if (!currentSite) return;
        if (item.dataset.action === "browser") {
          window.open(currentSite.url, "_blank");
          hidePopup();
        } else if (item.dataset.action === "embed") {
          hidePopup();
          openEmbedded(currentSite);
        }
      });
    });

    root.addEventListener("click", (e) => {
      if (!e.target.closest(".ws-popup") && !e.target.closest(".ws-card"))
        hidePopup();
    });

    // 内嵌浏览
    const PROXY_PORT = 18080;
    const PROXY_BASE = "http://127.0.0.1:" + PROXY_PORT + "/proxy?url=";
    const openEmbedded = async (site) => {
      try {
        const { StartProxy } = await import("../../../wailsjs/go/main/App.js");
        await StartProxy(PROXY_PORT);
      } catch (_) {}
      urlEl.textContent = site.url;
      iframe.style.display = "";
      iframe.src = PROXY_BASE + encodeURIComponent(site.url);
      browserEl.style.display = "flex";
      blockedEl.style.display = "none";
    };

    root.getElementById("ws-back").addEventListener("click", () => {
      iframe.src = "";
      browserEl.style.display = "none";
    });
    const openCurrent = () => {
      if (currentSite) window.open(currentSite.url, "_blank");
    };
    root.getElementById("ws-open").addEventListener("click", openCurrent);
    root
      .getElementById("ws-open-fallback")
      .addEventListener("click", openCurrent);

    root.getElementById("ws-refresh").addEventListener("click", loadSites);

    // 站点导出/导入
    root
      .getElementById("ws-export-btn")
      ?.addEventListener("click", async () => {
        try {
          const { ExportWorkshopSitesJSONFile } =
            await import("../../../wailsjs/go/main/App.js");
          const path = await ExportWorkshopSitesJSONFile();
          bus.emit("toast:show", {
            msg: "📤 站点已导出: " + path,
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
    root
      .getElementById("ws-import-btn")
      ?.addEventListener("click", async () => {
        try {
          const { ImportWorkshopSitesJSONFile } =
            await import("../../../wailsjs/go/main/App.js");
          const n = await ImportWorkshopSitesJSONFile();
          await loadSites();
          bus.emit("toast:show", {
            msg: "✅ 已导入 " + n + " 个站点",
            duration: 2000,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ 导入失败: " + String(e),
            duration: 4000,
            type: "error",
          });
        }
      });

    // ===== 右栏：JSON驱动的站点视图 =====
    const showSiteView = (site) => {
      searchResults.innerHTML = "";
      creatorView.style.display = "none";

      // 筛选当前站点创作者
      const creators = allCreators.filter(
        (cr) => cr.type && cr.type.split(";").includes(site.id),
      );
      console.log(
        "[workshop] showSiteView:",
        site.id,
        "allCreators:",
        allCreators.length,
        "matched:",
        creators.length,
        "wsEditMode:",
        wsEditMode,
      );

      // 按固定顺序构建 HTML
      let parts = [];

      // 1. 滚动容器
      parts.push('<div style="flex:1;overflow-y:auto">');

      // 2. 预设搜索按钮（如果有）
      if (site.presetSearches && site.presetSearches.length) {
        parts.push(
          '<div style="padding:8px 12px 4px;display:flex;gap:4px;flex-wrap:wrap">' +
            site.presetSearches
              .map(
                (ps) =>
                  '<button class="ws-preset-btn" data-q="' +
                  this._esc(ps.q) +
                  '" style="padding:2px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--accent);cursor:pointer;font-size:9px">' +
                  this._esc(ps.label) +
                  "</button>",
              )
              .join("") +
            "</div>",
        );
      }

      // 3. 创作者列表
      if (!wsEditMode && creators.length) {
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
                this._esc(cr.name) +
                '">' +
                '<div class="ws-creator-icon">🎨</div>' +
                '<div class="ws-creator-body">' +
                '<div class="ws-creator-name">' +
                this._esc(cr.name) +
                "</div>" +
                '<div class="ws-creator-desc">' +
                this._esc(cr.desc) +
                "</div>" +
                "</div>" +
                (hasRepo
                  ? '<button class="ws-browse-repo" data-repo="' +
                    this._esc(cr.name) +
                    '" style="padding:4px 12px;border-radius:6px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:11px;flex-shrink:0">📦 浏览</button>'
                  : "") +
                '<div class="ws-creator-action">↗</div>' +
                "</div>"
              );
            })
            .join(""),
        );
      } else if (wsEditMode) {
        parts.push(
          '<div style="padding:6px 12px 4px;display:flex;align-items:center;gap:4px">' +
            '<span style="font-size:10px;font-weight:600;color:var(--txt)">✏️ 编辑创作者</span>' +
            '<span style="flex:1"></span>' +
            '<button class="ws-cr-export-btn" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:9px">📤</button>' +
            '<button class="ws-cr-import-btn" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:9px">📥</button>' +
            '<button class="ws-cr-view-btn" style="padding:4px 12px;border-radius:6px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">✅ 完成</button>' +
            '<button class="ws-cr-save-btn" style="padding:4px 14px;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:11px">💾 保存</button>' +
            "</div>",
        );
        creators.forEach((cr, idx) => {
          parts.push(
            '<div style="display:flex;align-items:center;gap:3px;padding:4px 6px;border-radius:4px;border:1px solid var(--bd);font-size:10px;margin:1px 12px">' +
              "<span>🎨</span>" +
              '<input class="ws-cr-ed" data-idx="' +
              idx +
              '" data-fld="name" value="' +
              this._esc(cr.name) +
              '" style="flex:2;min-width:30px;padding:2px 4px;border-radius:3px;border:1px solid transparent;background:transparent;color:var(--txt);font-size:10px">' +
              '<input class="ws-cr-ed" data-idx="' +
              idx +
              '" data-fld="desc" value="' +
              this._esc(cr.desc) +
              '" style="flex:2;min-width:30px;padding:2px 4px;border-radius:3px;border:1px solid transparent;background:transparent;color:var(--muted);font-size:9px">' +
              '<input class="ws-cr-ed" data-idx="' +
              idx +
              '" data-fld="type" value="' +
              this._esc(cr.type) +
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

      // 4. 关闭滚动容器
      parts.push("</div>");

      let html = parts.join("");

      if (!site.presetSearches?.length && !creators.length && !wsEditMode) {
        // 无内容时显示 fallback
        html =
          '<div style="flex:1;overflow-y:auto;padding:12px;color:var(--muted);font-size:10px">此站点无可操作内容。<br>点击「浏览器打开」访问：<br><a href="' +
          this._esc(site.url) +
          '" target="_blank" style="color:var(--accent)">' +
          this._esc(site.url) +
          "</a></div>";
      }

      searchResults.innerHTML = html;
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
            // 如果点的是浏览按钮不触发跳转
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

      // 📦 浏览 GitHub 仓库模型（双回退：raw → API）
      searchResults.querySelectorAll(".ws-browse-repo").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const repo = btn.dataset.repo;
          btn.textContent = "⏳";

          // 进度条
          const setProgress = (pct, label) => {
            searchResults.innerHTML =
              '<div style="padding:24px 12px;text-align:center">' +
              "<style>" +
              "@keyframes ws-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}" +
              "@keyframes ws-stripes{from{background-position:0 0}to{background-position:14px 100%}}" +
              "</style>" +
              '<div style="font-size:10px;color:var(--muted);margin-bottom:8px">' +
              '<span style="display:inline-block;vertical-align:middle;animation:ws-spin 1.2s linear infinite">⏳</span> ' +
              '<span style="vertical-align:middle">' +
              this._esc(label || "") +
              "</span></div>" +
              '<div style="width:160px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto;overflow:hidden">' +
              '<div style="width:' +
              pct +
              "%;height:100%;border-radius:2px;transition:width 0.3s" +
              (pct < 100
                ? ";background:linear-gradient(90deg,var(--accent) 40%,rgba(137,180,250,.4) 40%,rgba(137,180,250,.4) 60%,var(--accent) 60%);background-size:14px 100%;animation:ws-stripes .4s linear infinite"
                : ";background:var(--accent)") +
              '"></div>' +
              "</div>" +
              "</div>";
          };

          let usedSource = "";
          let countdownTimer = null;

          const startCountdown = (label) => {
            if (countdownTimer) clearInterval(countdownTimer);
            let p = 50;
            setProgress(p, label || "");
            countdownTimer = setInterval(() => {
              p = Math.max(10, p - 10);
              setProgress(p, label || "");
            }, 1000);
          };

          const stopCountdown = () => {
            if (countdownTimer) {
              clearInterval(countdownTimer);
              countdownTimer = null;
            }
          };

          const tryFetchModels = async (mirror) => {
            // 定义三个可用的获取方案
            const attempts = [
              {
                name: "raw",
                url:
                  "https://raw.githubusercontent.com/" +
                  repo +
                  "/main/index.json",
                label: "⏳ 正在连接 raw.githubusercontent.com…",
              },
              {
                name: "jsd",
                url: "https://cdn.jsdelivr.net/gh/" + repo + "@main/index.json",
                label: "⏳ 正在连接 cdn.jsdelivr.net…",
              },
              {
                name: "api",
                url:
                  "https://api.github.com/repos/" +
                  repo +
                  "/contents/index.json",
                label: "⏳ 正在连接 api.github.com…",
              },
            ];

            // 根据镜像设置排序
            const sorted =
              mirror === "jsdelivr"
                ? [attempts[1], attempts[0], attempts[2]] // jsd → raw → api
                : mirror === "githubapi"
                  ? [attempts[2], attempts[0], attempts[1]] // api → raw → jsd
                  : attempts; // raw → jsd → api（默认）

            for (const attempt of sorted) {
              const ctrl = new AbortController();
              const tmr = setTimeout(() => ctrl.abort(), 5000);
              startCountdown(attempt.label);
              try {
                const resp = await fetch(attempt.url, {
                  signal: ctrl.signal,
                });
                clearTimeout(tmr);
                stopCountdown();
                if (resp.ok) {
                  setProgress(70, "⏳ 解析模型列表中…");
                  let models;
                  if (attempt.name === "api") {
                    // API 返回 base64
                    const data = await resp.json();
                    if (data.encoding !== "base64" || !data.content) continue;
                    const binary = atob(data.content.replace(/\n/g, ""));
                    const bytes = Uint8Array.from(binary, (c) =>
                      c.charCodeAt(0),
                    );
                    const json = new TextDecoder().decode(bytes);
                    models = JSON.parse(json);
                  } else {
                    models = await resp.json();
                  }
                  if (models && models.length) {
                    usedSource = attempt.name;
                    return models;
                  }
                }
              } catch (_) {
                clearTimeout(tmr);
                stopCountdown();
                // 失败就试下一个
              }
            }
            throw new Error("All sources failed");
          };

          // 加载镜像配置
          let mirror = "";
          try {
            const { LoadAppConfig } =
              await import("../../../wailsjs/go/main/App.js");
            const cfg = await LoadAppConfig();
            mirror = cfg.mirror || "";
          } catch (_) {}

          setProgress(10, "⏳ 准备中…");
          try {
            // 检查缓存
            if (repoModelCache[repo]) {
              const cached = repoModelCache[repo];
              setProgress(100, "✅ 加载完成（缓存）");
              await new Promise((r) => setTimeout(r, 100));
              await showRepoModels(repo, cached.models, cached.source);
              btn.textContent = "📦 浏览";
              return;
            }
            stopCountdown();
            const models = await tryFetchModels(mirror);
            stopCountdown();
            // 写入缓存
            repoModelCache[repo] = { models, source: usedSource };
            setProgress(100, "✅ 加载完成");
            await new Promise((r) => setTimeout(r, 200));
            await showRepoModels(repo, models, usedSource);
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
              ?.addEventListener("click", () => {
                if (currentSite) showSiteView(currentSite);
              });
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
      const refreshView = () => {
        showSiteView(site);
      };

      searchResults
        .querySelector(".ws-cr-edit-btn")
        ?.addEventListener("click", () => {
          wsEditMode = true;
          refreshView();
        });

      searchResults
        .querySelector(".ws-cr-view-btn")
        ?.addEventListener("click", () => {
          wsEditMode = false;
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
            wsEditMode = false;
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
            // 合并到 allCreators
            fresh.forEach((cr) => {
              if (!allCreators.find((c) => c.name === cr.name)) {
                allCreators.push(cr);
              }
            });
            wsEditMode = false;
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
      searchResults
        .querySelector(".ws-cr-add")
        ?.addEventListener("click", () => {
          creators.push({ name: "新作者", desc: "描述", type: site.id });
          // 确保 allCreators 里也有
          allCreators.push(creators[creators.length - 1]);
          refreshView();
        });
    };

    // 📦 显示 GitHub 仓库模型列表（比对本地已有文件）
    const showRepoModels = async (repo, models, source) => {
      // 加载本地仓库已有文件列表 + 镜像配置
      let localMap = new Map();
      let mirror = "";
      try {
        const { LoadAppConfig, ScanModelEntries } =
          await import("../../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        mirror = cfg.mirror || "";
        const repoRoot = cfg.repoRoot || "";
        if (repoRoot) {
          const entries = await ScanModelEntries(repoRoot);
          entries.forEach((e) => {
            let n = e.Name || "";
            if (n.endsWith(".ban")) n = n.slice(0, -4);
            localMap.set(n, e.Hash || "");
          });
        }
      } catch (_) {
        // 加载失败不影响列表显示
      }

      // 根据镜像源选择下载 URL 前缀
      // 选 jsDelivr 时下载优先走 CDN；选 GitHub API 时走 raw（Go 端内部会按配置回退）
      const dlPrefix =
        mirror === "jsdelivr"
          ? "https://cdn.jsdelivr.net/gh/" + repo + "@main/"
          : "https://raw.githubusercontent.com/" + repo + "/main/";

      const sourceLabel =
        (source === "raw"
          ? '<span style="font-size:8px;padding:1px 4px;border-radius:3px;background:rgba(137,180,250,.15);color:var(--accent)">raw</span>'
          : source === "jsd"
            ? '<span style="font-size:8px;padding:1px 4px;border-radius:3px;background:rgba(250,179,135,.15);color:#fab387">⚡jsd</span>'
            : source === "api"
              ? '<span style="font-size:8px;padding:1px 4px;border-radius:3px;background:rgba(166,227,161,.15);color:var(--success,#4caf50)">API</span>'
              : "") +
        (mirror === "jsdelivr"
          ? '<span style="font-size:8px;padding:1px 4px;border-radius:3px;background:rgba(250,179,135,.15);color:#fab387;margin-left:2px">⚡CDN</span>'
          : mirror === "githubapi"
            ? '<span style="font-size:8px;padding:1px 4px;border-radius:3px;background:rgba(166,227,161,.15);color:var(--success,#4caf50);margin-left:2px">🐙API</span>'
            : "");

      let showAll = false;
      let selectedSet = new Set(); // 选中下载的模型名

      const isMissing = (m) => {
        return m.hash
          ? !(
              Array.from(localMap.values()).some((h) => h && h === m.hash) ||
              localMap.has(m.name)
            )
          : !localMap.has(m.name);
      };

      const renderList = (filter = "") => {
        const q = filter.trim().toLowerCase();
        let filtered = q
          ? models.filter((m) => m.name.toLowerCase().includes(q))
          : models;
        if (!showAll) {
          filtered = filtered.filter((m) => isMissing(m));
        }
        const frag = document.createDocumentFragment();
        const esc = (s) => this._esc(s);
        if (!filtered.length) {
          const empty = document.createElement("div");
          empty.style.cssText =
            "padding:12px;text-align:center;color:var(--muted);font-size:10px";
          empty.textContent = "🔍 没有匹配的模型";
          frag.appendChild(empty);
          return frag;
        }
        filtered.forEach((m) => {
          const exists = !isMissing(m);
          const row = document.createElement("div");
          row.className = "model-row";
          row.dataset.id = String(models.indexOf(m));
          row.dataset.name = m.name;
          row.style.cssText =
            "display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;border:1px solid var(--bd);font-size:11px;margin-bottom:6px;cursor:context-menu;transition:background .15s" +
            (exists
              ? ";opacity:.6;background:rgba(166,227,161,.06)"
              : ";background:rgba(243,139,168,.04)");

          // 复选框（仅未下载的）
          if (!exists) {
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.className = "ws-sel";
            cb.dataset.name = m.name;
            cb.checked = selectedSet.has(m.name);
            cb.style.cursor = "pointer;flex-shrink:0";
            row.appendChild(cb);
          }

          // 信息区（文件名 + 大小）
          const info = document.createElement("div");
          info.style.cssText =
            "flex:1;min-width:0;display:flex;flex-direction:column;gap:1px";

          // 文件名（加粗）
          const nameSpan = document.createElement("span");
          nameSpan.style.cssText =
            "font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt);font-size:11px";
          nameSpan.textContent = m.name;
          info.appendChild(nameSpan);

          // 大小（灰色小字）
          const sizeSpan = document.createElement("span");
          sizeSpan.style.cssText = "font-size:9px;color:var(--muted)";
          sizeSpan.textContent = m.size
            ? (m.size / 1024).toFixed(0) + "KB"
            : "";
          info.appendChild(sizeSpan);

          row.appendChild(info);

          // 状态按钮
          if (exists) {
            const badge = document.createElement("span");
            badge.style.cssText =
              "padding:2px 8px;border-radius:4px;font-size:10px;color:var(--success,#4caf50);flex-shrink:0";
            badge.textContent = "✅ 已有";
            row.appendChild(badge);
          } else {
            const dlBtn = document.createElement("button");
            dlBtn.className = "ws-dl-model";
            dlBtn.dataset.url = dlPrefix + m.path.replace(/\\/g, "/");
            dlBtn.dataset.name = m.name;
            dlBtn.dataset.size = String(m.size || 0);
            dlBtn.style.cssText =
              "padding:3px 10px;border-radius:6px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px;flex-shrink:0;transition:all .15s";
            dlBtn.textContent = "⬇️";
            // 悬停时亮起
            dlBtn.onmouseenter = () => {
              dlBtn.style.borderColor = "var(--accent)";
              dlBtn.style.color = "var(--accent)";
            };
            dlBtn.onmouseleave = () => {
              dlBtn.style.borderColor = "var(--bd)";
              dlBtn.style.color = "var(--muted)";
            };
            row.appendChild(dlBtn);
          }

          // 整行悬停高亮
          row.onmouseenter = () => {
            row.style.background = exists
              ? "rgba(166,227,161,.1)"
              : "rgba(243,139,168,.08)";
          };
          row.onmouseleave = () => {
            row.style.background = exists
              ? "rgba(166,227,161,.06)"
              : "rgba(243,139,168,.04)";
          };

          frag.appendChild(row);
        });
        return frag;
      };

      const missingCount = models.filter((m) => {
        const exists = m.hash
          ? Array.from(localMap.values()).some((h) => h && h === m.hash) ||
            localMap.has(m.name)
          : localMap.has(m.name);
        return !exists;
      }).length;

      searchResults.innerHTML =
        '<div style="flex:1;overflow-y:auto;padding:0 12px">' +
        '<div style="padding:8px 0 4px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
        '<button class="ws-back-repo" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:10px">← 返回</button>' +
        '<span style="font-size:11px;font-weight:600;color:var(--txt)">📦 ' +
        this._esc(repo) +
        "</span>" +
        sourceLabel +
        '<span style="font-size:9px;color:var(--muted)">' +
        models.length +
        " 个模型</span>" +
        (missingCount > 0
          ? '<span style="font-size:9px;color:var(--accent);margin-left:auto">⬇️' +
            missingCount +
            "</span>" +
            '<button class="ws-dl-selected" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:9px;opacity:.4;pointer-events:none">⬇️ 选中 (0)</button>'
          : "") +
        '<button class="ws-filter-btn" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:10px">⚙️ 筛选</button>' +
        '<div class="ws-filter-dropdown" style="display:none;width:100%;padding:4px 0 2px;gap:4px;flex-wrap:wrap">' +
        (missingCount > 0
          ? '<button class="ws-dl-all" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:9px">⬇️ 下载全部缺失</button>' +
            '<button class="ws-select-all" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:9px">☐ 全选</button>'
          : "") +
        '<button class="ws-toggle-all" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:9px">' +
        (showAll ? "📁 显示全部" : "📁 仅显示缺失") +
        "</button>" +
        "</div>" +
        "</div>" +
        '<div id="ws-queue-status" style="display:none;padding:4px 12px;background:var(--surf);border-bottom:1px solid var(--bd);font-size:10px;color:var(--txt)"></div>' +
        '<div style="padding:2px 0 6px">' +
        '<input id="ws-repo-srch" type="text" placeholder="🔍 搜索模型名称" style="width:100%;box-sizing:border-box;padding:4px 8px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:10px;outline:none">' +
        "</div>" +
        '<div id="ws-repo-list"></div>' +
        "</div>";
      // 用 DOM API 渲染列表，避免字符串拼接的陷阱
      const listContainer = searchResults.querySelector("#ws-repo-list");
      if (listContainer) listContainer.appendChild(renderList());

      // 返回
      searchResults
        .querySelector(".ws-back-repo")
        ?.addEventListener("click", () => {
          if (currentSite) showSiteView(currentSite);
        });

      // 搜索过滤
      const srch = searchResults.querySelector("#ws-repo-srch");
      if (srch) {
        srch.addEventListener("input", () => {
          const list = searchResults.querySelector("#ws-repo-list");
          if (list) {
            list.replaceChildren(renderList(srch.value));
          }
        });
      }

      // 📁 显示全部 切换
      const toggleBtn = searchResults.querySelector(".ws-toggle-all");
      if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
          showAll = !showAll;
          toggleBtn.textContent = showAll ? "📁 显示全部" : "📁 仅显示缺失";
          toggleBtn.style.borderColor = showAll ? "var(--accent)" : "var(--bd)";
          toggleBtn.style.color = showAll ? "var(--accent)" : "var(--txt)";
          const list = searchResults.querySelector("#ws-repo-list");
          const srch = searchResults.querySelector("#ws-repo-srch");
          if (list) list.replaceChildren(renderList(srch?.value || ""));
        });
      }

      // ⚙️ 筛选下拉展开/收起
      const filterBtn = searchResults.querySelector(".ws-filter-btn");
      const filterDropdown = searchResults.querySelector(".ws-filter-dropdown");
      if (filterBtn && filterDropdown) {
        filterBtn.addEventListener("click", () => {
          const isOpen = filterDropdown.style.display === "flex";
          filterDropdown.style.display = isOpen ? "none" : "flex";
          filterBtn.textContent = isOpen ? "⚙️ 筛选" : "⚙️ 收起";
        });
      }

      // ⬇️ 下载缺失（通过下载队列串行执行）
      const dlAllBtn = searchResults.querySelector(".ws-dl-all");
      const queueStatus = searchResults.querySelector("#ws-queue-status");
      if (dlAllBtn) {
        dlAllBtn.addEventListener("click", async () => {
          const missing = models.filter((m) => isMissing(m));
          if (!missing.length) return;
          const ok = await modalConfirm({
            title: "批量下载",
            icon: "⬇️",
            message:
              "将从 0 号模型开始依次下载 " +
              missing.length +
              " 个模型，每 10 秒下载一个，是否继续？",
            okText: "开始下载",
          });
          if (!ok) return;
          dlAllBtn.disabled = true;
          // 构造队列任务
          const { LoadAppConfig, EnqueueDownloads, CancelQueue } =
            await import("../../../wailsjs/go/main/App.js");
          const cfg = await LoadAppConfig();
          const repoRoot = cfg.repoRoot || "";
          if (!repoRoot) {
            bus.emit("toast:show", {
              msg: "请先在设置中配置仓库目录",
              duration: 3000,
              type: "warn",
            });
            dlAllBtn.disabled = false;
            return;
          }
          const tasks = missing.map((m) => ({
            url: dlPrefix + m.path.replace(/\\/g, "/"),
            saveDir: repoRoot,
            name: m.name,
            size: m.size || 0,
          }));
          await EnqueueDownloads(tasks);

          // 监听队列状态
          const offEvents = () => {
            if (window.runtime?.EventsOff) {
              window.runtime.EventsOff("queue:status");
              window.runtime.EventsOff("queue:file-start");
              window.runtime.EventsOff("queue:file-done");
            }
          };
          const onQueueStatus = (status, total, currentName) => {
            if (status === "done" || status === "cancelled") {
              dlAllBtn.disabled = false;
              dlAllBtn.textContent =
                status === "done" ? "✅ 下载完成" : "⏹ 已取消";
              queueStatus.style.display = "none";
              offEvents();
              setTimeout(() => showRepoModels(repo, models, source), 1000);
            }
          }; // end onQueueStatus
          const onFileStart = (name, total, remaining) => {
            const done = total - remaining;
            dlAllBtn.textContent = "⬇️ " + done + "/" + total;
            queueStatus.style.display = "block";
            queueStatus.innerHTML =
              '<span style="color:var(--accent)">⬇️</span> ' +
              this._esc(name) +
              ' <span style="color:var(--muted)">(' +
              done +
              "/" +
              total +
              ")</span>" +
              ' <button class="ws-cancel-queue" style="margin-left:auto;padding:1px 6px;border-radius:3px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:9px">✕ 取消</button>';
            queueStatus
              .querySelector(".ws-cancel-queue")
              ?.addEventListener("click", async () => {
                await CancelQueue();
              });
          }; // end onFileStart
          const onFileDone = (name, status, errMsg) => {
            if (status === "fail") {
              queueStatus.innerHTML +=
                '<div style="color:#f38ba8;font-size:9px">❌ ' +
                this._esc(name) +
                ": " +
                this._esc(errMsg || "") +
                "</div>";
            }
          }; // end onFileDone
          if (window.runtime?.EventsOn) {
            window.runtime.EventsOn("queue:status", onQueueStatus);
            window.runtime.EventsOn("queue:file-start", onFileStart);
            window.runtime.EventsOn("queue:file-done", onFileDone);
          }
        }); // end dlAllBtn.addEventListener
      } // end if (dlAllBtn)

      // 复选框 → 更新选中计数（数据层 + DOM 同步）
      const updateSelectedUI = () => {
        const checked = selectedSet.size;
        const btn = searchResults.querySelector(".ws-dl-selected");
        if (btn) {
          btn.textContent = "⬇️ 下载选中 (" + checked + ")";
          btn.style.opacity = checked > 0 ? "1" : ".4";
          btn.style.pointerEvents = checked > 0 ? "auto" : "none";
        }
      };
      const selContainer = searchResults.querySelector("#ws-repo-list");
      if (selContainer) {
        selContainer.addEventListener("change", (e) => {
          if (!e.target.classList.contains("ws-sel")) return;
          const name = e.target.dataset.name;
          if (e.target.checked) selectedSet.add(name);
          else selectedSet.delete(name);
          updateSelectedUI();
        });
      }

      // ⬇️ 下载选中
      const dlSelBtn = searchResults.querySelector(".ws-dl-selected");
      if (dlSelBtn) {
        dlSelBtn.addEventListener("click", async () => {
          if (!selectedSet.size) return;
          const tasks = [...selectedSet]
            .map((name) => models.find((m) => m.name === name))
            .filter(Boolean)
            .map((m) => ({
              url: dlPrefix + m.path.replace(/\\/g, "/"),
              saveDir: "",
              name: m.name,
              size: m.size || 0,
            }));
          const { LoadAppConfig, EnqueueDownloads } =
            await import("../../../wailsjs/go/main/App.js");
          const cfg = await LoadAppConfig();
          const repoRoot = cfg.repoRoot || "";
          if (!repoRoot) {
            bus.emit("toast:show", {
              msg: "请先在设置中配置仓库目录",
              duration: 3000,
              type: "warn",
            });
            return;
          }
          tasks.forEach((t) => (t.saveDir = repoRoot));
          await EnqueueDownloads(tasks);
          // 监听队列完成
          const h = async (status) => {
            if (status === "done" || status === "cancelled") {
              window.runtime?.EventsOff("queue:status");
              window.runtime?.EventsOff("queue:file-start");
              window.runtime?.EventsOff("queue:file-done");
              selectedSet.clear();
              const srch = searchResults.querySelector("#ws-repo-srch");
              const list = searchResults.querySelector("#ws-repo-list");
              if (list && srch) {
                const { ScanModelEntries } =
                  await import("../../../wailsjs/go/main/App.js");
                const entries = await ScanModelEntries(repoRoot);
                localMap = new Map();
                entries.forEach((e) => {
                  let n = e.Name || "";
                  if (n.endsWith(".ban")) n = n.slice(0, -4);
                  localMap.set(n, e.Hash || "");
                });
                list.replaceChildren(renderList(srch.value));
              }
            }
          };
          window.runtime?.EventsOn("queue:status", h);
          window.runtime?.EventsOn("queue:file-start", (name, total, rem) => {
            const qs = searchResults.querySelector("#ws-queue-status");
            if (qs) {
              qs.style.display = "block";
              qs.innerHTML =
                "⬇️ " +
                this._esc(name) +
                " (" +
                (total - rem) +
                "/" +
                total +
                ")";
            }
          });
          window.runtime?.EventsOn("queue:file-done", (name, status) => {
            if (status === "fail" && selContainer) {
              // 失败时取消勾选，让用户可重试
              const cb = selContainer.querySelector(
                '.ws-sel[data-name="' + this._esc(name) + '"]',
              );
              if (cb) cb.checked = false;
              selectedSet.delete(name);
              updateSelectedUI();
            }
          });
        });
      }

      // ☐ 全选 / 取消全选
      const selAllBtn = searchResults.querySelector(".ws-select-all");
      if (selAllBtn) {
        selAllBtn.addEventListener("click", () => {
          const allChecked =
            selContainer?.querySelectorAll(".ws-sel:checked").length ===
            selContainer?.querySelectorAll(".ws-sel").length;
          selContainer?.querySelectorAll(".ws-sel").forEach((cb) => {
            cb.checked = !allChecked;
            if (cb.checked) selectedSet.add(cb.dataset.name);
            else selectedSet.delete(cb.dataset.name);
          });
          selAllBtn.textContent = allChecked ? "☐ 全选" : "☑ 取消全选";
          updateSelectedUI();
        });
      }

      // 右键模型行 → 查看索引信息
      const listEl = searchResults.querySelector("#ws-repo-list");
      if (listEl) {
        listEl.addEventListener("contextmenu", (e) => {
          const row = e.target.closest("[data-name]");
          if (!row) return;
          e.preventDefault();
          e.stopPropagation();
          const name = row.dataset.name;
          const m = models.find((x) => x.name === name);
          if (!m) return;
          const sizeStr = m.size ? (m.size / 1024).toFixed(0) + "KB" : "?KB";
          const items = [
            { label: "📄 " + this._esc(m.name), onClick: () => {} },
            { label: "📂 " + this._esc(m.path), onClick: () => {} },
            {
              label: "🔐 " + (m.hash ? m.hash : "—"),
              onClick: () => {},
            },
            { label: "📏 " + sizeStr, onClick: () => {} },
          ];
          bus.emit("menu:show", { x: e.clientX, y: e.clientY, items });
        });
      }

      // 下载（事件委托：⬇️ = 勾选 + 入队）
      if (listContainer) {
        listContainer.addEventListener("click", async (e) => {
          const btn = e.target.closest(".ws-dl-model");
          if (!btn) return;

          // 同步勾选同行复选框
          const cb = btn.closest(".model-row")?.querySelector(".ws-sel");
          const name = btn.dataset.name || "";
          if (cb && name) {
            cb.checked = true;
            selectedSet.add(name);
            updateSelectedUI();
          }

          const url = btn.dataset.url;
          const size = parseInt(btn.dataset.size, 10) || 0;
          const FOUR_MB = 4 * 1024 * 1024;
          const TEN_MB = 10 * 1024 * 1024;
          if (size > TEN_MB) {
            bus.emit("toast:show", {
              msg: "📏 文件超过 10MB，已拒绝下载",
              duration: 3000,
              type: "warn",
            });
            return;
          }
          if (size > FOUR_MB) {
            const ok = await modalConfirm({
              title: "文件较大",
              icon: "📏",
              message: (size / 1024 / 1024).toFixed(1) + "MB，确定要下载吗？",
              okText: "下载",
            });
            if (!ok) return;
          }
          // 入队单个文件
          btn.textContent = "⏳";
          try {
            const { LoadAppConfig, EnqueueDownloads } =
              await import("../../../wailsjs/go/main/App.js");
            const cfg = await LoadAppConfig();
            const repoRoot = cfg.repoRoot || "";
            if (!repoRoot) {
              bus.emit("toast:show", {
                msg: "请先在设置中配置仓库目录",
                duration: 3000,
                type: "warn",
              });
              btn.textContent = "⬇️";
              return;
            }
            await EnqueueDownloads([{ url, saveDir: repoRoot, name, size }]);
            // 等待队列完成这个任务
            await new Promise((resolve) => {
              const h = (s) => {
                if (s === "done" || s === "cancelled") {
                  window.runtime?.EventsOff("queue:status");
                  resolve();
                }
              };
              window.runtime?.EventsOn("queue:status", h);
            });
          } catch (_) {}
          btn.textContent = "⬇️";
        }); // end listContainer.addEventListener
      } // end if (listContainer)
    }; // end showRepoModels

    loadSites();
  }

  _initRecycle() {
    initRecycleBin(this);
  }

  async _initSettings() {
    const root = this._root;
    try {
      const {
        LoadAppConfig,
        SaveAppConfig,
        SelectDirectory,
        GetMinecraftPath,
        SetLinkMode,
        GetLinkMode,
      } = await import("../../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const mcPath = cfg.mcRoot || "";
      const repoPath = cfg.repoRoot || "";
      const linkMode = cfg.linkMode || "copy";

      // 显示当前值
      const mcEl = root.getElementById("set-mc-path");
      const repoEl = root.getElementById("set-repo-path");
      if (mcEl) mcEl.textContent = mcPath || "未设置";
      if (repoEl) repoEl.textContent = repoPath || "未设置";

      // 链接模式
      const lmRadio = root.querySelector(
        `input[name="link-mode"][value="${linkMode}"]`,
      );
      if (lmRadio) lmRadio.checked = true;

      // 主题：先读 Go 配置，再回退 localStorage
      let savedTheme = cfg.theme || cfg.Theme || "";
      if (!savedTheme) savedTheme = localStorage.getItem("theme") || "system";
      localStorage.setItem("theme", savedTheme);
      applyTheme(savedTheme);
      const themeSelect = root.getElementById("set-theme");
      if (themeSelect) themeSelect.value = savedTheme;

      // 镜像源
      const savedMirror = cfg.mirror || "";
      const mirrorSelect = root.getElementById("set-mirror");
      if (mirrorSelect) {
        mirrorSelect.value = savedMirror;
        mirrorSelect.addEventListener("change", async () => {
          const val = mirrorSelect.value;
          const { SetDownloadMirror } =
            await import("../../../wailsjs/go/main/App.js");
          await SetDownloadMirror(val);
          bus.emit("toast:show", {
            msg:
              "✅ 下载源已切换为 " +
              (val === "jsdelivr"
                ? "jsDelivr CDN"
                : val === "githubapi"
                  ? "GitHub API"
                  : "直连"),
            duration: 2000,
            type: "success",
          });
        });
      }

      // ===== 事件绑定 =====

      // 游戏路径 - 选择目录
      root
        .getElementById("set-mc-browse")
        ?.addEventListener("click", async () => {
          const dir = await SelectDirectory();
          if (!dir) return;
          const theme = localStorage.getItem("theme") || "dark";
          await SaveAppConfig(repoPath, dir, linkMode, theme);
          if (mcEl) mcEl.textContent = dir;
          // 广播配置变更
          bus.emit("config:updated");
          bus.emit("stats:refresh");
          bus.emit("toast:show", {
            msg: "✅ 游戏路径已设置",
            duration: 2000,
            type: "success",
          });
        });

      // 游戏路径 - 自动搜索
      root
        .getElementById("set-mc-detect")
        ?.addEventListener("click", async () => {
          const result = await GetMinecraftPath();
          // 返回格式如 "✅ 游戏路径: D:\PCL2\.minecraft" 或 "⚠️ 未找到"
          const match = result.match(/[✅⚠️]\s*游戏路径[:：]\s*(.+)/);
          if (match) {
            const found = match[1].trim();
            if (found) {
              const theme1 = localStorage.getItem("theme") || "dark";
              await SaveAppConfig(repoPath, found, linkMode, theme1);
              if (mcEl) mcEl.textContent = found;
              bus.emit("config:updated");
              bus.emit("stats:refresh");
              bus.emit("toast:show", {
                msg: `✅ 已自动检测到: ${found}`,
                duration: 3000,
                type: "success",
              });
              return;
            }
          }
          bus.emit("toast:show", {
            msg: result || "未找到 .minecraft 文件夹",
            duration: 3000,
            type: "warn",
          });
        });

      // 仓库路径
      root
        .getElementById("set-repo-browse")
        ?.addEventListener("click", async () => {
          const dir = await SelectDirectory();
          if (!dir) return;
          const theme = localStorage.getItem("theme") || "dark";
          await SaveAppConfig(dir, mcPath, linkMode, theme);
          if (repoEl) repoEl.textContent = dir;
          bus.emit("config:updated");
          bus.emit("stats:refresh");
          bus.emit("toast:show", {
            msg: "✅ 仓库路径已设置",
            duration: 2000,
            type: "success",
          });
        });

      // 链接模式提示切换
      const updateLinkHint = (mode) => {
        ["copy", "hardlink", "symlink"].forEach((m) => {
          const el = root.getElementById("lm-hint-" + m);
          if (el) el.style.display = m === mode ? "" : "none";
        });
      };
      updateLinkHint(linkMode);

      // 链接模式变更
      root.querySelectorAll('input[name="link-mode"]').forEach((radio) => {
        radio.addEventListener("change", async () => {
          if (!radio.checked) return;
          updateLinkHint(radio.value);
          const theme = localStorage.getItem("theme") || "dark";
          await SaveAppConfig(repoPath, mcPath, radio.value, theme);
          await SetLinkMode(radio.value);
          bus.emit("toast:show", {
            msg: `✅ 链接模式已切换至: ${radio.value}`,
            duration: 2000,
            type: "success",
          });
          // 询问是否重新链接已有模型
          const relink = await modalConfirm({
            title: "切换链接模式",
            icon: "🔗",
            message:
              "是否将已有模型重新链接为新模式？\n（将删除整合包中已安装的模型副本，用新模式重新安装）",
            okText: "重新链接",
          });
          if (!relink) return;
          try {
            const { LoadAppConfig, ListVersionInstances, RelinkCustomDir } =
              await import("../../../wailsjs/go/main/App.js");
            const cfg = await LoadAppConfig();
            const mcRoot = cfg.mcRoot || "";
            const rRoot = cfg.repoRoot || "";
            if (!mcRoot || !rRoot) return;
            const instances = await ListVersionInstances(mcRoot);
            let total = 0;
            for (const ins of instances) {
              if (!ins.Exists) continue;
              try {
                const n = await RelinkCustomDir(ins.CustomDir, rRoot);
                total += n;
              } catch {}
            }
            bus.emit("stats:refresh");
            bus.emit("toast:show", {
              msg: `🔄 已重新链接 ${total} 个文件`,
              duration: 3000,
              type: "success",
            });
          } catch (e) {
            bus.emit("toast:show", {
              msg: `❌ 重新链接失败: ${String(e)}`,
              duration: 5000,
              type: "error",
            });
          }
        });
      });

      // 主题切换
      root
        .getElementById("set-theme")
        ?.addEventListener("change", async (e) => {
          const mode = e.target.value;
          applyTheme(mode);
          localStorage.setItem("theme", mode);
          // 同步到 Go 配置
          try {
            const { SaveAppConfig } =
              await import("../../../wailsjs/go/main/App.js");
            const theme2 = localStorage.getItem("theme") || mode;
            await SaveAppConfig(repoPath, mcPath, linkMode, theme2);
          } catch {}
          const label =
            {
              cyber: "赛博霓虹",
              warm: "温暖木纹",
              pro: "极简深邃",
              system: "跟随系统",
            }[mode] || mode;
          bus.emit("toast:show", {
            msg: `✅ 主题已切换为: ${label}`,
            duration: 2000,
            type: "success",
          });
        });

      // 显示版本号
      const showVersion = async () => {
        try {
          const { CurrentVersion } =
            await import("../../../wailsjs/go/main/App.js");
          const ver = await CurrentVersion();
          const el = root.getElementById("set-version");
          if (el) el.textContent = ver;
        } catch {}
      };
      showVersion();

      // 检查更新
      initVersionUpdater(root);
    } catch (e) {
      console.error("[settings] 初始化失败:", e);
    }
  }

  _fmtSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  _esc(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
customElements.define("app-content", AppContent);
