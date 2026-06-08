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
  async _loadModel2D(modelPath, skelContainer) {
    const content = skelContainer || this._root.getElementById("preview-content");
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

      // ---- 模型轨迹图 ----
      const canvas = document.createElement("canvas");
      canvas.width = 180;
      canvas.height = 180;
      canvas.style.cssText =
        "width:100%;height:auto;border-radius:8px;background:rgba(0,0,0,.12);margin-bottom:6px";
      container.appendChild(canvas);

      // ---- 加载纹理（骨骼图用）----
      let textureImg = null;
      if (model.texture) {
        textureImg = new Image();
        await new Promise((r) => {
          textureImg.onload = r;
          textureImg.onerror = r;
          textureImg.src = model.texture;
        });
      }

      // ---- 骨骼名开关 ----
      const toggleRow = document.createElement("div");
      toggleRow.style.cssText = "display:flex;align-items:center;gap:4px;margin-bottom:6px";
      const eyeBtn = document.createElement("button");
      eyeBtn.style.cssText = "font-size:9px;padding:1px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;display:flex;align-items:center;gap:3px";
      const savedState = localStorage.getItem("ysm_showBoneLabels") !== "false";
      let _labelsOn = savedState;
      eyeBtn.innerHTML = _labelsOn ? "👁 骨骼名" : "👁‍🗨 骨骼名";
      eyeBtn.title = "切换骨骼名称显示";
      const eyeHint = document.createElement("span");
      eyeHint.style.cssText = "font-size:8px;color:var(--muted)";
      eyeHint.textContent = _labelsOn ? "开启" : "关闭";
      toggleRow.appendChild(eyeBtn);
      toggleRow.appendChild(eyeHint);
      container.appendChild(toggleRow);

      // ---- 统计卡片 ----
      const card = document.createElement("div");
      card.style.cssText =
        "background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:8px 10px;margin-bottom:8px";
      card.innerHTML = this._statsCardHTML(model, modelPath, _decodedBy);
      container.appendChild(card);

      // ---- 渲染骨骼图 ----
      const { renderModel2D } = await import("../../utils/model2d.js");
      let _zoom = 1;
      const doRender = () => renderModel2D(canvas, model, textureImg, { showLabels: _labelsOn, zoom: _zoom });
      doRender();

      eyeBtn.onclick = () => {
        _labelsOn = !_labelsOn;
        localStorage.setItem("ysm_showBoneLabels", _labelsOn);
        eyeBtn.innerHTML = _labelsOn ? "👁 骨骼名" : "👁‍🗨 骨骼名";
        eyeHint.textContent = _labelsOn ? "开启" : "关闭";
        doRender();
      };

      // ---- 全窗放大 + 滚轮缩放 ----
      canvas.style.cursor = "zoom-in";
      canvas.title = "左键全窗放大 · 滚轮缩放";
      canvas.addEventListener("click", () => this._openFullPreview(canvas, model, textureImg, _labelsOn));
      canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        _zoom = Math.max(0.2, Math.min(10, _zoom + (e.deltaY > 0 ? -0.2 : 0.2)));
        doRender();
      }, { passive: false });

      // ---- 导出按钮 ----
      const { addExportButton } = await import("../../utils/canvas-export.js");
      addExportButton(
        container,
        canvas,
        modelPath.split("/").pop().split("\\").pop(),
      );

      // 导出骨骼名
      const boneRow = document.createElement("div");
      boneRow.style.cssText = "display:flex;gap:6px;margin-top:2px;align-items:center";
      const boneBtn = document.createElement("button");
      boneBtn.textContent = "📋 导出骨骼名";
      boneBtn.style.cssText =
        "font-size:9px;padding:2px 8px;border-radius:4px;" +
        "border:1px solid var(--bd);background:var(--surf);" +
        "color:var(--txt);cursor:pointer";
      const boneHint = document.createElement("span");
      boneHint.style.cssText = "font-size:8px;color:var(--muted)";
      boneHint.textContent = `${model.boneCount} 骨骼`;
      boneBtn.onclick = () => {
        const lines = [];
        lines.push(`骨骼总数: ${model.boneCount}`);
        lines.push(`立方体总数: ${model.cubeCount}`);
        lines.push(`纹理: ${model.texWidth || "?"}×${model.texHeight || "?"}`);
        lines.push("─".repeat(30));
        for (const b of model.bones) {
          const cs = b.cubes || [];
          lines.push(`${b.name}${cs.length ? ` (${cs.length} 方)` : " (结构骨骼,无方)"}`);
        }
        const blob = new Blob([lines.join("\n")], { type: "text/plain" });
        const a = document.createElement("a");
        a.download = (modelPath.split("/").pop().split("\\").pop() || "model") + "_bones.txt";
        a.href = URL.createObjectURL(blob);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      };
      boneRow.appendChild(boneBtn);
      boneRow.appendChild(boneHint);
      container.appendChild(boneRow);
    } catch (e) {
      container.innerHTML = `<div style="font-size:10px;font-weight:600;color:#ff6b6b;margin-bottom:4px">🏗️ 模型结构</div><div style="font-size:9px;color:#888;padding:8px 0">⚠️ 解析失败: ${e?.message ?? e}</div>`;
    }
  }

  /** 生成模型统计卡片 HTML */
  _statsCardHTML(model, modelPath, decodedBy) {
    const isYsm = /\.ysm$/i.test(modelPath);
    const fmt = isYsm
      ? ".ysm (加密)"
      : modelPath.endsWith(".zip") ? ".zip" : ".7z";
    const badge = decodedBy
      ? `<span style="font-size:8px;padding:0 5px;border-radius:3px;background:rgba(124,131,255,0.25);color:var(--txt)">${decodedBy}</span>`
      : "";
    return `
  <div style="display:flex;align-items:center;gap:4px;margin-bottom:6px;font-size:10px;font-weight:600;color:var(--txt)">
    📊 模型概览${badge}
  </div>
  <div style="border-left:2px solid #7c83ff;padding-left:8px;margin-bottom:5px">
    <div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">🔗 模型结构</div>
    <div style="font-size:10px;color:var(--txt);line-height:1.6">
      <span style="display:inline-block;min-width:80px">├─ 骨骼 (Bones)</span><span style="color:var(--accent);font-weight:600">${model.boneCount}</span> 根<br>
      <span style="display:inline-block;min-width:80px">└─ 立方体 (Cubes)</span><span style="color:var(--accent);font-weight:600">${model.cubeCount}</span> 个
    </div>
  </div>
  <div style="border-left:2px solid #a6e3a1;padding-left:8px;margin-bottom:5px">
    <div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">🖼️ 纹理尺寸</div>
    <div style="font-size:10px;color:var(--txt);line-height:1.6">
      └─ <span style="color:var(--accent);font-weight:600">${model.texWidth || "?"} × ${model.texHeight || "?"}</span> px
    </div>
  </div>
  <div style="border-left:2px solid #f9a826;padding-left:8px">
    <div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">💾 文件信息</div>
    <div style="font-size:10px;color:var(--txt);line-height:1.6">
      └─ ${fmt}
    </div>
  </div>`;
  }

  /** 通过前端 WASM 解码 .ysm，返回 { texture, geometry }（缓存复用） */
  async _decodeYsmViaWasm(modelPath) {
    if (this._ysmCache) return this._ysmCache;
    try {
      console.log("[YSM] 加载 WASM 模块...");
      const { initYSMParser, decodeYsmFileFromMemory, decodeYsmFile } =
        await import("../../wasm/ysm-parser.js");
      const ok = await initYSMParser();
      console.log(`[YSM] WASM init: ${ok ? "✅" : "❌"}`);
      if (!ok) return null;

      console.log("[YSM] 读取文件...");
      const { ReadFileBytes } = await import("../../../wailsjs/go/main/App.js");
      let bytes = await ReadFileBytes(modelPath);
      if (typeof bytes === "string") {
        const binaryStr = atob(bytes);
        bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
      } else if (!(bytes instanceof Uint8Array)) {
        bytes = new Uint8Array(bytes);
      }
      console.log(`[YSM] 读取 ${bytes?.length || 0} bytes`);
      if (!bytes?.length) return null;

      console.log("[YSM] 内存解析...");
      let files;
      try {
        files = await decodeYsmFileFromMemory(bytes);
        if (files?.length) {
          console.log(`[YSM] ✅ 内存解析成功: ${files.length} 文件`);
        } else {
          console.log("[YSM] 内存解析返回空，回退 callMain");
        }
      } catch (e) {
        console.log(`[YSM] 内存解析异常: ${e?.message}，回退 callMain`);
      }

      if (!files?.length) {
        console.log("[YSM] callMain 回退...");
        files = await decodeYsmFile(bytes);
      }
      console.log(`[YSM] 输出 ${files?.length || 0} 文件`);
      if (files?.length) {
        console.log(`[YSM] 文件: ${files.map((f) => f.path).join(", ")}`);
      }
      if (!files?.length) return null;

      let texture = null;
      const texFile = files.find(
        (f) => f.path.endsWith(".png") || f.path.endsWith(".jpg"),
      );
      if (texFile) {
        const blob = new Blob([texFile.data]);
        texture = URL.createObjectURL(blob);
        console.log(`[YSM] 纹理: ${texFile.path}`);
      }

      let geometry = null;
      for (const f of files) {
        if (!f.path.startsWith("models/") || !f.path.endsWith(".json"))
          continue;
        console.log(`[YSM] 解析 ${f.path}...`);
        try {
          const jsonStr = new TextDecoder().decode(f.data);
          const parsed = parseBedrockGeometryFromJSON(jsonStr);
          if (parsed?.bones?.length) {
            console.log(
              `[YSM] ✅ ${f.path}: ${parsed.bones.length}骨 ${parsed.cubeCount}方`,
            );
            if (!geometry || parsed.bones.length > geometry.bones.length) {
              geometry = parsed;
              geometry.texture = texture;
            }
          } else {
            console.log(`[YSM] ⚠️ ${f.path}: 无骨骼`);
          }
        } catch (e) {
          console.log(`[YSM] ❌ ${f.path}: ${e?.message}`);
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

  /** 全窗放大预览 */
  async _openFullPreview(smallCanvas, model, textureImg, labelsOn) {
    const { renderModel2D } = await import("../../utils/model2d.js");
    // 遮罩
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;flex-direction:column";

    // 大 Canvas
    const bigCanvas = document.createElement("canvas");
    bigCanvas.width = 600;
    bigCanvas.height = 600;
    bigCanvas.style.cssText =
      "max-width:90vw;max-height:80vh;border-radius:8px;background:rgba(0,0,0,.2)";
    overlay.appendChild(bigCanvas);

    // 提示
    const hint = document.createElement("div");
    hint.style.cssText =
      "font-size:11px;color:var(--muted);margin-top:6px";
    hint.textContent = "🖱️ 滚轮缩放 · 点击外部或 ESC 关闭";
    overlay.appendChild(hint);

    let zoom = 1;
    const doRender = () => renderModel2D(bigCanvas, model, textureImg, { showLabels: labelsOn, zoom });
    doRender();

    // 滚轮缩放
    bigCanvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoom = Math.max(0.2, Math.min(10, zoom + (e.deltaY > 0 ? -0.3 : 0.3)));
      doRender();
    }, { passive: false });

    // 关闭
    const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); }, { once: true });

    document.body.appendChild(overlay);
  }

  async _showModelDetail(path) {
    const savedTab = localStorage.getItem("ysm_previewTab") || "detail";
    this._root.innerHTML = `<div class="content" id="preview-content">
  <div style="display:flex;gap:2px;margin-bottom:6px">
    <button class="preview-tab" data-tab="detail" style="flex:1;font-size:10px;padding:3px 6px;border-radius:4px;border:1px solid var(--bd);background:${savedTab === "detail" ? "var(--accent)" : "var(--surf)"};color:${savedTab === "detail" ? "#fff" : "var(--txt)"};cursor:pointer">📄 详情</button>
    <button class="preview-tab" data-tab="skeleton" style="flex:1;font-size:10px;padding:3px 6px;border-radius:4px;border:1px solid var(--bd);background:${savedTab === "skeleton" ? "var(--accent)" : "var(--surf)"};color:${savedTab === "skeleton" ? "#fff" : "var(--txt)"};cursor:pointer">🏗️ 骨骼</button>
  </div>
  <div id="preview-detail"${savedTab !== "detail" ? ' style="display:none"' : ""}><h3>📄 模型信息</h3><div class="dp-placeholder"><div class="big-icon">⏳</div><div class="dp-hint">正在解析模型文件...</div></div></div>
  <div id="preview-skeleton"${savedTab !== "skeleton" ? ' style="display:none"' : ""}></div>
</div>`;

    // Tab 切换
    const switchTab = (tab) => {
      localStorage.setItem("ysm_previewTab", tab);
      this._root.querySelectorAll(".preview-tab").forEach((btn) => {
        const isActive = btn.dataset.tab === tab;
        btn.style.background = isActive ? "var(--accent)" : "var(--surf)";
        btn.style.color = isActive ? "#fff" : "var(--txt)";
      });
      const detail = this._root.getElementById("preview-detail");
      const skel = this._root.getElementById("preview-skeleton");
      detail.style.display = tab === "detail" ? "" : "none";
      skel.style.display = tab === "skeleton" ? "" : "none";
    };
    this._root.querySelectorAll(".preview-tab").forEach((btn) => {
      btn.onclick = () => switchTab(btn.dataset.tab);
    });

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
      // 注入纹理缩略图
      if (previewSrc) {
        cardHTML = cardHTML.replace(
          '<div class="content" id="preview-content">',
          `<div style="float:right;width:70px;margin:0 0 6px 6px"><img src="${previewSrc}" alt="预览" onerror="this.style.display='none'" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid var(--bd)"></div>`,
        );
      }
      const detailDiv = this._root.getElementById("preview-detail");
      detailDiv.innerHTML = cardHTML;

      // 加载 2D 模型预览（骨架 tab）
      this._loadModel2D(path, this._root.getElementById("preview-skeleton"));
    } catch (err) {
      const detailDiv = this._root.getElementById("preview-detail");
      if (detailDiv) {
        detailDiv.innerHTML = modelDetailHTML({
          hasError: true,
          errorMsg: String(err),
        });
      }
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
        uv: Array.isArray(c.uv) ? c.uv : [0, 0],
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
