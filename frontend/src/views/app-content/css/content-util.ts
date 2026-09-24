// ===== 回收站 / 资源管理器 / 预览拖拽 / 主题选择器 / 响应式 =====
export const contentUtilCSS: string = `
/* ===== 回收站动画 ===== */
.recy-page { flex:1;display:flex;flex-direction:column;overflow:hidden;padding:var(--sp-3); }
.recy-item { animation: fadeSlideUp .2s ease both; transition:opacity var(--tr-normal), transform var(--tr-normal); }
.recy-item.leaving { opacity:0; transform:translateX(20px); pointer-events:none; }
@keyframes recyItemIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
/* 恢复/删除按钮：继承 .btn-base sm 基础样式，recy-del 覆盖为危险色 */
.recy-restore { cursor:pointer; }
.recy-restore:hover { background:var(--hover); }
.recy-del { cursor:pointer; }
.recy-del:hover { background:color-mix(in srgb, var(--status-error) 12%, transparent); }

/* ===== 资源管理器动画 ===== */
.rm-item { animation: fadeSlideUp .2s ease both; }
@keyframes rmItemIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:translateY(0) } }
.rm-content { animation: fadeSlideUp .2s ease; }
@keyframes rmContentIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:translateY(0) } }

/* ===== 预览面板拖拽调整宽度 ===== */
.preview-resize-handle { touch-action:none; }
.preview-resize-handle:hover { background:var(--accent) !important; }

/* ===== 主题选择器 ===== */
.theme-picker { display:flex;gap:6px;flex-wrap:wrap; }
.theme-card { display:flex;flex-direction:column;align-items:center;gap:4px;padding:var(--sp-vh-btn);border-radius:var(--radius-md);cursor:pointer;transition:var(--tr-fast);min-width:72px;border:2px solid var(--bd); }
.theme-card:hover { border-color:var(--accent) !important;transform:translateY(-2px);box-shadow:var(--shadow-md); }
.theme-card.active { border-color:var(--accent) !important;box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 30%,transparent); }
.theme-mode-btn.active { background:var(--accent);color:var(--bg);border-color:var(--accent); }

/* ===== 响应式 ===== */
@media (max-width:768px) {
  .gh-left,.ins-sidebar { width:100%; height:auto; border-right:none; flex-direction:row; flex-wrap:wrap; }
  .cr-scroll,.gh-grid { padding:4px 6px; }
}
`;
