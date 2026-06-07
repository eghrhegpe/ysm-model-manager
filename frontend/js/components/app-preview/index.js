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
        bus.on("model:select", async ({ path, isDir }) => {
          if (isDir) {
            this._showPackInfo(path);
          } else {
            this._showModelDetail(path);
          }
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

  /** 自动匹配缩略图：1. 同目录散图 → 2. zip/7z 解压纹理 */
  async _loadPreviewImage(modelPath) {
    try {
      const { FindPreviewImage, ExtractPreviewTexture } =
        await import("../../../wailsjs/go/main/App.js");
      // 先找同目录散图
      const loose = await FindPreviewImage(modelPath);
      if (loose) return loose;
      // 再尝试 zip/7z 解压纹理
      const tex = await ExtractPreviewTexture(modelPath);
      return tex || null;
    } catch (_) {
      return null;
    }
  }

  /** 加载 2D 模型骨骼线条图（zip 内含 minecraft:geometry 或 7z） */
  async _loadModel2D(modelPath) {
    const content = this._root.getElementById("preview-content");
    if (!content) return;

    const container = document.createElement("div");
    container.style.cssText = "margin-bottom:8px;opacity:0.6";
    container.innerHTML = `<div style="font-size:10px;font-weight:600;color:var(--muted);margin-bottom:4px">🏗️ 模型结构（读取中...）</div><div style="height:60px;border-radius:6px;background:rgba(0,0,0,.08)"></div>`;
    content.appendChild(container);

    try {
      const { AnalyzeBedrockModel } = await import("../../../wailsjs/go/main/App.js");
      const model = await AnalyzeBedrockModel(modelPath);

      if (!model?.bones?.length) {
        // .ysm 是 YSM 二进制格式，无法直接解析几何体
        const isYsm = modelPath.toLowerCase().endsWith(".ysm");
        container.innerHTML = isYsm
          ? `<div style="font-size:10px;font-weight:600;color:var(--muted);margin-bottom:4px">🏗️ 模型结构</div><div style="font-size:9px;color:#888;padding:8px 0">📦 YSM 二进制格式 · 需解析器解码后方可查看骨骼结构</div>`
          : `<div style="font-size:10px;font-weight:600;color:var(--muted);margin-bottom:4px">🏗️ 模型结构</div><div style="font-size:9px;color:#888;padding:8px 0">⚠️ 未找到几何数据</div>`;
        return;
      }

      container.style.opacity = "1";
      container.innerHTML = "";
      const title = document.createElement("div");
      title.style.cssText = "font-size:10px;font-weight:600;color:var(--muted);margin-bottom:4px";
      title.textContent = `🏗️ 模型结构（${model.boneCount} 骨骼 · ${model.cubeCount} 立方体）`;
      container.appendChild(title);

      const canvas = document.createElement("canvas");
      canvas.width = 180;
      canvas.height = 180;
      canvas.style.cssText = "width:100%;height:auto;border-radius:6px;background:rgba(0,0,0,.15)";
      container.appendChild(canvas);

      const { renderModel2D } = await import("../../utils/model2d.js");
      let textureImg = null;
      if (model.texture) {
        textureImg = new Image();
        await new Promise((r) => { textureImg.onload = r; textureImg.onerror = r; textureImg.src = model.texture; });
      }
      renderModel2D(canvas, model, textureImg);
    } catch (e) {
      container.innerHTML = `<div style="font-size:10px;font-weight:600;color:#ff6b6b;margin-bottom:4px">🏗️ 模型结构</div><div style="font-size:9px;color:#888;padding:8px 0">⚠️ 解析失败: ${e?.message ?? e}</div>`;
    }
  }

  async _showModelDetail(path) {
    this._root.innerHTML = `<div class="content" id="preview-content"><h3>📄 模型信息</h3><div class="dp-placeholder"><div class="big-icon">⏳</div><div class="dp-hint">正在解析模型文件...</div></div></div>`;

    // 并行：解析元数据 + 加载缩略图
    const previewSrc = await this._loadPreviewImage(path);

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
      let cardHTML = "";
      if (hasRealSummary || header) {
        cardHTML = summaryCardHTML(
          hasRealSummary ? summary : null,
          header,
          basename,
        );
      } else {
        throw new Error("无法解析此文件");
      }
      // 在卡片顶部注入缩略图
      if (previewSrc) {
        cardHTML = cardHTML.replace(
          '<div class="content" id="preview-content">',
          `<div class="content" id="preview-content"><div class="preview-thumb"><img src="${previewSrc}" alt="预览" onerror="this.style.display='none'"></div>`,
        );
      }
      this._root.innerHTML = cardHTML;

      // 尝试加载 2D 模型预览（只对 zip/7z 有效）
      this._loadModel2D(path);
    } catch (err) {
      this._root.innerHTML = modelDetailHTML({
        hasError: true,
        errorMsg: String(err),
      });
    }
  }

  /** 显示文件夹下的整合包信息（ysm-pack.json + ysm-pack.png） */
  async _showPackInfo(dirPath) {
    const esc = (s) =>
      (s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    this._root.innerHTML = `<div class="content" id="preview-content"><h3>📦 整合包</h3><div class="dp-placeholder"><div class="big-icon">⏳</div></div></div>`;
    try {
      const { GetPackInfo } = await import("../../../wailsjs/go/main/App.js");
      const pack = await GetPackInfo(dirPath);
      if (!pack || (!pack.name && !pack.description)) {
        const folderName =
          dirPath.split(/[/\\]/).filter(Boolean).pop() || dirPath;
        this._root.innerHTML = `<div class="content" id="preview-content"><h3>📁 文件夹</h3><div class="model-detail-title" style="font-size:13px;font-weight:600">${esc(folderName)}</div><div class="dp-placeholder" style="padding:12px 0"><div class="dp-hint">该文件夹暂无整合包信息</div></div></div>`;
        return;
      }
      this._root.innerHTML = `<div class="content" id="preview-content">
<h3>📦 整合包</h3>
${pack.imageBase64 ? `<div class="preview-thumb"><img src="${pack.imageBase64}" alt="封面"></div>` : ""}
<div class="model-detail-title" style="font-size:14px;font-weight:700">${esc(pack.name)}</div>
${pack.description ? `<div style="font-size:11px;color:var(--txt);margin-top:6px;line-height:1.6">${esc(pack.description)}</div>` : ""}
</div>`;
    } catch (err) {
      this._root.innerHTML = `<div class="content" id="preview-content"><h3>📁 文件夹</h3><div class="dp-placeholder"><div class="big-icon">📁</div><div class="dp-hint">无法读取整合包信息</div></div></div>`;
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
