// ===== <app-content> 入口 =====
import { contentCSS } from "./content-css.js";
import {
  dashboardHTML,
  repositoryHTML,
  instancesHTML,
  settingsHTML,
  placeholderHTML,
  diagnosticsHTML,
} from "./tpl.js";
// 需要用到的 Go 绑定
let LoadAppConfig, GetInstanceStatus, SyncCustomToRepo;

class AppContent extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(contentCSS);
    this._current = "dashboard";
  }

  connectedCallback() {
    this._unsub = bus.on("nav:change", ({ page }) => {
      this._current = page;
      bus.emit("nav:changed", { page });
      this._render();
    });

    // 监听上传待上传
    bus.on("stats:upload", () => this._handleUpload());

    // 加载 Go 绑定
    import("../../../wailsjs/go/main/App.js").then((mod) => {
      LoadAppConfig = mod.LoadAppConfig;
      GetInstanceStatus = mod.GetInstanceStatus;
      SyncCustomToRepo = mod.SyncCustomToRepo;
    });

    this._render();
  }

  disconnectedCallback() {
    if (this._unsub) this._unsub();
  }

  async _handleUpload() {
    if (!LoadAppConfig || !GetInstanceStatus || !SyncCustomToRepo) return;
    try {
      const cfg = await LoadAppConfig();
      const mcRoot = cfg.mcRoot || cfg.McRoot || "";
      const repoRoot = cfg.repoRoot || cfg.RepoRoot || "";
      if (!mcRoot || !repoRoot) return;

      const statusList = await GetInstanceStatus(mcRoot, repoRoot);
      if (!statusList || !statusList.length) return;

      let total = 0;
      for (const ins of statusList) {
        if (!ins.Extra || ins.Extra.length === 0) continue;
        const count = await SyncCustomToRepo(ins.CustomDir, repoRoot);
        total += count;
      }

      // 刷新统计
      bus.emit("stats:refresh");
    } catch (_) {}
  }

  _render() {
    let inner = "";
    switch (this._current) {
      case "dashboard":
        inner = dashboardHTML();
        break;
      case "repository":
        inner = repositoryHTML();
        break;
      case "instances":
        inner = instancesHTML();
        break;
      case "downloads":
        inner = placeholderHTML("⬇️", "下载与更新");
        break;
      case "diagnostics":
        inner = diagnosticsHTML();
        break;
      case "settings":
        inner = settingsHTML();
        break;
      default:
        inner = dashboardHTML();
    }
    this._root.innerHTML = `<div class="page">${inner}</div>`;

    // 诊断页面初始化
    if (this._current === "diagnostics") {
      this._initDiagnostics();
    }
  }

  _initDiagnostics() {
    const root = this._root;

    // 左栏按钮切换
    root.querySelectorAll(".diag-btn[data-diag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.diag;
        root
          .querySelectorAll(".diag-btn[data-diag]")
          .forEach((b) => b.classList.toggle("active", b === btn));
        root.getElementById("diag-log").style.display =
          name === "log" ? "" : "none";
        root.getElementById("diag-conflict").style.display =
          name === "conflict" ? "" : "none";
        if (name === "log") this._loadDiagnosticsLogs();
      });
    });

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

    this._loadDiagnosticsLogs();
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
            l.ModelName +
            (l.TargetDir ? " → " + l.TargetDir : "") +
            (l.ErrorMsg ? ": " + l.ErrorMsg : "");
          return `<div class="log-row">
<span class="log-status ${status}">${statusLabel}</span>
<span class="log-msg">${this._esc(msg)}</span>
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

  _esc(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
customElements.define("app-content", AppContent);
