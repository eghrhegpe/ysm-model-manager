// ===== <app-preview> 入口 =====
import { bus } from "../../bus.js";
import { previewCSS } from "./preview-css.js";
import { statsHTML, modelDetailHTML, statsCardHTML } from "./tpl.js";
import { bindBusUpdates } from "./events.js";
import { bindActions } from "./preview-actions.js";
import { showPackageDetail, registerMmdEvents } from "./preview-pack.js";
import { loadLogsPreview } from "./preview-logs.js";
import { openFullPreview } from "./preview-zoom.js";
import { summaryCardHTML } from "../../utils/summarize.js";
import {
  cacheGet,
  cacheSet,
  cacheSetEvictHandler,
} from "../../utils/preview-cache.js";
import { devLog, stripYsgpTextHeader } from "./preview-utils.js";
import { decodeYsmViaWasm } from "./preview-wasm.js";
import { showModelDetail, showResourcePack, showShaderPack } from "./preview-detail.js";
import { showLitematic } from "./preview-litematic-meta.js";
// loadModelData 由 preview-skeleton.js 统一引入
import { setupBoneExport } from "./preview-bone-export.js";

// 注册缓存淘汰回调：释放 blob URL
cacheSetEvictHandler((key, val) => {
  if (!val) return;
  // geometry.textures 数组中的 blob URL
  const urls = [];
  if (val.geometry?.textures) urls.push(...val.geometry.textures);
  if (val.geometry?.texture && !urls.includes(val.geometry.texture))
    urls.push(val.geometry.texture);
  if (val.texture && !urls.includes(val.texture)) urls.push(val.texture);
  for (const u of urls) {
    if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
  }
});

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

      // 注册 MMD 变体事件委托（仅一次，模块级标志控制不重复）
      registerMmdEvents(this._root);

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
      this._preloadTypeRegistry();
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
    this._cleanupModelListeners();
    this._unsubs.forEach((fn) => fn());
  }

  /** 清理模型拖拽 window 级监听 */
  _cleanupModelListeners() {
    if (this._modelCleanup) {
      this._modelCleanup();
      this._modelCleanup = null;
    }
  }

  _render() {
    if (this._mode === "stat") {
      this._root.innerHTML = statsHTML();
      bindActions(this._root);
    } else {
      this._root.innerHTML = modelDetailHTML(null);
    }
  }

  /** 自动匹配缩略图：查缓存 → .ysm/.json 走 WASM → Go 兜底 */
  async _loadPreviewImage(modelPath) {
    // 查缓存（模块级，跨组件生命周期持久）
    const cached = cacheGet(modelPath);
    if (cached?.texture) return cached.texture;
    if (cached?.geometry?.texture) return cached.geometry.texture;

    // .ysm 或 .json（解压的 ysm.json）都走 WASM 解码
    if (/\.(ysm|json)$/i.test(modelPath)) {
      const decoded = await this._decodeYsmViaWasm(modelPath);
      if (decoded?.texture) {
        cacheSet(modelPath, { ...decoded, _decodedBy: "🧠 WASM 内置解码" });
        return decoded.texture;
      }
      if (decoded?.geometry) {
        // 有 geometry 数据（含 _ysmMeta）但无纹理，缓存以备 _loadModel2D 使用
        cacheSet(modelPath, { ...decoded, _wasmTried: true });
      } else {
        // WASM 完全失败，标记已尝试过
        cacheSet(modelPath, { _wasmTried: true });
      }
    }
    try {
      const { FindPreviewImage, ExtractPreviewTexture } =
        await import("../../../wailsjs/go/main/App.js");
      const loose = await FindPreviewImage(modelPath);
      if (loose) {
        cacheSet(modelPath, { texture: loose, _decodedBy: "" });
        return loose;
      }
      const tex = await ExtractPreviewTexture(modelPath);
      if (tex) cacheSet(modelPath, { texture: tex, _decodedBy: "" });
      return tex || null;
    } catch (_) {
      return null;
    }
  }

  /** @deprecated 由 preview-skeleton.js:loadModel2D 替代 */
  /* eslint-disable-next-line no-unused-private-class-members */
  async _loadModel2D(_modelPath, _skelContainer) { /* 死代码 */ }

  /** 通过前端 WASM 解码 .ysm，返回 { texture, geometry }（缓存复用） */
  async _decodeYsmViaWasm(modelPath) {
    return decodeYsmViaWasm(modelPath);
  }

  /** 在预览区追加调试小字 */
  _appendDebug(container, msg) {
    try {
      const el =
        container || this._root.getElementById("preview-content") || this._root;
      const dbg = document.createElement("div");
      dbg.className = "ysm-debug";
      dbg.textContent = msg;
      (el.appendChild ? el : this._root).appendChild(dbg);
    } catch (_) {}
  }

  async _preloadTypeRegistry() {
    try {
      const { LoadResourceTypes } = await import("../../../wailsjs/go/main/App.js");
      const raw = await LoadResourceTypes();
      const reg = JSON.parse(raw);
      this._typeCache = reg.resourceTypes || [];
    } catch (_) {}
  }

  async _showModelDetail(path) {
    // 检测文件类型
    let rtype = "";
    try {
      const { DetectResourceType } = await import("../../../wailsjs/go/main/App.js");
      rtype = await DetectResourceType(path) || "";
    } catch (_) {}
    if (rtype === "resourcepack") {
      showResourcePack(this, path);
      return;
    }
    // ysm 或无检测结果 → YSM 模型解析
    if (!rtype || rtype === "ysm") {
      showModelDetail(this, path);
      return;
    }
    if (rtype === "litematic") {
      showLitematic(this, path);
      return;
    }
    // 其他已知类型（shaderpack / create-blueprint / mmd-skin / vrchat-avatar）
    showShaderPack(this, path, this._typeMeta(rtype));
  }

  _typeMeta(rtype) {
    if (!this._typeReg) {
      this._typeReg = {};
      for (const t of (this._typeCache || [])) this._typeReg[t.id] = t;
    }
    const def = this._typeReg[rtype];
    return { icon: def?.icon || "📦", label: def?.name || rtype };
  }

  /** 显示资源包信息（pack.mcmeta + pack.png） */
  async _showResourcePack(path) {
    showResourcePack(this, path);
  }
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

// ===== 工具：从 JSON 字符串解析 Bedrock geometry（已移至 data.js） =====
