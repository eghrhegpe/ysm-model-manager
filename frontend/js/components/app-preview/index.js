// ===== <app-preview> 入口 =====
import { previewCSS } from "./preview-css.js";
import { statsHTML, modelDetailHTML } from "./tpl.js";
import { DEFAULT_STATS } from "./data.js";
import { updateDisplay } from "./render.js";
import { bindActions, bindBusUpdates } from "./events.js";

class AppPreview extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(previewCSS);
    this._stats = { ...DEFAULT_STATS };
    this._unsubs = [];
    // mode: "stat" | "model"
    this._mode = "stat";
  }

  static get observedAttributes() {
    return ["mode"];
  }

  attributeChangedCallback(name, _, newVal) {
    if (name === "mode") {
      this._mode = newVal === "model" ? "model" : "stat";
      if (this._root.isConnected) this._render();
    }
  }

  connectedCallback() {
    this._mode = this.getAttribute("mode") === "model" ? "model" : "stat";
    this._render();

    if (this._mode === "stat") {
      bindBusUpdates(this._root, this._stats, this._unsubs);

      this._unsubs.push(
        bus.on("_preview:needs-update", () => {
          updateDisplay(this._root, this._stats);
        }),
      );

      // 刷新时从 Go 加载真实数据
      this._unsubs.push(
        bus.on("stats:refresh", () => {
          this._loadRealStats();
        }),
      );

      // 日志刷新
      this._unsubs.push(
        bus.on("logs:refresh", () => {
          this._loadLogs();
        }),
      );

      // 初始加载
      this._loadRealStats();
      this._loadLogs();
    }

    // model 模式监听文件选中
    if (this._mode === "model") {
      this._unsubs.push(
        bus.on("model:select", async ({ path }) => {
          this._showModelDetail(path);
        }),
      );
    }
  }

  disconnectedCallback() {
    this._unsubs.forEach((fn) => fn());
  }

  _render() {
    if (this._mode === "stat") {
      this._root.innerHTML = statsHTML();
      bindActions(this._root);
    } else {
      this._root.innerHTML = modelDetailHTML(null);
    }
  }

  async _loadRealStats() {
    bus.emit("loading:start");
    try {
      const { LoadAppConfig, GetInstanceStatus, ScanModelEntries } =
        await import("../../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const mcRoot = cfg.mcRoot || cfg.McRoot || "";
      const repoRoot = cfg.repoRoot || cfg.RepoRoot || "";

      const repoEntries = await ScanModelEntries(repoRoot);
      const repoCount = repoEntries ? repoEntries.length : 0;

      let verCount = 0;
      let completeCount = 0;
      let pendingUpCount = 0;
      if (mcRoot && repoRoot) {
        const statusList = await GetInstanceStatus(mcRoot, repoRoot);
        if (statusList) {
          verCount = statusList.length;
          statusList.forEach((s) => {
            if (s.Status === "complete") {
              completeCount++;
            } else if (s.Status === "extra") {
              pendingUpCount++;
            }
            // "missing" 不算待上传，算待下载
          });
        }
      }

      this._stats = {
        repo: repoCount,
        ver: verCount,
        ok: completeCount,
        tot: verCount,
        pending: pendingUpCount,
      };
      updateDisplay(this._root, this._stats);
    } catch (_) {
      // 保持初始值
    } finally {
      bus.emit("loading:end");
    }
  }

  async _showModelDetail(path) {
    // 显示加载中
    this._root.innerHTML = `<div class="content" id="preview-content"><h3>📄 模型信息</h3><div class="stat-row"><span class="label">加载中...</span></div></div>`;

    try {
      const { AnalyzeYSMModel } =
        await import("../../../wailsjs/go/main/App.js");
      const meta = await AnalyzeYSMModel(path);
      this._root.innerHTML = modelDetailHTML(meta);
    } catch (err) {
      this._root.innerHTML = modelDetailHTML({
        hasError: true,
        errorMsg: String(err),
      });
    }
  }

  async _loadLogs() {
    try {
      const { GetImportLogs } = await import("../../../wailsjs/go/main/App.js");
      const logs = await GetImportLogs();
      const list = this._root.getElementById("log-list");
      if (!list) return;
      if (!logs || !logs.length) {
        list.innerHTML =
          '<div class="stat-row"><span class="label">暂无日志</span></div>';
        return;
      }
      const items = logs
        .slice(-200)
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
          const time = l.Timestamp
            ? new Date(l.Timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })
            : "";
          const msg = l.ModelName + (l.ErrorMsg ? ": " + l.ErrorMsg : "");
          return `<div class="log-entry">
<span class="log-status ${status}">${statusLabel}</span>
<span class="log-msg">${this._esc(msg)}</span>
<span class="log-time">${time}</span>
</div>`;
        })
        .join("");
      list.innerHTML = items;
    } catch (_) {
      // ignore
    }
  }

  _esc(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
customElements.define("app-preview", AppPreview);
