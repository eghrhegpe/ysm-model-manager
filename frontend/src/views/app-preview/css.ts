// ===== preview Shadow CSS =====
// ADR-238：本串被 app-preview 的 shadow 根 adopt。UI_ICONS 的 SVG 依赖 .ws-icon
// 尺寸/着色规则，而 CSS 不穿透 shadow 边界 ⇒ 必须就地带上 wsIconCSS；
// 缺它时图标退回 viewBox 默认 24×24，在 12px 按钮里显巨块（.pv-tab 一族即此症状）。
import { metaTagCSS, noAnimationsCSS, wsIconCSS } from "@/utils/dom/css.ts";

export const previewCSS: string = `
:host {
  display: flex; flex-direction: column;
  position: relative;
  background: var(--bg);
  border-left: 1px solid var(--bd);
  width: 200px;
  flex-shrink: 0;
  font-family: var(--font-ui);
  font-size: var(--fs-base);
}
.content { padding: 10px; overflow-y: auto; flex: 1; }
@keyframes previewIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:translateY(0) } }
.content > * { animation: previewIn .2s ease; }
h3 { font-size: var(--fs-base); font-weight: 600; color: var(--txt); text-transform: uppercase; letter-spacing: .5px; margin: 0 0 8px; }
.dp-placeholder { text-align: center; padding: 24px 0; color: var(--muted); }
/* 紧凑头部态（maid 封面/文件名区）：压缩 24px 空态留白，贴近下方详情卡 */
.dp-placeholder--head { padding: 4px 0 8px; }
.dp-placeholder--head .dp-hint { margin-bottom: 6px; }
.dp-placeholder .dp-hint:last-child { margin-bottom: 0; }
.dp-placeholder .big-icon { font-size: var(--fs-xl); margin-bottom: 8px; }
.dp-placeholder .dp-hint { font-size: var(--fs-base); margin-bottom: 12px; }
.dp-placeholder .dp-hints { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.dp-placeholder .dp-hints span { font-size: var(--fs-xs); padding: 2px 8px; border-radius: var(--radius-sm); background: var(--surf); border: 1px solid var(--bd); color: var(--muted); }
.md-row { font-size:var(--fs-base); color: var(--txt); padding: 3px 0; display: flex; justify-content: space-between; }
.md-label { color: var(--muted); }
.md-value { color: var(--txt); font-weight: 500; font-family:var(--font-mono); }
.md-divider { border: none; border-top: 1px solid var(--bd); margin: 8px 0; }
.err { font-size: var(--fs-sm); color: var(--status-error); padding: 4px 0; }
.preview-thumb { margin-bottom: 10px; border-radius:var(--radius-lg); overflow: hidden; background: var(--surf); border: 1px solid var(--bd); }
.preview-thumb img { display: block; width: 100%; height: auto; object-fit: cover; }
.pv-stat-label { display:inline-block;min-width:80px; }

/* === 骨骼预览区 === */
.pv-btn { font-size:var(--fs-xs);padding:1px 6px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;display:flex;align-items:center;gap:3px; }
.pv-btn:hover { background:var(--hover); }
.pv-hint { font-size:var(--fs-xs);color:var(--muted); }
.pv-canvas { width:100%;height:auto;border-radius:var(--radius-lg);background:rgba(0,0,0,.12);margin-bottom:6px;touch-action:none; }
.pv-grab { cursor:grab;touch-action:none; }
.pv-card { background:var(--surf);border:1px solid var(--bd);border-radius:var(--radius-lg);padding:8px 10px;margin-bottom:8px; }
.pv-card-section { padding-left:8px;margin-bottom:5px; }
.pv-card-section-label { font-size:var(--fs-sm);color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px; }
.pv-card-row { font-size:var(--fs-sm);color:var(--txt);line-height:1.6; }
.pv-card-val { color:var(--accent);font-weight:600; }
.ysm-badge { display:inline-block;font-size:var(--fs-xs);padding:2px 8px;border-radius:var(--radius-xl);background:color-mix(in srgb,var(--status-success,#1971C2) 18%,transparent);color:var(--status-success,#1971C2);margin-left:6px;font-weight:600;vertical-align:middle; }
.pv-section-blue { border-left:2px solid var(--accent); }
.pv-section-green { border-left:2px solid var(--status-success); }
.pv-section-orange { border-left:2px solid var(--sm-optional); }
.pv-tab-row { display:flex;gap:2px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid var(--bd); }
.pv-tab { flex:1;font-size:var(--fs-sm);padding:3px 6px;border-radius:var(--radius-sm);border:1px solid var(--bd);cursor:pointer;text-align:center;transition:var(--tr-fast); }
.pv-tab:hover { border-color:var(--accent); }
.pv-tab-active { background:var(--accent);color:var(--bg); }
.pv-tab-inactive { background:var(--surf);color:var(--txt); }
.pv-toggle-row { display:flex;align-items:center;gap:4px;margin-bottom:6px;margin-top:4px;padding:4px 6px;background:var(--surf);border-radius:var(--radius-sm);justify-content:flex-end; }
.pv-debug { font-size:var(--fs-xs);color:var(--status-error);margin-top:2px;opacity:0.8; }
.pv-loading-title { font-size:var(--fs-sm);font-weight:600;color:var(--muted);margin-bottom:4px; }
.pv-loading-bar { height:60px;border-radius:var(--radius-md);background:rgba(0,0,0,.08); }
.pv-error-title { font-size:var(--fs-sm);font-weight:600;margin-bottom:4px; }
.pv-error-body { font-size:var(--fs-xs);color:var(--muted);padding:8px 0; }

/* === 3D 悬浮触发 FAB（ADR-057 §2.3，Shadow DOM 内面板右下角） === */
.preview-fab{position:absolute;right:12px;bottom:12px;width:44px;height:44px;border-radius:50%;border:1px solid var(--bd);background:var(--accent);color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.4);z-index:20;transition:var(--tr-fast)}
.preview-fab:hover{filter:brightness(1.1)}
.preview-fab:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 45%,transparent)}
.preview-fab .preview-ic{line-height:1}
@media (max-width:480px){ .preview-fab{width:52px;height:52px;right:10px;bottom:10px;font-size:var(--fs-xl)} }
/* 触控热区 44px（Apple HIG） */
@media (pointer:coarse){ .preview-fab{min-width:44px;min-height:44px} }

/* === P1 批次10:loadModel2D 加载占位盒 / detail 统计容器(shadow 内元素,规则须在 adopted 样式表) === */
.sk-loading-box { margin-bottom:8px; opacity:0.6; }
.dp-stats { margin-top:10px; }

/* === 兄弟列表 hover 规则（detail-3d.ts morph-item / detail.ts pack-model-item）=== */
.morph-item{padding:4px 6px;cursor:pointer;border-radius:var(--radius-sm);font-size:var(--fs-base);display:flex;align-items:center;gap:6px}
.morph-item:hover{background:rgba(255,255,255,0.05)}
.morph-item.active{background:color-mix(in srgb,var(--status-success) 15%,transparent);color:var(--status-success);font-weight:600}
.pack-model-item:hover{background:rgba(255,255,255,0.05)}

/* SVG 图标尺寸/着色（ADR-238 单一出处，跨 shadow 共享） */
${wsIconCSS}

/* 元数据标签（.tag-author/.tag-work/.tag-date）——tpl-summary.ts 渲染作者段用，
   原缺本串导致摘要页作者标签无样式（2026-09 补；与 app-tree/content-repo 同源） */
${metaTagCSS}

/* .no-animations 通配桥（ADR-015 §2.4 约束 1；规则本体 = @/utils/dom/css.ts） */
${noAnimationsCSS}

/* ===== litematic 元数据面板（litematic-meta.ts）2026-09 补 =====
   此前 .lt-* 全族**全仓零规则**（不是漏扫，是从来没有）：.lt-color-swatch 只有内联 background
   没有尺寸 → 空 inline span **恒不可见**，方块颜色色块根本没渲染；.lt-meta-row 无 flex →
   label/value 挤成一行；.lt-meta-label 不弱化。同文件 121 行那行是全内联
   （display:flex;justify-content:space-between;padding:4px 0;…）＝作者本意，此处收口为类。
   闸为何曾看不见：这些类所在的命名空间 lt- 在本域从未被定义过，检查 3 自推导域结构上不覆盖
   （2026-09 补检查 6「跨层存在性」才现形）。 */
.lt-material-list { display:flex; flex-direction:column; gap:1px; }
.lt-block-row { display:flex; align-items:center; gap:6px; padding:2px 0; font-size:var(--fs-xs); color:var(--txt); }
.lt-color-swatch { width:10px; height:10px; border-radius:var(--radius-xs); flex-shrink:0; border:1px solid var(--bd); }
.lt-block-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lt-block-count { color:var(--muted); font-size:var(--fs-tiny); flex-shrink:0; }
.lt-meta-row { display:flex; justify-content:space-between; gap:8px; padding:2px 0; font-size:var(--fs-xs); color:var(--txt); }
.lt-meta-row > span:last-child { font-family:var(--font-mono); }
.lt-meta-label { color:var(--muted); }
`;
