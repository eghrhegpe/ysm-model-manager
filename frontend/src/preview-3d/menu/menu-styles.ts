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
export const MENU_ERROR_NOTE_CSS = `.cm-error-note, .fr-error-note { padding: 8px 10px; color: #ff7b7b; font-size: 12px; }`;

/** 可折叠 section 头（folder / cap 分组共用）：cap-controls 渲染与 render.ts rmAppendFolder 同源 */
export const MENU_SECTION_CSS = `.cap-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  min-height: 32px;
  cursor: pointer;
  user-select: none;
  font-size: 11px;
  color: rgba(255,255,255,0.6);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.cap-section-arrow {
  font-size: 10px;
  display: inline-block;
}`;
