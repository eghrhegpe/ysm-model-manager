// ===== <app-preview> 入口 =====
import { bus } from "../../bus.ts";
import { previewCSS } from "./preview-css.ts";
import { RESOURCE_TYPES } from "../../utils/resource-types.ts";
import { modelDetailHTML } from "./tpl.ts";
import {
  cacheGet,
  cacheSet,
  cacheSetEvictHandler,
} from "../../utils/preview-cache.ts";
import { type PreviewCtx, type DecodedYsm } from "./preview-utils.ts";
import { decodeYsmViaWasm } from "./preview-wasm.ts";
import { showModelDetail, showResourcePack, showShaderPack } from "./preview-detail.ts";
import { showLitematic } from "./preview-litematic-meta.ts";
import { esc } from "../../utils/dom.ts";
import type { BedrockGeometry } from "./utils.ts";

// 注册缓存淘汰回调：释放 blob URL
cacheSetEvictHandler((key, val) => {
  if (!val) return;
  // geometry.textures 数组中的 blob URL
  const urls: string[] = [];
  const geo = val.geometry as BedrockGeometry | undefined;
  if (geo?.textures) urls.push(...geo.textures);
  if (geo?.texture && !urls.includes(geo.texture)) urls.push(geo.texture);
  if (val.texture && !urls.includes(val.texture)) urls.push(val.texture);
  // 作者头像 blob URL（preview-wasm 为头像 createObjectURL）：
  // authors[].avatarUrl 与 avatars 记录可能指向同一 URL，去重后 revoke
  for (const au of val.authors || []) {
    if (typeof au === "object" && au.avatarUrl && !urls.includes(au.avatarUrl)) {
      urls.push(au.avatarUrl);
    }
  }
  for (const u of Object.values(val.avatars || {})) {
    if (u && !urls.includes(u)) urls.push(u);
  }
  for (const u of urls) {
    if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
  }
});

class AppPreview extends HTMLElement implements PreviewCtx {
  _root: ShadowRoot;
  _unsubs: Array<() => void> = [];
  private _typeCache: Array<{ id: string; name?: string; icon?: string }> = [];
  private _typeReg: Record<string, { id: string; name?: string; icon?: string }> | null = null;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(previewCSS);
  }

  connectedCallback(): void {
    this._render();

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

  disconnectedCallback(): void {
    this._unsubs.forEach((fn) => fn());
  }

  private _render(): void {
    this._root.innerHTML = modelDetailHTML(null);
  }

  /** 自动匹配缩略图：查缓存 → .ysm/.json 走 WASM → Go 兜底 */
  async _loadPreviewImage(modelPath: string): Promise<string | null> {
    // 查缓存（模块级，跨组件生命周期持久）
    const cached = cacheGet(modelPath);
    if (cached?.texture) return cached.texture;
    const cachedGeo = cached?.geometry as BedrockGeometry | undefined;
    if (cachedGeo?.texture) return cachedGeo.texture;

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
        await import("../../../bindings/ysm-model-manager/internal/app/app.js");
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

  /** 通过前端 WASM 解码 .ysm，返回 { texture, geometry }（缓存复用） */
  async _decodeYsmViaWasm(modelPath: string): Promise<DecodedYsm | null> {
    return decodeYsmViaWasm(modelPath);
  }

  /** 通过前端 WASM 解码（PreviewCtx 别名，preview-loader 用） */
  async decodeYsmViaWasm(modelPath: string): Promise<DecodedYsm | null> {
    return decodeYsmViaWasm(modelPath);
  }

  /** 在预览区追加调试小字 */
  _appendDebug(container: HTMLElement | null, msg: string): void {
    try {
      const el =
        container || this._root.getElementById("preview-content") || this._root;
      const dbg = document.createElement("div");
      dbg.className = "ysm-debug";
      dbg.textContent = msg;
      el.appendChild(dbg);
    } catch (_) {}
  }

  private async _preloadTypeRegistry(): Promise<void> {
    try {
      const { LoadResourceTypes } = await import("../../../bindings/ysm-model-manager/internal/app/app.js");
      const raw = await LoadResourceTypes();
      const reg = JSON.parse(raw) as { resourceTypes?: Array<{ id: string; name?: string; icon?: string }> };
      this._typeCache = reg.resourceTypes || [];
    } catch (_) {}
  }

  private async _showModelDetail(path: string): Promise<void> {
    // 检测文件类型
    let rtype = "";
    try {
      const { DetectResourceType } = await import("../../../bindings/ysm-model-manager/internal/app/app.js");
      rtype = (await DetectResourceType(path)) || "";
    } catch (_) {}
    if (rtype === RESOURCE_TYPES.PACK) {
      showResourcePack(this, path);
      return;
    }
    // ysm 或无检测结果 → YSM 模型解析
    if (!rtype || rtype === RESOURCE_TYPES.YSM) {
      showModelDetail(this, path);
      return;
    }
    if (rtype === RESOURCE_TYPES.LITEMATIC || rtype === RESOURCE_TYPES.BLUEPRINT) {
      showLitematic(this, path);
      return;
    }
    // 其他已知类型（shaderpack / mmd-skin / vrchat-avatar）
    showShaderPack(this, path, this._typeMeta(rtype));
  }

  private _typeMeta(rtype: string): { icon: string; label: string } {
    if (!this._typeReg) {
      this._typeReg = {};
      for (const t of this._typeCache || []) this._typeReg[t.id] = t;
    }
    const def = this._typeReg[rtype];
    return { icon: def?.icon || "📦", label: def?.name || rtype };
  }

  /** 显示资源包信息（pack.mcmeta + pack.png） */
  private async _showResourcePack(path: string): Promise<void> {
    showResourcePack(this, path);
  }

  private async _showPackInfo(dirPath: string): Promise<void> {
    this._root.innerHTML = `<div class="content" id="preview-content"><h3>📦 整合包</h3><div class="dp-placeholder"><div class="big-icon">⏳</div></div></div>`;
    try {
      const { GetPackInfo } = await import("../../../bindings/ysm-model-manager/internal/app/app.js");
      const pack = await GetPackInfo(dirPath);
      if (!pack || (!pack.name && !pack.description)) {
        const folderName = dirPath.split(/[/\\]/).filter(Boolean).pop() || dirPath;
        this._root.innerHTML = `<div class="content" id="preview-content"><h3>📁 文件夹</h3><div class="model-detail-title" style="font-size:13px;font-weight:600">${esc(folderName)}</div><div class="dp-placeholder" style="padding:12px 0"><div class="dp-hint">该文件夹暂无整合包信息</div></div></div>`;
        return;
      }
      this._root.innerHTML = `<div class="content" id="preview-content">
<h3>📦 整合包</h3>
${pack.imageBase64 ? `<div class="preview-thumb"><img src="${esc(pack.imageBase64)}" alt="封面"></div>` : ""}
<div class="model-detail-title" style="font-size:14px;font-weight:700">${esc(pack.name || "")}</div>
${pack.description ? `<div style="font-size:11px;color:var(--txt);margin-top:6px;line-height:1.6">${esc(pack.description)}</div>` : ""}
</div>`;
    } catch (err) {
      this._root.innerHTML = `<div class="content" id="preview-content"><h3>📁 文件夹</h3><div class="dp-placeholder"><div class="big-icon">📁</div><div class="dp-hint">无法读取整合包信息</div></div></div>`;
    }
  }

}
customElements.define("app-preview", AppPreview);
