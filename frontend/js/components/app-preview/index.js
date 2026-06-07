// ===== <app-preview> 入口 =====
import { bus } from "../../bus.js";
import { previewCSS } from "./preview-css.js";
import { statsHTML, modelDetailHTML } from "./tpl.js";
import {
  bindActions,
  bindBusUpdates,
  showPackageDetail,
  loadLogsPreview,
} from "./events.js";
import { summaryCardHTML } from "../../utils/summarize.js";

class AppPreview extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(previewCSS);
    this._unsubs = [];
    this._selectedPkg = null;
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
      bindBusUpdates(this._root, this._unsubs);

      this._loadLogsPreview();

      this._unsubs.push(
        bus.on("package:selected", (pkg) => {
          this._selectedPkg = pkg;
          showPackageDetail(this._root, pkg);
        }),
      );

      this._unsubs.push(bus.on("logs:refresh", () => this._loadLogsPreview()));

      this._unsubs.push(bus.on("stats:refresh", () => this._loadLogsPreview()));
    }

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

  async _showModelDetail(path) {
    this._root.innerHTML = `<div class="content" id="preview-content"><h3>📄 模型信息</h3><div class="dp-placeholder"><div class="big-icon">⏳</div><div class="dp-hint">正在解析模型文件...</div></div></div>`;
    try {
      const { ExtractYsmSummary, ExtractYSMHeader } =
        await import("../../../wailsjs/go/main/App.js");
      const results = await Promise.allSettled([
        ExtractYsmSummary(path),
        ExtractYSMHeader(path),
      ]);
      const summary =
        results[0].status === "fulfilled" ? results[0].value : null;
      const header =
        results[1].status === "fulfilled" ? results[1].value : null;
      const basename = path.split("/").pop().split("\\").pop();
      // 判断 summary 是否真实有效（加密模型返回零值空壳，name/stats/authors 全空）
      const hasRealSummary =
        summary &&
        (summary.name ||
          summary.stats?.textures > 0 ||
          summary.stats?.models > 0 ||
          summary.authors?.length > 0);
      if (hasRealSummary || header) {
        this._root.innerHTML = summaryCardHTML(
          hasRealSummary ? summary : null,
          header,
          basename,
        );
      } else {
        throw new Error("无法解析此文件");
      }
    } catch (err) {
      this._root.innerHTML = modelDetailHTML({
        hasError: true,
        errorMsg: String(err),
      });
    }
  }

  async _loadLogsPreview() {
    try {
      const { GetImportLogs } = await import("../../../wailsjs/go/main/App.js");
      const logs = await GetImportLogs();
      loadLogsPreview(this._root, logs);
    } catch (_) {}
  }
}
customElements.define("app-preview", AppPreview);
