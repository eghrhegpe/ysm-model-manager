// ===== 回收站 / 资源管理器 / 预览拖拽 / 主题选择器 / 响应式 =====
export const contentUtilCSS: string = `
/* ===== 回收站动画 ===== */
.recy-item { animation: fadeSlideUp .2s ease both; transition:opacity var(--tr-normal), transform var(--tr-normal); }
.recy-item.leaving { opacity:0; transform:translateX(20px); pointer-events:none; }
@keyframes recyItemIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }

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
.theme-card { display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 10px;border-radius:var(--radius-md);cursor:pointer;transition:var(--tr-fast);min-width:72px;border:2px solid var(--bd); }
.theme-card:hover { border-color:var(--accent) !important;transform:translateY(-2px);box-shadow:var(--shadow-md); }
.theme-card.active { border-color:var(--accent) !important;box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 30%,transparent); }
.theme-mode-btn.active { background:var(--accent);color:var(--bg);border-color:var(--accent); }

/* ===== 响应式 ===== */
@media (max-width:768px) {
  .cr-left,.gh-left,.ins-sidebar { width:100%; height:auto; border-right:none; flex-direction:row; flex-wrap:wrap; }
  .cr-scroll,.gh-grid,.diag-right { padding:4px 6px; }
  .diag-left { width:100%; border-right:none; flex-direction:row; flex-wrap:wrap; }
}
`;
