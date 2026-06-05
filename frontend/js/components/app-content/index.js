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
import { renderDisplayName, parseModelName } from "../../utils/display.js";

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
      const confirmed = await window.showConfirm?.(
        `发现 ${totalDups} 个重复文件（${dupHashes.length} 组），移入回收站？`,
      );
      if (!confirmed) {
        list.innerHTML =
          '<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">已取消去重</div>';
        return;
      }

      let del = 0,
        fail = 0;
      const detailList = [];
      for (const [, group] of dupHashes) {
        // 保留第一个，其余移入回收站
        for (let i = 1; i < group.length; i++) {
          try {
            await MoveToRecycle(group[i].Path);
            del++;
            detailList.push({ name: group[i].Name, type: "success" });
          } catch {
            fail++;
            detailList.push({ name: group[i].Name, type: "fail" });
          }
        }
      }

      if (del > 0) {
        bus.emit("stats:refresh");
        bus.emit("tree:reload");
      }
      list.innerHTML = `<div class="stat-row" style="padding:8px 12px;font-size:11px;color:${fail > 0 ? "#f9a826" : "#a6e3a1"}">
✅ 去重完成：移入回收站 ${del} 个，失败 ${fail} 个</div>`;
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
    const root = this._root;
    const dropZone = root.getElementById("dl-drop");
    const fileInput = root.getElementById("dl-file-input");
    const importedList = root.getElementById("dl-imported-list");
    const dlCount = root.getElementById("dl-count");
    // 存储当前文件信息
    let currentFile = null;
    let currentBase64 = null;
    let currentFileName = null;
    const imported = []; // { name, time }

    const showForm = (file, base64) => {
      currentFile = file;
      currentBase64 = base64;
      currentFileName = file.name;

      const parsed = parseModelName(file.name);
      root.getElementById("dl-fname").textContent = file.name;
      root.getElementById("dl-fsize").textContent =
        file.size < 1048576
          ? (file.size / 1024).toFixed(1) + " KB"
          : (file.size / 1048576).toFixed(1) + " MB";

      root.getElementById("dl-author").value = parsed.author || "";
      root.getElementById("dl-work").value = parsed.work || "";
      root.getElementById("dl-chara").value = parsed.chara || "";
      root.getElementById("dl-variant").value = "";
      root.getElementById("dl-date").value = parsed.date || "";
      updatePreview();

      dropZone.style.display = "none";
      root.getElementById("dl-form").style.display = "flex";
    };

    const updatePreview = () => {
      const a = root.getElementById("dl-author").value.trim();
      const w = root.getElementById("dl-work").value.trim();
      const c = root.getElementById("dl-chara").value.trim();
      const v = root.getElementById("dl-variant").value.trim();
      const manualDate = root.getElementById("dl-date").value.trim();
      const autoOn = root.getElementById("dl-date-auto").checked;
      const autoDate =
        new Date().getFullYear() +
        "-" +
        String(new Date().getMonth() + 1).padStart(2, "0");
      const d = manualDate || (autoOn ? autoDate : "");
      const parts = [];
      if (a) parts.push("[" + a + "]");
      if (w) parts.push("【" + w + "】");
      parts.push(c || "?");
      if (v) parts.push("-" + v);
      if (d) parts.push("(" + d + ")");
      root.getElementById("dl-preview").textContent =
        parts.join(" ") + "." + (currentFileName?.split(".").pop() || "ysm");
    };

    ["dl-author", "dl-work", "dl-chara", "dl-variant", "dl-date"].forEach(
      (id) => {
        root.getElementById(id)?.addEventListener("input", updatePreview);
      },
    );
    root
      .getElementById("dl-date-auto")
      ?.addEventListener("change", updatePreview);

    // 拖拽事件
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.style.borderColor = "var(--accent)";
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.style.borderColor = "";
    });
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.style.borderColor = "";
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const ext = file.name.split(".").pop().toLowerCase();
      if (!["ysm", "zip", "7z"].includes(ext)) {
        bus.emit("toast:show", {
          msg: "仅支持 .ysm / .zip / .7z",
          duration: 3000,
          type: "warn",
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => showForm(file, reader.result.split(",")[1]);
      reader.readAsDataURL(file);
    });

    // 点击选择文件
    dropZone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => showForm(file, reader.result.split(",")[1]);
      reader.readAsDataURL(file);
    });

    // 导入按钮
    root.getElementById("dl-import")?.addEventListener("click", async () => {
      const a = root.getElementById("dl-author").value.trim();
      const w = root.getElementById("dl-work").value.trim();
      const c = root.getElementById("dl-chara").value.trim();
      const v = root.getElementById("dl-variant").value.trim();
      const d = root.getElementById("dl-date").value.trim();
      const ext = currentFileName?.split(".").pop() || "ysm";

      if (!a || !w || !c) {
        bus.emit("toast:show", {
          msg: "作者、作品品牌、角色名不能为空",
          duration: 3000,
          type: "warn",
        });
        return;
      }

      const newName =
        "[" +
        a +
        "]【" +
        w +
        "】" +
        c +
        (v ? "-" + v : "") +
        (d ? "(" + d + ")" : "") +
        "." +
        ext;

      try {
        const { LoadAppConfig, ImportModelFile } =
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
        await ImportModelFile(newName, currentBase64);
        bus.emit("stats:refresh");
        bus.emit("tree:reload");
        bus.emit("toast:show", {
          msg: "✅ 已导入: " + newName,
          duration: 3000,
          type: "success",
        });

        // 加入已导入列表
        imported.unshift({
          name: newName,
          time: new Date().toLocaleTimeString(),
        });
        renderImportedList();

        // 重置表单
        currentFile = null;
        currentBase64 = null;
        currentFileName = null;
        root.getElementById("dl-form").style.display = "none";
        dropZone.style.display = "flex";
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ 导入失败: " + String(e),
          duration: 5000,
          type: "error",
        });
      }
    });

    // 渲染已导入列表
    const renderImportedList = () => {
      if (!imported.length) {
        importedList.innerHTML =
          '<div style="padding:6px 4px;font-size:10px;color:var(--muted)">暂无导入记录</div>';
        dlCount.textContent = "0 个文件";
        return;
      }
      dlCount.textContent = imported.length + " 个文件";
      importedList.innerHTML = imported
        .map(
          (item, i) =>
            '<div style="display:flex;align-items:center;gap:4px;padding:3px 4px;border-radius:4px;font-size:10px">' +
            '<span style="color:var(--muted);flex-shrink:0">' +
            item.time +
            "</span>" +
            '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)">' +
            this._esc(item.name) +
            "</span>" +
            '<button class="dl-reimport" data-name="' +
            this._esc(item.name) +
            '" style="padding:1px 5px;border-radius:3px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:9px">✂️ 重命名</button>' +
            "</div>",
        )
        .join("");

      importedList.querySelectorAll(".dl-reimport").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const name = btn.dataset.name;
          const { showRenameDialog } = await import("../../dialogs/rename.js");
          const { RenameFile, LoadAppConfig } =
            await import("../../../wailsjs/go/main/App.js");
          const cfg = await LoadAppConfig();
          const repoRoot = cfg.repoRoot || "";
          // 在仓库中查找文件路径
          const fullPath = repoRoot + "\\" + name;
          const newName = await showRenameDialog(fullPath, name);
          if (!newName) return;
          try {
            await RenameFile(fullPath, newName);
            // 更新列表中的名称
            const idx = imported.findIndex((it) => it.name === name);
            if (idx >= 0) imported[idx].name = newName;
            renderImportedList();
            bus.emit("stats:refresh");
            bus.emit("tree:reload");
            bus.emit("toast:show", {
              msg: "✅ 已重命名: " + newName,
              duration: 3000,
              type: "success",
            });
          } catch (e) {
            bus.emit("toast:show", {
              msg: "❌ 重命名失败: " + String(e),
              duration: 5000,
              type: "error",
            });
          }
        });
      });
    };

    // 清空列表
    root.getElementById("dl-clear-list")?.addEventListener("click", () => {
      imported.length = 0;
      renderImportedList();
    });

    renderImportedList();
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
    const searchInput = root.getElementById("ws-author-input");
    const searchBtn = root.getElementById("ws-search-btn");
    const searchResults = root.getElementById("ws-search-results");
    const creatorView = root.getElementById("ws-creator-view");
    const creatorList = root.getElementById("ws-cr-list");
    const creatorTitle = root.getElementById("ws-cr-title");
    let currentSite = null;
    let allCreators = [];
    let repoAuthors = [];

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

    // ===== 右栏：JSON驱动的站点视图 =====
    const showSiteView = (site) => {
      searchResults.innerHTML = "";
      creatorView.style.display = "none";

      let html = "";

      // 搜索框（如果有 searchUrl）
      if (site.searchUrl) {
        html +=
          '<div style="padding:8px 12px 0;font-size:11px;font-weight:600;color:var(--txt)">🔍 ' +
          this._esc(site.label) +
          " 搜索</div>" +
          '<div style="padding:4px 12px 6px;display:flex;gap:4px">' +
          '<input class="ws-site-search" placeholder="输入搜索词..." style="flex:1;padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">' +
          '<button class="btn accent ws-site-search-btn" style="font-size:10px;padding:3px 8px">搜索</button>' +
          "</div>";

        // 预设搜索词
        if (site.presetSearches && site.presetSearches.length) {
          html +=
            '<div style="padding:0 12px 4px;display:flex;gap:4px;flex-wrap:wrap">' +
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
            "</div>";
        }
      }

      // 创作者列表
      const platformCreators = allCreators.find((c) => c.platform === site.id);
      const creators = platformCreators ? platformCreators.creators : [];

      if (creators.length) {
        html +=
          '<div style="padding:6px 12px 4px;font-size:10px;font-weight:600;color:var(--txt)">🎨 活跃创作者</div>';
        html += creators
          .map(
            (cr) =>
              '<div class="ws-creator-card" data-url="' +
              this._esc(cr.searchUrl || cr.url) +
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
              '<div class="ws-creator-action">↗</div>' +
              "</div>",
          )
          .join("");
      }

      if (!html) {
        html =
          '<div style="padding:12px;color:var(--muted);font-size:10px">此站点无可操作内容。<br>点击「浏览器打开」访问：<br><a href="' +
          this._esc(site.url) +
          '" target="_blank" style="color:var(--accent)">' +
          this._esc(site.url) +
          "</a></div>";
      }

      searchResults.innerHTML = html;

      // 站点搜索框回车/点击
      const siteSearchInput = searchResults.querySelector(".ws-site-search");
      const siteSearchBtn = searchResults.querySelector(".ws-site-search-btn");
      if (siteSearchInput && siteSearchBtn && site.searchUrl) {
        const doSiteSearch = () => {
          const q = siteSearchInput.value.trim();
          if (!q) return;
          window.open(fillSearch(site.searchUrl, q), "_blank");
        };
        siteSearchBtn.addEventListener("click", doSiteSearch);
        siteSearchInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") doSiteSearch();
        });
      }

      // 预设搜索按钮
      searchResults.querySelectorAll(".ws-preset-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (site.searchUrl) {
            window.open(fillSearch(site.searchUrl, btn.dataset.q), "_blank");
          }
        });
      });

      // 创作者卡片
      searchResults.querySelectorAll(".ws-creator-card").forEach((card) => {
        card.addEventListener("click", () => {
          const url = card.dataset.url;
          if (url) window.open(url, "_blank");
        });
      });
    };

    // ===== 全局搜索（默认视图） =====
    const doGlobalSearch = () => {
      const q = searchInput.value.trim();
      creatorView.style.display = "none";

      let html =
        '<div style="padding:4px 0;font-size:10px;color:var(--muted)">搜索结果将在此平台的搜索页打开</div>';

      // 找到所有有 searchUrl 的站点
      const sites = grid._wsSites || [];
      const searchable = sites.filter((s) => s.searchUrl);
      if (searchable.length) {
        html +=
          '<div style="font-size:10px;font-weight:600;color:var(--txt);padding:6px 0 4px">🔍 在以下平台搜索</div>';
        searchable.forEach((s) => {
          html +=
            '<div class="ws-creator-card" data-searchurl="' +
            this._esc(s.searchUrl) +
            '" data-q="' +
            this._esc(q || searchInput.value.trim()) +
            '">' +
            '<div class="ws-creator-icon">' +
            (s.icon || "🔗") +
            "</div>" +
            '<div class="ws-creator-body"><div class="ws-creator-name">' +
            this._esc(s.label) +
            "</div>" +
            '<div class="ws-creator-desc">搜索：' +
            this._esc(q || "(空)") +
            "</div></div>" +
            '<div class="ws-creator-action">↗</div>' +
            "</div>";
        });
      }

      // 仓库作者匹配
      const matchedRepo = q
        ? repoAuthors.filter((a) => a.toLowerCase().includes(q.toLowerCase()))
        : [];
      if (matchedRepo.length) {
        html +=
          '<div style="font-size:10px;font-weight:600;color:var(--txt);padding:6px 0 4px">📦 本地仓库中的作者</div>';
        matchedRepo.forEach((author) => {
          html +=
            '<div class="ws-creator-card" style="cursor:default">' +
            '<div class="ws-creator-icon">📦</div>' +
            '<div class="ws-creator-body"><div class="ws-creator-name">' +
            this._esc(author) +
            "</div></div></div>";
        });
      }

      if (!searchable.length && !matchedRepo.length) {
        html =
          '<div style="color:var(--muted);font-size:10px;padding:8px 0">未找到搜索平台</div>';
      }

      searchResults.innerHTML = html;

      // 点击平台搜索卡片
      searchResults
        .querySelectorAll(".ws-creator-card[data-searchurl]")
        .forEach((card) => {
          card.addEventListener("click", () => {
            const tpl = card.dataset.searchurl;
            const query = card.dataset.q;
            if (tpl && query) {
              window.open(fillSearch(tpl, query), "_blank");
            }
          });
        });
    };

    searchBtn.addEventListener("click", doGlobalSearch);
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doGlobalSearch();
    });

    loadSites();
  }

  _initRecycle() {
    const root = this._root;
    root
      .getElementById("recy-refresh")
      ?.addEventListener("click", () => this._loadRecycleBin());
    root.getElementById("recy-empty")?.addEventListener("click", async () => {
      const confirmed = await window.showConfirm?.(
        "确定永久清空回收站所有文件？此操作不可恢复！",
      );
      if (!confirmed) return;
      try {
        const { LoadAppConfig, EmptyRecycleBin } =
          await import("../../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        const repoRoot = cfg.repoRoot || "";
        if (!repoRoot) {
          bus.emit("toast:show", {
            msg: "请先设置仓库目录",
            duration: 3000,
            type: "warn",
          });
          return;
        }
        const n = await EmptyRecycleBin(repoRoot);
        bus.emit("toast:show", {
          msg: `🗑️ 已清空 ${n} 个文件`,
          duration: 3000,
          type: "success",
        });
        this._loadRecycleBin();
        bus.emit("stats:refresh");
        bus.emit("tree:reload");
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 清空失败: ${String(e)}`,
          duration: 5000,
          type: "error",
        });
      }
    });
    this._loadRecycleBin();
  }

  async _loadRecycleBin() {
    const list = this._root.getElementById("recy-list");
    const hint = this._root.getElementById("recy-empty-hint");
    const count = this._root.getElementById("recy-count");
    if (!list) return;
    try {
      const {
        LoadAppConfig,
        ListRecycleBin,
        RestoreFromRecycle,
        DeleteFromRecycle,
        EmptyRecycleBin,
      } = await import("../../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const repoRoot = cfg.repoRoot || "";
      if (!repoRoot) {
        if (count) count.textContent = "请先设置仓库目录";
        return;
      }

      const entries = await ListRecycleBin(repoRoot);
      if (!entries || !entries.length) {
        list.innerHTML = "";
        if (hint) hint.style.display = "flex";
        if (count) count.textContent = "空";
        return;
      }
      if (hint) hint.style.display = "none";
      if (count) count.textContent = `${entries.length} 个文件`;

      list.innerHTML = entries
        .map((e) => {
          const name = e.Name.replace(/\.(ysm|zip|7z)\.ban$/i, ".$1");
          const size = e.Size ? this._fmtSize(e.Size) : "?";
          return `<div class="recy-item" style="display:flex;flex-direction:column;gap:2px;padding:5px 8px;border-radius:5px;background:var(--bg,#1e1e2e);font-size:11px">
<div style="display:flex;align-items:center;gap:6px">
<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt,#cdd6f4)" title="${this._esc(e.Path)}">${renderDisplayName(name)}</span>
<span style="font-size:9px;color:var(--muted,#6c7086)">${size}</span>
<button class="recy-restore" data-path="${this._esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid var(--bd,#444);background:var(--surf,#2a2a42);color:var(--txt,#cdd6f4);cursor:pointer;font-size:9px">↩️ 恢复</button>
<button class="recy-del" data-path="${this._esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid #e5534b;background:transparent;color:#e5534b;cursor:pointer;font-size:9px">🗑️ 删除</button>
</div>
<div style="font-size:9px;color:var(--muted,#6c7086);padding-left:2px;word-break:break-all">📂 ${this._esc(e.Path)}</div>
</div>`;
        })
        .join("");

      // 恢复按钮
      list.querySelectorAll(".recy-restore").forEach((btn) => {
        btn.onclick = async () => {
          try {
            await RestoreFromRecycle(btn.dataset.path, repoRoot);
            bus.emit("toast:show", {
              msg: "✅ 已恢复",
              duration: 2000,
              type: "success",
            });
            this._loadRecycleBin();
            bus.emit("stats:refresh");
            bus.emit("tree:reload");
          } catch (e) {
            bus.emit("toast:show", {
              msg: `❌ 恢复失败: ${String(e)}`,
              duration: 3000,
              type: "error",
            });
          }
        };
      });

      // 删除按钮
      list.querySelectorAll(".recy-del").forEach((btn) => {
        btn.onclick = async () => {
          const confirmed = await window.showConfirm?.("确定永久删除此文件？");
          if (!confirmed) return;
          try {
            await DeleteFromRecycle(btn.dataset.path);
            this._loadRecycleBin();
            bus.emit("toast:show", {
              msg: "✅ 已删除",
              duration: 2000,
              type: "success",
            });
          } catch (e) {
            bus.emit("toast:show", {
              msg: `❌ 删除失败: ${String(e)}`,
              duration: 3000,
              type: "error",
            });
          }
        };
      });
    } catch (e) {
      list.innerHTML = `<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">❌ 读取回收站失败: ${this._esc(String(e))}</div>`;
      if (count) count.textContent = "加载失败";
    }
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

      // 链接模式变更
      root.querySelectorAll('input[name="link-mode"]').forEach((radio) => {
        radio.addEventListener("change", async () => {
          if (!radio.checked) return;
          const theme = localStorage.getItem("theme") || "dark";
          await SaveAppConfig(repoPath, mcPath, radio.value, theme);
          await SetLinkMode(radio.value);
          bus.emit("toast:show", {
            msg: `✅ 链接模式已切换至: ${radio.value}`,
            duration: 2000,
            type: "success",
          });
          // 询问是否重新链接已有模型
          const relink = await window.showConfirm?.(
            "是否将已有模型重新链接为新模式？\n（将删除整合包中已安装的模型副本，用新模式重新安装）",
          );
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

      // 重置创意工坊
      root
        .getElementById("set-ws-reset")
        ?.addEventListener("click", async () => {
          const confirmed = await window.showConfirm?.(
            "重置创意工坊配置将恢复默认站点列表并清空创作者数据，确定继续吗？",
          );
          if (!confirmed) return;
          try {
            const { ResetWorkshopConfigs } =
              await import("../../../wailsjs/go/main/App.js");
            const sites = await ResetWorkshopConfigs();
            bus.emit("toast:show", {
              msg: `✅ 已重置 ${sites.length} 个默认站点，workshop_creators/ 已清空`,
              duration: 4000,
              type: "success",
            });
          } catch (e) {
            bus.emit("toast:show", {
              msg: `❌ 重置失败: ${String(e)}`,
              duration: 5000,
              type: "error",
            });
          }
        });

      // ===== CSV 导出/导入（创意工坊）=====
      const csvDownload = (content, filename) => {
        // WPS/Excel 友好：加 BOM 让中文正常显示
        const bom = "\uFEFF";
        const blob = new Blob([bom + content], {
          type: "text/csv;charset=utf-8",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      };

      const csvUpload = async () => {
        return new Promise((resolve) => {
          const inp = document.createElement("input");
          inp.type = "file";
          inp.accept = ".csv";
          inp.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) {
              resolve("");
              return;
            }
            const text = await file.text();
            resolve(text);
          };
          inp.click();
        });
      };

      root
        .getElementById("set-ws-export")
        ?.addEventListener("click", async () => {
          try {
            const { ExportWorkshopSitesCSVFile } =
              await import("../../../wailsjs/go/main/App.js");
            const path = await ExportWorkshopSitesCSVFile();
            bus.emit("toast:show", {
              msg: "📤 已导出到: " + path,
              duration: 3000,
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
        .getElementById("set-ws-import")
        ?.addEventListener("click", async () => {
          try {
            const { ImportWorkshopSitesCSVFile } =
              await import("../../../wailsjs/go/main/App.js");
            const count = await ImportWorkshopSitesCSVFile();
            bus.emit("toast:show", {
              msg: `✅ 已从 CSV 导入 ${count} 个站点`,
              duration: 3000,
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

      root
        .getElementById("set-cr-export")
        ?.addEventListener("click", async () => {
          try {
            const { ExportWorkshopCreatorsCSVFile } =
              await import("../../../wailsjs/go/main/App.js");
            const path = await ExportWorkshopCreatorsCSVFile();
            bus.emit("toast:show", {
              msg: "📤 已导出到: " + path,
              duration: 3000,
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
        .getElementById("set-cr-import")
        ?.addEventListener("click", async () => {
          try {
            const { ImportWorkshopCreatorsCSVFile } =
              await import("../../../wailsjs/go/main/App.js");
            const count = await ImportWorkshopCreatorsCSVFile();
            bus.emit("toast:show", {
              msg: `✅ 已从 CSV 导入 ${count} 个创作者`,
              duration: 3000,
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
      root
        .getElementById("set-check-update")
        ?.addEventListener("click", async () => {
          const btn = root.getElementById("set-check-update");
          btn.textContent = "⏳ 检查中...";
          btn.disabled = true;
          try {
            const { CheckUpdate, DownloadUpdate, ApplyUpdate, CurrentVersion } =
              await import("../../../wailsjs/go/main/App.js");
            const info = await CheckUpdate();
            if (!info.available) {
              bus.emit("toast:show", {
                msg: `✅ 已是最新版本 (${info.current})`,
                duration: 3000,
                type: "success",
              });
              return;
            }
            const confirmed = await window.showConfirm?.(
              `发现新版本 ${info.latest}（当前 ${info.current}）\n是否下载并更新？`,
            );
            if (!confirmed) return;
            btn.textContent = "⬇️ 下载中...";
            const zipPath = await DownloadUpdate(info.url);
            btn.textContent = "🔄 更新中...";
            await ApplyUpdate(zipPath);
            // 触发应用重启
            setTimeout(() => {
              window.close?.();
            }, 1000);
          } catch (e) {
            bus.emit("toast:show", {
              msg: `❌ 更新失败: ${String(e)}`,
              duration: 5000,
              type: "error",
            });
          } finally {
            btn.textContent = "🔄 检查更新";
            btn.disabled = false;
          }
        });
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
