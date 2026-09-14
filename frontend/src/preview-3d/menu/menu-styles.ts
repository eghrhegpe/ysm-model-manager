// ===== menu-styles.ts — 菜单跨文件共享样式常量（同值多源收敛，2026-09）=====
// P1 批次 cssText→类迁移后，多个菜单文件各自注入同值类（cm-* / fr-* 前缀私有类
// 保留原位；本模块只收「跨文件同值」的类），此前双源漂移风险由注释口头承诺
// 「待合并」——现以常量单一事实源落地：
//   - MENU_ERROR_NOTE_CSS：core.ts `.cm-error-note` == roles.ts `.fr-error-note`（同值）
//   - MENU_SECTION_CSS：cap-controls.ts 定义、render.ts rmAppendFolder 消费的
//     `.cap-section-header` / `.cap-section-arrow`（render.ts 原无定义、搭便车注入，
//     现在消费方自足）
// 各 ensure*Styles 幂等注入各自拼接本常量——同值规则在多个 <style> 中重复无害
// （后定义覆盖先定义，值相同），单一事实源在常量本身。

/** 错误提示行（红色文案）：core.ts 装配层与 roles.ts 角色面板同值 */
export const MENU_ERROR_NOTE_CSS = `.cm-error-note, .fr-error-note { padding: 8px 10px; color: #ff7b7b; font-size:var(--fs-base); }`;

/** 可折叠 section 头（folder / cap 分组共用）：cap-controls 渲染与 render.ts rmAppendFolder 同源 */
export const MENU_SECTION_CSS = `.cap-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  min-height: 32px;
  cursor: pointer;
  user-select: none;
  font-size:var(--fs-sm);
  color: rgba(255,255,255,0.6);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.cap-section-arrow {
  font-size:var(--fs-xs);
  display: inline-block;
}`;

/**
 * 行密度 token + 紧凑导航行规则（3d 菜单单一样式源）。
 *
 * 背景：3d 菜单行分两类——「导航行」（icon+label+箭头，稀疏内容，如 env 一级 cap 行 /
 * scene 组根视图行）与「内容行」（radio/badge/参数控件填充，如 roles 行 / cap 参数行）。
 * 二者共享底层变量（--3d-row-*，字号/基准可随主题同步缩放），仅密度不同。
 * 紧凑行 = 内容自然高（无 min-height 硬撑），标准行 = 38px 触控基座。
 *
 * [行高治理] 原 .slide-item 基座（ui-components --uih-slide-item-min-height:38px）对所有行
 * 统一撑高，稀疏导航行显得空旷（env 行 6+38+6 ≈ 50px vs .cm-row 8+13+8 ≈ 34px）。
 * 本规则让声明 rowDensity:"compact" 的行走紧凑密度，两类行各自 token 化。
 */
export const MENU_ROW_DENSITY_CSS = `
.menu-wrapper.slide-menu {
  --3d-row-nav-pad-y: 4px;
  --3d-row-nav-min-h: 30px;
}
.menu-wrapper.slide-menu .slide-item.rm-row-compact {
  min-height: var(--3d-row-nav-min-h);
  padding-top: var(--3d-row-nav-pad-y);
  padding-bottom: var(--3d-row-nav-pad-y);
  margin-bottom: 1px;
}
.menu-wrapper.slide-menu .slide-item.rm-row-compact .slide-label {
  font-size:var(--fs-md);
}
.menu-wrapper.slide-menu .slide-item.rm-row-compact .slide-icon {
  width: 18px;
  height: 18px;
  font-size:var(--fs-lg);
}`;

/**
 * 节点 divider 分隔线样式（[ADR-195] 补：原 .menu-divider 无任何样式规则——cap divider
 * 经 cc-divider 有完整视觉，节点体系收编 divider 后补同款分隔线；视觉对齐 .cc-divider）。
 * rmAppendDecor（render.ts）消费；与 cap-controls 的 .cc-divider 同值避免双源。
 */
export const MENU_DIVIDER_CSS = `.menu-divider {
  height: 1px;
  background: rgba(255,255,255,0.12);
  margin: 4px 10px;
}`;

/**
 * 卡牌分组容器（[ADR-195] 终态：`lcard`/卡片分组能力进入菜单）。
 *
 * 形态 = 顶行标题 + 分隔线 + 内容区，由 rmAppendCard 装配（kind:"card" 节点消费）。
 * 与 folder 的分工：folder 是**可折叠**参数组（参数页内部，点击收放）；
 * card 是**不可折叠**的语义卡壳，用于把一批同级导航行按语义聚拢
 * （如环境面板「基础：天空/地面/水面」「氛围：环境/雾/反射」）。
 *
 * 为何不复用 `.lcard`（原 ui/ui-card.ts，2026-09-10 因零生产消费者连 orphan 样式一并删除）：
 * 一、`.lcard` 只有组件库字符串里有定义，全仓无任何代码产出该 class 的 DOM；
 * 二、菜单样式经 overlay 样式桥注入 ShadowRoot，组件库/全局 CSS 不穿透——卡壳样式必须落在本地。
 */
export const MENU_CARD_CSS = `.cap-card {
  margin: 6px 8px;
  border: 1px solid rgba(255,255,255,0.10);
  border-radius:var(--radius-lg);
  background: rgba(255,255,255,0.035);
  overflow: hidden;
}
.cap-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  font-size:var(--fs-sm);
  color: rgba(255,255,255,0.6);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: none;
}
.cap-card-divider {
  height: 1px;
  background: rgba(255,255,255,0.12);
  margin: 0 10px;
}
.cap-card-body {
  padding: 2px 0 4px;
}`;
