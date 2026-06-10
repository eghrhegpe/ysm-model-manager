// ===== <app-preview> 入口 =====
import { bus } from "../../bus.js";
import { previewCSS } from "./preview-css.js";
import { statsHTML, modelDetailHTML, statsCardHTML } from "./tpl.js";
import {
  bindActions,
  bindBusUpdates,
  showPackageDetail,
  loadLogsPreview,
  openFullPreview,
} from "./events.js";
import { summaryCardHTML } from "../../utils/summarize.js";
import { parseBedrockGeometryFromJSON } from "./utils.js";
import { parseBedrockAnimationJSON } from "../../utils/animation.js";
import {
  cacheGet,
  cacheSet,
  cacheSetEvictHandler,
} from "../../utils/preview-cache.js";

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

// DEV 环境下才输出调试日志
const devLog = import.meta.env.DEV ? console.log : () => {};

/** 3D 预览偏好（跨模型切换保持） */
let _prefer3D = false;

/**
 * 剥离 YSGP V2 文本头部（BOM + 文本元数据）
 * 部分早期模型在加密二进制前有 UTF-8 BOM + "YSGP" + CRLF + 文本头部（Metadata/Tips/Export 节）
 * 传入 WASM 前需剥离，否则 C++ 解析器找不到文件魔数。
 */
/**
 * 从 BOM + YSGP 文本头部变体构建标准 YSGP V2 二进制
 * 部分模型格式为：
 *   [BOM]"YSGP"\r\n--- [ Metadata ] ---\r\n...<hash>KEY...\r\n\r\n[加密数据]
 * C++ 解析器要求：
 *   "YSGP" + version(4B大端=2) + hash(16B) + [加密数据]
 * 这里从文本头部提取 hash，拼接成标准格式传给 WASM。
 */
function buildStdYsgpFromTextVariant(bytes) {
  if (!bytes || bytes.length < 20) return null;
  // 检测 BOM + YSGP
  if (bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf) return null;
  if (
    bytes[3] !== 0x59 ||
    bytes[4] !== 0x53 ||
    bytes[5] !== 0x47 ||
    bytes[6] !== 0x50
  ) {
    return null;
  }

  // 把整个文件当文本读，找 <hash> 标签
  let textPortion = "";
  for (let i = 0; i < Math.min(bytes.length, 6000); i++) {
    textPortion += String.fromCharCode(bytes[i]);
  }

  // 提取 <hash> 标签中的 MD5 密钥
  let hashHex = "";
  const hashMatch = textPortion.match(/<hash>\s*([0-9a-f]{32})/i);
  if (hashMatch) hashHex = hashMatch[1];

  // 找加密数据起始位置（第一个 null 字节）
  let dataStart = -1;
  // 从可能结束的区域开始找：--- [ Source SHA-256 ] 之后
  const shaEnd = textPortion.lastIndexOf("--- [ Source");
  const searchFrom = shaEnd > 0 ? shaEnd : 100;
  for (let i = searchFrom; i < bytes.length - 4; i++) {
    if (bytes[i] === 0x00 && bytes[i + 1] !== 0x00) {
      dataStart = i;
      break;
    }
  }
  // 兜底：找第一个 null 字节
  if (dataStart < 0) {
    for (let i = 50; i < bytes.length; i++) {
      if (bytes[i] === 0x00) {
        dataStart = i;
        break;
      }
    }
  }
  if (dataStart < 0 || dataStart >= bytes.length - 16) return null;

  // 构建标准 YSGP V2 头部
  const magic = new Uint8Array([0x59, 0x53, 0x47, 0x50]); // "YSGP"
  const version = new Uint8Array([0x00, 0x00, 0x00, 0x02]); // V2 big-endian
  // hash: 从文本提取的 16 字节，或从原文头部的 hash 区域提取
  let hashArr;
  if (hashHex) {
    hashArr = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      hashArr[i] = parseInt(hashHex.substr(i * 2, 2), 16);
    }
  } else {
    // 没有 <hash> 标签，尝试从文本头部末尾的 hash 字段读
    // 构造一个默认 hash
    hashArr = new Uint8Array(16);
  }

  // 调试：打印 dataStart 处的字节，确认 hash 位置
  const debugBytes = Array.from(
    bytes.slice(
      Math.max(0, dataStart - 4),
      Math.min(bytes.length, dataStart + 24),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
  console.log(
    `[YSM] dataStart=${dataStart}, 前4字节: ${debugBytes.slice(0, 11)}... 后24字节: ${debugBytes.slice(12)}`,
  );

  // 原始文件在文本头部后包含 16 字节 hash，然后才是加密数据
  // 跳过这 16 字节，避免重建时 hash 重复
  const encryptedStart = dataStart + 16;
  const encrypted = bytes.slice(encryptedStart);
  console.log(`[YSM] 跳过 16B hash 后加密数据=${encrypted.length}B`);
  const result = new Uint8Array(4 + 4 + 16 + encrypted.length);
  result.set(magic, 0);
  result.set(version, 4);
  result.set(hashArr, 8);
  result.set(encrypted, 24);

  const strippedLen = dataStart;
  console.log(
    `[YSM] 构建标准 YSGP: 剥离 ${strippedLen}B 文本头部, ` +
      `hash=${hashHex || "默认"}, 加密数据=${encrypted.length}B`,
  );
  return result;
}

function stripYsgpTextHeader(bytes) {
  // 先尝试构建标准 YSGP 二进制
  const stdYsgp = buildStdYsgpFromTextVariant(bytes);
  if (stdYsgp) return stdYsgp;

  if (!bytes || bytes.length < 10) return bytes;
  // 检测 UTF-8 BOM + YSGP（旧版降级）
  if (bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf) return bytes;
  if (
    bytes[3] !== 0x59 ||
    bytes[4] !== 0x53 ||
    bytes[5] !== 0x47 ||
    bytes[6] !== 0x50
  ) {
    return bytes;
  }
  // 找第一个 null 字节
  let firstNull = -1;
  for (let i = 50; i < bytes.length && i < 8000; i++) {
    if (bytes[i] === 0) {
      firstNull = i;
      break;
    }
  }
  if (firstNull > 0) {
    devLog(
      `[YSM] 剥离 YSGP 文本头部: ${firstNull}B → ${bytes.length - firstNull}B`,
    );
    return bytes.slice(firstNull);
  }
  return bytes;
}

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

  /** 自动匹配缩略图：查缓存 → .ysm 走 WASM → Go 兜底 */
  async _loadPreviewImage(modelPath) {
    // 查缓存（模块级，跨组件生命周期持久）
    const cached = cacheGet(modelPath);
    if (cached?.texture) return cached.texture;
    if (cached?.geometry?.texture) return cached.geometry.texture;

    // .ysm 先试 WASM，失败则走 Go
    if (/\.ysm$/i.test(modelPath)) {
      const decoded = await this._decodeYsmViaWasm(modelPath);
      if (decoded?.texture) {
        cacheSet(modelPath, { ...decoded, _decodedBy: "🧠 WASM" });
        return decoded.texture;
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
      let model;
      const isYsm = /\.ysm$/i.test(modelPath);

      // 查缓存（_loadPreviewImage 可能已经存过）
      let _decodedBy = ""; // "WASM" | "CLI" | ""

      const cached = cacheGet(modelPath);
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
          // 解析 Go 端返回的动画 JSON
          let goClips = [];
          if (model.animations?.length) {
            const { parseBedrockAnimationJSON } =
              await import("../../utils/animation.js");
            for (const jsonStr of model.animations) {
              const { clips } = parseBedrockAnimationJSON(jsonStr);
              for (const clip of clips) {
                if (clip.hasMolang) {
                  // Molang 表达式已跳过，静默忽略
                }
              }
              if (clips.length > 0) goClips.push(...clips);
            }
          }
          // Go CLI 模型简化的纹理映射日志
          const goTexCount = model.textures?.length || 0;
          model._texMappingLog = [
            {
              file: modelPath.split("/").pop().split("\\").pop(),
              texKey: goTexCount > 0 ? "texture[0]" : "—",
              texIdx: 0,
              pngSize: "—",
              geoSize: model.texWidth
                ? `${model.texWidth}×${model.texHeight}`
                : "—",
              uvSize: "—",
              finalSize: model.texWidth
                ? `${model.texWidth}×${model.texHeight}`
                : "—",
            },
          ];
          if (goTexCount > 1) {
            model._texMappingLog.push({
              file: "(+多纹理)",
              texKey: `+${goTexCount - 1}`,
              texIdx: 0,
              pngSize: "—",
              geoSize: "—",
              uvSize: "—",
              finalSize: "—",
            });
          }
          cacheSet(modelPath, {
            texture: model.texture,
            geometry: model,
            animations: goClips.length > 0 ? goClips : undefined,
            _decodedBy: "⚙️ CLI",
          });
          _decodedBy = "⚙️ CLI";
        }
      }

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
      let _model3d = null;
      const viewBtn = document.createElement("button");
      viewBtn.className = "ysm-btn";
      viewBtn.textContent = "🌐 3D";
      viewBtn.title = "全屏 3D 预览";
      const viewHint = document.createElement("span");
      viewHint.className = "ysm-hint";
      viewHint.textContent = "全屏";

      // 3D 全屏状态
      let _overlay3d = null;
      let _is3D = false;
      if (_prefer3D) requestAnimationFrame(() => viewBtn.click());

      viewBtn.onclick = async () => {
        _is3D = !_is3D;
        _prefer3D = _is3D;

        if (_is3D) {
          // 创建全屏遮罩
          const overlay = document.createElement("div");
          overlay.id = "ysm-overlay-3d";
          overlay.style.cssText =
            "position:fixed;inset:0;z-index:9999;background:#1a1b2e;display:flex;flex-direction:column";
          _overlay3d = overlay;

          // 顶部栏
          const topBar = document.createElement("div");
          topBar.id = "ysm-topbar-3d";
          topBar.style.cssText =
            "display:flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(0,0,0,0.3);flex-shrink:0;pointer-events:auto;position:relative;z-index:10";
          const closeBtn = document.createElement("button");
          closeBtn.className = "ysm-btn";
          closeBtn.id = "ysm-close-3d";
          closeBtn.textContent = "✕ 关闭 3D";
          closeBtn.onclick = () => {
            const ov = document.getElementById("ysm-overlay-3d");
            if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
            _overlay3d = null;
            _is3D = false;
            _prefer3D = false;
            viewBtn.textContent = "🌐 3D";
            viewHint.textContent = "全屏";
            if (_model3d) {
              _model3d.cleanup();
              _model3d = null;
            }
          };
          topBar.appendChild(closeBtn);

          // 纹理选择器
          let _texIdx = 0;
          if (model.textures?.length > 1) {
            const texSel = document.createElement("select");
            texSel.className = "ysm-btn";
            texSel.style.cssText = "font-size:11px";
            model.textures.forEach((_, i) => {
              const opt = document.createElement("option");
              opt.value = i;
              opt.textContent = `纹理 ${i + 1}`;
              texSel.appendChild(opt);
            });
            texSel.onchange = () => {
              _texIdx = parseInt(texSel.value);
              close3D();
              viewBtn.click(); // 重新打开
            };
            topBar.appendChild(texSel);
          }

          // 动画控件（暂隐藏，动画已分离）
          /* 恢复动画时取消注释下方 if 块
          if (clips?.length > 0) {
            const sel = document.createElement("select");
            sel.className = "ysm-btn";
            sel.style.cssText = "font-size:11px;max-width:160px";
            clips.forEach((c, i) => {
              const opt = document.createElement("option");
              opt.value = i;
              opt.textContent = c.name.replace(/^animation\./, "").slice(0, 25);
              sel.appendChild(opt);
            });
            topBar.appendChild(sel);

            const playBtn = document.createElement("button");
            playBtn.className = "ysm-btn";
            playBtn.textContent = "▶️";
            const stopBtn = document.createElement("button");
            stopBtn.className = "ysm-btn";
            stopBtn.textContent = "⏹️";
            const speedSel = document.createElement("select");
            speedSel.className = "ysm-btn";
            speedSel.style.cssText = "font-size:11px;width:52px";
            [0.25, 0.5, 1, 2, 4].forEach((s) => {
              const opt = document.createElement("option");
              opt.value = s;
              opt.textContent = s + "×";
              if (s === 1) opt.selected = true;
              speedSel.appendChild(opt);
            });
            const timeLabel = document.createElement("span");
            timeLabel.style.cssText =
              "font-size:11px;color:rgba(255,255,255,0.6);min-width:60px";
            timeLabel.textContent = "0.0s / 0.0s";
            topBar.appendChild(playBtn);
            topBar.appendChild(stopBtn);
            topBar.appendChild(speedSel);
            topBar.appendChild(timeLabel);
          } */ // 恢复动画时删掉上行
          overlay.appendChild(topBar);

          // 3D 渲染容器
          const viewContainer = document.createElement("div");
          viewContainer.style.cssText = "flex:1;position:relative";
          overlay.appendChild(viewContainer);
          document.body.appendChild(overlay);

          // 加载 3D
          try {
            const texUrl = model.texture || null;
            const { renderModel3D } = await import("../../utils/model3d.js");
            _model3d = await renderModel3D(
              viewContainer,
              model,
              texUrl,
              _texIdx,
            );

            // ESC 关闭
            const onKey = (e) => {
              if (e.key !== "Escape") return;
              const ov = document.getElementById("ysm-overlay-3d");
              if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
              _overlay3d = null;
              _is3D = false;
              _prefer3D = false;
              viewBtn.textContent = "🌐 3D";
              viewHint.textContent = "全屏";
              if (_model3d) {
                _model3d.cleanup();
                _model3d = null;
              }
            };
            document.addEventListener("keydown", onKey);
            _model3d._keyHandler = onKey;
            // （动画绑定已分离，后续恢复时在这加）
          } catch (e) {
            console.error("[3D] 加载失败:", e);
            viewContainer.innerHTML = `<div style="padding:40px;color:#ff6b6b;font-size:14px">⚠️ 3D 预览加载失败: ${e?.message || e}</div>`;
          }
        }
      };

      function close3D() {
        if (_model3d) {
          clearInterval(_model3d._timeTimer);
          if (_model3d._keyHandler)
            document.removeEventListener("keydown", _model3d._keyHandler);
          _model3d.cleanup();
          _model3d = null;
        }
        if (_overlay3d?.parentNode)
          _overlay3d.parentNode.removeChild(_overlay3d);
        _overlay3d = null;
        _is3D = false;
        _prefer3D = false;
        viewBtn.textContent = "🌐 3D";
        viewHint.textContent = "全屏";
      }

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
        if (_model3d) {
          clearInterval(_model3d._timeTimer);
          if (_model3d._keyHandler)
            document.removeEventListener("keydown", _model3d._keyHandler);
          _model3d.cleanup();
          _model3d = null;
        }
        if (_overlay3d?.parentNode)
          _overlay3d.parentNode.removeChild(_overlay3d);
        _overlay3d = null;
      };

      // ---- 导出骨骼名 ----
      const boneRow = document.createElement("div");
      boneRow.className = "ysm-export-row";
      const boneBtn = document.createElement("button");
      boneBtn.textContent = "📋 导出骨骼名";
      boneBtn.className = "ysm-export-btn";
      const boneHint = document.createElement("span");
      boneHint.className = "ysm-hint";
      boneHint.textContent = `${model.boneCount} 骨骼`;
      boneBtn.onclick = () => {
        const lines = [];
        lines.push(`骨骼总数: ${model.boneCount}`);
        lines.push(`立方体总数: ${model.cubeCount}`);
        lines.push(`纹理: ${model.texWidth || "?"}×${model.texHeight || "?"}`);
        lines.push("─".repeat(30));
        for (const b of model.bones) {
          const cs = b.cubes || [];
          lines.push(
            `${b.name}${cs.length ? ` (${cs.length} 方)` : " (结构骨骼,无方)"}`,
          );
        }
        const blob = new Blob([lines.join("\n")], { type: "text/plain" });
        const a = document.createElement("a");
        a.download =
          (modelPath.split("/").pop().split("\\").pop() || "model") +
          "_bones.txt";
        a.href = URL.createObjectURL(blob);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      };
      boneRow.appendChild(viewBtn);
      boneRow.appendChild(viewHint);
      boneRow.appendChild(boneBtn);
      boneRow.appendChild(boneHint);
      container.appendChild(boneRow);
    } catch (e) {
      container.innerHTML = `<div class="ysm-error-title" style="color:#ff6b6b">🏗️ 模型结构</div><div class="ysm-error-body">⚠️ 解析失败: ${e?.message ?? e}</div>`;
    }
  }

  /** 通过前端 WASM 解码 .ysm，返回 { texture, geometry }（缓存复用） */
  async _decodeYsmViaWasm(modelPath) {
    const cached = cacheGet(modelPath);
    if (cached?.geometry) return cached;
    try {
      devLog("[YSM] 加载 WASM 模块...");
      const { initYSMParser, decodeYsmFileFromMemory } =
        await import("../../wasm/ysm-parser.js");
      const ok = await initYSMParser();
      console.log(`[YSM] WASM init: ${ok ? "✅" : "❌"}`);
      if (!ok) return null;

      devLog("[YSM] 读取文件...");
      const { ReadFileBytes } = await import("../../../wailsjs/go/main/App.js");
      let bytes = await ReadFileBytes(modelPath);
      if (typeof bytes === "string") {
        const raw = atob(bytes);
        const len = raw.length;
        const arr = new Uint8Array(len);
        for (let i = 0; i < len; i++) arr[i] = raw.charCodeAt(i);
        bytes = arr;
      } else if (!(bytes instanceof Uint8Array)) {
        bytes = new Uint8Array(bytes);
      }
      devLog(`[YSM] 读取 ${bytes?.length || 0} bytes`);
      if (!bytes?.length) return null;

      // 剥离 BOM + YSGP 文本头部（部分早期 YSGP V2 模型在加密数据前有 UTF-8 BOM 和文本元数据）
      bytes = stripYsgpTextHeader(bytes);

      devLog("[YSM] 内存解析...");
      let files;
      try {
        files = await decodeYsmFileFromMemory(bytes);
        if (files?.length) {
          devLog(`[YSM] ✅ 内存解析成功: ${files.length} 文件`);
        } else {
          devLog("[YSM] 内存解析返回空（跳过 callMain 直接回退 Go CLI）");
        }
      } catch (e) {
        devLog(`[YSM] 内存解析异常: ${e?.message}，回退 Go CLI`);
      }
      console.log(`[YSM] 输出 ${files?.length || 0} 文件`);
      if (files?.length) {
        console.log(`[YSM] 文件: ${files.map((f) => f.path).join(", ")}`);
      }
      if (!files?.length) {
        console.log("[YSM] ❌ WASM 解码失败，无输出文件");
        return null;
      }

      // 打印 ysm.json 确认纹理映射
      let ysmTexOrder = null;
      let ysmModelOrder = null;
      let ysmDefaultTex = null;
      const ysmMeta = files.find((f) => f.path.endsWith("ysm.json"));
      if (ysmMeta) {
        try {
          const txt = new TextDecoder().decode(ysmMeta.data);
          const json = JSON.parse(txt);
          ysmTexOrder = json?.files?.player?.texture;
          ysmModelOrder = json?.files?.player?.model;
          // 读取默认纹理名（Go 端 parseBedrockFromZip 也读此字段）
          ysmDefaultTex = json?.properties?.default_texture || null;
          if (ysmTexOrder)
            console.log(
              `[YSM] ysm.json 纹理列表:`,
              ysmTexOrder
                .map((t) => (typeof t === "string" ? t : t?.uv || t?.path))
                .filter(Boolean),
              `默认纹理: ${ysmDefaultTex || "无"}`,
            );
        } catch (e) {
          /* ignore */
        }
      }

      // 收集所有纹理文件，按 ysm.json 顺序排列
      const textures = {};
      const texNameMap = {};
      /** 小写 key → 实际 key 映射（Windows 大小写不敏感） */
      const texLowerMap = {};
      /** 每个纹理的实际 PNG 尺寸（key → {w, h}），用于各模型独立计算 UV */
      const texDimensions = {};
      let maxTexW = 0,
        maxTexH = 0;
      for (const f of files) {
        if (f.path.endsWith(".png") || f.path.endsWith(".jpg")) {
          const blob = new Blob([f.data]);
          const key = f.path
            .split("/")
            .pop()
            .replace(/\.\w+$/, "");
          textures[key] = URL.createObjectURL(blob);
          texNameMap[key] = f.path;
          texLowerMap[key.toLowerCase()] = key;
          // 从 PNG/JPG 文件头读实际尺寸（优先于 geometry metadata）
          const arr = new Uint8Array(f.data);
          let texW = 0,
            texH = 0;
          if (arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4e) {
            // PNG: IHDR at bytes 16-23: width(4) height(4) big-endian
            texW = (arr[16] << 24) | (arr[17] << 16) | (arr[18] << 8) | arr[19];
            texH = (arr[20] << 24) | (arr[21] << 16) | (arr[22] << 8) | arr[23];
          } else if (arr[0] === 0xff && arr[1] === 0xd8) {
            // JPEG: 扫描 SOF marker (FF C0/C1/C2) 获取尺寸
            for (let i = 2; i < Math.min(arr.length - 8, 4096); i++) {
              if (arr[i] === 0xff && (arr[i + 1] & 0xf0) === 0xc0) {
                texH = (arr[i + 5] << 8) | arr[i + 6];
                texW = (arr[i + 7] << 8) | arr[i + 8];
                break;
              }
            }
          }
          if (texW > 0 && texH > 0) {
            texDimensions[key] = { w: texW, h: texH };
            if (texW > maxTexW) maxTexW = texW;
            if (texH > maxTexH) maxTexH = texH;
          }
          devLog(
            `[YSM] 纹理: ${f.path} → key="${key}"${texDimensions[key] ? ` (${texDimensions[key].w}×${texDimensions[key].h})` : ""}`,
          );
        }
      }
      /** 尝试精确匹配，失败则大小写不敏感兜底 */
      const matchTexKey = (tn) => {
        if (!tn) return null;
        if (textures[tn]) return tn;
        const lower = tn.toLowerCase();
        return texLowerMap[lower] || null;
      };

      let orderedTexKeys = Object.keys(textures);
      if (ysmTexOrder) {
        let ordered = [];
        for (const t of ysmTexOrder) {
          const path = typeof t === "string" ? t : t?.uv || t?.path || "";
          const tn = path
            .split("/")
            .pop()
            .replace(/\.\w+$/, "");
          const matched = matchTexKey(tn);
          if (matched) ordered.push(matched);
        }
        for (const k of Object.keys(textures)) {
          if (!ordered.includes(k)) ordered.push(k);
        }
        // 确保默认纹理排在第一位（与 Go 端 parseBedrockFromZip 行为一致）
        if (ysmDefaultTex) {
          const defKey = matchTexKey(
            ysmDefaultTex
              .split("/")
              .pop()
              .replace(/\.\w+$/, ""),
          );
          if (defKey && ordered.includes(defKey) && ordered[0] !== defKey) {
            ordered = [defKey, ...ordered.filter((k) => k !== defKey)];
          }
        }
        orderedTexKeys = ordered;
      }
      console.log(
        `[YSM] 找到 ${orderedTexKeys.length} 个纹理: ${orderedTexKeys.join(", ")}`,
      );

      // 构建模型文件 → 纹理索引映射（按 ysm.json files.player.model 数组顺序）
      // 模型顺序决定了纹理分配：files.player.model[i] → textures[i]
      const modelTexIdxMap = new Map();
      if (ysmModelOrder) {
        for (let i = 0; i < ysmModelOrder.length; i++) {
          const mp = ysmModelOrder[i];
          const mn = typeof mp === "string" ? mp : mp?.path || mp?.name || "";
          const modelName = mn.split("/").pop().split("\\").pop();
          if (modelName) {
            const texIdx = Math.min(i, orderedTexKeys.length - 1);
            modelTexIdxMap.set(modelName, texIdx);
          }
        }
      }

      // 解析所有模型文件，合并骨骼，标记纹理索引
      let geometry = null;
      const allBones = [];
      const processedModels = new Set();
      /** 每个模型文件的纹理映射记录（用于 UI 展示） */
      const texMappingLog = [];

      /** 解析一个模型文件并添加到 allBones */
      const processModelFile = (f, forcedTexIdx) => {
        if (!f || processedModels.has(f.path)) return;
        processedModels.add(f.path);
        devLog(`[YSM] 解析 ${f.path}...`);
        try {
          const jsonStr = new TextDecoder().decode(f.data);
          const parsed = parseBedrockGeometryFromJSON(jsonStr);
          if (!parsed?.bones?.length) return;
          devLog(
            `[YSM] ✅ ${f.path}: ${parsed.bones.length}骨 ${parsed.cubeCount}方`,
          );

          // 纹理索引来自 ysmModelOrder 映射，或默认 0
          const texIdx = forcedTexIdx ?? 0;
          const texKey =
            orderedTexKeys.length > texIdx
              ? orderedTexKeys[texIdx]
              : orderedTexKeys.length > 0
                ? orderedTexKeys[0]
                : null;
          const texUrl = texKey ? textures[texKey] : null;

          // 从 UV 值推断该几何体实际需要的纹理尺寸（某些模型 UV 像素超出声明的纹理尺寸）
          // 对 expandBoxUV（uv: [u,v]），max_u = u + 2*(x+z)，max_v = v + y + z
          // 对 faceUV，取每面 uv + uv_size 的最大值
          let uvMaxW = 2,
            uvMaxH = 2;
          for (const b of parsed.bones) {
            for (const c of b.cubes || []) {
              const [sx, sy, sz] = c.size;
              if (Array.isArray(c.uv) && c.uv.length >= 2) {
                const [u, v] = c.uv;
                // expandBoxUV 布局的最大 UV 像素值
                const maxU = u + 2 * (Math.abs(sx) + Math.abs(sz));
                const maxV = v + Math.abs(sy) + Math.abs(sz);
                if (maxU > uvMaxW) uvMaxW = maxU;
                if (maxV > uvMaxH) uvMaxH = maxV;
              } else if (c.faceUV) {
                try {
                  const fd = JSON.parse(c.faceUV);
                  for (const fn of [
                    "east",
                    "west",
                    "up",
                    "down",
                    "south",
                    "north",
                  ]) {
                    const f = fd[fn];
                    if (!f?.uv) continue;
                    const fw = Math.abs(f.uv_size?.[0] || 0);
                    const fh = Math.abs(f.uv_size?.[1] || 0);
                    const uEnd = f.uv[0] + fw;
                    const vEnd = f.uv[1] + fh;
                    if (uEnd > uvMaxW) uvMaxW = uEnd;
                    if (vEnd > uvMaxH) uvMaxH = vEnd;
                  }
                } catch {}
              }
            }
          }

          // 最终纹理尺寸 = max(PNG 实际尺寸, 几何体声明尺寸, UV 推断尺寸)
          const texDim = texKey ? texDimensions[texKey] : null;
          const actualTexW = texDim ? texDim.w : 0;
          const actualTexH = texDim ? texDim.h : 0;
          const boneTexW = Math.max(actualTexW, parsed.texWidth, uvMaxW) || 64;
          const boneTexH = Math.max(actualTexH, parsed.texHeight, uvMaxH) || 64;
          // 记录纹理映射日志
          texMappingLog.push({
            file: f.path.split("/").pop(),
            texKey: texKey || "—",
            texIdx,
            pngSize: texDim ? `${texDim.w}×${texDim.h}` : "—",
            geoSize:
              parsed.texWidth > 0
                ? `${parsed.texWidth}×${parsed.texHeight}`
                : "—",
            uvSize: `${uvMaxW}×${uvMaxH}`,
            finalSize: `${boneTexW}×${boneTexH}`,
          });
          for (const b of parsed.bones) {
            b._texIdx = texIdx;
            b._texUrl = texUrl;
            b._texWidth = boneTexW;
            b._texHeight = boneTexH;
          }
          allBones.push(...parsed.bones);

          if (!geometry) {
            geometry = parsed;
          } else {
            geometry.boneCount += parsed.boneCount;
            geometry.cubeCount += parsed.cubeCount;
            if (parsed.texWidth > geometry.texWidth)
              geometry.texWidth = parsed.texWidth;
            if (parsed.texHeight > geometry.texHeight)
              geometry.texHeight = parsed.texHeight;
          }
        } catch (e) {
          devLog(`[YSM] ❌ ${f.path}: ${e?.message}`);
        }
      };

      // 第一轮：按 ysmModelOrder 顺序处理模型文件（保证纹理索引正确）
      if (ysmModelOrder) {
        for (const mp of ysmModelOrder) {
          const mn = typeof mp === "string" ? mp : mp?.path || mp?.name || "";
          const modelName = mn.split("/").pop().split("\\").pop();
          if (!modelName) continue;
          const f = files.find(
            (ff) =>
              ff.path.endsWith("/" + modelName) ||
              ff.path.endsWith("\\" + modelName) ||
              ff.path === modelName,
          );
          const texIdx = modelTexIdxMap.get(modelName) ?? 0;
          processModelFile(f, texIdx);
        }
      }

      // 第二轮：处理剩余不在 ysmModelOrder 中的模型文件
      // 无 ysm.json 时，按模型文件名匹配纹理：main.json→"main"纹理, arrow.json→"arrow"纹理
      // 匹配不到的统一用 index 0（主纹理）
      const texKeyToIdx = {};
      orderedTexKeys.forEach((k, i) => {
        texKeyToIdx[k] = i;
      });
      for (const f of files) {
        if (!f.path.startsWith("models/") || !f.path.endsWith(".json"))
          continue;
        if (!processedModels.has(f.path)) {
          // 从模型文件名推测纹理索引：取 basename 去 .json，在纹理列表中匹配
          const modelBase = f.path
            .split("/")
            .pop()
            .replace(/\.json$/, "");
          let matchedKey = matchTexKey(modelBase);
          // 精确匹配不到时尝试子串匹配：如 arrow.json → "arrow-texture" / "arrow" 纹理
          if (matchedKey == null) {
            const lowerBase = modelBase.toLowerCase();
            for (const k of orderedTexKeys) {
              if (
                k.toLowerCase().includes(lowerBase) ||
                lowerBase.includes(k.toLowerCase())
              ) {
                matchedKey = k;
                break;
              }
            }
          }
          const texIdx =
            matchedKey != null ? (texKeyToIdx[matchedKey] ?? 0) : 0;
          processModelFile(f, texIdx);
        }
      }
      // 合并后的 geometry
      if (geometry) {
        geometry.bones = allBones;
        geometry.textures = orderedTexKeys
          .map((k) => textures[k])
          .filter(Boolean);
        geometry.texture =
          orderedTexKeys.length > 0 ? textures[orderedTexKeys[0]] : null;
        // 当实际 PNG 尺寸 > 几何体元数据时，用 PNG 实际尺寸覆盖
        // 几何体元数据可能过小（如 32），导致 UV 归一化错误
        if (maxTexW > geometry.texWidth) geometry.texWidth = maxTexW;
        if (maxTexH > geometry.texHeight) geometry.texHeight = maxTexH;
        // 纹理映射日志（调试用）
        geometry._texMappingLog = texMappingLog;
      }

      // 解析动画文件
      const animations = [];
      for (const f of files) {
        if (!f.path.startsWith("animations/") || !f.path.endsWith(".json"))
          continue;
        devLog(`[YSM] 动画 ${f.path}...`);
        try {
          const jsonStr = new TextDecoder().decode(f.data);
          const { clips, errors } = parseBedrockAnimationJSON(jsonStr);
          for (const clip of clips) {
            if (clip.hasMolang) {
              // Molang 表达式已跳过，静默忽略
            }
          }
          if (clips.length > 0) {
            animations.push(...clips);
          }
          if (errors.length > 0) {
            devLog(`[YSM] ⚠️ ${f.path}: ${errors.join("; ")}`);
          }
        } catch (e) {
          devLog(`[YSM] ❌ ${f.path}: ${e?.message}`);
        }
      }

      const texUrl =
        geometry?.texture ||
        (orderedTexKeys.length > 0 ? textures[orderedTexKeys[0]] : null) ||
        null;
      cacheSet(modelPath, { texture: texUrl, geometry, animations });
      return { texture: texUrl, geometry, animations };
    } catch (e) {
      devLog(`[YSM] ❌ ${e?.message || e}`);
      return null;
    }
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
    const savedTab = localStorage.getItem("ysm_previewTab") || "detail";
    this._root.innerHTML = `<div class="content" id="preview-content">
  <div class="ysm-tab-row">
    <button class="preview-tab ysm-tab ${savedTab === "detail" ? "ysm-tab-active" : "ysm-tab-inactive"}" data-tab="detail">📄 详情</button>
    <button class="preview-tab ysm-tab ${savedTab === "skeleton" ? "ysm-tab-active" : "ysm-tab-inactive"}" data-tab="skeleton">🏗️ 骨骼</button>
  </div>
  <div id="preview-detail"${savedTab !== "detail" ? ' style="display:none"' : ""}><h3>📄 模型信息</h3><div class="dp-placeholder"><div class="big-icon">⏳</div><div class="dp-hint">正在解析模型文件...</div></div></div>
  <div id="preview-skeleton"${savedTab !== "skeleton" ? ' style="display:none"' : ""}></div>
</div>`;

    // Tab 切换
    const switchTab = (tab) => {
      localStorage.setItem("ysm_previewTab", tab);
      this._root.querySelectorAll(".preview-tab").forEach((btn) => {
        const isActive = btn.dataset.tab === tab;
        btn.classList.toggle("ysm-tab-active", isActive);
        btn.classList.toggle("ysm-tab-inactive", !isActive);
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
        (summary.stats?.textures > 0 ||
          summary.stats?.models > 0 ||
          summary.stats?.animations > 0 ||
          summary.stats?.texWidth > 0 ||
          summary.authors?.length > 0 ||
          summary.license);
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

// ===== 工具：从 JSON 字符串解析 Bedrock geometry（已移至 data.js） =====
