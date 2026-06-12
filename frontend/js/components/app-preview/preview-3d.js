// ===== 3D 全屏预览 =====
// 从 index.js _loadModel2D 拆分：_toggle3D + close3D + 3D 清理
import { setPrefer3D } from "./preview-utils.js";

/**
 * 创建 3D 预览控制器
 * @param {object} model - BedrockModel 对象
 * @returns {{ toggle3D: Function, close3D: Function, cleanup: Function }}
 */
export function create3DPreview(model) {
  let _model3d = null;
  let _overlay3d = null;
  let _is3D = false;

  function _cleanupOverlay() {
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
    setPrefer3D(false);
  }

  async function toggle3D() {
    _is3D = !_is3D;
    setPrefer3D(_is3D);

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
      closeBtn.onclick = _cleanupOverlay;
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
          _cleanupOverlay();
          toggle3D(); // 重新打开
        };
        topBar.appendChild(texSel);
      }

      // 动画控件（暂隐藏，动画已分离）
      /* 恢复动画时取消注释下方 if 块
      if (model.animations?.length > 0) {
        const sel = document.createElement("select");
        sel.className = "ysm-btn";
        sel.style.cssText = "font-size:11px;max-width:160px";
        model.animations.forEach((c, i) => {
          const opt = document.createElement("option");
          opt.value = i;
          const label = (c.name || c).replace(/^animation\./, "").slice(0, 25);
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
        _model3d = await renderModel3D(viewContainer, model, texUrl, _texIdx);

        // ESC 关闭
        const onKey = (e) => {
          if (e.key !== "Escape") return;
          _cleanupOverlay();
        };
        document.addEventListener("keydown", onKey);
        _model3d._keyHandler = onKey;
      } catch (e) {
        console.error("[3D] 加载失败:", e);
        viewContainer.innerHTML = `<div style="padding:40px;color:#ff6b6b;font-size:14px">⚠️ 3D 预览加载失败: ${e?.message || e}</div>`;
      }
    }
  }

  function close3D() { _cleanupOverlay(); }
  function cleanup() { _cleanupOverlay(); }

  return { toggle3D, close3D, cleanup };
}
