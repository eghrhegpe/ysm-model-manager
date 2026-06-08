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
    /** @type {Map<string,{texture?:string,geometry?:object}>} */
    this._previewDataCache = new Map();
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

  /** 自动匹配缩略图：查缓存 → .ysm 走 WASM → Go 兜底 */
  async _loadPreviewImage(modelPath) {
    // 查缓存
    const cached = this._previewDataCache.get(modelPath);
    if (cached?.texture) return cached.texture;
    if (cached?.geometry?.texture) return cached.geometry.texture;

    // .ysm 先试 WASM，失败则走 Go
    if (/\.ysm$/i.test(modelPath)) {
      const decoded = await this._decodeYsmViaWasm(modelPath);
      if (decoded?.texture) {
        this._previewDataCache.set(modelPath, { ...decoded, _decodedBy: "🧠 WASM" });
        return decoded.texture;
      }
    }
    try {
      const { FindPreviewImage, ExtractPreviewTexture } =
        await import("../../../wailsjs/go/main/App.js");
      const loose = await FindPreviewImage(modelPath);
      if (loose) {
        this._previewDataCache.set(modelPath, { texture: loose, _decodedBy: "" });
        return loose;
      }
      const tex = await ExtractPreviewTexture(modelPath);
      if (tex) this._previewDataCache.set(modelPath, { texture: tex, _decodedBy: "" });
      return tex || null;
    } catch (_) {
      return null;
    }
  }

  /** 加载 2D 模型骨骼线条图 + 统计面板 */
  async _loadModel2D(modelPath) {
    const content = this._root.getElementById("preview-content");
    if (!content) return;

    const container = document.createElement("div");
    container.style.cssText = "margin-bottom:8px;opacity:0.6";
    container.innerHTML = `<div style="font-size:10px;font-weight:600;color:var(--muted);margin-bottom:4px">🏗️ 模型结构（读取中...）</div><div style="height:60px;border-radius:6px;background:rgba(0,0,0,.08)"></div>`;
    content.appendChild(container);

    try {
      let model;
      const isYsm = /\.ysm$/i.test(modelPath);

      // 查缓存（_loadPreviewImage 可能已经存过）
      let _decodedBy = ""; // "WASM" | "CLI" | ""

      const cached = this._previewDataCache.get(modelPath);
      if (cached?.geometry?.bones?.length) {
        model = cached.geometry;
        _decodedBy = cached._decodedBy || "";
      }

      // .ysm → 前端 WASM 解码
      if (!model && isYsm) {
        const decoded = await this._decodeYsmViaWasm(modelPath);
        if (decoded?.geometry) {
          model = decoded.geometry;
          _decodedBy = "🧠 WASM";
        } else {
          this._appendDebug(container, "[YSM] WASM 返回空，回退 Go");
        }
      }

      // 非 .ysm 或 WASM 失败 → 走 Go（一次性拿到 texture + geometry）
      if (!model) {
        const { AnalyzeBedrockModel } =
          await import("../../../wailsjs/go/main/App.js");
        model = await AnalyzeBedrockModel(modelPath);
        // 缓存完整结果，供 _loadPreviewImage 复用
        if (model?.bones?.length) {
          this._previewDataCache.set(modelPath, {
            texture: model.texture,
            geometry: model,
            _decodedBy: "⚙️ CLI",
          });
          _decodedBy = "⚙️ CLI";
        }
      }

      if (!model?.bones?.length) {
        container.innerHTML = `<div style="font-size:10px;font-weight:600;color:var(--muted);margin-bottom:4px">🏗️ 模型结构</div><div style="font-size:9px;color:#888;padding:8px 0">⚠️ 未找到几何数据</div>`;
        return;
      }

      container.style.opacity = "1";
      container.innerHTML = "";
      const title = document.createElement("div");
      title.style.cssText =
        "display:flex;align-items:center;gap:6px;font-size:10px;font-weight:600;color:var(--muted);margin-bottom:4px";
      title.innerHTML = `🏗️ 模型结构（${model.boneCount} 骨骼 · ${model.cubeCount} 立方体）` +
        (_decodedBy ? `<span style="font-size:8px;padding:0 5px;border-radius:3px;background:rgba(124,131,255,0.25);color:var(--txt,#cdd6f4)">${_decodedBy}</span>` : "");
      container.appendChild(title);

      // ---- 统计面板 ----
      const statsRow = document.createElement("div");
      statsRow.style.cssText =
        "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px";
      const fmt = isYsm
        ? ".ysm (加密)"
        : modelPath.endsWith(".zip")
          ? ".zip"
          : ".7z";
      const stats = [
        { label: "🦴 骨骼", val: model.boneCount },
        { label: "📦 立方体", val: model.cubeCount },
        {
          label: "📐 纹理",
          val: (model.texWidth || "?") + "×" + (model.texHeight || "?"),
        },
        { label: "📁 格式", val: fmt },
      ];
      for (const s of stats) {
        const tag = document.createElement("span");
        tag.style.cssText =
          "font-size:9px;padding:1px 6px;border-radius:4px;border:1px solid var(--bd,#45475a);background:var(--bg2,#313244);color:var(--txt,#cdd6f4);white-space:nowrap";
        tag.textContent = `${s.label} ${s.val}`;
        statsRow.appendChild(tag);
      }
      container.appendChild(statsRow);
      // -----------------

      const canvas = document.createElement("canvas");
      canvas.width = 180;
      canvas.height = 180;
      canvas.style.cssText =
        "width:100%;height:auto;border-radius:6px;background:rgba(0,0,0,.15)";
      container.appendChild(canvas);

      const { renderModel2D } = await import("../../utils/model2d.js");
      let textureImg = null;
      if (model.texture) {
        textureImg = new Image();
        await new Promise((r) => {
          textureImg.onload = r;
          textureImg.onerror = r;
          textureImg.src = model.texture;
        });
      }
      renderModel2D(canvas, model, textureImg);

      // 导出按钮
      const { addExportButton } = await import("../../utils/canvas-export.js");
      addExportButton(
        container,
        canvas,
        modelPath.split("/").pop().split("\\").pop(),
      );
    } catch (e) {
      container.innerHTML = `<div style="font-size:10px;font-weight:600;color:#ff6b6b;margin-bottom:4px">🏗️ 模型结构</div><div style="font-size:9px;color:#888;padding:8px 0">⚠️ 解析失败: ${e?.message ?? e}</div>`;
    }
  }

  /** 通过前端 WASM 解码 .ysm，返回 { texture, geometry }（缓存复用） */
  async _decodeYsmViaWasm(modelPath) {
    if (this._ysmCache) return this._ysmCache;
    const content = this._root.getElementById("preview-content");
    try {
      this._appendDebug(content, "[YSM] 加载 WASM 模块...");
      const { initYSMParser, decodeYsmFileFromMemory, decodeYsmFile } =
        await import("../../wasm/ysm-parser.js");
      const ok = await initYSMParser();
      this._appendDebug(content, `[YSM] WASM init: ${ok ? "✅" : "❌"}`);
      if (!ok) return null;

      this._appendDebug(content, "[YSM] 读取文件...");
      const { ReadFileBytes } = await import("../../../wailsjs/go/main/App.js");
      let bytes = await ReadFileBytes(modelPath);
      // Wails []byte 返回 base64 字符串，解码为 Uint8Array
      if (typeof bytes === "string") {
        const binaryStr = atob(bytes);
        bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
      } else if (!(bytes instanceof Uint8Array)) {
        bytes = new Uint8Array(bytes);
      }
      this._appendDebug(content, `[YSM] 读取 ${bytes?.length || 0} bytes`);
      if (!bytes?.length) return null;

      // 优先内存解析（无文件 I/O），回退 callMain
      this._appendDebug(content, "[YSM] 内存解析...");
      let files;
      try {
        files = await decodeYsmFileFromMemory(bytes);
        if (files?.length) {
          this._appendDebug(
            content,
            `[YSM] ✅ 内存解析成功: ${files.length} 文件`,
          );
        } else {
          this._appendDebug(content, "[YSM] 内存解析返回空，回退 callMain");
        }
      } catch (e) {
        this._appendDebug(
          content,
          `[YSM] 内存解析异常: ${e?.message}，回退 callMain`,
        );
      }

      if (!files?.length) {
        this._appendDebug(content, "[YSM] callMain 回退...");
        files = await decodeYsmFile(bytes);
      }
      this._appendDebug(content, `[YSM] 输出 ${files?.length || 0} 文件`);

      // 列出文件
      if (files?.length) {
        const names = files.map((f) => f.path).join(", ");
        this._appendDebug(content, `[YSM] 文件: ${names}`);
      }
      if (!files?.length) return null;

      // 提取纹理
      let texture = null;
      const texFile = files.find(
        (f) => f.path.endsWith(".png") || f.path.endsWith(".jpg"),
      );
      if (texFile) {
        const blob = new Blob([texFile.data]);
        texture = URL.createObjectURL(blob);
        this._appendDebug(content, `[YSM] 纹理: ${texFile.path}`);
      }

      // 解析几何体
      let geometry = null;
      for (const f of files) {
        if (!f.path.startsWith("models/") || !f.path.endsWith(".json"))
          continue;
        this._appendDebug(content, `[YSM] 解析 ${f.path}...`);
        try {
          const jsonStr = new TextDecoder().decode(f.data);
          const parsed = parseBedrockGeometryFromJSON(jsonStr);
          if (parsed?.bones?.length) {
            this._appendDebug(
              content,
              `[YSM] ✅ ${f.path}: ${parsed.bones.length}骨 ${parsed.cubeCount}方`,
            );
            if (!geometry || parsed.bones.length > geometry.bones.length) {
              geometry = parsed;
              geometry.texture = texture;
            }
          } else {
            this._appendDebug(content, `[YSM] ⚠️ ${f.path}: 无骨骼`);
          }
        } catch (e) {
          this._appendDebug(content, `[YSM] ❌ ${f.path}: ${e?.message}`);
        }
      }

      this._ysmCache = { texture, geometry };
      return this._ysmCache;
    } catch (e) {
      this._appendDebug(content, `[YSM] ❌ ${e?.message || e}`);
      return null;
    }
  }

  /** 在预览区追加调试小字 */
  _appendDebug(container, msg) {
    try {
      const el =
        container || this._root.getElementById("preview-content") || this._root;
      const dbg = document.createElement("div");
      dbg.style.cssText =
        "font-size:9px;color:#ff6b6b;margin-top:2px;opacity:0.8";
      dbg.textContent = msg;
      (el.appendChild ? el : this._root).appendChild(dbg);
    } catch (_) {}
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

// ===== 工具：从 JSON 字符串解析 Bedrock geometry =====
function parseBedrockGeometryFromJSON(jsonStr) {
  const raw = JSON.parse(jsonStr);
  const geo = raw?.["minecraft:geometry"]?.[0];
  if (!geo?.bones?.length) return null;

  const bones = [];
  let cubeCount = 0;
  for (const b of geo.bones) {
    const cubes = [];
    for (const c of b.cubes || []) {
      cubes.push({
        origin: c.origin || [0, 0, 0],
        size: c.size || [1, 1, 1],
        pivot: c.pivot || [0, 0, 0],
      });
    }
    bones.push({ name: b.name, cubes });
    cubeCount += cubes.length;
  }

  return {
    boneCount: bones.length,
    cubeCount,
    texWidth: geo.description?.texture_width || 0,
    texHeight: geo.description?.texture_height || 0,
    bones,
  };
}
