// ===== 通用相机控件（ADR-066 P3 拆出：破 mount-preview-core ↔ preview-menu 循环）=====
// buildCameraControls / CameraControlBridge 原定义在 mount-preview-core.ts，
// 但 preview-menu/core.ts 也 import 它们 → 两文件互相 import 构成循环依赖
// （check-circular 检出）。拆到独立文件后：
//   mount-preview-core → preview-menu（mountPreviewRootMenu）
//   preview-menu → camera-controls（buildCameraControls）
//   不再有环。
import { t } from "../../core/i18n/t.ts";
import { safeSet } from "../../utils/dom/storage.ts";
import { createIconButton } from "../../utils/dom/fab.ts";

/** 相机控制桥：shared/self 双模式统一构建旋转/速度/重置控件的回调集合（方案 A：消灭 ysm-adapter 双份实现） */
export interface CameraControlBridge {
  /** 当前旋转模式（true=环绕） */
  getOrbit(): boolean;
  /** 设置旋转模式（含 shared 模式的 controls.enableRotate / orbitTarget 同步） */
  setOrbit(v: boolean): void;
  /** 当前相机速度 */
  getSpeed(): number;
  /** 设置相机速度 */
  setSpeed(n: number): void;
  /** 重置视角（shared 模式经 content.resetCamera，build 前调用安全——闭包延迟求值） */
  reset(): void;
}

// ---- 通用相机控制常量（对齐 vrm/litematic 既有口径）----
const MIN_CAM_SPEED = 2;
const MAX_CAM_SPEED = 200;

/** 在根菜单 camera 面板内追加通用相机控件（旋转模式 / 速度滑条 / 重置视角），shared/self 双模式复用 */
export function buildCameraControls(list: HTMLElement, bridge: CameraControlBridge): void {
  const rotLabel = document.createElement("span");
  rotLabel.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5)";
  rotLabel.textContent = t("preview.cameraRotation") + ":";
  list.appendChild(rotLabel);

  const rotSel = document.createElement("select");
  rotSel.className = "setting-select"; // 🥉 ui/ 库下拉样式（§19）
  rotSel.style.marginRight = "8px";
  rotSel.dataset.testid = "mmd-rot-mode"; // §19.1
  [
    { v: true, t: "环绕" },
    { v: false, t: "自身" },
  ].forEach((m) => {
    const opt = document.createElement("option");
    opt.value = String(m.v);
    opt.textContent = m.t;
    rotSel.appendChild(opt);
  });
  rotSel.value = String(bridge.getOrbit());
  rotSel.onchange = (): void => {
    const v = rotSel.value === "true";
    bridge.setOrbit(v);
    safeSet("td-rot-mode", v ? "orbit" : "free");
  };
  list.appendChild(rotSel);

  const spdLabel = document.createElement("span");
  spdLabel.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5)";
  spdLabel.textContent = t("preview.cameraSpeed") + ":";
  list.appendChild(spdLabel);

  const spdSlider = document.createElement("input");
  spdSlider.type = "range";
  spdSlider.min = String(MIN_CAM_SPEED);
  spdSlider.max = String(MAX_CAM_SPEED);
  spdSlider.value = String(bridge.getSpeed());
  spdSlider.style.cssText = "width:80px;margin:0 4px;cursor:pointer;accent-color:var(--accent,#7c83ff)";
  list.appendChild(spdSlider);

  const spdVal = document.createElement("span");
  spdVal.style.cssText = "font-size:11px;color:rgba(255,255,255,0.6);min-width:20px";
  spdVal.textContent = String(bridge.getSpeed());
  list.appendChild(spdVal);

  spdSlider.oninput = (): void => {
    spdVal.textContent = spdSlider.value;
    bridge.setSpeed(Number(spdSlider.value));
    safeSet("td-cam-speed", spdSlider.value);
  };

  const resetBtn = createIconButton({
    icon: "⟲",
    label: t("preview.resetView"),
    title: "重置相机视角到初始位置",
  });
  resetBtn.onclick = (): void => bridge.reset();
  list.appendChild(resetBtn);
}
