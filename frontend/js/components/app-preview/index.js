// ===== <app-preview> 入口 =====
import { bus } from "../../bus.js";
import { previewCSS } from "./preview-css.js";
import { statsHTML, modelDetailHTML, statsCardHTML } from "./tpl.js";
import { bindBusUpdates } from "./events.js";
import { bindActions } from "./preview-actions.js";
import { showPackageDetail } from "./preview-pack.js";
import { loadLogsPreview } from "./preview-logs.js";
import { openFullPreview } from "./preview-zoom.js";
import { summaryCardHTML } from "../../utils/summarize.js";
import {
  cacheGet,
  cacheSet,
  cacheSetEvictHandler,
} from "../../utils/preview-cache.js";
import { devLog, getPrefer3D, stripYsgpTextHeader } from "./preview-utils.js";
import { decodeYsmViaWasm } from "./preview-wasm.js";
import { create3DPreview } from "./preview-3d.js";
import { showModelDetail, showResourcePack } from "./preview-detail.js";
import { loadModelData } from "./preview-loader.js";
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

  /** 加载 2D 模型骨骼线条图 + 统计面板 */
  async _loadModel2D(modelPath, skelContainer) {
    const content =
      skelContainer || this._root.getElementById("preview-content");
    if (!content) return;

    // 清理旧内容（前一次模型切换残留的 canvas、调试日志等）
    content.innerHTML = "";

    const container = document.createElement("div");
    container.style.cssText = "margin-bottom:8px;opacity:0.6";
    container.innerHTML = `<div class="ysm-loading-title">🏗️ 模型结构（读取中...）</div><div class="ysm-loading-bar"></div>`;
    content.appendChild(container);

    try {
      // ---- 加载模型数据（缓存 → WASM → Go 兜底）----
      const { model, decodedBy: _decodedBy } = await loadModelData(modelPath, {
        decodeYsmViaWasm: (p) => this._decodeYsmViaWasm(p),
        appendDebug: (msg) => this._appendDebug(container, msg),
      });

      if (!model?.bones?.length) {
        container.innerHTML = `<div class="ysm-error-title">🏗️ 模型结构</div><div class="ysm-error-body">⚠️ 未找到几何数据</div>`;
        return;
      }

      // 保存模型路径供 3D 渲染使用
      model._modelPath = modelPath;

      container.style.opacity = "1";
      container.innerHTML = "";

      // ---- 模型轨迹图 ----
      const canvas = document.createElement("canvas");
      canvas.width = 180;
      canvas.height = 180;
      canvas.className = "ysm-canvas";
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
      toggleRow.className = "ysm-toggle-row";
      const eyeBtn = document.createElement("button");
      eyeBtn.className = "ysm-btn";
      const savedState = localStorage.getItem("ysm_showBoneLabels") !== "false";
      let _labelsOn = savedState;
      eyeBtn.innerHTML = _labelsOn ? "👁 骨骼名" : "👁‍🗨 骨骼名";
      eyeBtn.title = "切换骨骼名称显示";
      const eyeHint = document.createElement("span");
      eyeHint.className = "ysm-hint";
      eyeHint.textContent = _labelsOn ? "开启" : "关闭";
      toggleRow.appendChild(eyeBtn);
      toggleRow.appendChild(eyeHint);
      container.appendChild(toggleRow);

      // ---- 统计卡片 ----
      const card = document.createElement("div");
      card.className = "ysm-card";
      card.innerHTML = statsCardHTML(model, modelPath, _decodedBy);
      container.appendChild(card);

      // ---- 渲染骨骼图 ----
      const { renderModel2D } = await import("../../utils/model2d.js");
      let _zoom = 1;
      let _rotation = 0;
      const _noPlayer = { getCurrentTransforms: () => null };
      const doRender = () => {
        try {
          renderModel2D(canvas, model, textureImg, {
            showLabels: _labelsOn,
            zoom: _zoom,
            rotation: _rotation,
            boneTransforms: null,
          });
        } catch (e) {
          console.warn("[preview] 2D 渲染跳过:", e);
        }
      };
      doRender();

      eyeBtn.onclick = () => {
        _labelsOn = !_labelsOn;
        localStorage.setItem("ysm_showBoneLabels", _labelsOn);
        eyeBtn.innerHTML = _labelsOn ? "👁 骨骼名" : "👁‍🗨 骨骼名";
        eyeHint.textContent = _labelsOn ? "开启" : "关闭";
        doRender();
      };

      // ---- 动画播放器（已分离到 model3d-anim.js，暂禁用） ----
      /* 恢复时取消下方注释
      const cachedAnim = cacheGet(modelPath);
      const clips = cachedAnim?.animations;
      if (clips?.length > 0) {
        const { AnimationPlayer } =
          await import("../../utils/animation-player.js");

        // 创建设控件容器
        const animRow = document.createElement("div");
        animRow.className = "ysm-toggle-row";
        animRow.style.cssText = "gap:3px;flex-wrap:wrap";

        // 动画选择下拉
        const sel = document.createElement("select");
        sel.className = "ysm-btn";
        sel.style.cssText = "font-size:9px;max-width:120px";
        clips.forEach((c, i) => {
          const opt = document.createElement("option");
          opt.value = i;
          const label = c.name.replace(/^animation\./, "");
          opt.textContent =
            label.length > 20 ? label.slice(0, 20) + "…" : label;
          sel.appendChild(opt);
        });
        animRow.appendChild(sel);

        // 播放/暂停
        const playBtn = document.createElement("button");
        playBtn.className = "ysm-btn";
        playBtn.textContent = "▶️";
        playBtn.title = "播放/暂停";

        // 停止
        const stopBtn = document.createElement("button");
        stopBtn.className = "ysm-btn";
        stopBtn.textContent = "⏹️";
        stopBtn.title = "停止";

        // 速度
        const speedSel = document.createElement("select");
        speedSel.className = "ysm-btn";
        speedSel.style.cssText = "font-size:9px;width:48px";
        [0.25, 0.5, 1, 2, 4].forEach((s) => {
          const opt = document.createElement("option");
          opt.value = s;
          opt.textContent = s + "×";
          if (s === 1) opt.selected = true;
          speedSel.appendChild(opt);
        });
        animRow.appendChild(playBtn);
        animRow.appendChild(stopBtn);
        animRow.appendChild(speedSel);

        // 位置动画开关
        const posBtn = document.createElement("button");
        posBtn.className = "ysm-btn";
        posBtn.textContent = "🚫";
        posBtn.title = "位置动画：关（点击开）";
        posBtn.style.cssText = "font-size:9px;opacity:0.5";
        animRow.appendChild(posBtn);

        // 时间显示
        const timeLabel = document.createElement("span");
        timeLabel.className = "ysm-hint";
        timeLabel.style.cssText = "font-size:9px;min-width:50px";
        timeLabel.textContent = "0.0s";
        animRow.appendChild(timeLabel);

        container.appendChild(animRow);

        // 进度条
        const progRow = document.createElement("div");
        progRow.style.cssText =
          "display:flex;align-items:center;gap:4px;padding:0 12px;margin-bottom:4px";
        const progBar = document.createElement("div");
        progBar.style.cssText =
          "flex:1;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;cursor:pointer;position:relative";
        const progFill = document.createElement("div");
        progFill.style.cssText =
          "height:100%;background:rgba(124,131,255,0.7);border-radius:2px;width:0%";
        progBar.appendChild(progFill);
        const maxLabel = document.createElement("span");
        maxLabel.className = "ysm-hint";
        maxLabel.style.cssText =
          "font-size:9px;min-width:30px;text-align:right";
        maxLabel.textContent = "0.0s";
        progRow.appendChild(timeLabel);
        progRow.appendChild(progBar);
        progRow.appendChild(maxLabel);
        container.appendChild(progRow);

        // 进度条点击跳转
        progBar.addEventListener("click", (e) => {
          if (!_player?.currentClip) return;
          const rect = progBar.getBoundingClientRect();
          const pct = Math.max(
            0,
            Math.min(1, (e.clientX - rect.left) / rect.width),
          );
          _player.seek(pct * _player.length);
        });

        // 初始化播放器
        const boneHierarchy = model.bones.map((b) => ({
          name: b.name,
          parent: b.parent,
        }));
        _player = new AnimationPlayer(clips, boneHierarchy);

        _player.onUpdate = (transforms, t) => {
          timeLabel.textContent = t.toFixed(1) + "s";
          if (_player.length > 0) {
            progFill.style.width =
              ((t / _player.length) * 100).toFixed(1) + "%";
          }
          doRender();
        };

        _player.onStop = () => {
          playBtn.textContent = "▶️";
          doRender();
        };

        sel.onchange = () => {
          _player.play(parseInt(sel.value));
          playBtn.textContent = "⏸️";
          maxLabel.textContent = _player.length.toFixed(1) + "s";
          progFill.style.width = "0%";
        };

        playBtn.onclick = () => {
          if (_player.playing) {
            _player.pause();
            playBtn.textContent = "▶️";
          } else {
            if (_player.currentIndex < 0 && clips.length > 0) {
              _player.play(0);
              sel.value = "0";
              maxLabel.textContent = _player.length.toFixed(1) + "s";
              progFill.style.width = "0%";
            } else {
              _player.resume();
            }
            playBtn.textContent = "⏸️";
          }
        };

        stopBtn.onclick = () => {
          _player.stop();
          playBtn.textContent = "▶️";
          doRender();
        };

        speedSel.onchange = () => {
          _player.setSpeed(parseFloat(speedSel.value));
        };
      } // end if (clips?.length > 0)
      */ // ← 恢复动画时删掉这行和上面 /*

      // ---- 3D 预览切换 ----
      const _3dCtrl = create3DPreview(model);

      // 接线 🎨 3D tab 按钮（尽早绑定，避免被 _showModelDetail 占位 onclick 覆盖）
      const btn3d = this._root.getElementById("btn-3d-preview");
      if (btn3d) {
        btn3d.onclick = _3dCtrl.toggle3D;
      }
      if (getPrefer3D()) requestAnimationFrame(() => btn3d?.click());

      // ---- 全窗放大 + 滚轮/拖拽旋转 ----
      canvas.classList.add("ysm-grab");
      canvas.title = "左键全窗放大 · 滚轮缩放 · 拖拽旋转";
      canvas.addEventListener("click", () =>
        openFullPreview(canvas, model, textureImg, _labelsOn),
      );
      canvas.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          _zoom = Math.max(
            0.2,
            Math.min(10, _zoom + (e.deltaY > 0 ? -0.2 : 0.2)),
          );
          doRender();
        },
        { passive: false },
      );

      // 清理上一次的拖拽监听（避免重复注册）
      this._cleanupModelListeners();

      let _dragging = false,
        _lastX = 0;
      const _onMouseDown = (e) => {
        _dragging = true;
        _lastX = e.clientX;
      };
      const _onMouseMove = (e) => {
        if (!_dragging) return;
        _rotation = (_rotation + (e.clientX - _lastX) * 0.5) % 360;
        _lastX = e.clientX;
        doRender();
      };
      const _onMouseUp = () => {
        _dragging = false;
      };
      canvas.addEventListener("mousedown", _onMouseDown);
      window.addEventListener("mousemove", _onMouseMove);
      window.addEventListener("mouseup", _onMouseUp);
      this._modelCleanup = () => {
        canvas.removeEventListener("mousedown", _onMouseDown);
        window.removeEventListener("mousemove", _onMouseMove);
        window.removeEventListener("mouseup", _onMouseUp);
        _3dCtrl.cleanup();
      };

      // ---- 导出骨骼名 ----
      setupBoneExport(container, model, modelPath);
    } catch (e) {
      container.innerHTML = `<div class="ysm-error-title" style="color:#ff6b6b">🏗️ 模型结构</div><div class="ysm-error-body">⚠️ 解析失败: ${e?.message ?? e}</div>`;
    }
  }

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

  async _showModelDetail(path) {
    // 检测文件类型，非 YSM 走通用预览
    try {
      const { DetectResourceType } =
        await import("../../../wailsjs/go/main/App.js");
      const rtype = await DetectResourceType(path);
      if (rtype === "resourcepack") {
        showResourcePack(this, path);
        return;
      }
    } catch (_) {}
    showModelDetail(this, path);
  }

  /** 显示材质包信息（pack.mcmeta + pack.png） */
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
