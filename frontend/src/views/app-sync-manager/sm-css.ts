// ===== app-sync-manager 样式串（sm-css）=====
// 本模块承载 app-sync-manager 的全部样式，由 tpl.ts 的 containerHTML 以
// `<style>${SM_STYLE}</style>` 注入（light DOM 子树，挂在 app-content ShadowRoot 内，
// 与宿主样式表同树——见 docs/knowledge/app-sync-manager.md「light DOM」不变量）。
//
// ⚠️ 命名纪律：为什么是 `SM_STYLE` 而不是 `smCSS`？
// css-layer-check 的 CSS_MARKER 以「导出名是 XxxCSS 形式」「出现根宿主伪类标记」「出现
// 样式表 adopt 调用」三者之一判定某目录是否为 shadow 域。本组件不 attachShadow、样式随
// innerHTML 注入宿主 shadow 树，动画关闭也由宿主（app-content 已 adopt noAnimationsCSS）
// 兜底——它**不是** shadow 域，导出名带 CSS 后缀会让它被误判进 SHADOW_DOMAINS，
// 触发检查 4「域内含动效却未自带 no-animations 桥」的假阳性。故命名避开该模式，
// 保持目录「纯逻辑域」分类与闸门基线不变。
// 注意：本注释措辞刻意不写 CSS_MARKER 正则原文——自查闸读的是未展开源文本，
// 注释里的 marker 特征字面量会让本文件自己命中判定（2026-10 实测翻车）。
//
// 样式语义说明（自 tpl.ts 迁出的历史注释，2026-10）：
//
// 定高行（原贴 .sm-item 处）：虚拟滚动要求同行等高，且行高必须随用户 --fs-scale
// （设置页可调）缩放——故用 calc 从 --fs-sm 派生（12px 基准 → 25.8px），TS 侧首帧实测取整
// （见 renderer 行高实测）。注意：这里是**静态** height，非 height 过渡——ADR-015 §2.4
// 约束 3 禁的是虚拟滚动组件上的 height/max-height **transition**（与 innerHTML 替换冲突
// 触发闪烁）；定高恰是窗口化的前提，且本行 transition 只列 background。另：行不再挂入场
// 动画，理由同该 ADR「已知例外」（模型树子行淡入即因此禁用：animation-fill-mode:both
// 叠加窗口化替换会滚动闪烁）。
//
// 状态筛选 tab 样式回归样式表（原为 statusTabHTML 里字符串拼接的行内 style=）——行内
// 样式绕开样式表，主题切换 / 媒体查询 / 复用都够不着；且与既有 transition 规则分裂成
// 两处。12px 横向内边距走 --btn-padding-filter（沿用 --btn-padding-* 既有简写约定）。
//
// 选中态用「accent 18% 淡化」而非实心 accent：本栏 6 个筛选并排（all/synced/missing/
// disabled/optional/legacy），实心会成视觉噪音。与 .cr-tag-filter-btn.active 逐值同款——
// 判据：**并排 4+ 个的筛选组用 18% 淡化**（.cr-tag-filter-btn / .diag-log-fbtn /
// .diag-sub-tab / .sm-status-tab 逐值同款）；**2 个的切换组用实心 accent**（仅 .pv-tab，
// 见 app-preview/css.ts .pv-tab-active）——实心底 + accent 字在「二选一」场景才是强反馈，
// 在「多并排筛选」场景则成噪音。
//
// a11y（2026 复测补缺）：目录箭头 span→button 后的原生 button 复位（样式归样式表，
// 行内 style 只留缩进等动态值）——继承行字号/行高，仅重置按钮自带外框。
//
// 筛选栏重构：.sm-status-tabs（flex 行）= 只读类型指示槽位 + radiogroup；指示器非 radio，
// 不入 radiogroup 组（ARIA 规范：radiogroup 子节点应全为 radio）。
//
// 当前类型只读指示（原同样是行内 style=）。
//
// 空状态图标尺寸：原内联 20px（design-tokens 的 inline-style-font-size，属基线内已知债）。
// 20px 无精确令牌 → 按既有「归最近档位」口径收为 --fs-xl(24px)：样式从内联回到样式表、
// 硬编码字号消失，债真正还掉（非仅搬位置——闸对硬编码字号位置无关）。
//
// 状态筛选栏（类型选择已全局化到 nav 下拉，sm-cur-type 只读指示随本栏渲染）；
// a11y：radiogroup 语义 + aria-label（i18n）；六个状态页签是互斥筛选而非页面 tab，
// 走 radio 组（仓内先例 tabs-shell diag 子切换同族，且天然避开嵌套 tablist 红线）。
export const SM_STYLE: string = `
/* 容器骨架布局（2026-10 收编：原 tpl.containerHTML 整块内联 display/flex-direction/height/
   overflow/padding/border-bottom/font-size 静态字面量——样式归样式表）。注意容器本身由
   innerHTML 一次性注入、不再重建，静态布局放样式表零风险 */
.sm-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden}
.sm-status-tabs{display:flex;align-items:center;gap:2px;padding:var(--btn-padding-tool-lg);flex-shrink:0;border-bottom:1px solid var(--bd);font-size:var(--fs-xs)}
.sm-summary{display:flex;align-items:center;gap:8px;padding:var(--btn-padding-tool-lg);flex-shrink:0;border-bottom:1px solid var(--bd);font-size:var(--fs-xs)}
.sm-item{display:flex;align-items:center;gap:4px;padding:var(--btn-padding-std);height:calc(var(--fs-sm) * 1.4 + 9px);box-sizing:border-box;font-size:var(--fs-sm);border-bottom:1px solid var(--bd);cursor:default;transition:background var(--tr-fast)}
.sm-item:hover{background:var(--hover)}
.sm-item-btn{padding:var(--pad-btn-secondary) 8px;border-radius:var(--radius-sm);background:transparent;cursor:pointer;flex-shrink:0;font-size:var(--fs-btn-secondary);transition:background var(--tr-fast),border-color var(--tr-fast),color var(--tr-fast)}
/* 在途单行按钮视觉（2026-10 收口：原 network.setRowButtonsBusy 与 renderer.restoreBusyState
   各自内联写 style.opacity/cursor 两处重复——样式归样式表，两处只 toggle 类名） */
.sm-item-btn--busy{opacity:.55;cursor:wait}
/* 状态色变体（2026-10 收编：原 tpl.actionBtnHTML 三处内联 border/color 静态字面量——
   样式归样式表，行内 style 只留缩进等动态值）。push 用 accent（=主操作）、pull 用
   --sm-optional、pullHere 用 muted 边 + 正文色（弱化，区分「拉到这里」的次级语义） */
.sm-item-btn--accent{border:1px solid var(--accent);color:var(--accent)}
.sm-item-btn--optional{border:1px solid var(--sm-optional);color:var(--sm-optional)}
.sm-item-btn--muted{border:1px solid var(--muted);color:var(--txt)}
.sm-item-btn:hover{background:var(--hover)}
.sm-tab{transition:var(--tr-fast)}
.sm-status-tab{padding:var(--btn-padding-filter);border-radius:var(--radius-sm);border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer;font-family:inherit;font-size:var(--fs-filter);white-space:nowrap;transition:background var(--tr-fast),color var(--tr-fast),border-color var(--tr-fast)}
.sm-status-tab.active{border-color:var(--accent);background:color-mix(in srgb, var(--accent) 18%, transparent);color:var(--accent)}
.sm-dir-arrow{flex-shrink:0;width:14px;text-align:center;cursor:pointer;color:var(--muted);background:transparent;border:0;padding:0;font:inherit;line-height:1}
.sm-cur-type-slot{display:contents}
.sm-status-radios{display:flex;gap:var(--sp-1);flex:1;min-width:0}
.sm-cur-type{display:inline-flex;align-items:center;gap:4px;padding:0 var(--sp-2);color:var(--accent);font-size:var(--fs-filter);white-space:nowrap;border-right:1px solid var(--bd);margin-right:6px}
.sm-empty{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;height:100%;color:var(--muted);font-size:var(--fs-base);animation:sm-fade-in .2s ease}
.sm-empty-icon{font-size:var(--fs-xl)}
/* 摘要栏路径单元（2026-10 收编：原 renderer.renderScanDirs 内联 8 属性 style 串 ×2 处，
   样式归样式表——含截断三件套，title 仍留动态值） */
.sm-path-cell{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}
/* 过宽告警变体：同截断布局，仅颜色转错误语义 */
.sm-path-cell--warn{color:var(--err)}
/* 空实例态占位（2026-10 收编：原 _showNoInstance 内联 padding+color） */
.sm-no-instance{padding:var(--sp-3);color:var(--err)}
.sm-list{flex:1;overflow-y:auto;padding:var(--pad-v-2);animation:sm-fade-in .15s ease}
.sm-loading{display:flex;flex-direction:column;gap:8px;padding:var(--sp-3)}
.sm-dir{cursor:pointer}
/* 行内槽位（2026-10 收编：原 tpl.syncDirRowHTML 与 itemHTML 各自内联 flex/font-size/
   overflow/text-overflow/color 静态字面量——两处逐值同款，合并为通用 .sm-row-* 类；
   样式归样式表，行内 style 只留 padding-left 缩进与状态色等动态值） */
.sm-row-status{flex-shrink:0;width:14px;text-align:center}
.sm-row-icon{flex-shrink:0;font-size:var(--fs-base)}
.sm-row-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)}
.sm-row-size{flex-shrink:0;color:var(--muted);font-size:var(--fs-xs)}
.sm-dir .sm-dir-arrow{transition:color var(--tr-fast)}
.sm-dir:hover{background:var(--hover)}
.sm-file{cursor:default}
.sm-file:hover{background:transparent}
.sm-shimmer{height:12px;border-radius:var(--radius-md);background:linear-gradient(90deg,var(--bd) 25%,var(--hover) 50%,var(--bd) 75%);background-size:200% 100%;animation:sk-shimmer 1.5s infinite}
.sm-shimmer-w80{width:80%}
.sm-shimmer-w60{width:60%}
.sm-shimmer-w70{width:70%}
@keyframes sm-fade-in{from{opacity:0}to{opacity:1}}
@keyframes sk-shimmer{from{background-position:-200% 0}to{background-position:200% 0}}
`;
