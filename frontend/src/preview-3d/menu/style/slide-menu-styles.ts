// 🥉 slide-menu 外壳样式（MikuMikuAR app.css 迁移，仅外壳层，不含菜单导航引擎；
// 本仓手工维护——.menu-wrapper.slide-menu 背景已有意改为玻璃质感，对齐 ysm 3D HUD 的 .ysm-3d-popup，
// 故允许针对 3D 浮层手工微调；类名契约由 ui-slide-menu-styles.test.ts 兜底）。
// 消费方式：
//  - Shadow DOM 组件：root.adoptedStyleSheets = [slideMenuStyleSheet, ...others];
//  - 全局/light-DOM：installSlideMenuStyles() 会把样式注入 document.head 一次。
// 外壳始终承载 🥉 行组件，故 createSlideMenu 会同时安装 ui-components 样式。

export const slideMenuCss = `/* ===== 🥉 slide-menu 外壳样式（自 MikuMikuAR app.css 迁移） ===== */
/* 外壳专属 token 加 --uih- 命名空间以防与 ysm 全局主题冲突；颜色 token 已映射为 ysm 等价变量。
   2026-09 收敛：原 8 个 token 中 7 个仅单次消费（纯间接层），已内联回消费点；
   余下 --uih-slide-card-bg 保持 token 形态——卡片背景独立于 ysm 主题，属真语义 token。 */
:root {
  /* 内容卡背景：色值统一自外壳 rgba(20,20,30) 系（原 15,15,22 双源漂移），
     透明度 0.92 → 0.55 让外壳 blur(16px) 的场景透出——透景口径与 34 行注释一致；
     可读性由 blur 深底 + 白色文字保证。 */
  --uih-slide-card-bg: rgba(20, 20, 30, 0.55);
  /* 分隔线（标题栏下沿 / 折叠头边框）：--uih-slide-divider 曾被引用但从未定义
     （2026-09 收敛时发现的历史悬空引用），致两条 border 声明整条失效、分隔线长期不可见。
     此处补上定义，取玻璃卡内白色弱分隔调，与 --uih-white-weak 同视觉重量。 */
  --uih-slide-divider: rgba(255, 255, 255, 0.08);
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
  background: rgba(20, 20, 30, 0.1);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--radius-xl);
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
  padding: 6px 8px;
  background: var(--uih-slide-card-bg);
  border-radius:var(--radius-xl);
}

.slide-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--uih-slide-divider);
  flex-shrink: 0;
}

.slide-back {
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  padding: 4px 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  min-width: 28px;
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

// 顶层初始化包：happy-dom/vitest 等无 CSSStyleSheet 的环境 import 即崩，会连带所有 import 本库的模块测试失败。
// 样式注入（installSlideMenuStyles）走 style 标签，不依赖 _sheet，失败仅影响 shadow 组件。
// 脚手架由 style-install.ts 统一提供，勿在此手写 try/catch + _sheet + _installed 三件套。
import { createInstallableStyles } from "./style-install.ts";

const { sheet: slideMenuStyleSheet, install: installSlideMenuStyles } = createInstallableStyles(
  slideMenuCss,
  "data-ui-slide-menu",
  "ui-slide-menu",
);

export { installSlideMenuStyles, slideMenuStyleSheet };
