// ===== 2D 骨骼加载层 =====
// 从 index.js 拆分：模型骨骼数据加载 + 2D 渲染编排
import { devLog, getPrefer3D, setPrefer3D } from "./preview-utils.js";
import { cacheGet, cacheSet } from "../../utils/preview-cache.js";
import { parseBedrockGeometryFromJSON } from "./utils.js";
import { parseBedrockAnimationJSON } from "../../utils/animation.js";
import { renderModel2D } from "../../utils/model2d.js";

/**
 * 加载模型 2D 骨骼线条图 + 统计面板
 * ctx = 组件实例（提供 this._root, this._appendDebug 等）
 */
export async function loadModel2D(ctx, modelPath, skelContainer) {
  const content = skelContainer || ctx._root.getElementById("preview-content");
  if (!content) return;

  content.innerHTML = "";

  const container = document.createElement("div");
  container.style.cssText = "margin-bottom:8px;opacity:0.6";
  container.innerHTML = `<div class="ysm-loading-title">🏗️ 模型结构（读取中...）</div><div class="ysm-loading-bar"></div>`;
  content.appendChild(container);

  try {
    let model;
    const isYsm = /\.ysm$/i.test(modelPath);

    let _decodedBy = "";
    const cached = cacheGet(modelPath);
    if (cached?.geometry?.bones?.length) {
      model = cached.geometry;
      _decodedBy = cached._decodedBy || "";
    }

    // .ysm → 前端 WASM 解码
    if (!model && isYsm) {
      const decoded = await ctx._decodeYsmViaWasm(modelPath);
      if (decoded?.geometry) {
        model = decoded.geometry;
        _decodedBy = "🧠 WASM 内置解码";
        const cur = cacheGet(modelPath);
        if (cur) cacheSet(modelPath, { ...cur, _decodedBy });
      } else {
        ctx._appendDebug(container, "[YSM] WASM 返回空，回退 Go");
      }
    }

    // 非 .ysm 或 WASM 失败 → 走 Go
    if (!model) {
      const { AnalyzeBedrockModel } =
        await import("../../../wailsjs/go/main/App.js");
      model = await AnalyzeBedrockModel(modelPath);
      if (model?.bones?.length) {
        let goClips = [];
        if (model.animations?.length) {
          const { parseBedrockAnimationJSON } =
            await import("../../utils/animation.js");
          for (const jsonStr of model.animations) {
            const { clips } = parseBedrockAnimationJSON(jsonStr);
            for (const clip of clips) {
              if (clip.hasMolang) {
                /* skip */
              }
            }
            if (clips.length > 0) goClips.push(...clips);
          }
        }
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
        cacheSet(modelPath, {
          texture: model.texture,
          geometry: model,
          animations: goClips.length > 0 ? goClips : undefined,
          _decodedBy: isYsm ? "⚙️ CLI 外置解码" : "📦 Go 原生解析",
        });
        _decodedBy = isYsm ? "⚙️ CLI 外置解码" : "📦 Go 原生解析";
      }
    }

    if (!model?.bones?.length) {
      container.innerHTML = `<div class="ysm-error-title">🏗️ 模型结构</div><div class="ysm-error-body">⚠️ 未找到几何数据</div>`;
      return;
    }

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
    const { statsCardHTML } = await import("./tpl.js");
    const card = document.createElement("div");
    card.className = "ysm-card";
    card.innerHTML = statsCardHTML(model, modelPath, _decodedBy);
    container.appendChild(card);

    // ---- 渲染骨骼图 ----
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

    // ---- 全窗放大 + 滚轮/拖拽旋转 ----
    const { openFullPreview } = await import("./events.js");
    canvas.classList.add("ysm-grab");
    canvas.title = "左键全窗放大 · 滚轮缩放 · 左右拖拽旋转";

    // 区分点击和拖拽：拖拽时 mouse 移动过则不触发 click
    let _dragging = false,
      _dragged = false,
      _lastX = 0;
    canvas.addEventListener("mousedown", (e) => {
      _dragging = true;
      _dragged = false;
      _lastX = e.clientX;
    });
    window.addEventListener("mousemove", (e) => {
      if (!_dragging) return;
      const dx = e.clientX - _lastX;
      if (Math.abs(dx) > 3) _dragged = true; // 移动超过 3px 判定为拖拽
      _lastX = e.clientX;
      _rotation = (_rotation + dx * 0.01) % (Math.PI * 2);
      doRender();
    });
    window.addEventListener("mouseup", () => {
      _dragging = false;
    });
    canvas.addEventListener("click", (e) => {
      if (_dragged) {
        e.stopPropagation();
        return;
      }
      openFullPreview(canvas, model, textureImg, _labelsOn);
    });
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

    // ---- 导出骨骼名按钮 ----
    const boneRow = document.createElement("div");
    boneRow.className = "ysm-toggle-row";
    const boneBtn = document.createElement("button");
    boneBtn.className = "ysm-btn";
    boneBtn.textContent = "📋 导出骨骼名";
    boneBtn.title = "导出骨骼名称为文本文件";
    const boneHint = document.createElement("span");
    boneHint.className = "ysm-hint";
    boneHint.textContent = `${model.boneCount} 骨骼`;
    boneBtn.onclick = () => {
      const lines = [`模型: ${modelPath}`, `骨骼总数: ${model.boneCount}`];
      for (const b of model.bones || []) {
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
    boneRow.appendChild(boneBtn);
    boneRow.appendChild(boneHint);
    container.appendChild(boneRow);

    // ---- 3D 预览切换 ----
    let _model3d = null;
    let _overlay3d = null;
    let _is3D = false;
    let _prefer3D = getPrefer3D();

    const _toggle3D = async () => {
      _is3D = !_is3D;
      _prefer3D = _is3D;
      setPrefer3D(_prefer3D);

      if (_is3D) {
        const overlay = document.createElement("div");
        overlay.id = "ysm-overlay-3d";
        overlay.style.cssText =
          "position:fixed;inset:0;z-index:9999;background:#1a1b2e;display:flex;flex-direction:column";
        _overlay3d = overlay;

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
          setPrefer3D(false);
          if (_model3d) {
            _model3d.cleanup();
            _model3d = null;
          }
        };
        topBar.appendChild(closeBtn);

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
            _toggle3D();
          };
          topBar.appendChild(texSel);
        }

        const spacer = document.createElement("div");
        spacer.style.cssText = "flex:1";
        topBar.appendChild(spacer);

        const rotLabel = document.createElement("span");
        rotLabel.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5)";
        rotLabel.textContent = "摄像机旋转:";
        topBar.appendChild(rotLabel);

        const rotSel = document.createElement("select");
        rotSel.style.cssText = "font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit;margin-right:8px";
        [{ v: true, t: "环绕" }, { v: false, t: "自身" }].forEach((m) => {
          const opt = document.createElement("option");
          opt.value = m.v;
          opt.textContent = m.t;
          rotSel.appendChild(opt);
        });
        topBar.appendChild(rotSel);

        const spdLabel = document.createElement("span");
        spdLabel.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5)";
        spdLabel.textContent = "摄像机速度:";
        topBar.appendChild(spdLabel);

        const spdSlider = document.createElement("input");
        spdSlider.type = "range";
        spdSlider.min = "2";
        spdSlider.max = "200";
        spdSlider.value = "20";
        spdSlider.style.cssText = "width:80px;margin:0 4px;cursor:pointer;accent-color:var(--accent,#7c83ff)";
        topBar.appendChild(spdSlider);

        const spdVal = document.createElement("span");
        spdVal.style.cssText = "font-size:11px;color:rgba(255,255,255,0.6);min-width:20px";
        spdVal.textContent = "20";
        topBar.appendChild(spdVal);

        overlay.appendChild(topBar);

        const viewContainer = document.createElement("div");
        viewContainer.style.cssText = "flex:1;position:relative";

        const progStyle = document.createElement("style");
        progStyle.textContent = "@keyframes ysm-prog{0%{margin-left:-30%}100%{margin-left:130%}}";
        overlay.appendChild(progStyle);

        overlay.appendChild(viewContainer);
        document.body.appendChild(overlay);

        const loadingEl = document.createElement("div");
        loadingEl.style.cssText = "position:absolute;inset:0;top:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:rgba(255,255,255,0.6);font-size:14px;gap:12px;z-index:10;background:rgba(26,27,46,0.9)";
        loadingEl.innerHTML = '<div style="font-size:32px">🧱</div><div>加载模型中...</div><div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden"><div style="height:100%;width:30%;background:var(--accent,#7c83ff);border-radius:2px;animation:ysm-prog 1.5s ease-in-out infinite"></div></div>';
        overlay.appendChild(loadingEl);

        try {
          const texUrl = model.texture || null;
          const { renderModel3D } = await import("../../utils/model3d.js");
          _model3d = await renderModel3D(viewContainer, model, texUrl, _texIdx);
          loadingEl.remove();

          const tip = document.createElement("div");
          tip.style.cssText = "padding:6px 12px;background:rgba(124,131,255,0.2);color:#fff;font-size:12px;text-align:center;flex-shrink:0;font-weight:500";
          tip.textContent = "🎮 WASD 移动 | 空格/Shift 上下 | 🖱 拖拽旋转 | 🔍 滚轮缩放 | ESC 关闭";
          overlay.insertBefore(tip, overlay.children[1]);
          setTimeout(() => { if (tip.parentNode) tip.remove(); }, 6000);

          rotSel.onchange = () => {
            _model3d.setRotationMode(rotSel.value === "true");
          };
          spdSlider.oninput = () => {
            spdVal.textContent = spdSlider.value;
            _model3d.setSpeed(Number(spdSlider.value));
          };

          const onKey = (e) => {
            if (e.key !== "Escape") return;
            const ov = document.getElementById("ysm-overlay-3d");
            if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
            _overlay3d = null;
            _is3D = false;
            _prefer3D = false;
            setPrefer3D(false);
            if (_model3d) {
              _model3d.cleanup();
              _model3d = null;
            }
          };
          document.addEventListener("keydown", onKey);
          _model3d._keyHandler = onKey;
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
      if (_overlay3d?.parentNode) _overlay3d.parentNode.removeChild(_overlay3d);
      _overlay3d = null;
      _is3D = false;
      _prefer3D = false;
      setPrefer3D(false);
    }

    // 接线 🎨 3D tab 按钮
    const btn3d = ctx._root.getElementById("btn-3d-preview");
    if (btn3d) btn3d.onclick = _toggle3D;
    if (_prefer3D) requestAnimationFrame(() => btn3d?.click());
  } catch (e) {
    container.innerHTML = `<div class="ysm-error-title" style="color:#ff6b6b">🏗️ 模型结构</div><div class="ysm-error-body">⚠️ 解析失败: ${e?.message ?? e}</div>`;
  }
}
