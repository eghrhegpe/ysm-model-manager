// 自动生成：🥉 slide-menu 外壳样式（MikuMikuAR app.css 迁移，仅外壳层，不含菜单导航引擎）。
// 消费方式：
//  - Shadow DOM 组件：root.adoptedStyleSheets = [slideMenuStyleSheet, ...others];
//  - 全局/light-DOM：installSlideMenuStyles() 会把样式注入 document.head 一次。
// 注意：本文件由 MikuMikuAR 外壳迁移而来，但 .menu-wrapper.slide-menu 的背景已
// 有意改为玻璃质感（对齐 ysm 3D HUD 的 .ysm-3d-popup），故此处允许针对 3D 浮层手工微调。
// 外壳始终承载 🥉 行组件，故 createSlideMenu 会同时安装 ui-components 样式。

export const slideMenuCss = `/* ===== 🥉 slide-menu 外壳样式（自 MikuMikuAR app.css 迁移） ===== */
/* 外壳专属尺寸 token 加 --uih- 命名空间以防与 ysm 全局主题冲突；颜色 token 已映射为 ysm 等价变量。 */
:root {
  --uih-slide-back-pad-y: 4px;
  --uih-slide-back-pad-x: 8px;
  --uih-slide-back-min-width: 28px;
  --uih-slide-back-radius: var(--radius-sm);
  --uih-slide-header-pad-y: 6px;
  --uih-slide-header-pad-x: 8px;
  --uih-slide-list-pad: 6px 8px;
}

/* 定位容器：底部居中（替代原 .ysm-3d-popup 的定位职责；卡片视觉交给 .menu-wrapper） */
.ysm-slide-popup {
  position: absolute;
  left: 50%;
  bottom: 84px;
  transform: translateX(-50%);
  width: 280px;
  max-height: min(60vh, 420px);
  z-index: 25;
  display: flex;
  flex-direction: column;
}

/* 卡片本体：玻璃质感对齐 ysm 3D HUD（fab.ts .ysm-3d-popup），与 MikuMikuAR 实心卡不同——
   3D 浮层需透出场景，且不受 app 主题影响（主题无关，统一深色玻璃）。 */
.menu-wrapper.slide-menu {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: rgba(20, 20, 30, 0.7);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  touch-action: pan-y;
  color: rgba(255, 255, 255, 0.85);
}

.slide-viewport {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  position: relative;
}

.slide-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.slide-list.render-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--uih-slide-list-pad);
}

.slide-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--uih-slide-header-pad-y) var(--uih-slide-header-pad-x);
  border-bottom: 1px solid var(--uih-slide-divider);
  flex-shrink: 0;
}

.slide-back {
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  padding: var(--uih-slide-back-pad-y) var(--uih-slide-back-pad-x);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--uih-slide-back-radius);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  min-width: var(--uih-slide-back-min-width);
  transition: background var(--tr-fast);
}

.slide-back:hover {
  background: rgba(255, 255, 255, 0.12);
}

.slide-back:active {
  background: color-mix(in srgb, var(--accent) 30%, transparent);
}

.slide-title {
  color: rgba(255, 255, 255, 0.9);
  cursor: default;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--fw-semibold);
  font-size: var(--fs-md);
}

/* .lcard 内首项/末项圆角（与卡片视觉衔接，对齐 MikuMikuAR .lcard > .slide-item:first-child） */
.lcard > .slide-item:first-child {
  border-radius: var(--uih-lcard-radius) var(--uih-lcard-radius) 0 0;
}

.lcard > .slide-item:last-child {
  border-radius: 0 0 var(--uih-lcard-radius) var(--uih-lcard-radius);
}

.lcard > .slide-item:only-child {
  border-radius: var(--uih-lcard-radius);
}

/* 内部 🥉 行组件在玻璃卡内的文字/交互色：强制白底调，使 3D 浮层与 ysm HUD 一致、不受 app 主题影响 */
.menu-wrapper.slide-menu .slide-item,
.menu-wrapper.slide-menu .slide-label,
.menu-wrapper.slide-menu .field-label,
.menu-wrapper.slide-menu .field-value,
.menu-wrapper.slide-menu .collapsible-label,
.menu-wrapper.slide-menu .section-title,
.menu-wrapper.slide-menu .slide-icon,
.menu-wrapper.slide-menu .cs-icon {
  color: rgba(255, 255, 255, 0.85);
}
.menu-wrapper.slide-menu .slide-item:hover {
  background: rgba(255, 255, 255, 0.08);
}
.menu-wrapper.slide-menu .slide-item:active {
  background: color-mix(in srgb, var(--accent) 28%, transparent);
}
.menu-wrapper.slide-menu .collapsible-header {
  border-color: var(--uih-slide-divider);
}
`;

// 顶层初始化包 try/catch + 环境守卫：happy-dom/vitest 等无 CSSStyleSheet 的环境
// import 即崩，会连带所有 import 本库的模块测试失败。
// 样式注入（installSlideMenuStyles）走 style 标签，不依赖 _sheet，失败仅影响 shadow 组件。
let _sheet: CSSStyleSheet | null = null;
try {
  if (typeof CSSStyleSheet !== "undefined") {
    _sheet = new CSSStyleSheet();
    _sheet.replaceSync(slideMenuCss);
  }
} catch (e) {
  console.error("[ui-slide-menu] CSS 解析失败", e);
}
export const slideMenuStyleSheet = _sheet;

let _installed = false;
/** 将外壳样式注入 document.head（全局/light-DOM 场景）。幂等，仅注入一次。 */
export function installSlideMenuStyles(doc: Document = document): void {
  if (_installed) return;
  const st = doc.createElement("style");
  st.setAttribute("data-ui-slide-menu", "");
  st.textContent = slideMenuCss;
  doc.head.appendChild(st);
  _installed = true;
}
