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
        "position:fixed;inset:0;z-index:var(--z-fullscreen);background:#1a1b2e;display:flex;flex-direction:column";
      _overlay3d = overlay;

      // 顶部栏
      const topBar = document.createElement("div");
      topBar.id = "ysm-topbar-3d";
      topBar.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(0,0,0,0.3);flex-shrink:0;pointer-events:auto;position:relative;z-index:10";
      const closeBtn = document.createElement("button");
      closeBtn.id = "ysm-close-3d";
      closeBtn.textContent = "✕ 关闭 3D";
      closeBtn.style.cssText = "font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit";
      closeBtn.onclick = _cleanupOverlay;
      topBar.appendChild(closeBtn);

      // 纹理选择器
      let _texIdx = 0;
      if (model.textures?.length > 1) {
        const texSel = document.createElement("select");
        texSel.style.cssText = "font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit";
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

      // 3D 渲染容器
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
