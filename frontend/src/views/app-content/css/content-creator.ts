// ===== 创作者域：标签/频道/卡片/详情浮层/编辑（.cr-* 全族；.ws-* 工坊类已归位 content-layout.ts） =====
export const contentCreatorCSS: string = `
/* ===== 创作者标签 (cr-tag) ===== */
.cr-tag { display:inline-flex;align-items:center;gap:2px;font-size:var(--fs-micro);padding:0 var(--sp-1);border-radius:var(--radius-xs);line-height:16px;font-weight:500;flex-shrink:0; }
/* class 名由 render.ts 拼成 cr-tag- + getTagFromRole(role)，role 枚举仅 creator/official/vup/oc/repo
   五值（权威源：site/render.ts 编辑下拉 roleOption 五项 + workshop-data.ts getCreatorIdentity switch）——
   故此族恰好五条，缺一条即该身份渲染成裸文字。原 .cr-tag-game 是给不存在的 game 身份准备的
   死类（其 --tag-game/--tag-game-bg 变量在 content-layout :host 定义且被他域复用，变量保留）。 */
.cr-tag-official { background:var(--tag-official-bg);color:var(--tag-official); }
.cr-tag-creator { background:var(--tag-creator-bg);color:var(--tag-creator); }
.cr-tag-vup { background:var(--tag-vup-bg);color:var(--tag-vup); }
.cr-tag-oc { background:var(--tag-oc-bg);color:var(--tag-oc); }
.cr-tag-repo { background:var(--tag-repo-bg);color:var(--tag-repo); }
/* .cr-tag-filter-row 的容器度量定义在后段单处（2026-09 锐评 P1-7：原此处与后段各一份、
   属性互补，易误判为覆盖关系；已单点化——合并前后逐值等同，间距未改）。 */
/* 多按钮筛选组统一范式（同 shadow 根共享：content-creator + content-diag）。
   .diag-log-fbtn 复用本组规则、仅覆盖字号（见 content-diag.ts）；
   app-sync-manager 的 .sm-status-tab 因跨 shadow 根，样式逐值同款但需各自持有。
   本组度量 = 原 .diag-log-fbtn 的 2px 8px / radius-sm / hover 色 var(--txt)：
   .cr-tag-filter-btn 由 2px 10px / radius-xl / hover 色 var(--accent) 收敛至此（2026-09
   有意统一，三组筛选按钮逐值同款，见 app-sync-manager tpl.ts 统一范式注释）。 */
.cr-tag-filter-btn, .diag-log-fbtn { font-size:var(--fs-xs);padding:var(--btn-padding-tool-lg);border-radius:var(--radius-sm);border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-family:inherit;transition:var(--tr-fast);animation:fadeSlideUp var(--tr-enter) both; }
.cr-tag-filter-btn:hover, .diag-log-fbtn:hover { border-color:var(--accent);color:var(--txt);background:var(--hover); }
.cr-tag-filter-btn.active, .diag-log-fbtn.active { border-color:var(--accent);color:var(--accent);background:color-mix(in srgb, var(--accent) 18%, transparent); }

/* ===== 创作者频道 (cr-) ===== */
.cr-page { flex:1; display:flex; overflow:hidden; position:relative; }
.cr-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.cr-right-inner { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.cr-scroll { flex:1; overflow-y:auto; padding:var(--sp-vh-pane); }

/* 2026-09 锐评 P1 收口：.cr-action-btn-muted 无消费者已删；
   .cr-section / .cr-section-title-lg / .cr-section-sub / .cr-action-btn-accent 的同选择器
   两处定义合并为本文件后段单处（间距按合并前实际计算值保留）。 */

.cr-mode-switch { display:inline-flex;border:1px solid var(--bd);border-radius:var(--radius-md) 6px 0 0;border-bottom:none;overflow:hidden;cursor:pointer;margin-right:2px;flex-shrink:0;align-self:stretch;background:transparent;padding:0;appearance:none;-webkit-appearance:none;font:inherit;color:inherit; }
.cr-mode-opt { padding:var(--btn-padding-sm);font-size:var(--fs-xs);font-family:inherit;transition:var(--tr-fast);color:var(--muted);background:var(--bg);cursor:pointer;display:flex;align-items:center; }
.cr-mode-opt:hover { color:var(--txt);background:var(--hover); }
.cr-mode-opt.active { color:var(--accent);background:var(--surf);margin-bottom:-1px; }
.cr-mode-opt:first-child { border-right:1px solid var(--bd); }

/* 创作者卡片：.cr-creator-card 基础 + .cr-creator-card--grid 网格变体（BEM 修饰符，替代后置 cascade 覆盖） */
.cr-creator-card { display:flex;align-items:center;gap:8px;padding:var(--sp-vh-card);border-radius:var(--radius-card);border:1px solid var(--bd);background:var(--bg);cursor:pointer;transition:var(--tr-fast); } /* 审计 P1-2：卡片圆角收口 --radius-card */
.cr-creator-card:hover { border-color:var(--accent);background:var(--hover); }

.cr-creator-grid {
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  width:100%;
  padding:4px 0 8px;
}
/* 网格卡片变体：.cr-creator-card--grid —— 显式 BEM 修饰符，替代后置 cascade 覆盖 */
.cr-creator-card--grid {
  min-width:200px;max-width:280px;
  flex:1 1 200px;
  cursor:pointer;
  animation: fadeSlideUp var(--tr-enter) both;
  padding:12px 14px;
  border-radius:var(--radius-xl);
  border:1px solid var(--bd);
  background:var(--card);
  transition:var(--tr-normal);
  flex-direction:column;
  align-items:stretch;
  gap:6px;
  position:relative;
  overflow:hidden;
}
.cr-creator-card--grid:hover {
  border-color:var(--accent);
  background:var(--hover);
  box-shadow:0 2px 12px rgba(0,0,0,.1);
  transform:translateY(-1px);
}
.cr-creator-card--grid:focus-visible {
  box-shadow:0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
  outline:none;
}
/* P2-2 锐评：hover 只保留「选中信号」三件套（border/bg/shadow/位移），
   砍掉头像 rotate(-8deg) 装饰噪音——浏览列表是理性操作，旋转不是反馈是彩蛋 */
/* 筛选隐藏态：淡出 + 折叠 */
.cr-creator-card--grid.cr-card-hidden {
  opacity:0;
  transform:scale(.95);
  max-height:0;
  min-height:0;
  padding:0 14px;
  margin:0;
  border-width:0;
  overflow:hidden;
  pointer-events:none;
  transition:opacity var(--tr-normal), transform var(--tr-normal), max-height var(--tr-normal), min-height var(--tr-normal), padding var(--tr-normal), margin var(--tr-normal), border-width var(--tr-normal);
}
/* 位置色带条（2026-10-15 语义重做：原「荣誉分档条」→「位置地标条」）：
   3px 常驻，颜色由 data-band（gold/silver 按展示序每 9 张交替）决定。
   视觉与改造前**逐值相同**（3px / opacity:1 / 同一对色变量），变的只是语义与选择器名。
   P2-1 锐评留痕：原 2px/opacity:.6 承载「顶级创作者」强断言几乎不可见，且 hover 才显形=需要猜。 */
.cr-card-band-bar {
  position:absolute;top:0;left:0;right:0;height:3px;opacity:1;transition:opacity var(--tr-normal);
}
.cr-creator-card--grid[data-band="gold"] .cr-card-band-bar { background:var(--band-gold); }
.cr-creator-card--grid[data-band="silver"] .cr-card-band-bar { background:var(--band-silver); }
/* 光环基类 = accent 默认。原来是 :not([data-tier]) 写法——色带改由构造保证必在
   （CrCardCtx.band 是必填字段、creatorBandOf 恒返回两值之一），:not() 会留下一条
   永不匹配的死规则（同 .cr-tag-game 的教训），故改写成基类默认 + 两条带色覆盖。 */
.cr-creator-card--grid .cr-avatar-ring {
  background:conic-gradient(from 0deg,var(--accent),transparent 60%,var(--accent));
  box-shadow:none;
}
.cr-creator-card--grid[data-band="gold"] .cr-avatar-ring {
  background:conic-gradient(from 0deg,var(--band-gold),transparent 60%,var(--band-gold));
  box-shadow:0 0 6px color-mix(in srgb,var(--band-gold) 40%,transparent);
}
.cr-creator-card--grid[data-band="silver"] .cr-avatar-ring {
  background:conic-gradient(from 0deg,var(--band-silver),transparent 60%,var(--band-silver));
  box-shadow:0 0 6px color-mix(in srgb,var(--band-silver) 25%,transparent);
}

/* 头像（跨域复用：.cr-avatar 亦在 gh-card 中用到） */
.cr-avatar { width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:var(--fs-base);font-weight:700;color:var(--muted);background:var(--surf);z-index:1;transition:all var(--tr-normal); }
.cr-avatar-container { position:relative;display:inline-flex;flex-shrink:0;align-self:flex-start;width:28px;height:28px;margin:6px; }
.cr-avatar-ring { position:absolute;inset:-2px;border-radius:50%;pointer-events:none;transition:transform var(--tr-normal); }

/* 卡片头部：头像 + 名称行 */
.cr-card-header {
  display:flex;
  align-items:center;
  gap:8px;
}
/* 变体：卡头头像放大到 32px 并去掉基类的 6px 外边距。
   position/flex-shrink 与基类 .cr-avatar-container 同值，故不在此重复声明。 */
.cr-card-header .cr-avatar-container {
  width:32px;height:32px;
  margin:0;
}

/* 名称行 */
.cr-card-name-row {
  flex:1;min-width:0;
  display:flex;align-items:center;
  gap:4px;
}
.cr-card-name {
  font-size:var(--fs-md);
  font-weight:700;
  color:var(--txt);
  font-family:var(--font-display);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  flex:1;
}
/* P0 a11y（2026-10-15）：星标 / 联网搜索 / 本地徽章由 <span> 升格为 <button>——
   先在此抹掉 UA 按钮默认面（背景/边框/内边距/字体/前景色），再接各自语义类。
   line-height:inherit 不可省：UA 对 input/textarea/select/button 强置 line-height:normal，
   不重置则三个按钮行盒从宿主 :host 的 1.4 缩到 ~1.15（图标触达区变小）；
   appearance:none 防 WebView2 原生按钮面（背景/边框已显式覆盖，此为双保险）。
   ⚠️ 本组必须排在 .cr-card-local-count 之前：徽章的 border/padding/color/line-height 靠后者
   同特异性覆盖回来（顺序颠倒会把徽章外观清零）。 */
.cr-star-btn, .cr-card-search, .cr-card-local-jump {
  background:transparent;border:none;padding:0;font-family:inherit;color:inherit;line-height:inherit;
  appearance:none;-webkit-appearance:none;
}
.cr-card-local-count {
  font-size:var(--fs-micro);color:var(--muted);flex-shrink:0;
  border:1px solid var(--bd);border-radius:var(--radius-lg);
  padding:0 var(--sp-1);line-height:14px;
}
.cr-card-local-jump { cursor:pointer;transition:color var(--tr-fast),border-color var(--tr-fast); }
.cr-card-local-jump:hover { color:var(--accent);border-color:var(--accent); }
.cr-card-desc {
  font-size:var(--fs-xs);color:var(--muted);line-height:1.5;
  display:-webkit-box;
  -webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;min-height:0;
}
.cr-card-footer {
  display:flex;align-items:center;gap:4px;flex-wrap:wrap;
}
.cr-card-footer .cr-platform-badge {
  display:inline-flex;
  font-size:var(--fs-micro);padding:1px 5px;border-radius:var(--radius-xs);line-height:14px;
  background:var(--surf);color:var(--muted);border:1px solid var(--bd);gap:2px;
}
 .cr-card-footer .cr-tag { font-size:var(--fs-micro);margin-left:auto; }
.cr-platform-badge { font-size:var(--fs-micro);padding:var(--pad-v-1) var(--sp-1);border-radius:var(--radius-xs);line-height:12px;display:inline-flex;align-items:center;gap:2px;background:var(--surf);color:var(--muted);border:1px solid var(--bd); }
.cr-card-search { cursor:pointer;font-size:var(--fs-sm);transition:transform var(--tr-normal);flex-shrink:0; }
.cr-card-search:hover { transform:scale(1.15); }
.cr-star-btn { cursor:pointer;font-size:var(--fs-sm);color:var(--sm-optional);transition:transform var(--tr-normal);flex-shrink:0; } /* ADR-238：星标走 SVG 语义图标（currentColor），收藏金色沿用 --sm-optional；位置色带已独立为 --band-gold/--band-silver（P0-2） */
.cr-star-btn:hover { transform:scale(1.15); }
/* 卡内三个按钮的键盘焦点环（2026-10-15 a11y）：升格为 button 后必须给出可见焦点，
   否则 Tab 进来「看不见自己在哪」。视觉沿用卡片 focus-visible 的 accent 语言。 */
.cr-star-btn:focus-visible, .cr-card-search:focus-visible, .cr-card-local-jump:focus-visible {
  outline:2px solid var(--accent);outline-offset:2px;
}

/* ===== 预设搜索 ===== */
.cr-preset-area { display:flex;gap:6px;flex-wrap:wrap;padding:4px 0 12px; }
.cr-preset-icon { font-size:var(--fs-base); }
.cr-preset-btn {
  font-size:var(--fs-sm);padding:var(--btn-padding-filter);border-radius:var(--radius-md);
  border:1px solid var(--bd);background:var(--surf);color:var(--txt);
  cursor:pointer;font-family:inherit;transition:var(--tr-fast);
  animation:fadeSlideUp var(--tr-enter) both;
}
.cr-preset-btn:hover { border-color:var(--accent);color:var(--accent);background:var(--hover); }
.cr-preset-btn:active { background:color-mix(in srgb, var(--accent) 15%, transparent); }

/* ===== 搜索输入 ===== */
.cr-search-input {
  flex:1;min-width:120px;max-width:180px;
  padding:var(--btn-padding-std);border-radius:var(--radius-md);
  border:1px solid var(--bd);background:var(--bg);color:var(--txt);
  font-size:var(--fs-xs);font-family:inherit;outline:none;
  transition:border-color var(--tr-fast);
}
.cr-search-input:focus { border-color:var(--accent); }
.cr-search-input::placeholder { color:var(--muted);opacity:.6; }

/* ===== 工坊空状态 ===== */
/* 工坊空态：已收编进居中空态原语（content-layout 的 .placeholder-box--roomy）。
   原 .cr-empty-site 是本原语的第二份复刻（同一配方 + padding:48px 20px），2026-09 退役。 */
/* ===== 编辑模式卡片（合并 base + override：cascade 后置覆盖，此处合并为单一块） ===== */
.cr-edit-card {
  padding:4px 8px 6px;
  border-radius:var(--radius-lg);
  border:1px solid var(--bd);
  background:var(--surf);
  margin:4px 12px;
  overflow:hidden;
  cursor:default;
  transition:box-shadow var(--tr-normal), border-color var(--tr-normal), margin-top var(--tr-normal), margin-bottom var(--tr-normal);
}
.cr-edit-card:hover { box-shadow:0 0 0 1px var(--accent); }
.cr-edit-card:active { cursor:grabbing; }
.cr-edit-card-head { display:flex; align-items:center; gap:4px; padding:6px 8px; border-bottom:1px solid var(--bd); background:var(--bg); }
.cr-edit-card-body { padding:4px 8px 6px; display:flex; flex-direction:column; gap:4px; }
.cr-edit-card-row { display:flex; align-items:center; gap:4px; margin:2px 0; }
.cr-edit-card-row select { flex:1; }
.cr-drag-handle { cursor:grab; color:var(--muted); font-size:var(--fs-lg); user-select:none; line-height:1; }
.cr-edit-card-avatar { width:22px; height:22px; display:flex; align-items:center; justify-content:center; border-radius:50%; background:var(--surf); font-size:var(--fs-sm); flex-shrink:0; }
.cr-input {
  flex:1;min-width:60px;border:none;background:transparent;
  color:var(--txt);font-size:var(--fs-sm);font-family:inherit;outline:none;
}
.cr-input:focus { background:var(--surf); }
.cr-input-desc { font-size: var(--fs-xs); }
.cr-input-role { width:auto;min-width:70px;padding:var(--btn-padding-xs);border-radius:var(--radius-sm);border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-xs);font-family:inherit; }
.cr-input-role:focus { border-color: var(--accent); }
/* P1-5 锐评：platform 编辑控件从 select multiple 改可点击 badge 组——与浏览态
   .cr-platform-badge 同语义（站点归属的多选标签），点击切换选中态 */
.cr-site-chip-group { display:flex;flex-wrap:wrap;gap:var(--sp-1);flex:1; }
.cr-site-chip {
  font-size:var(--fs-xs);padding:var(--pad-v-1) var(--sp-2);border-radius:var(--radius-sm);
  border:1px solid var(--bd);background:var(--surf);color:var(--muted);
  cursor:pointer;font-family:inherit;transition:var(--tr-fast);
}
.cr-site-chip:hover { border-color:var(--accent);color:var(--txt); }
.cr-site-chip.active { border-color:var(--accent);color:var(--accent);background:color-mix(in srgb, var(--accent) 18%, transparent); }
.cr-btn-icon { font-size:var(--fs-base);padding:0 var(--sp-1);background:none;border:none;color:var(--muted);cursor:pointer;font-family:inherit; }
.cr-btn-icon:hover { color:var(--txt); }
/* P2-4 锐评：label 原固定 28px——中文「描述/平台」两字在 fs-xs 下挤贴左缘、
   像无表线的半成品表格。改 auto + min-width：单字标签窄、双字/长标签自适应，不再挤爆 */
.cr-edit-label { font-size:var(--fs-xs);color:var(--muted);width:auto;min-width:28px;flex-shrink:0; }
.cr-add-area { padding:4px 0 12px; }
.cr-add-area button, .cr-add-preset {
  padding:var(--btn-padding-filter);border-radius:var(--radius-md);border:1px dashed var(--bd);
  background:transparent;color:var(--muted);cursor:pointer;
  font-size:var(--fs-sm);font-family:inherit;transition:var(--tr-fast);
}
.cr-add-area button:hover, .cr-add-preset:hover { border-color:var(--accent);color:var(--accent); }
.cr-section {
  display:flex;align-items:center;gap:6px;
  padding:8px 0 4px;
  margin-bottom:8px;
}
.cr-section-title-lg {
  font-size:var(--fs-md);font-weight:600;color:var(--txt);
}
.cr-section-sub { font-size:var(--fs-sm);color:var(--muted); }
.cr-tag-filter-row {
  display:flex;gap:4px;flex-wrap:wrap;padding-bottom:8px;
  align-items:center;
  margin:0 0 8px;
}

/* 2026-10-15 语义重做：原 tier 图例（.cr-tier-legend / -legend-item / -swatch）已删——
   色带是位置地标，不需要解释性图例；content.tierGold / tierSilver 三语键同批清理（死键不留）。 */
.cr-drop-zone {
  display:flex;align-items:center;justify-content:center;gap:8px;
  padding:12px 16px;margin:4px 0 8px;
  border:2px dashed var(--bd);border-radius:var(--radius-lg);
  color:var(--muted);font-size:var(--fs-xs);
  cursor:pointer;transition:all var(--tr-fast);user-select:none;
}
.cr-drop-zone-active {
  border-color:var(--accent);color:var(--accent);background:var(--hover);
}
.cr-drop-icon { font-size:var(--fs-nav); }
.cr-drop-text { font-size:var(--fs-xs); }
/* 按钮收敛（2026-09 锐评 P1）：4 个描边按钮组已走 .btn-base.sm（render.ts 双类名，
   cr-* 锚点类保留供 JS 选择器），此处仅补 btn-base.sm 不提供的 tool-lg 横向 padding
   与 --fs-xs 字号差异；border/背景/cursor/transition 等全量属性由 btn-base 承接 */
.cr-fetch-btn, .cr-edit-btn, .cr-save-btn, .cr-cancel-btn { padding:var(--btn-padding-tool-lg);font-size:var(--fs-xs); }

.cr-section-fill { flex:1; }
.cr-section-wrap { flex-wrap:wrap; }

/* Drag states */
.cr-dragging { opacity: .4; }
.cr-drag-target { border-color: var(--accent); }
.cr-drag-before { margin-top: 8px; }
.cr-drag-after { margin-bottom: 8px; }

/* ===== 创作者详情浮层 (cr-detail) ===== */
.cr-detail-overlay { position:fixed;inset:0;z-index:var(--z-modal);background:var(--overlay-scrim);display:flex;align-items:center;justify-content:center;animation:fade-in .15s ease; }
.cr-detail-box { background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-xl);padding:var(--sp-4);max-width:var(--dlg-width-sm);width:90vw;box-shadow:var(--shadow-xl);display:flex;flex-direction:column;gap:12px;animation:detail-in .2s ease;position:relative; } /* 审计 P1-1：宽收口 --dlg-width-sm，遮罩收口 --overlay-scrim，内边距走 --sp-4。position:relative 是下方 .cr-star-btn 绝对定位的包含块 */
.cr-detail-header { display:flex;align-items:center;gap:10px; }
    .cr-detail-name { font-size:calc(16px + var(--fs-scale));font-weight:700;color:var(--txt); }
.cr-detail-desc { font-size:var(--fs-sm);color:var(--muted);line-height:1.5;display:flex;flex-wrap:wrap;gap:4px;padding:0;background:transparent; }
.cr-detail-row { display:flex;align-items:center;gap:8px;font-size:var(--fs-sm);color:var(--muted); }
.cr-detail-row .cr-tag { font-size:var(--fs-xs); }
.cr-detail-actions { display:flex;gap:6px;flex-wrap:wrap;margin-top:4px; }
.cr-detail-actions button { padding:5px 14px;border-radius:var(--radius-md);border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;font-size:var(--fs-sm);font-family:inherit;transition:var(--tr-fast); }

/* Overlay avatar sizes (overrides .cr-avatar base: 28px → 36px) */
.cr-detail-avatar-container { width:36px;height:36px;margin:0; }
.cr-detail-avatar-img { width:36px;height:36px;border-radius:50%;object-fit:cover; }
    .cr-detail-avatar-text { width:36px;height:36px;font-size:calc(16px + var(--fs-scale)); }

/* Name area */
.cr-detail-fill { flex:1;min-width:0; }
.cr-detail-name-row { display:flex;align-items:center;gap:6px; }
.cr-detail-identity { font-size:var(--fs-xs);color:var(--muted);margin-top:1px; }

/* Desc tags */
.cr-desc-tag { font-size:var(--fs-xs);padding:1px 7px;border-radius:var(--radius-sm);line-height:18px;background:var(--surf);color:var(--txt);opacity:.75;border:1px solid var(--bd); }

/* Local count card */
.cr-local-card { display:flex;align-items:center;gap:8px;background:var(--surf);border-radius:var(--radius-lg);padding:var(--sp-vh-card);border:1px solid var(--bd); }
.cr-local-icon { font-size:var(--fs-md); }
.cr-local-text { flex:1;font-size:var(--fs-sm);color:var(--txt); }

/* Platform row */
.cr-detail-platforms { display:flex;gap:4px;flex-wrap:wrap;margin-top:3px; }
.cr-detail-platforms .cr-platform-badge { background:var(--surf);color:var(--muted);border:none;padding:1px 8px;border-radius:var(--radius-sm);font-size:var(--fs-xs); }
/* 徽章内图标尺寸单点：卡片（createCrCard）与详情浮层（cmCrBuildDetailHtml）共用
   .cr-platform-badge，原规则只写在 .cr-detail-platforms 作用域下 → 卡片侧图标无尺寸约束。
   提到共享一处，两路同口径（.cr-platform-badge 基类本就是 inline-flex + gap 的图标+文字形状）。 */
.cr-platform-badge .ws-icon { width:10px;height:10px; }
.cr-detail-actions button:hover { border-color:var(--accent);background:var(--hover); }
.cr-detail-actions .primary { background:var(--accent);color:var(--bg);border-color:var(--accent); }
.cr-detail-actions .primary:hover { opacity:.85; }
.cr-detail-actions .secondary { background:transparent;color:var(--muted);border-color:transparent; }
.cr-detail-actions .secondary:hover { background:var(--hover);color:var(--txt); }
    .cr-detail-box .cr-star-btn { position:absolute;top:16px;right:16px;font-size:calc(18px + var(--fs-scale)); }
.cr-local-btn { padding:var(--btn-padding-tool-lg);border-radius:var(--radius-sm);border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-size:var(--fs-xs);font-family:inherit;transition:background-color var(--tr-fast),color var(--tr-fast); }
.cr-local-btn:hover { background:var(--accent);color:var(--bg); }
`;
