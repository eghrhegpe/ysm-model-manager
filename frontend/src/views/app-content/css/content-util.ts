// ===== 回收站 / 资源管理器 / 预览拖拽 / 主题选择器 / 响应式 =====
export const contentUtilCSS: string = `
/* ===== 回收站动画 ===== */
.recy-page { flex:1;display:flex;flex-direction:column;overflow:hidden;padding:var(--sp-3); }
.recy-item { animation: fadeSlideUp .2s ease both; transition:opacity var(--tr-normal), transform var(--tr-normal); }
.recy-item.leaving { opacity:0; transform:translateX(20px); pointer-events:none; }
/* 注：@keyframes recyItemIn 已删（2026-10，ADR-312 收尾）——v1.7.6「keyframe 合并 13→3」把它
   并入 fadeSlideUp 后本体遗漏在仓内，全仓零 animation 引用；保留它只会让「哪些 keyframe 还活着」失真。 */
/* 恢复/删除按钮：继承 .btn-base sm 基础样式，recy-del 覆盖为危险色 */
.recy-restore { cursor:pointer; }
.recy-restore:hover { background:var(--hover); }
.recy-del { cursor:pointer; }
.recy-del:hover { background:color-mix(in srgb, var(--status-error) 12%, transparent); }

/* ===== 预览面板拖拽调整宽度 ===== */
.preview-resize-handle { touch-action:none; }
.preview-resize-handle:hover { background:var(--accent) !important; }

/* ===== 主题选择器 ===== */
.theme-picker { display:flex;gap:6px;flex-wrap:wrap; }
.theme-card { appearance:none; display:flex;flex-direction:column;align-items:center;gap:4px;padding:var(--sp-vh-btn);border-radius:var(--radius-md);cursor:pointer;font-family:inherit;font-size:inherit;color:var(--txt);background:transparent;text-align:center;transition:var(--tr-fast);min-width:72px;border:2px solid var(--bd); }
.theme-card:hover { border-color:var(--accent) !important;transform:translateY(-2px);box-shadow:var(--shadow-md); }
.theme-card:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.theme-card.active { border-color:var(--accent) !important;box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 30%,transparent); }

/* ===== 响应式 ===== */
@media (max-width:768px) {
  .gh-left,.ins-sidebar { width:100%; height:auto; border-right:none; flex-direction:row; flex-wrap:wrap; }
  .cr-scroll,.gh-grid { padding:4px 6px; }
}
`;
