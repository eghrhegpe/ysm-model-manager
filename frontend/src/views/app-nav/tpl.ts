// ===== app-nav 样式与模板 =====
import { noAnimationsCSS, wsIconCSS } from "@/utils/dom/css.ts";

export const navCSS: string = `
:host {
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border-right: 1px solid var(--bd);
  width: 160px;
  font-family: var(--font-ui);
  font-size: var(--fs-base);
  transition: width var(--tr-fast);
  overflow: hidden;
}
/* 折叠态：收成常驻窄条，仅保留图标 + 展开按钮 */
:host([data-collapsed]) { width: 48px; }
:host([data-collapsed]) .logo { justify-content: center; padding: 16px 0 12px; }
:host([data-collapsed]) .logo-text,
:host([data-collapsed]) .menu-label,
:host([data-collapsed]) .nav-text,
:host([data-collapsed]) .version { display: none; }
:host([data-collapsed]) .nav-item { justify-content: center; padding: 8px 0; }
:host([data-collapsed]) .nav-item.active { border-left: none; padding-left: 0; }
:host([data-collapsed]) .menu-head { justify-content: center; }
/* 资源切换器（大类+子类型双下拉，ADR-092 派生）：折叠态隐藏 */
.nav-repo-sel {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px 8px;
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
}
.nav-repo-sel select {
  background: var(--surf);
  color: var(--txt);
  border: 1px solid var(--bd);
  border-radius:var(--radius-sm);
  font-size: var(--fs-tab);
  font-family: var(--font-ui);
  padding:var(--btn-padding-xs);
  width: 100%;
}
:host([data-collapsed]) .nav-repo-sel { display: none; }
.logo {
  padding: 16px 14px 12px;
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--txt);
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--bd);
}
.logo-icon { font-size: 20px; }
/* Logo 呼吸光晕 */
@keyframes logoBreathe {
  0%, 100% { text-shadow: 0 0 4px color-mix(in srgb, var(--accent) 0%, transparent); }
  50% { text-shadow: 0 0 12px color-mix(in srgb, var(--accent) 35%, transparent), 0 0 4px color-mix(in srgb, var(--accent) 15%, transparent); }
}
.logo-icon { animation: logoBreathe 3s ease-in-out infinite; }
/* 「🧭 导航栏」行：label 撑满，折叠按钮置于行尾（紧贴导航项上方，直觉位置） */
.menu-head { display: flex; align-items: center; gap: 4px; cursor: pointer; }
/* 折叠/展开按钮：常驻——折叠态窄条上仍可见，防意外找不回导航 */
.nav-toggle {
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size:var(--fs-lg);
  padding: 4px 6px;
  border-radius:var(--radius-sm);
  transition: var(--tr-fast);
  flex-shrink: 0;
}
.nav-toggle:hover { color: var(--accent); background: var(--hover); }
.menu { padding: var(--sp-1) var(--sp-3) 8px; flex: 1; display: flex; flex-direction: column; } /* 审计 P1-9：横向对齐 logo/version（14px→--sp-3 12px 近似），纵向 --sp-1（4px），消除整列错位 */
.menu-label { flex: 1; font-size: var(--fs-xs); color: var(--muted); padding: 8px 10px 4px; text-transform: uppercase; letter-spacing: .5px; }
/* 2026-09 层级扁平治理：导航项文字 = 正文 → 底色 --txt；激活态由 --hover 底 +
   accent 指示条区分,不靠底色深浅（原 base muted 让常驻导航全员次色） */
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding:var(--sp-vh-card);
  border-radius: var(--radius-sm);
  font-size: var(--fs-nav);
  color: var(--txt);
  cursor: pointer;
  transition: var(--tr-fast);
  margin-bottom: 2px;
}
.nav-item:hover { background: var(--hover); }
.nav-item.active {
  background: var(--hover);
  border-left: 3px solid var(--accent);
  padding-left: 7px;
}
.nav-item .icon { font-size: var(--fs-lg); width: 20px; text-align: center; }
/* 左下角 3D 一键跳转（统一为导航项样式，与 nav-item 一致） */
.nav-viewer-fab {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 8px 6px;
  padding:var(--sp-vh-card);
  border-radius: var(--radius-sm);
  font-size: var(--fs-nav);
  color: var(--txt);
  cursor: pointer;
  transition: var(--tr-fast);
}
.nav-viewer-fab:hover { background: var(--hover); }
.nav-viewer-fab .icon { font-size: var(--fs-lg); width: 20px; text-align: center; }
:host([data-collapsed]) .nav-viewer-fab { justify-content: center; padding: 8px 0; margin: 2px 6px 6px; }
:host([data-collapsed]) .nav-viewer-fab .fab-text { display: none; }
.version {
  padding: 10px 14px;
  border-top: 1px solid var(--bd);
  font-size: var(--fs-sm);
  color: var(--muted);
}

/* SVG 图标尺寸/着色（ADR-238 单一出处，跨 shadow 共享） */
${wsIconCSS}

/* .no-animations 通配桥（ADR-015 §2.4 约束 1；规则本体 = @/utils/dom/css.ts） */
${noAnimationsCSS}
`;
