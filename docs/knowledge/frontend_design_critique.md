---
kind: frontend_design_critique
name: 前端设计锐评
tier: architecture
category: ui
status: snapshot
affected: false            # 锐评快照卡：结论指向具体文件，source_files 只服务存在性校验，不随单次文件变更提示复核
source_files:
  - frontend/src/views/app-content/index.ts
  - frontend/src/views/app-content/init-pages.ts
  - frontend/src/views/app-content/diagnostics/dedup.ts
  - frontend/src/views/app-content/state.ts
  - frontend/src/views/app-sidebar/index.ts
  - frontend/src/views/app-nav/index.ts
  - frontend/src/preview-3d/adapters/shared/perception/gaze.ts
  - frontend/src/preview-3d/adapters/shared/perception/autodance.ts
  - frontend/src/preview-3d/infra/safe-dispose.ts
  - frontend/src/preview-3d/infra/scene-registry.ts
  - frontend/src/preview-3d/menu/panels/roles.ts
  - frontend/src/utils/dom/modal-core.ts
  - frontend/src/features/dialogs/adv-filter.ts
  - frontend/src/features/dialogs/batch-rename.ts
  - frontend/src/preview-3d/menu/style/components-styles.ts
  - frontend/src/views/app-content/settings/path-cards.ts
  - frontend/src/views/app-content/settings/theme.ts
  - frontend/src/views/app-preview/detail-3d.ts
  - frontend/src/preview-3d/infra/worker-bridge.ts
  - frontend/src/preview-3d/infra/render-budget.ts
  - frontend/src/wasm/ysm-worker-loader.ts
  - frontend/src/backend/web-stats.ts
auto_fields:
  symbols_with_lines:
    - __resetModalStateForTest
    - AdaptiveRenderBudget
    - appContentStyle
    - AutoDanceOptions
    - BeatDetectorLike
    - bindPathClick
    - closeActiveDialog
    - closeDlg
    - createAdaptiveRenderBudget
    - createAutoDanceController
    - createDedupSession
    - createGazeController
    - createResolveModeBridge
    - createWorkerBridge
    - CreateWorkerBridgeOpts
    - createWorkerParser
    - DedupConfigShape
    - DedupSession
    - getFrameIntervalMs
    - getMaxFps
    - getMaxPixelRatio
    - initAdvancedGrid
    - initDiagnosticsPage
    - initInstancesPage
    - initMcDetect
    - initRepositoryPage
    - initSettingsPage
    - invalidateMaxFpsCache
    - MAX_FPS_DEFAULT
    - MAX_FPS_KEY
    - MAX_MODELS
    - MAX_PIXEL_RATIO_KEY
    - ModelEntry
    - PREVIEW_FRAME_INTERVAL_MS
    - previewPixelRatio
    - registerDlg
    - ResolveModeBridge
    - ResolveModeResponse
    - roleBaseName
    - safeDispose
    - sampleAdaptivePixelRatio
    - saveCfg
    - sceneRegistry
    - shouldRenderAtFps
    - shouldRenderPreviewFrame
    - showFbxPreview
    - showMmdPreview
    - showMorphPreview
    - showScenePreview
    - showStagePreview
    - showVrmMeta
    - trapFocus
    - VIEW_TESTIDS
    - WorkerBridge
    - WorkerErrorStrategy
tests:
  - frontend/src/preview-3d/infra/scene-registry.test.ts
  - frontend/src/preview-3d/infra/worker-bridge.test.ts
  - frontend/src/preview-3d/menu/roles.test.ts
  - frontend/src/preview-3d/adapters/shared/perception/autodance.test.ts
  - frontend/src/preview-3d/adapters/shared/perception/gaze.test.ts
  - frontend/src/preview-3d/infra/render-budget.test.ts
  - frontend/src/preview-3d/infra/safe-dispose.test.ts
  - frontend/src/test-utils/index.test.ts
  - frontend/src/utils/dom/modal.test.ts
  - frontend/src/services/resource-registry.test.ts
  - frontend/src/views/app-content/settings/theme.test.ts
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-preview/detail-3d.test.ts
  - frontend/src/views/app-sync-manager/index.branches.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/app-tree/index.extra.test.ts
  - frontend/src/views/context-menu/index.test.ts
use_when:
  - 设计评审
  - 前端设计
  - 锐评
  - 主题系统
  - 3D 性能审查
  - 生命周期审查
  - 技术债
pitfalls:
  - 内联 style 字符串拼 innerHTML 是「主题失守 + XSS 口径违规」的共同载体——写样式走 CSS 类/token，不内联硬编码色
  - 模块级 let busy 锁必须有 reset 路径（dedup.ts 案例：tab 卸载后 busy 卡 true → 再进永久卡死）
  - safeDispose 静默吞错会让 dispose 抛错零信号——至少 console.warn 留痕
  - 帧循环内禁止 new THREE.Quaternion/Euler/Vector3——prealloc 闭包 scratch 复用（mount-preview-core 的 R1-P1-1 模式）
  - 性能预算不要用「数量上限」冒充（MAX_MODELS=8 是计数不是预算）——要查 draw call/三角面/纹理字节
quick_groups:
  - 审计与质量门禁
quick_intents:
  - 前端设计评审 / 锐评
  - 主题系统审查（token 失守）
  - 3D 性能与内存预算审查
  - 页面生命周期审查（整 DOM 重建）
quick_risk_lines:
  - 样式必须走主题 token（var(--accent)），禁止硬编码品牌色散落（存量纯 rgba(124,131,255)/#7c83ff 已全收编；现存 #7c83ff 均为 var(--accent,#7c83ff) fallback 兜底，合规）
  - 页面切换必须 tab-panel 常驻 + active 切换，禁止整 DOM innerHTML 重建
  - 帧循环内禁止 new 对象分配，prealloc 复用是 3D 性能铁律（perception 是唯一站规则外的子系统）
invariant_anchors:
  - frontend/src/views/app-content/index.ts|appContentStyle
  - frontend/src/views/app-content/init-pages.ts|createDedupSession
  - frontend/src/views/app-content/diagnostics/dedup.ts|createDedupSession
---

# 前端设计锐评

## 概览

2026-09-05 三子代理串行只读锐评（架构 / UI/UX / 3D性能），主模型对每份报告的最强断言逐条实地抽查，**无幻觉指控**。基线：`frontend_repo_audit`（2026-08-26，4.1/5，偏代码质量）。本卡为**设计视角增量批评快照**，不重复审计卡结论。

加权总分 **≈3.6/5**：架构 4.0 / UIUX 3.7 / 3D性能 3.4。一句话：工程化治理行业级（红线零违、bus 类型化、门禁齐备），ADR-163 单面板挂载与 perception prealloc 已落地，但可访问性债务集中、模块级状态泄漏、性能预算仍靠信仰。

## 三路评分

| 视角 | 分 | 主炮 |
|------|----|------|
| 架构 | 4.0 | `app-content/index.ts` 死代码转发壳、`app-sidebar` `_checkedSets` 模块级泄漏（L37）、`app-nav` `_focusRepoSearch` 轮询耦合（L328-342）。✅ **三项均已于 2026-09 闭环**：转发壳实为 6 个（原记 7 个含从不存在的 `_bindTabs`）已删除、「测试桩保留」仲裁被推翻（见 刀⑮）；`_checkedSets` 已改私有实例属性；`_focusRepoSearch` 轮询已改 `repo:focus-search` bus + `utils/dom/focus-pending.ts`（ADR-223） |
| UI/UX | 3.7 | 所有弹窗缺 `role="dialog"`（modal.ts:134）、adv-filter label 未 for 关联（L57）、batch-rename checkbox 无 aria-label（L185）、`--uih-accent-dim` 硬编码遗漏（ui-components-styles.ts:14） |
| 3D/性能 | 3.4 | WASM 解码无单模型超时（ysm-worker-loader.ts:198）、`pickModelByObject` 每帧 O(roots) 遍历（scene-registry.ts:215）、Blob URL 成功路径永不 revoke（ysm-worker-loader.ts:118）、render-budget 缺 GPU 计量（render-budget.ts:60） |

## 实证锚点（主模型抽查背书，2026-09-05）

| 指控 | 验证结果 |
|------|----------|
| `app-content/index.ts:274-302` 死代码转发壳 | ✅ **属实且最终确认**；实际为 **6 个**（原记 7 个，多算的 `_bindTabs` 在生产代码中从不存在——真实 `bindTabs` 是 `init-pages.ts` 的局部函数）。6 个仅转发 `init-pages.ts`/`init-github.ts`/`init-workshop.ts`，实际调用走 `PAGE_REGISTRY`。**已删除**（见 刀⑮）；`_initPreviewResize` 不在其列（有真实调用） |
| `app-sidebar/index.ts:37` `_checkedSets` 模块级泄漏 | ⚠️ 撤回：设计意图非 bug——`sync.test.ts:131-140`「重新挂载 → 恢复已勾选状态」明确依赖跨 disconnectedCallback 保留，按 rtype 隔离。**且已进一步闭环**：现为 `private _checkedSets` 私有实例属性（随组件 GC），连「模块级」这层描述也已过期 |
| `app-nav/index.ts:328-342` `_focusRepoSearch` 轮询耦合 | ✅ 属实；setTimeout 循环 20 次等待 `app-tree` 挂载，依赖查询链 `appContent?.shadowRoot?.querySelector("app-tree")?.shadowRoot?.getElementById("srch")`。【✅ 已修复 ADR-223：nav 焦点改 `repo:focus-search` bus 事件 + `utils/dom/focus-pending.ts` 一次性 pending flag，删轮询与 shadow 穿透】 |
| `modal.ts:134-146` overlay 缺 `role="dialog"` | ✅ 属实；`buildOverlay` 仅设 `className`/`tabIndex`，未设 `role`/`aria-modal` |
| `adv-filter.ts:57` label 无 for 关联 | ✅ 属实；`<label style="display:block">` 无 `for` 属性，对应 `input#afv-kw` 无关联 |
| `batch-rename.ts:185` checkbox 无 aria-label | ✅ 属实；批量条目 checkbox 仅 `class="br-file-cb"` + `data-ci`，无 `aria-label` |
| `scene-registry.ts:215-223` `pickModelByObject` 线性遍历 | ✅ 属实；已修（刀⑦）：WeakMap 索引 O(depth) 替代双重遍历 |
| `ysm-worker-loader.ts:198-233` WASM 解码无单模型超时 | ✅ 属实；`decodeYsmInWorker` 直接 ccall，无 watchdog（✅ 2026-09 由 [ADR-219] 根治：单 worker 静默看门狗 + 逐模型 partial 流 + 挂死模型 hasError 细粒度降级——注意榜单原「5s Promise.race 软超时」一刀切对**同步 ccall 挂死是半吊子**：挂死点不可抢占，race timer 在阻塞线程里根本不触发，只能靠「逐模型流中断」这一唯一可靠侦测信号 |
| `render-budget.ts:60-63` 缺 GPU 资源计量 | ✅ 属实；仅 pixelRatio 自适应 + MAX_MODELS=8 计数上限，无 draw call/三角面/纹理字节预算 |

## 共识问题榜（交集 = 高置信，按 ROI 排序）

1. **可访问性债务集中爆发**（UIUX 2.5/5）：modal overlay 缺 `role="dialog"` / `aria-modal`、adv-filter label 未 for 关联、batch-rename checkbox 无 aria-label。一刀切：modal.ts buildOverlay 加 ROLE_ATTR，业务弹窗统一继承。
2. **模块级状态泄漏**（架构 3.5/5）：`app-sidebar` `_checkedSets` Map 无 reset、`init-pages.ts:314` `_lastModelPath` 模块级无 reset。一刀切：disconnectedCallback 兜底清理，或改实例级。
   - ✅ 2026-09-10 部分闭环（[ADR-221]）：`_lastModelPath` 已归位 `core/model-path-store.ts`，保留 `__resetLastModelPathForTest` 钩子（isolate:false 共享模块图下的既有约束，非新增债务）；归位同时断开 app-tree / app-nav / app-preview 三条越权边，消除 `app-content ↔ app-preview` 视图环。`app-sidebar._checkedSets` ✅ 已升级为私有实例属性（`app-sidebar/index.ts|_checkedSets`，随组件 GC 自然回收）——本条共识项彻底闭环。
3. **性能预算仍靠信仰**（3D 2.5/5）：`render-budget.ts` MAX_MODELS=8 是计数非预算、`scene-registry.ts` 拾取每帧线性遍历。一刀切：读 `renderer.info.render` 统计 draw calls，建 WeakMap 缓存拾取。（✅ 已闭环：拾取部分由刀⑦ WeakMap 索引根治；draw calls 部分由刀⑩ `gpu-load.ts` 实测信号预算根治——MAX_MODELS=8 保留为兜底硬顶）
4. **WASM 解码无单模型超时**（3D 3.5/5）：`ysm-worker-loader.ts` 畸形文件可阻塞 60s 才降级。一刀切：`stats.worker.ts` 层加 `Promise.race` 软超时（5s），超时返回 `ERROR_STATS` 而非杀池。

## 仲裁修正（主模型对子代理报告的裁定）

1. 架构子代理「死代码转发壳」指控属实，但删除需同步清理 `AppContentHost` 接口声明，避免接口漂移。（❌ 后续曾据此仲裁为「测试桩保留，不可删」，2026-09 复核证实该撤回理由不成立、6 个方法已实际删除——见 §动刀进度 刀⑮）
2. UIUX 子代理「modalPicker 无显式键盘处理器」指控降级：浏览器原生 Enter→click 行为在 button 上可靠，与 prompt/confirm 的 input 场景不同，不构成行为分裂。
3. 3D 子代理「Blob URL 成功路径永不 revoke」属实，但 pthread worker 单例常驻页面生命周期，泄漏速率极低（每页面生命周期 1 次），优先级降为 P2。

## 不变量（锐评快照结论，非既有红线）

- 样式一律走主题 token；硬编码品牌色（#7c83ff / rgba(124,131,255)）纯硬编码已全收编（2026-09-03 刀②）；现存 #7c83ff 均为 `var(--accent,#7c83ff)` fallback 兜底（变量未定义时才有值，合规）。
- 页面切换常驻 + active 切换，禁止整 DOM 重建。
- 帧循环内 prealloc 复用，禁止 new 对象分配（perception 需对齐 R1-P1-1）。
- 弹窗 overlay 必须设 `role="dialog"` + `aria-modal="true"`（WCAG 2.1 A 级）。
- 模块级 let 可变全局必须有 reset 路径或注释豁免理由。

## 动刀进度（实施记录，2026-09-03 起）

- ✅ **刀① perception 帧内 prealloc**：`perception/gaze.ts`、`perception/autodance.ts` 闭包级 scratch（Quaternion/Euler/Vector3 复用），每帧 0 分配；EYE_IDS / 左右臂 Set 提常量。45 感知测试全绿。
- ✅ **刀② accent 收编 var(--accent)**：8 文件 15 处 `rgba(124,131,255)` → `color-mix(in srgb,var(--accent) X%,transparent)`；`#7c83ff` → `var(--accent)`；canvas 2D（model2d-draw.ts）加 `accentRgba()` 运行时解析（fillStyle 不解析 CSS 变量）；`variables.css --mmd-morph-active-bg` 改派生。roles/switch/vrm-bone-ui 样式串提纯函数（happy-dom 不认 color-mix()，测试直断字符串）。全量 5171 测试 + typecheck + vite build 全绿。
- 🔧 **死代码清理（2026-09 后续）**：刀②派生式收编的 `--mmd-morph-active-bg` 与 `--clr-ch-r/g/b` 自始零消费（死 token），已连同 `--pad-tab`/`--space-xs`/`--space-lg`/`--tr-slow`/`--z-dropdown`/`--z-sticky`/`--z-modal-backdrop` 一并删除；组件库 `--uih-ui-scale`（恒 1 的伪缩放，全仓无赋值方）拍平为固定值；`.hdr-btn` 死样式（tpl 早改 .btn-base）与 treeRowIn 排查注释残留清除；slide-menu 内容卡背景 `rgba(15,15,22,0.92)` 统一为外壳同源 `rgba(20,20,30,0.55)`（透景口径生效，双源色值收敛）。
- ✅ **刀③ _render → 页面面板常驻化**：兄弟会话 `486b9033` 实施完成（**单面板挂载复用**方案，非 ADR-163 原文「tab-panel 常驻 + active 切换」——落地方案更优）：
  - `index.ts` 每页首次访问构建面板 + 执行 init（每页仅一次），之后复用缓存节点、不重建不重复 init——消灭「再进 dedup 永久卡死」（busy 锁 finally 必复位 + 不再重复 init）；
  - **单面板挂载**：root 下同一时刻仅保留当前面板（其余从 DOM 分离、引用留缓存），root 内 id 天然唯一，页内 `host._root.getElementById` 无跨页冲突 → **无需页内查询作用域化**（省去 237 处 getElementById 改造）；
  - `lang:changed` 全量重建（低频可接受）；`disconnectedCallback` 清面板缓存防泄漏。
  - ⚠️ 与 ADR-163 的差异：ADR 写的是「tab-panel 常驻 + active 切换 + dedup 锁随页面实例化」，落地为「单面板挂载 + 缓存节点复用」，dedup 锁保持模块级（常驻后不再重复 init，锁问题自然消解）。ADR-163 决策方向仍成立，实施细节以本卡为准。
- ✅ **刀④ web-spike 注入面转义**：`web-spike/main.ts` 的 `file.name` / 解码产物 `f.path` 原样拼入 `insertAdjacentHTML`（拖入 `<img onerror>` 文件名即注入）→ 统一 `esc()`。独立 spike 页无单测，改动极小。
- ✅ **刀⑤ modal FOCUSABLE_SEL 死选择器**：`features/dialogs/modal.ts` 裸 `tabindex,`（无 `=` 匹配元素名而非属性，全仓无 `<tabindex>` 元素）移除；`trapFocus` 测试 4 例全绿，行为不变。
- ✅ **刀⑥ 弹窗可访问性三件套（WCAG A 级）**（2026-09-05）：
  - `features/dialogs/modal.ts` `buildOverlay` 设 `role="dialog"` + `aria-modal="true"`——全仓弹窗唯一基座，业务弹窗统一继承；
  - `features/dialogs/batch-rename.ts:185` checkbox 加 `aria-label="${esc(it.Name)}"`——文件名经 esc() 转义防属性注入；
  - `features/dialogs/adv-filter.ts` 5 个 label 加 `for` 关联主 input，3 个 max input 加 `aria-label`（双 input 无法 for 一对一）；
  - 90 测试全绿 + vite build + typecheck + biome 全通过。
- ⚠️ **仲裁撤回：`_checkedSets` 非"泄漏"**：子代理报 `app-sidebar/index.ts:37` `_checkedSets` 模块级 Map 无 reset 路径。主模型抽查 `app-sidebar.sync.test.ts:131-140`「重新挂载 → 恢复已勾选状态」测试明确依赖跨 disconnectedCallback 保留——**设计意图**（按 rtype 隔离 + 跨重新渲染保持勾选），非 bug。模块级状态保持不动。
- ❌ **仲裁撤回被推翻（2026-09 复核实证）：死代码转发壳确是真死代码**。原撤回理由是「`methods.test.ts` 大量引用 → 测试消费方明确」，实测该理由不成立：`app-content.methods.test.ts` 的 `ContentEl` 是**测试本地类型**（且带 `[key: string]: unknown` 兜底，该声明本身非必需），`mountContent()` 把 `_initDiagnostics`/`_initWorkshop`/`_initGithub`/`_initSettings` 赋成 `vi.fn()`——**从不执行**；`describe("_initRepository …")` 与 `package:selected` 用例走的都是 `el._render()` → `PAGE_REGISTRY[page].init`（`app-content/page-registry.ts|PAGE_REGISTRY` 直引各 init 函数），方法体从未被触碰，原注释「真实 _initInstances 注册订阅」属误述。生产侧 grep `\._init(Diagnostics|Instances|Repository|Workshop|Github|Settings)\(` 零命中。**已删除 6 个转发方法**（`_initPreviewResize` 有真实调用故保留），同步清理失效 import 与测试桩/类型/注释；改后 app-content 24 文件 381 用例全绿。详见 §动刀进度 刀⑮。
- ✅ **刀⑦ pickModelByObject WeakMap 索引**（2026-09-05）：`preview-3d/infra/scene-registry.ts` `register` 时在 root 上填 `WeakMap<Object3D, ModelEntry>`，`pickModelByObject` 从 O(entries×roots) 双重遍历改为 O(depth) 沿父链查 Map；`unregister`/`reset`/去重重载路径同步维护索引；删除 `isDescendant` 死函数。13 测试全绿 + vite build + typecheck + biome 全通过。
- ✅ **刀⑧ web-stats 单 worker 终止 + 重试**（2026-09-05）：`backend/web-stats.ts` 瞬态 error（WASM 初始化失败 / trap 逃逸）从「杀整池」改为「只终止出错 worker + 换 worker 重试 1 次」——每 Worker 独立 WASM 实例，单 worker 故障不应传染。超时路径仍杀整池（WASM 死循环可能传染）。`statsOneChunk` 返回 `StatsChunkResult{ok, retryable}`，`terminateStatsWorker` 导出签名不变（browser-adapter 消费）。135 测试全绿 + vite build + typecheck + biome 全通过。
- ⚠️ **P2-7 撤回（子代理建议不可行）**：`wasm/ysm-worker-loader.ts:215` 的 `ccall("ysm_decode_from_memory")` 是同步 WASM 调用，阻塞 Worker 事件循环——`Promise.race` 软超时的 `setTimeout` 回调在 ccall 期间不会触发，Promise 无法被 race 掉。唯一能中断挂起 ccall 的方法是主线程 `Worker.terminate()`（即现有 `statsOneChunk` 60s 超时路径）。60s 是设计意图的防御线，非「无超时」。
- ✅ **刀⑨ ADR-219 细粒度降级：单 worker 静默看门狗 + 逐模型 partial 流**（2026-09-10，共识榜 #4 根治）：P2-7 判定的「60s 杀整池」防御线被升级为**故障粒度对齐**——协议重开最小 worker 级信道（`partial` 逐模型结果流 + `result` 瘦身为流结束标记，ADR-218 D2 部分修订），主线程 `statsOneChunk` 双计时器（30s 静默窗随 partial 重置 + 60s chunk 墙钟跨重试共享）：挂死只杀该 worker，专属 replacement 上重试**剩余未回包**模型；静默杀预算 2 次 / 墙钟耗尽 → 剩余模型全 `hasError`（`EMPTY_ERROR`），chunk 正常收尾、**整批不降级**。故障边界拆分（D3）：系统级（WASM init 重试耗尽 / 构造失败 / 取消）保留整批降级 + toast；局部挂死走模型级细粒度。UI 进度顺带从 chunk 级升级为模型级。web-stats 25 + stats.worker 5 + 消费端 157 测试全绿 + vite build + typecheck + biome 全通过。
- ✅ **刀⑩ GPU 负载实测预算（`gpu-load.ts`，2026 锐评整改，共识榜 #3 残余根治）**：新增 `preview-3d/infra/gpu-load.ts`——`sampleGpuLoad(renderer)` 薄封装读 `renderer.info`（`render.calls` 上帧 draw calls + `memory.textures` GPU 纹理数，读值无副作用），`evaluateGpuLoad(sample, limits?)` **纯函数**判定（`DEFAULT_GPU_LOAD_LIMITS` = {drawCalls: 1600, textures: 1024}，保守初值待真机标定，命中 toast 附实测数值供调参）。接线点 = `switch-preview.ts|beginSwitch` keep 追加路径（与 MAX_MODELS 计数顶同约定：inFlight 置位前判、命中即 return 附 toast 不卡死）。**方案选型**：弃「UNMASKED_RENDERER GPU 型号指纹表」（ANGLE 字符串解析脆弱 / Android WebView 无此扩展 / happy-dom 不可测），按本卡原处方走 `renderer.info` 实测信号。`MAX_MODELS=8` 保留为计数兜底硬顶（budget 命中先于它触发 = 病态堆叠早拦）。7 新测（gpu-load 纯判定）+ 2 新测（beginSwitch gate 拦/放）+ 全量 5515 测试绿。⚠️ **已知盲区 → 刀⑪ 已闭环**：`mount3D cooperate=true` 直挂路径不经 `beginSwitch` 的缺口，已由刀⑪ 补上同一道门（见下）。

- ✅ **刀⑪ GPU 预算「计数 → 计量」全链补强**（2026-09 锐评二次整改：共识榜 #3 的维度残余 + 刀⑩ 遗留盲区 + 三项新增防线一并收）：
  - **维度补全（P1）**：`gpu-load.ts` 原只判 draw calls + 纹理**数量**——「50 万面 MMD」与「5 千面方块」draw calls 都是 1 判不出；「1024 张 16×16」与「1024 张 4K」纹理数一样判不出。补 `triangles`（`info.render.triangles`）与 `textureBytes`（`textureCache|getTotalBytes` 按 RGBA 上限估算聚合）两维，预算从计数变计量。默认 `{drawCalls: 1600, triangles: 100 万, textures: 1024, textureBytes: 256MB}`。⚠️ 实测边界：4 张 4K 纹理（4×4096²×4）**恰好等于** 256MB 上限，严格 `>` 不触发——该预算对 4K 纹理堆叠是紧的。
  - **两入口共用一道门（P0）**：抽出 `infra/gpu-budget.ts|guardGpuBudget(renderer, exceededKey)`（判定 + i18n 文案同源），`switch-preview|beginSwitch`（追加通道）与 `mount-preview-core|mount3D`（直挂通道）共用——消除刀⑩ 记录的 cooperate 直挂盲区。⚠️ 直挂侧的落地位置与语义经刀⑫ 修正（见下），本行原写「走 `runFullCleanup` 完整回收」已被取代。
  - **GPU 饱和反压像素比（P2）**：`render-budget|sampleAdaptivePixelRatio` 加可选 GPU 参数，`render-host` rAF 回调注入 `sampleGpuLoad`——原实现只看 CPU 帧时（「提交速度」代理），主线程 16ms 完成提交而 GPU 已排队时漏判。GPU 超硬顶 50% 软线时，即使帧时正常也预防性降档。⚠️ **语义边界**：降像素比只减**填充率**压力，不减 draw calls / 三角面本身——真治 draw call 靠 `guardGpuBudget` 拦追加，勿把此项误当根治。
  - **真机标定闭环（P4）**：新增 `infra/gpu-load-calibrate.ts`——`createCalibrationTracker`（纯状态机）+ `suggestGpuLimits`（峰值 × 1.5 安全系数）+ `runGpuBudgetCalibration`（注入假时钟可测）。**标定结果不是打印建议**：写 localStorage 后由 `resolveGpuLoadLimits` 消费、`guardGpuBudget` 读取 → 真的改变拦截线（标定放宽/收紧双向生效，有测试背书）。DEV 下钩子由**装配层** `app-modules.ts` 挂载（ADR-214 同款 `_devMode` + `isDebugEnabled` 守卫）：`window.ysmCalibrateGpuBudget(ms)` / `ysmResetGpuBudget()`——命名**不带双下划线**（对齐 `window.debugGetSpec` 先例，且避开红线段 R1「禁止把调试状态挂成双下划线全局」）；采样源经 getter 惰性读 `sceneInfraHost.renderer`（renderer 只在 3D 会话存活，装配期尚无实例）。钩子生命周期归装配层，**不进 `mount3D` 热路径**——`debugGetSpec` 同规矩（ADR-214：叶子工具不绑桥）。
  - **大文件事前告知（P5）**：新增 `infra/large-model.ts|warnLargeModelIfNeeded(bytes, path)`——受限平台（`isViewerMode`：网页版 / Android）超 50MB 给一条带实测字节数 + 3× 峰值估算的 toast（会话内同路径只提示一次，防轰炸）。**不改内存模型**（六层拷贝并存是长期债），只把「静默 OOM」变成「有预期的卡顿」。文案走 i18n（`preview.largeModelWarn` 三语）。
  - **fail-open 语义（防误拦）**：`sampleGpuLoad` 改**结构化可选读取**（`info?.render?.calls ?? 0`）——WebGPU 后端 / 老版本 three / 测试 mock 的 info 结构未必齐全，缺字段读 0 而非崩。预算是「病态堆叠早拦」护栏，不是加载的必要前提：误拦一切远比漏拦更糟（原生 bug 由测试环境的 three mock 缺字段暴露）。
  - 守卫：`gpu-load` 19 + `gpu-budget` 9 + `gpu-load-calibrate` 16 + `render-budget` 13 + `large-model` 8 新测；全量 5593 测试 + typecheck + vite build + biome 全绿。
- ✅ **刀⑫ 刀⑪ 的独立审查闭环（提交 e3886d250 后 CodeReview 子代理复核 → 逐条修）**：审查核心结论「站得住，但有一个必须补的窟窿和两个必须收的口子」，全部采纳：
  - **P1 阻断「新门零覆盖」→ 已补**：`test-utils/fake-webgl-renderer.ts` 原本**没有 `info` 字段** → `sampleGpuLoad` 走 fail-open 读 0 → `guardGpuBudget` 恒放行 → **直挂门在测试里一次都没被触发过**（判反了测试也全绿）。补可注入 `info`（`setFakeRendererStats` / `resetFakeRendererStats`，默认 0 不破坏既有 37 用例）+ `mount-preview-core.test.ts` 5 条真驱动用例（首挂不进门 / 残留会话超限拦 + toast 实测值 + 外壳回收 / 拦截后可再 mount 不自锁 / 预算内放行 / 纹理数维度同拦）。**「测试基建的意外副作用」升级为「被断言的行为」**。
  - **P2「直挂门语义错位」→ 已修（位置也改了）**：审查实测指出原实现读的是**上一帧/上一会话**的统计，却用来拦一个**尚未构建**的新会话——无残留会话时读到空 renderer（白判）或陈旧指标（拿旧负载拦新会话，归因错误）。修正为：**门前置到外壳装配之前** + `hasActivePreview()` 前置条件 + 有活跃会话时 `sceneInfraHost.renderer` 必存在。补充收益：装配前判意味着**本次无状态可回收**，直接 `cleanupPreview()`（「全部关闭」语义）一步收干净——取代了刀⑪ 原方案的 `runFullCleanup(ctx)`（审查实测暴露它只结算**本次**会话，被 `clearSingletons` 摘掉 overlay 的残留会话 handle 变**僵尸**：`hasActivePreview()` 仍 true 而外壳已拆）。
  - **P2「一行脏存储自锁全部 3D」→ 已修**：`resolveGpuLoadLimits` 原无下限 clamp，`{"drawCalls":1}` 即让**每次** 3D 加载都判超限，而归因显示「GPU 超预算」（误导），且重置钩子只在 dev 挂载 → 生产用户**无 UI 逃生口**。加 clamp 到 `[默认 × 0.1, 默认 × 10]`（`LIMIT_MIN_RATIO`/`LIMIT_MAX_RATIO`），并补「自锁防线」专项测试。
  - **P3「`textureBytes` 对 MMD/VRM 恒 0」→ 已标注**：`textureCache` 自述「MMD/VRM 走 blob URL + 内置 Loader，暂不接入」——即刀⑪ 那句「字节维度补上这一刀」在**最吃显存的 MMD/VRM 上是空的**，只有 YSM/pack 生效。已在 `texture-cache|getTotalBytes` 与 `gpu-budget|guardGpuBudget` 写明**覆盖盲区**，防下一个人误以为这一刀已落全。
  - **P3「`getTotalBytes` 漏 mipmap」→ 已修**：three 默认 `generateMipmaps=true` 额外 ~1/3 存储，原口径未计 → 而 `w×h×4` 恰好让「4 张 4K = 256MB」踩在默认上限线上（严格 `>` 不触发）。补 `MIPMAP_CHAIN_FACTOR`（`generateMipmaps === false` 才不乘），「4 张 4K」从**踩线**变**确定超线**，口径更诚实。
  - **P3「`warnedPaths` 无界」→ 已修**：照抄 `core/i18n/t.ts|warnedResiduals` 的既有有界范式（`WARNED_PATHS_MAX`=200 + 淘汰最旧），替代原「模块级 Set 零生产复位 + 专门导出测试钩子」。
  - **P3「软/硬线双源」→ 已修**：`render-budget|isGpuSaturated` 原写死 `DEFAULT_GPU_LOAD_LIMITS × 0.5`，标定放宽硬顶后软线不动 → 4000 draw calls 场景被**持续反压到 0.75 地板**而硬顶一路放行。改为软线也走 `resolveGpuLoadLimits()`（读取频率 = 每 30 帧一次，非每帧）。
  - **P4「注释 100MB 与常量 50MB 混为一谈」→ 已修**：写清两者是**两档**——100MB 是别处的导入/内存**硬阈值**，50MB 是**事前警示线**（刻意更低，让用户还有机会反悔）。
  - **P4「可复用既有函数」→ 已修**：`resolveGpuLoadLimits` 手写 `JSON.parse` + try/catch → 换 `utils/base/primitives/storage.ts|safeGetJSON`。
  - 审查明确**核实后不成立**的项（未改）：i18n 三语 key/占位符一致；`getTotalBytes` 重复计数（key=URL，同 URL 单 entry，不同 URL 即两份真实 GPU 副本，计得忠）；标定 getter 悬垂 renderer（`reset()` 置 null，`info` 是构造期普通对象，读到陈旧也不崩）；标定 do-while 卡死（后台节流会变慢不挂起）；`runFullCleanup` 对 ctx 的清理完备性。
  - 守卫：新增/改写 13 测（mount 直挂门 5 + clamp 4 + mipmap 2 + 软线跟随标定 1 + 有界去重 1）；全量 5606 测试 + typecheck + vite build + biome 全绿。
- ✅ **刀⑬ 字节维度补全：让 `textureBytes` 真正覆盖全格式（刀⑫ P3-1 的根治）**：刀⑪ 那句「字节这一刀补上纹理数与 4K 的差别」在 **MMD/VRM 上是空的**——它们走 blob URL + 内置 Loader，**不进 `textureCache`**，池口径对它们恒 0，即**最吃显存的格式恰好不被计量**（YSM/pack 另有 pack 适配器进池）。
  - **方案选型**：不把 MMD/VRM 纹理「接进引用计数池」（那要重写各自 loader 的 dispose 所有权链，风险高、收益仅是计量）——改为**场景图口径**：`collectSceneStats` 本来就在 traverse 场景、按九贴图槽（`ALL_TEXTURE_KEYS`）按实例去重收纹理实例，加一条字节累加即可，**天然覆盖全部格式**且反映「GPU 上真实压着多少」（比池更准，池可能含未悬挂的残留）。
  - **抽单一事实源 `infra/texture-bytes.ts`**：`estimateTextureBytes`（单张，含 mip 链）/ `estimateTextureSetBytes`（**内部保证按实例去重**——命名承诺与实现一致）/ `collectMaterialTextures`（九槽收集，供 `scene-stats` 复用，消除重复遍历逻辑）/ `estimateSceneTextureBytes`（场景整图）+ 场景字节**快照**（`set/getLastSceneTextureBytes`）。
  - **快照为什么必需**：`guardGpuBudget` 在 mount/switch 时同步判定，不可能当场 traverse 全场景（每次 mount 扫一遍太重）——由 `register-built-scene` 在构建后写快照（取**全场景**而非本次差量：追加语义下预算判的是「GPU 上现在压着多少」，必须累计全部已注册模型）。
  - **双口径取大者**：`guardGpuBudget` 用 `max(场景快照, 池累计)`——两者覆盖不同集合（场景=全格式；池=已 acquire 未挂场景 / 已移除未归零的 YSM/pack），缺一即漏计。取大不会低估，代价是理论上可能高估（同一批两边都算）；预算是「病态堆叠早拦」护栏，**保守优于漏拦**。首挂（快照为 0）自然退化为池口径。
  - 守卫：`texture-bytes` 17 新测（单张口径/mip/未就绪/集合去重/九槽收集/场景遍历/null 安全/快照非法值）+ `scene-stats` 2 新测（字节与计数同口径、共享纹理不重复累加）+ `gpu-budget` 4 新测（**快照参与判定**：池为空但场景 512MB 仍拦 / 取大者 / 都内放行 / 双空不误报）；全量 5629 测试 + typecheck + vite build + biome 全绿。
- ✅ **刀⑭ 解码拷贝链：低成本释放清理落地 + 可行性调研定界**（2026-09，只读调研子代理实测背书）：
  - **C-1 三处零风险清理已落地**（~5 行，行为不变、5629 测试全绿）：① `decoder/wasm-decode.ts|doDecodeYsmViaWasm` 在 `Base64ToBytes` 后 `raw = null` 显式释放 base64 中间串（原为函数作用域 `let`，要等**跑完整条 WASM 解码**才可回收，而那时正是峰值阶段）——−1.33N；② 同文件纹理循环删掉 `new Uint8Array(f.data)` 冗余整拷贝（`sniffTexSize` 是只读纯函数，`f.data` 已是 `FS.readFile` 产出的独立数组）——−N_tex（**每张纹理一份**）；③ `ysm-parser.ts|decodeYsmFileFromMemory` 与 worker 侧 `ysm-worker-loader.ts` 补 MEMFS **收集后立即 wipe**（原先只在下次调用开始才清 → 产物跨模型累积驻留；callMain 路径早已如此，两路同病同修，含 `!success` 早退分支）。③ 关闭了 `ysm-wasm` 卡挂了很久的 P3 观察项。
  - **顺带钉住一处隐性契约**：`wasm-decode.ts` 用 `f.data.buffer` 整体构造纹理 Blob，**只在 `FS.readFile` 返回「恰好占满底层 ArrayBuffer」的数组时正确**——若将来有人把 `collectOutputFiles` 改成返回 subarray 做「零拷贝」，`.buffer` 会指向整个更大的底层缓冲、静默把多余字节塞进 Blob（花屏）。已在代码处写明「改那条路径时必须连这里一起处理」。
  - **调研推翻了三条既有前提**（实测数据见 `model3d` 卡不变量）：① MEMFS 的 `node.contents` 是 **JS 侧数组**、不在 WASM 线性内存；② `atob` 产出 **Latin-1 one-byte string（1 字节/字符）**，不是 UTF-16 的 2 字节；③ 「3-4×」只是 **N_in 口径下界**——实测 L1+L2+L3 = 3.33N，加 `HEAPU8.set` 的 1.0N = **4.33N**，尚未计 C++ 内部 3×N_in 与输出侧 N_out。**新增认知：WASM 线性内存只增不减**（上限 2GB），HEAP 高位常驻整个应用生命周期——比瞬时峰值更危险。
  - **明确排除的路线**（勿重复论证）：Go binding 直接返回 ArrayBuffer（Wails 传输只有 JSON，`runtime.js` 实证）、分块/流式喂解析器（`YSMParserFactory::Create` 要求完整缓冲）、Web Worker 降峰值（dedicated worker 与页面**同渲染进程**，transferable 只避免主线程持有、不去重）。
  - **★ 网页版消除 base64 往返 → 已实施（[ADR-228](../adr/ADR-228-web-bytes-direct-read.md)）**：原设想是「给 `browserAdapter` 加一个可选 ArrayBuffer 方法」，**落地时被 binding 形态挡住并改道**——`browser-adapter.ts` 的 `webImpls` 是 `satisfies Partial<GoBindingShape>`，只容纳 Go binding 存在的键，且 `get`/`has` trap 仅认自有键；加非 Wails 契约的方法会破坏类型约束与能力门控语义，**更不该为纯前端优化去动 binding 契约**（那会波及 `generate:bindings`、`web-fs.ts` 兜底与 Android 桥）。改道方案：新增 **`backend/read-model-bytes.ts|readModelBytes`** 作统一字节读取 seam，平台分叉**只在该处存在**（decoder 层不感知平台）；`web-fs-read.ts` 抽 `readWebFileArrayBuffer`（file key 构造单点）；`wasm-decode.ts` 的读取契约从「base64 字符串」升格为「字节」（`InflightCtx.ReadBytes`，三处子文件读取 avatar/model/tex 签名不变自动受益，本地 `Base64ToBytes` 链下沉到 seam 后删除）。桌面/Android 契约与行为全不变。**实施中修正一处自己的认知错误**：`new Uint8Array(arrayBuffer)` 是**视图（别名）非拷贝**（拷贝须 `new Uint8Array(typedArray)`）——即网页版路径实为**零拷贝**，比原设想更优，已写进 seam 文档与断言。
  - **A-2 桌面资产服务器二进制路由 → 经核实「技术可行但不值得做」**（2026-09 只读调研子代理 + 主模型复核，证据链见下）：
    - **机制无障碍**（推翻了我三条前提）：① `wails.localhost` 在 Windows 是 **WebView2 的 `WebResourceRequested` 拦截**（`webview_window_windows.go` 的 `processRequest()` → IStream 回灌，非 server 构建全 `pkg/application` 无任何 `net.Listen`），本机 `Resolve-DnsName wails.localhost` 无记录 → **外部进程不可达**，攻击面 = 自家前端；② **dev 模式 middleware 同样生效**（dev 窗口 URL 是 `http://wails.localhost:<vite port>`，仍命中拦截 → Go 资产服务器反代 Vite）；③ **守卫有干净写法**：在 `internal/app` 加**自由函数**（非 `*App` 方法）`func NewRawAssetHandler(a *App) http.Handler`，守卫 `isPathInRootOrSelf` 仍私有、包外无法重实现，`binding-check` 的正则只认 `func (\w+ \*?App) X(` 故完全不被扫。
    - **binding 污染是真陷阱**（若图省事加在 `*App` 上）：`bindings.go|getMethods()` 反射注册**所有导出方法**（无签名校验），唯一排除名是 `ServiceName/ServiceStartup/ServiceShutdown/ServeHTTP`。写 `func (a *App) ServeRawFile(w http.ResponseWriter, ...)` 会**变成一个永久坏死的假 binding**（JS 传 null → 处理器 panic → 422），且撞 `binding-check` 硬闸（`missing_in_js`，pre-push 阻断）——修法只能是改门禁白名单，本身会被治理审查盯上。`//wails:ignore` 只管 codegen 不管运行时，**不可用**。
    - **决定性命中：ROI 太小**。实测（Node v24.16 / 同 V8 族）桌面这条链一次性开销 **50MB ≈ 0.13–0.17s / 100MB ≈ 0.29–0.35s**（L1 base64 编码 + L2 `JSON.parse` + L3 `atob` + L4 `charCodeAt` 循环，后三者**全在主线程**）；而桌面**已被明确排除在内存告警外**（`large-model.ts` 的 `if (!isViewerMode()) return`，注释「内存充裕，提示是噪音」）。且 A-2 **不消除** `HEAPU8.set` 与 C++ 内部拷贝，峰值仍 ~2N —— 收益画像与已被排除的「Worker 降峰值（只改卡顿不改内存）」高度重叠。
    - **安全增量 ≈ 0，但新增一条 server 模式边界**：守卫与 `ReadFileBytes` 完全同口径（能力等价，后者已被 `wails-bindings` 卡称为「最危险入口」）；**唯一实质缺口**是 `-tags server` 会把同一资产服务器变成**真实 TCP 监听**（`application_server.go`），届时「读任意扫描根内文件」直接上网——若落地必须用 build tag 挡掉。
    - **替代路线（「桌面改 Go 优先让 4.33N 归零」）经复核前提不成立**：`.ysm` 的 `runYSMParserOnFile` → `decodeYSMViaNodeJS` **只解析 geometry + 纹理，完全不产出动画**（`grep Animations` 全 `internal/app` 仅一处、且在 zip 分支）；且 `loader.ts` 的 Go 路径要接收 **WASM 算出的 `authors`/`avatars`** 才完整。改排序会让内嵌动画 + 作者 + 头像**一起丢**，除非先在 Go 侧补这三样能力——那比 A-2 大得多。
    - **结论**：A-2 **不立项**。替代路线同样不成立。若日后桌面大文件加载实测确痛（性能面板 `recordLoadTrace` 的「读取/解析」段 > 0.5s），再按「自由函数 + server 模式 build tag 门控」重启。
  - **顺带修正 4 处既有认知偏差**（本次调研实证）：① 「资产服务器自带 host/origin 校验」**被高估**——`webview_window_windows.go` 那段是**分发过滤器**（`HasPrefix` 宽松，`wails.localhost.evil.com` 也过），且 `ExpectedWebViewHost` 在 alpha2.105 是**死代码**（全模块无赋值处）；资产服务器也不设任何 CORS 头；② 「桌面不暴露本机 HTTP」**已不成立**——`internal/app/proxy.go` 早有 `net.Listen("tcp","127.0.0.1:0")` 的**无鉴权反代**（带 cookie jar），评估桌面威胁面必须以它为基线；③ 桌面「4.33N」成立但**不是唯一/必然主链路**——3D 与详情主路径走 Go `GetModel3DSpec`/`AnalyzeBedrockModel`，只有缩略图/几何/加密详情三处吃这条链；④ 「六层拷贝」里的 MEMFS 在 JS 侧、`atob` 是 1 字节/字符（已在 `model3d` 卡更正）。

- ✅ **刀⑮ views 区写法收口：死代码 + esc 口径 + 主题 token + 重复测试 + 纯函数补测**（2026-09 三子代理只读审核 → 主模型逐条实测复核后实施；范围限 `frontend/src/views`）：
  - **死代码（P1）**：删 `app-content/index.ts` 6 个 `_initXxx` 转发方法（0 生产调用方；原「测试桩保留」仲裁被推翻，见 §仲裁修正 1）。`_initPreviewResize` 有真实调用故保留。同步清 import（`init-github.ts` 整体、`init-pages.ts` 四符号、`init-workshop.ts` 收窄为 `resetAvatarConfigLoaded`）+ 测试侧本地类型声明、4 处 `vi.fn()` 桩、2 处过期注释（含「真实 _initInstances 注册订阅」误述）。
  - **陈旧测试名（顺带修正）**：`app-content.methods.test.ts` 两处 `describe("_bindTabs …")` 指向**生产代码中从不存在的方法**（真实 `bindTabs` 是 `init-pages.ts` 局部函数），改为按实际测点命名；`describe("_initRepository …")` 同理（测的是 `_render()` → `PAGE_REGISTRY`）。
  - **esc 口径（P3）**：`app-content/init-pages.ts` 三处属性注入补 `esc()`——`defaultType`/`rtype`/`subdir`（同函数 `esc(insName)` 早已转义而 `defaultType` 漏网，即「口径不一」的直接实证；`rtype`/`subdir` 源含 localStorage `repo_subdir`，是本轮唯一带实际攻击面的一处）；`app-nav/index.ts|_logoText` 经 innerHTML 未 esc 补齐（同函数 textContent 分支安全，属同值两口径）。
  - **主题 token（P3）**：`app-preview/skeleton.ts` 错误红裸 hex `#ff6b6b` → `var(--status-error)`（对齐 `css/variables.css` 6 套主题变量；原写法切主题不跟随）。
  - **注册表事实源（P3，否决了子代理方案）**：`app-preview/detail-3d.ts` 三处徽章字面量 `SceneModel`/`CustomMorph`/`StageAnim` → 改取 `RESOURCE_TYPES.SCENE`/`CUSTOM_MORPH`/`STAGE`。**子代理原建议「加 3 个 i18n key」被否决**：这三个值是 `resource_types.json` 的 type `id`（技术标识），翻进语言包会 fork 出第二事实源、违反 ADR-116「前端只读不判」。输出值不变，零行为变更。
  - **删重复测试（P3）**：`app-content/diagnostics/perf-cli.test.ts` 名不副实（文件指向已不存在的 `perf-cli.ts`，实际 import `perf-common.ts`），且 4 条 `sectionHeader` 用例与 `perf-common.test.ts` **逐字重复**——仓库自己的 `check-deadcode-baseline` 早已把它登记为 jscpd 重复对。删除后基线该条目转为 `[已清理]` INFO（脚本不自动摘除，见下「守卫」行），`check-deadcode-baseline` 仍 `ERROR 0`。
  - **补零 mock 单测（P3）**：新增 `app-content/diagnostics/dedup-policy.test.ts`（17 用例）覆盖 `getDefaultKeepIdx` 三分支 + 边界（空数组/单元素/并列保序/modTime 缺失或非法/path 大小写不敏感/优先路径未命中回退/未知策略走默认/大小写敏感）。
  - ⚠️ **顺带钉出一处待裁决语义缺陷（未擅自改）**：`dedup-policy.ts|toTimestamp` 对缺失/非法 modTime 返回 `MAX_SAFE_INTEGER`，注释自述「视为最老」——对 `oldest` 巧合正确（MAX 不是最小），但 `newest` 取最大值 → **无时间信息的文件反被判为「最新」**，与声明意图相反。真实场景 Go 扫描恒带回 modTime 故未暴露。已在测试中以「【记录现状·待裁决】」用例钉住；改动方向需先定（缺失在 newest 侧视作 `-Infinity`，或直接排除出候选）。
     - ✅ **2026-09-12 P0 收口（排除出候选方案）**：`toTimestamp` 缺失/非法改返回 `null`（「无时间信息」语义），`reduceOldestIdx`/`reduceNewestIdx` 统一经 `pickByTime(files, cmp)` 共享辅助——`null` 候选跳过时间裁决，全缺失时严格比较保序回退首项（`dedup-policy.test.ts` 原「记录现状·待裁决」用例改写为「缺失者不抢席位」+ 新增「全缺失 → 首项」newest 兜底用例）。消费者 `dedup.ts` 签名零波及，`dedup-policy` + `dedup` 27 用例全绿。
  - **未动（判定 by-design 或面大需先立 ADR；2026-09-12 复核：GenGuard 立项 ADR-230，P2/P3 注释豁免闭环）**：`GenGuard` 4 套并存（`app-preview/gen-guard.ts` class ／ `utils/async/load-guard.ts` factory ／ `perf-common.ts|makeGenGuard` ／ `app-tree/bus-handlers.ts|atBeGenGuard`）——app-tree 侧实为 4 文件 **11 处** raw `_gen` 代际比较（另有 4 处自增、7 处捕获；原记「仅 3 处」低估），收敛面大宜先立 ADR（✅ 已立项 [ADR-230] 且**已实施**：`load-guard.ts` 补 `current` getter 为全仓唯一出口；`GenGuard` class 与 `makeGenGuard` 下线（`gen-guard.ts`/`gen-guard.test.ts` 删除，测试并入 `load-guard.test.ts`）；app-tree / app-sync-manager 两处 raw `_gen` 与 diagnostics 第 5/6 套裸 seq 一并收编——实施时核实扩面至 6 套，见 ADR-230 背景节）；`conflicts.ts`/`health.ts` 模块级 busy 锁（有 try/finally 故不卡死，仅范式不齐——✅ 复核 `diagScanning`/`diagSyncBusy`/`_healthBusy` 均为无跨调用配置状态的纯并发守卫，模块级锁够用；源码已加「范式豁免」注释钉死理由）；`workshop-tabs.ts|_showSiteView` 注入点（✅ 复核：`initWorkshopPage` 每次调用覆盖，旧闭包无实际泄漏；源码已加「保留不 reset」注释）；app-tree 三处 5s 节流器与 `_tsBadgeStylesInjected`（时间衰减/幂等，豁免合理）。
  - 守卫：views 全量 **81 文件 1117 用例全绿**（较审核前 1104 → 1117，净 +13 = 新增 17 − 删重复 4）+ `vite build` + `typecheck` + `check-biome --files` 显式点名全通过；`check-deadcode-baseline` ERROR 0（该条目被记为 `[已清理]` **INFO**——注意脚本写盘条件是 `blocking===0 && absorbable>0`，本身不会自动摘除，陈旧项需下次收编或手工删行）。

- ✅ **刀⑯ preview-3d 写法收口：真 bug 修复 + 样式注入机制归一 + 复杂度/命名收敛**（2026-09-13，三提交 `82e1a6808` / `9c4346fd5` / `2b62705f3`；范围限 `frontend/src/preview-3d`；写法评审结论 = **不重写，仅收小切口**）：
  - **P1 真 bug：KTX2 取消致排队任务永久挂起 + `inProgressHashes` 毒化**（`decoder/mmd-ktx2-encoder.ts`）：旧 `acquire()` 无 reject 路径，`cancelPendingEncodings()` 清空 `waitingQueue` 后排队中的 `await acquire()` 永不应答 → `encodeAndCacheTexture` 卡在 await（既不进 `.then` 也不进 `.catch`）→ `inProgressHashes.delete` 永不执行 → 该 hash 永久毒化、同纹理永不重编码。修复：`WaitingTask` 补 `reject`，取消时 `reject(new EncodeCancelledError())`；catch 静默退出并 `finally` 内 `release?.()` 释放。⚠️ **子代理原诊断「`activeCount` 泄漏」不成立**（任务从未执行故无自增），真后果是 hash 去重集毒化——已纠偏。新增回归用例锁「取消后同 hash 可重编码」（修复前卡 3 次调用，修复后 4 次）。
  - **P2：litematic 漏注册样式 reset 钩子**（`adapters/litematic-adapter.ts`）：七处模块级样式注入样板中唯一缺 `onOverlayStyleTargetReset` 注册者 → ADR-175 M1 二次挂载（shadow root 重建）后截断警告条 CSS 不重注。
  - **P2：幂等样式注入收敛为 `installOnceStyles(key, css)`**（`infra/overlay-style-bridge.ts` 新增 helper + 8 处消费方，含 `preview-shell.ts`）：内部模块级 `Set` 幂等 + 统一注册 reset 清零；消费方删掉 `_xStylesInjected` 旗标、手写 `createElement("style")` 与重复 reset 注册（`menu/{core,cap-controls,roles-views,render}.ts`、`adapters/{vrm-bone-ui,litematic-adapter,preview-shell}.ts`）。`fab.ts` **豁免**（per-FAB id 去重 + `document.head` SSR 守卫，机制不同）。收敛后 preview-3d 手写样式注入彻底清零，机制归一为**三套且全部 canonical**：`installOnceStyles`（overlay shadow root，随 reset 清零重注）/ `createInstallableStyles`（`document.head` + `CSSStyleSheet` 供 `adoptedStyleSheets`）/ `fab.ts`（豁免）。
  - **P3：`Stage3Ktx2Hydrate` 内层替换闭包提取**（`adapters/mmd-build-scene.ts`）：per-hash 的 ~30 行嵌套 Promise 提为模块级 `replaceHashSlots(c, hash, slots, getCachedTextureByHash)` + `MatTexSlotRef` 类型（key 取 `(typeof DISPOSE_TEX_KEYS)[number]`，与 `as const` 源精确对齐）。**认知复杂度 82 → 66（↓约 20%）**，新函数未进 RED 名单；语义逐字等价（含 `biome-ignore` 理由注释、链恒 resolve 供外层 `Promise.all` + `replaced=` 计数）。
  - **P3：魔法数字常量化**：`spec-builder.ts|parseBedrockGeometry` 的 `65536` → `MAX_TEX_DIM`（对齐 Go `geometry/parse.go clampTexSize` 归 0 哨兵语义，注释同步）；`mmd-pmx-parser.ts` 的 `0x01` → `export const PMX_MAT_FLAG_DOUBLE_SIDE`（PMX 2.0 DrawFlag bit0 双面绘制，判位改显式 `!== 0`），测试 fixture 同步改引常量（单一事实源，规范位不再在测试里退化为字面量）。
  - **未动（判领域本质，勿为降圈复杂度而拆）**：`parseBedrockGeometry`（认知 129）、`buildPmxScene`（125）等 25 个 RED 函数均为解析/构建多段循环 + 对齐 Go 契约的畸形输入防护，分段注释清晰、hash 聚槽去重等写法已优——拆只会转移复杂度并增 interface 噪音。
  - **兄弟会话锐评的驳回项（供下次评审免重扫）**：`index.ts` barrel 出口**违反 ADR-146 神桶红线**（禁 `@/dir` / `@/dir/index` 入口，R6 门禁）；`decoder/cache.ts` FIFO 已有显式注释（L28）且被 `cache.test.ts:50` 锁死，非「与 texture-cache 不一致」；`texture-loader.ts` 50ms 轮询已带 15s 超时兜底（P2 修复），「慢网 +50~100ms」诊断不成立且事件化改造会破坏 `acquire` 同步返回 Texture 的契约；`migrateEnvState` 非死代码——`fog-capability.ts:213` / `ground-capability.ts:419` 记录「空透传 → 升级用户自定义设置静默回默认」，删除会掩盖该待补迁移需求。
  - 守卫：biome 增量（`--files` 显名）**0 新增违规**；`vite build` + `tsc --noEmit` 通过；编码器 **25 用例**（含新增回归）+ adapters 全量 / `spec-builder` / `cube-mesh` / `model3d-loader` **728 用例**全绿。

- ✅ **刀⑰ preview-3d 可读性收口 + 一处真缺陷（观测性静默）**（2026-09，用户点题「优化代码本身的可读性，必要时看看测试是否完善」；承接刀⑯ 的「不重写、只收小切口」结论，本轮只做**可读性 / 断言诚实性 / 可观测性**三类，不改架构）：
  - **可读性①：`cap-controls.ts|capControlToView` 删除 `as unknown as` 双断言**。原实现 `return c as unknown as CapControlView`，但 JSDoc 自称「结构化满足，零拷贝适配」——**注释与断言互相矛盾**（若真需双断言，就证明不是结构满足）。实测删除断言后 `tsc --noEmit` **零报错**，证明它从未承担任何职责、纯属噪音，且双断言会**关闭编译期校验**（日后 `CapControlView` 加字段即静默漂移）。刀⑯ 扫的是字面 `as any` 故漏网。**教训：`as unknown as` 是 `as any` 的孪生形式，专项扫描须同时覆盖两种写法**。
  - **可读性②：`switch-preview.ts|unregisterSwitchPrevious` 改显式传 `prevId`**。原函数自查 `sceneRegistry.getActiveId()`，与调用方上方 `prevEntry` 的取法**各自查表**。子代理据此报 P1「多 entry 下会错杀、注销错对象」——**经核实为误报**：`activeId` 只在 `register`/`setActive`/`unregister` 三处变更，两处取值之间只跑了 `pushSwitchHistory`（不碰 `activeId`），故两处**恒等**。但「恒等」是隐式契约，现改为调用方取一次 id 显式传入，把等价关系固化为编译期事实（同时消掉恒未使用的 `_ctx` 形参）。**教训：子代理见「捕获后未使用 + 二次查表」即报缺陷，须先验证两次取值是否真会分叉**。
  - **可观测性③（真缺陷）：`render-host.ts|removePerFrame` 失配静默**。原实现 `if (idx >= 0) splice`——按**引用相等**移除，一旦调用方注册 `bound` 闭包、注销时传原型方法即 `indexOf` 恒 -1，回调**永久驻留** `_perFrames`，rAF 每帧驱动已 dispose 的内容层，且**完全无信号**（外层的 `if` 让漏移除看起来像正常 no-op）。现补节流告警留痕（仅在「列表非空却没找到」时告警——列表空是合法 no-op，防刷屏）。
  - **可观测性④（连带发现的真缺陷）：告警节流初值 `0` 吞掉首条告警**。③ 的新告警用 `performance.now()` 与初值 `0` 比较，节流窗 5000ms——但**页面/测试早期 `performance.now()` 本身仅 ~830ms**，`now - 0 > 5000` 为假 ⇒ **首条告警被静默吞掉**。改为 `null`（语义「从未告警过」）后首条恒放行。**同一缺陷在既有的 `_lastPerFrameWarnTs`（首帧卡顿告警）上同样存在**，一并修复；且两者原共用同一时间戳槽位会**互相吞掉对方的告警**，已拆为独立字段。**教训：节流哨兵用 `0` 而非 `null` 是「首条静默」的系统性陷阱，而首个卡顿帧恰是最该被看见的**。`reset()` 同步复位两时间戳（原注释自称「重置全部循环状态」却漏了它们）。
  - **可读性⑤：`collectVisiblePredicates` 补「禁删」说明**。子代理报其为「生产死代码，建议删除」。**核实后否决**：它是 ADR-128 §5「死穴二」的 cap 级对偶锚点，与 `menu-graph.ts|collectNodePredicates`（节点级）严格区分，是「cap 控件条件显隐」的唯一集中枚举入口，由 `preview-state.test.ts` 作契约测试消费。删除会摧毁该治理能力。已加显式「请勿以孤儿导出为由删除」注释。**教训：无生产调用方 ≠ 死代码，契约锚点须先查 ADR 交点再判**。
  - **测试补全（6 新用例，均经反向验证）**：`mount-preview-core.test.ts` +1（包装 `document.add/removeEventListener` **直数监听器存活数**，锁 escH 解绑契约；反向验证：摘掉两处解绑 → `expected 1 to be +0` 失败）；`render-loop.test.ts` +5（失配告警 4 例 + early-clock 回归 1 例；反向验证：还原 `0` 哨兵 → 3 例失败）。⚠️ **首版写法被自己推翻**：初版只断言「再按一次 ESC 不抛错」——**反向验证时发现旧代码同样通过**（陈旧 handler 只是空转），遂改为直数监听器。**教训：回归测试必须做反向验证（还原缺陷看是否报红），否则可能写出一条永绿的空测试**。
  - **本轮核实为误报/无需改动的项（供下次免重扫）**：`removePerFrame` 的「`?.` 提取 `content.update` 丢 `this` 绑定」指控**不成立**——`setPerFrame` 存取同一引用，全仓无 `.bind` 包装，配对恒成立（真正的风险只是「未来有人这么写」，故以告警兜底而非重构）；`teardown("failed")` 漏解绑 escH 属**责任错配而非现实泄漏**（调用方 `recoverMountFailure` 确实补了，反向验证证明），仍按「三档收敛到单一出口」归位到共用区并删除调用方补丁；`_envCapUnsubs` 模块级共享缺 owner 守卫属潜在风险非活 bug（`mountPreviewRootMenu` 实际单例）；`core.ts` tap-restore 分支缺 `menu.onShow()` 致 `_prevFocus` 未重置属焦点语义瑕疵，未在本轮范围。
   - 守卫：`tsc --noEmit` ✅ / `vite build` ✅ / biome 增量（`--files` 显名）✅ / **全前端 378 文件 5789 用例全绿**（preview-3d 2243 → **2249**）/ `check-layering`・`check-circular`・`check-path-hygiene`・`check-type-safety`（生产侵蚀 0）・`check-redlines` 全通过。

- ✅ **刀⑱ preview-3d a11y / 一致性双收口**（2026-09，承接刀⑰「写法收口」结论；用户点题「改进吧」，范围限 `frontend/src/preview-3d`）：
  - **a11y① tap-restore 焦点恢复一致性**（`menu/core.ts:bindPreviewTapToggle`）：刀⑰ 已点名「`_prevFocus` 未重置属焦点语义瑕疵，未在本轮范围」——现修复。早期 else 分支手搓 `pushInputBlock` 绕过 `slide-menu.onShow()`，`_prevFocus` 未被重新武装，后续 ✕/ESC 关闭时焦点无法恢复给触发元素。现统一走 `menu.onShow()`，onShow/onHide/push/pop 严格配对 + 焦点记忆重新武装。补契约测试锁定「dock 触发 → tap 隐藏 → tap 恢复 → 关闭 → 焦点归还 dock」。反向验证：还原旧写法 → 焦点断言失败（首版只断言「再按 ESC 不抛错」——反向验证发现旧代码同样通过，推倒重写为直数监听器 + 焦点断言）。
  - **一致性② 裸 console.warn 改走 ringLog 双轨**（AGENTS.md 铁律「日志往环形日志面板塞，不盯 console」）：`preview-state.ts` 2 处（订阅回调异常 / setStateValue 失败）+ `env-dispatcher.ts` 1 处（回调异常）改走 `ringLog(mod, msg, "warn", () => console.warn(...))` 双轨，与 `shader-patches/patch-guard.ts` 既有范式对齐。
  - **一致性③ `_envCapUnsubs` per-mount 隔离**（`menu/env.ts`）：刀⑰ 已点名「模块级共享缺 owner 守卫属潜在风险非活 bug」——现修复。改 `WeakMap<SlideMenuHandle, Array<() => void>>` 按 menu 句柄隔离，`disposeEnvSubscriptions` 同步改接收 menu 参数（对齐同文件 `coreSchemaOwners`/`customCleanups` 的 per-mount 注入范式）。`env.test.ts` 同步适配（`afterEach` 遍历清理所有测试创建的 menu 句柄）。
  - **被驳回项（本轮核实为误报/无需改）**：`removePerFrame`「`?.` 丢 `this` 绑定」——刀⑰ 已核验恒配对；`collectVisiblePredicates` 死代码——刀⑰ 已补禁删注释；`core.ts` tap-restore 焦点瑕疵——本轮已修。
  - 守卫：`tsc --noEmit` ✅ / `vite build` ✅ / biome 增量 ✅ / 全前端 378 文件 5790 用例全绿 / 治理门禁全通过。

- ✅ **刀⑲ 设计令牌守规度量 + 收债**（2026-09，用户点题「尝试完善设计类检查脚本」→「继续」；**首次把「设计规范是否被执行」变成机器信号**）：
  - **背景（刀①–⑱ 的整体盲区）**：18 刀全在雕 a11y / 3D 性能 / 写法一致性，而 `docs/UI-Design.md`（918 行，自称唯一 UI 规范）明文禁止的「硬编码 font-size / border-radius / 颜色」**从未被任何脚本守护**。原因具体：a11y 是子代理标准清单项，而「令牌失守」要**跨文件横向统计**才看得见，不在任何单点审查视野里。实测：`var(--fs-*)` 325 处（合规）与硬编码 222 处（违规）**并存**——不是没体系，是「体系与野路子并存」，比没规范更危险（切主题/调 `--fs-scale` 时部分跟随部分不跟随）。
  - **新增 `scripts/check-design-tokens.ts` + `_lib/design-tokens.ts`**（纯函数判定层，零 IO，9 组契约测试锁定）：查硬编码字号/圆角/颜色（内联 + CSS 块**同口径**）+ emoji 当图标。特色 = **带令牌建议**（`13px`→`var(--fs-md)`），仅在值与令牌基准 px **精确相等**时给出（宁可不说，不给错答案）。`--docs` 另查 UI-Design.md 数值与代码一致——实测查出 `--preview-width` **文档内自相矛盾**（布局图 240px / CSS 示例 200px）而代码实为 220px，**三处三个数**。
  - **未自造规则（关键纠正）**：初版设计了 `inline-style-other` 把「一切内联 style」判违规，查规范后**否决**——UI-Design.md 只在「艺术字体」场景禁内联，并未全仓禁。把 `style="display:flex"` 判成债会用噪声淹没真信号。同理中性色（`#fff`/`rgba(0,0,0,.5)` 遮罩）豁免，但近白 `#fefefe` 仍报（防豁免被滥用成漏检后门）。
  - **--fix 自动收债（53 处 / 47 文件）**：只做**机械等价替换**（`--fs-scale: 0px` 时 `var(--fs-md)` 即 13px，视觉零变化，附加收益=跟随无障碍缩放）。**颜色有意不自动替换**——`#ff7b7b` 到底该映射哪个语义令牌，机器判不了，猜测即给错答案。安全边界：跳过 `var()` fallback 内的值（`var(--x,11px)` 本就是令牌形态）、注释行、幂等（重跑零改动）。
  - **自查抓出的 5 个真缺陷（全部由探针实测，非推理）**：① emoji **整类漏报**——正则要求「引号后紧跟 emoji」，而本仓真实写法是 `>📁 ' +`（emoji 后带空格），仓库最常见的图标写法恰好全漏；② `♻️` 被截成裸 `♻`（变体选择符 U+FE0F 写进 `+` 字符类；biome `noMisleadingCharacterClass` 独立佐证）；③ 颜色违规**全被吞**（`COLOR_PROP` 是非捕获组，颜色值是第 1 组，误读 `cm[2]` 恒 undefined）；④ 配色盲区——内联颜色报、CSS 块隐形，判定随写法位置漂移；⑤ **`walk()` 默认跳过任何名为 `css` 的目录**，而样式常量恰住在 `views/app-content/css/`——整目录 8 文件漏扫，报告数字系统性偏低、`--fix` 对该目录完全失效。⑤ 已补回归测试锁死。
  - **结果**：硬编码字号/圆角 **275 → 36**（-87%）；剩余 440 处（emoji 331 / 颜色 41 / 无对应令牌的字号圆角 68）。**已接 pre-commit 硬阻断③**（`--baseline` 只拦新增，存量记入 `scripts/baseline/design-tokens-baseline.json` 428 条；逃生键 `YSM_SKIP_DESIGN_TOKENS=1` 独立解耦、命中留痕）。端到端验证：拦新增 ✅ / 放存量 ✅ / 逃生 ✅ / 基线缺失 fail-closed ✅。
  - **未清项需人工**：剩余 68 处字号圆角无对应令牌（`9px`/`8px`/`32px`/`48px` 等），需设计决策——是新增令牌还是接受一次性值；颜色 41 处需人工判语义令牌。
  - 守卫：9 组契约测试绿 / `tsc --noEmit` ✅ / `vite build` ✅ / **全前端 380 文件 5812 用例全绿**（替换后零回归）/ `check-script-hygiene --strict` 0 warn / `check-readme-index` ✅。

- ✅ **刀⑳ UI 图标规范与命名体系（ADR-238）**（2026-09，用户点题「设计图标规范或命名体系吧」；**331 处 emoji 债从「计数器」变成「可机械收敛清单」**）：
  - **勘查先于设计**：实测 331 处 / **101 个不同字形** / 51 文件（热点 `tpl-settings.ts` 54、`detail-3d.ts` 32、`app-content/tpl.ts` 26）。关键发现——仓库**已有**一套正确的 SVG 体系（`utils/icon/workshop-icons.ts` 17 图标，约定 `.ws-icon { width:1em; height:1em; fill:none; stroke:currentColor }`），只是**覆盖面止于创作者/平台徽标域**，UI chrome（按钮/标签/状态）无图标可用 → 开发者顺手写 emoji。**故本刀不是「建体系」，是「补上缺的那一半 + 复用既有样式」**，避免造出第二套漂移源。
  - **数据图标 vs UI chrome 的分界（最易犯的越层错）**：`resource_types.json` 的 `icon`/`groupIcon` 经 `typeIconOf()`/`fileIcon()` 消费，属 Go/JSON 驱动的**数据**（根 AGENTS.md 红线「前端只读不判」）——**改它即跨层重判归属**。判定口径可靠：**扫描只报字面量 emoji**，`typeIconOf(X)` 调用点不含字形字面量，天然不命中。曾误以为注册表图标集（🎨💎🧸…）的 56 处重合是数据图标，实测那些是**硬编码在模板里的 UI 字形恰好同形**（`>🎨 ${t(...)}` 是设置页标签），仍属 UI chrome。
  - **命名体系（ADR-238 D2，最易错处）**：**语义名，非外观名**。`warning` 而非 `triangle`/`emoji-warning`——外观名把「实现」写进「调用点」，将来 ⚠️ 换成圆形感叹号要全局改名。已写**外观词黑名单断言**（triangle/circle/arrow/emoji/glyph…）进契约测试防退化。
  - **交付**：`frontend/src/utils/icon/ui-icons.ts`（**97 个 SVG 图标**，全部经 `svg()` 包装 = `ws-icon` + 24×24 统一） + `scripts/_lib/icon-map.ts`（103 条字形→语义名映射，零依赖供扫描器/测试共享）。两者 **97↔97 双向对拍**（映射表建议了不存在的名 = 比不建议更糟，AI 会照写然后编译不过；实现有而映射表无 = 白写接不上扫描器）。
  - **扫描器接线（D4）**：emoji 命中附语义名建议，实测**覆盖率 100%（331/331）**，债从「一堆字形」变成「按名字可机械收敛」。Top：`warning` 18 / `error` 18 / `appearance` 16 / `search` 14 / `clipboard` 14。
  - **端到端验证（不只看测试绿）**：迁移 `app-content/tpl.ts` 20 处，**实渲染产物确认 4 个 `<svg class="ws-icon">` + 0 emoji**；emoji 债 331→314；基线 428→411。
  - **⚠️ 迁移工具踩的两个坑（都险些提交坏 UI，且测试全绿）**：
    ① **单引号串内 `${}` 不插值**——emoji 图标位大量在 `'<button ...>📁 ' +` 形态里，无脑写 `${UI_ICONS.folder}` 后渲染产物**字面输出 `${UI_ICONS.folder}`**。三重假绿：测试只断言 testid/文案不看图标 ✅、emoji 确实消失 ✅、扫描器报无残留 ✅——**靠 vite-node 实渲染产物才抓到**。正解按引号上下文分派：模板串 `` ` `` → `${x}`，单引号 → `' + x + '`，双引号 → `" + x + "`。
    ② **属性值内的 emoji 不能替换**——`placeholder="🔍 搜索"` 是**纯文本**，插 SVG 会被字面渲染成 `<svg class=...` 垃圾且截断属性引号。已加属性上下文排除；这类位置需人工决策（去掉 emoji 或改 CSS 背景图）。
  - **未清项**：emoji 310 处（长尾字形与属性内字号待人工）；`app-content/tpl.ts` 剩 3 处是 placeholder 内的、需人工决策。
  - 守卫：`test_ui_icons.ts` 5 组断言绿 / `test_design_tokens.ts` 10 组绿 / `tsc --noEmit` ✅ / `vite build` ✅ / biome `--write` ✅ / **全前端 380 文件 5812 用例全绿** / pre-commit 基线闸绿（411/411）。

- ✅ **刀㉑ 图标迁移全仓铺开：emoji 331 → 127 → 25 可映射（-92%）**（2026-09，承接刀⑳）：
  - **第二轮收尾**：首轮漏迁的 `tpl-settings.ts` 等（因早期 `git checkout -- frontend/` 回退后迁移器被误删、清单未重生）补迁 27 文件 / 116 处；基线 **228 → 129**。剩余 42 文件 / 134 处，其中**仅 25 处仍有精确 SVG 令牌对应**（19%），其余是属性值内 emoji（placeholder/title）、纯装饰字形、或 `📁`+数字这类拼接形态（不属图标位）。
  - **⚠️ 本轮暴露的核心教训：机器迁移的难点不在「替换」，在「判断哪些位置不该替换」——而后者靠黑名单永远做不对。**
    1. **纯文本槽位不能放 SVG 标记**：`el.textContent = \`${UI_ICONS.warning} ...\`` 会把 SVG 当字符串赋给 textContent，用户看到字面 `<svg class="ws-icon"...>` 乱码；toast 同理（`app-toast` 用 `${esc(msg)}` 转义注入）。**黑名单枚举文本槽位三轮都收敛不了**——`textContent`/`SetTitle` → 漏 `msg:` → 补 `onShowToast()` 实参又漏；**正解 = 正向判据**：只有「该行确实在拼 HTML」（行内有 `<tag`/`</tag`/innerHTML 赋值）才保留 SVG。枚举无穷多文本槽位不可能穷尽，而「在拼 HTML」有可靠特征。
    2. **i18n 语言包整体不能迁移**：`locales/{zh-CN,en,ja}.ts` 三个文件被误改 310 行/个——**翻译值是文案正文不是图标位**，且 UI_ICONS 在那里根本 import 不到（tsc TS2304）。已整文件回退。
    3. **多行 import 语句的插入位置**：按「最后一行以 import 开头」插入会把新 import **劈进多行 import 语句中间**（`import {\n A,\n B,\n} from "..."` 的续行不以 import 开头）→ 4 文件语法错误 TS1003/TS1109。正解：定位 import **块整体结束**处（吃到该语句闭合）。
    4. **闭合标签前的 emoji 形态**（`>⚠️</div>`，无尾随空格）首轮判据要求「后接空白」会整类漏掉——补「后接 `</` 闭合标签」分支。
    5. **`not.toContain("<svg")` 类断言被图标化污染**：perf 趋势折线测试用「无 `<svg>`」表达「无折线」，图标全变 SVG 后该断言恒假。改为针对**折线特征**（`<polyline`）判定——**断言要锁语义特征而非「某种标签的存在」**。
  - **测试断言更新的原则**：只改**形态**不改**意图**。`expect(html).toContain("⬇️ 2")` → `expect(html).toMatch(/gh-model-badge-missing"[^>]*><svg class="ws-icon"[\s\S]*?<\/svg>\s*2/)`——断言「该徽章内是 SVG 且紧跟数字 2」，比「包含任意 svg」严（后者会放过「徽章换错图标」的真回归），又比写死某条 path 稳（图标库改路径不该弄红测试）。共更新 ~18 处断言，全部保留原有的 testid/文案/转义断言。
  - **⚠️ 测试定位陷阱（第二轮新增）**：`loadModel2D` 内部以同名局部 `container` 承载内容（line 55 `const container = document.createElement("div")` 遮蔽了传入的 `skelContainer`），测试传入的 `container` 是其**外层**；故断言按钮须经 `.sk-loading-box` **嵌套定位**（直接 `container.querySelectorAll("button")` 命中不到，返回 0）——这不是迁移 bug，是既有测试定位失误，迁移只是让「靠 emoji 全文匹配」的脆弱断言暴露。
  - **方法论收获**：**「测试全绿」在结构性重构中几乎不是有效信号**——本轮 3 类真 bug（字面占位符、textContent 乱码、多行 import 劈裂）在单测层面全绿，全部靠**实渲染产物**（`vite-node` 打印 `<svg class="ws-icon">` 计数）与 **`tsc`** 才抓到。故验收标准定为：实渲染产物 + typecheck + 全量测试三条同时成立。
  - 守卫：`tsc --noEmit` ✅ / `vite build` ✅ / biome `--write` ✅ / **全前端 380 文件 5820 用例全绿** / pre-commit 基线闸 129/129。

- ✅ **刀㉒ 图标「裸奔」修复：`.ws-icon` 尺寸规则跨 Shadow 覆盖面**（2026-09，承接刀㉑）：
  - **症状**：换完 SVG 后 `.pv-tab` 等按钮图标变得巨大——不是图标错，是**尺寸规则没生效**。
  - **根因**：`CSS 规则不穿透 Shadow DOM 边界`（只有 `var()` 自定义属性能）。`.ws-icon{width:1em}` 当时只定义在 `app-content` 的 CSS 里，**而这恰好是 13 个渲染 UI_ICONS 的 shadow 根中唯一带该规则的一个**——其余 12 个（app-preview / app-sidebar / app-tree / app-nav…）拿不到规则 ⇒ SVG 退回 viewBox 默认 24×24 ⇒ 在 12px 按钮里显成巨块。光 DOM 组件（app-sync-manager / dialog）则因全局 `components.css` 也没这条规则，同样中招。
  - **修法**：`.ws-icon` 规则上收到 `@/utils/dom/css.ts|wsIconCSS` 作为**单一出处**，各 shadow 根在其组件 CSS 串里插值引入；同时**全局 `css/components.css` 保留一份副本**覆盖光 DOM 组件（两份刻意双写，注释互指，非漂移）。
  - **⚠️ 最值得记的一条：我第一版守卫测试是「假绿」**——它只查「文件里出现 `wsIconCSS` 字样」，而 `import` 语句里也有该字样，**删掉插值 `${wsIconCSS}` 后测试照样通过**。改成要求「CSS 串本体内含 `.ws-icon{` 或 `${wsIconCSS}` 插值」才真正拦得住。**写完守卫必须故意破坏一次验证它会红**，否则等于没写。
  - **顺带修**：`app-toast` 3 处 `msg:` 文本槽误用 UI_ICONS（toast 走 `esc()` 转义，会显示字面 `<svg>`）→ 还原 emoji；其 close 按钮图标在 inline `<style>` 的 shadow 里，同样需插值 `wsIconCSS`。
  - 守卫：`tests/test_ui_icons.ts` 新增第 5 组「尺寸规则覆盖面」——断言 5 个 shadow 组件 + 全局副本均带 `.ws-icon{width:1em}`，且已实测「故意移除即红」。
  - **⚠️ 2026-09-16 补漏（本刀当时数错了）**：漏带的不是 12 个而是 **13 个**——第 13 个是 3D overlay（`preview-3d`），它连上面这条守卫都没进：判据要 `export const xCSS`（它是 `componentsCss`，小写 Css），且样式主要走 `installOnceStyles` 内联串。后果也不同：不是「24×24 巨块」而是**图标 0×0 彻底不可见**（`.slide-icon` 是 flex 容器，无 `width:1em` 的 SVG 自动尺寸为 0；实测 computed `fill=rgb(0,0,0)` / `stroke=none` / `box=0x0`）。
    修法：`componentsCss` 插值 `${wsIconCSS}`（overlay 已在 adopt 本串）；守卫 `shadowDirs` 纳入 `preview-3d` 并放宽导出名判据到 `\w+(?:CSS|Css)`。

- ✅ **刀㉓ 图标与 i18n 分界收口：i18n 值剥离结构，模板层拼 `UI_ICONS`**（2026-09，承接刀㉒）：
  - **原则（与 i18n 完全同构）**：`t("key")` → 纯文本 → 放 text node；`UI_ICONS.x` → SVG 结构 → 放 HTML。
    i18n 值里不应含任何标记，正如翻译文件里不应硬编码 `<b>`——「结构在代码，内容在 i18n」。
  - **症状**：`content.webSearchTerms` 等 8 键的 i18n 值含 emoji 前缀（如 `"🔍 网页搜索词"`），
    且**同一 key 既投 HTML 又投 `title=` 属性**（模式切换按钮），标题里跟着 emoji 对无障碍不友好。
  - **修法**：三个语言包剥离 8 键 emoji 前缀；模板层（`site/render.ts` / `tpl.ts` /
    `workshop-tabs.ts`）在渲染处补 `UI_ICONS.x + " "` 前缀。`title=` 属性自动退化为纯文本（顺带改进）。
    缺的图标名（`window` / `edit`）补进 `ui-icons.ts`（99 → 101 名），字形映射补
    `scripts/_lib/icon-map.ts`（103 → 110 条）。
  - **分类边界（刻意不动，最易误伤）**：`workshop.action.exported/imported` 等 toast
    `msg:` 是**文本槽**（`esc()` 转义注入）——SVG 标记进去会显示成字面 `<svg>` 乱码，
    必须留 emoji。判定口诀：`textContent` / `msg:` / `SetTitle` 是文本槽；innerHTML /
    模板字符串拼 HTML 是结构槽。
  - **测试同步**：`app-content.methods.test.ts` 的 mock HTML 从手写字面 SVG 改为插值
    真实 `UI_ICONS`——防「mock 里的图标」与实现漂移（手写副本必然腐烂）。


- ✅ **刀㉔ 令牌闸的「覆盖面」审计：三处静默失明**（2026-09，用户点题「一直留在基线不是个好办法」→「尝试执行」）：
  - **转折点**：上一轮把 transition 债往基线里塞时意识到——**基线是「存量冻结」，不是「问题解决」**。
    真要解决得让闸**看得见**这类问题。于是转去审计闸本身的覆盖面，一查发现三处静默失明
    （都能报 ≠ 都扫 ≠ 都到得了判定函数）：
    - **① 扫描范围**：闸只 `walk(frontend/src, exts:['.ts'])`，`frontend/css/*.css`（5 个手写样式表）
      **从未被任何闸看过**，实测藏 59 条（`components.css` 单文件 49）。
    - **② 预筛关键词表陈旧（最严重）**：逐行扫描前有快速预筛（不含关键词即 skip，省 95%+ 正则），
      该表写于 box-shadow/transition 加入判定层**之前**、此后从未补。后果：`transition: opacity .4s` /
      `transition: top .15s ease` / 单独 `box-shadow:` 在预筛即被跳过，**永远到不了判定函数**。
      补两词后立刻浮出 2 处长期漏报（`variables.css` 的 `.skip-link` 等）。
    - **③ 属性名左边界**：`propValueRe` 缺 `(?<![\w-])`，`--uih-collapsible-panel-transition:`
      这类**自定义属性定义**被误当 transition 声明（假阳性长期挂在基线里，与 `propDeclRe` 同源的坑）。
  - **⚠️ 为什么这类漏检极难察觉**：命中的那些**恰好**同行含 `color`/`background`（如 `.cr-avatar-ring`
    同行有 `border-radius:50%`），于是报告看起来「正常工作」；漏掉的是**单独成行**的干净写法。
    **教训：闸能「报什么」（判定种类）/「扫哪里」（扫描范围）/「先过滤什么」（预筛）三层都可漏，
    且漏了不报错**。审计手法 = 用闸自己的纯函数去跑「理论上该覆盖但不在域内」的文件，对账差集。
  - **transition 判定反转**：原口径「时长与某 `--tr-*` 相等才报」只抓得住「差一点就对了」的写法，
    `.1s/.2s/.3s/.4s` 这类不撞任何令牌的硬编码时长**全部隐形**（盲区 11 处声明点）。
    改为**除豁免外一律报**。豁免三条：① 跟手/进度条（几何属性 + `linear` + **严格 <0.1s**——
    故进度条取 `0.06s` 而非 `0.1s`，`0.1s` 不满足上界）② 自定义缓动 `cubic-bezier()`/`steps()`
    （令牌三档均 `ease`/`ease-out`，无法表达回弹，报即把设计意图当债）③ `tr-exempt` 注释标记
    （§7「说明为何非它不可」的机器可读出口，须**同行**——判定层是逐行纯函数）。
  - **建议值必须与 `--fix` 同口径**：改用 `suggestTransitionTokenExact`（时长 + 缓动**双匹配**）。
    否则出现「报告说建议 `--tr-enter`、`--fix` 却不改」的自相矛盾（`transform .25s` 缓动为隐式
    `ease` ≠ `ease-out`）。给不出**安全**建议则为 null，报告仍保留供人工归位/加档/标记。
  - **`splitTopLevelCommas`**：CSS 函数参数含逗号——朴素 `split(",")` 会把
    `cubic-bezier(.34,1.56,.64,1)` 切成 4 段，致**自定义缓动豁免失效**（实测 `content-layout`
    的 `.num` bump 因此被误报）。判定必须按顶层逗号（括号深度 0）切分。
  - **结果**：`css-transition` 归零（全部令牌化 / 豁免 / 标记）；三处探针端到端验证闸能拦
    （文档层硬编码字号 / 不撞令牌的时长 / 单独 box-shadow 各 +1 → 「新增违规: 3」）。
    基线 119 → 177（+59 为文档层 CSS 首次纳入，其余为清理后的净值）。
  - **新增 3 组契约锁**：判定反转 + 豁免矩阵 / **预筛关键词同步锁**（双向对应：判定层能报的每个
    属性，预筛源码必须列它——防同类失明复发）/ 左边界与顶层逗号切分。共 20 组全绿，
    全前端 3499 用例零回归。
  - **未清项**：基线 177 条中 54 条有精确令牌对应（`--fix` 可机械收敛，多为文档层 CSS 的字号），
    需决策是否批量收债。


- ✅ **刀㉕ ADR-238 边界补全：符号字形算不算「UI 图标」**（2026-09，菜单勘察时撞上）：
  - **撞上的问题**：`slide-menu.ts` 用字面 `✕`/`←` 当图标，而「emoji 债 = 1」没覆盖它。
    查证是**两套口径都够不着**：① emoji 闸只认 emoji 码位（`1E300-1FAFF`/`2600-27BF`/`2B00-2BFF`），
    `←`(U+2190)/`⟲`/`◀`/`▶` 都在其外；② 即便在集内（`✕` U+2715 ✓），闸还有**位置口径**
    「只报标签内容起始处」→ `textContent = "✕"` 与 CSS `content:"✕"` 都不算 → 仍逃逸。
  - **真问题不是漏检，是规范边界模糊**：ADR-238 D1 字面写「UI 图标**一律**走 SVG」，按其字面**覆盖**符号；
    但该 ADR 的立论证据全是 emoji（331 处，四条危害第一条是「emoji 自带颜色、切主题不跟随」）。
    对照符号：单色、**继承 `currentColor`** → 「不受主题控制」**不成立**、「不参与缩放」**部分不成立**（随 font-size），
    真正成立的只剩「跨平台渲染不一致」+「无法精细对齐」。**规范文字超前于其论证范围**，
    于是既没被迁、也没记为豁免——正是这几轮反复出现的「规范与实现之间缺一行明文」。
  - **处置**：ADR-238 新增 **§1.4 边界补全**（结构槽图标位属 D1 / 文本槽内符号允许保留 /
    危险字形的处理逻辑允许保留），并立纪律：**图标库缺对应语义名时记债，不得用外观近似图标硬塞**
    （用 `pointerLeft` 冒充「返回」会腐蚀 D2 语义命名）。
  - **已迁**（结构槽、且 `UI_ICONS.close` 已存在）：`download-queue.ts` 取消按钮、`tag-editor.ts` 标签删除按钮、
    `slide-menu.ts` 根级关闭（`closeIcon` 参数语义由「文本 glyph」改为「**HTML 片段**」，承载
    `textContent` → `innerHTML`）、`core.ts` 随之删掉冗余的 `closeIcon: "✕"`。
    顺带纠正 `slide-menu.ts` 的一条**过时理由**：原注释称用字面 glyph 是「不依赖 iconify 运行时」——
    `UI_ICONS` 是内联 SVG 字符串，本就不需要任何运行时；iconify 是上游 MikuMikuAR 外壳的另一条通道。
  - **留债**（按 §1.4「缺语义名不硬塞」）：
    ① `fab.ts` 的 CSS `content:` glyph 图标（`📷 ⟲ ✕ ◀ ▶`）——它是一套**自成一体的局部图标系统**
    （`.preview-ic--*` + 白名单 + `textContent` 防 XSS）。**后经核实其消费者 `createIconButton` 无生产
    调用方**（仅测试引用），故整块迁/删是独立决策，不是「换图标」；
    ② `←` 返回——无「返回」语义名，需新增 `back`；
    ③ `render.ts` 的 `'← '` 在**文本标签**里（§1.4 文本槽豁免，允许保留）。
  - **刀㉕-续：3D 菜单表 emoji 图标迁移**（2026-09，用户「继续」）：
    勘察发现**真正的 emoji 图标面不是 fab 那套 CSS 字形，而是菜单数据表里的 `icon` 字段**——
    `preview-3d` 全域实测 35 处、23 个唯一字形、**0 处已是 SVG**。它们长期逃逸 emoji 闸，因为闸的
    口径是「标签内容起始处」（`>😀` / `' + 😀`），而这里是**数据字面量** → 两者都不是。于是
    「emoji 债 = 1」与「3D 菜单满屏 emoji 图标」可以同时为真，**债在账外**。这与令牌闸的
    「预筛关键词陈旧致整类静默失明」是同一种病：**闸只看得见它被写死的那一种位置**。
    - **既有约定本就存在**：`utils/icon/resolve.ts|resolveIcon` 头部明写「菜单项 icon 字段填
      **语义名**（UI_ICONS / ICON_KIT 的 key）」，工具栏下拉（ADR-239）与右键菜单（ADR-245）
      均已按此迁完——3D 菜单表是最后一块。故本次**不新造机制，只是补上落位函数与迁移**。
    - **第 1 期已迁**：`menu/defs.ts` 的坞站组与 core 菜单项 → 语义名（复用 `model`/`globe`/
      `settings`/`character`/`video`/`hint`/`sparkle`，新增 `controls`(调参滑块) / `motion`(动作) /
      `fog`(雾) 三个语义图标 + `icon-map.ts` 对应字形映射，双向对拍 104↔104）。
    - **渲染层关键取舍**：新增 `utils/icon/resolve.ts|applyIcon(el, icon)` 作为**迁移期统一入口**
      ——命中语义名走 `innerHTML` 落位 SVG，未命中回落 `textContent` 写字形文本。
      **兜底分支不可省**：`resolveIcon` 对未知名返回 `""`，若渲染层不判命中就塞 `innerHTML`，
      未迁的表其 emoji 图标会**整片消失**（比继续显示 emoji 更糟）。全表迁完后方可删兜底。
    - **测试**：新增 `menu/defs.test.ts` 三块契约（每个 icon 是已知语义名 / 渲染为 SVG /
      回归锁「不得再出现 emoji 与符号字形」）——把口径钉在**数据层**，比逐处渲染断言更早拦住回潮；
      `core.test.ts` 另补 DOM 层断言（dock 按钮内 `svg` 存在且 textContent 为空）。
    - **剩余期次**：`menu/env.ts` 天空/天气预设族、三个适配器的菜单表；全部迁完后删 `applyIcon`
      兜底分支，并**扩展 emoji 闸口径覆盖 `icon:` 字段位置**（否则债继续隐形——但按用户偏好，
      该口径扩展与迁移同批做，不单留基线）。
    - **第 2 期（口径纠偏 + 结构槽收口）**：
      - **原计划作废**：原定「迁 `menu/env.ts` 的 5 个预设图标」**是错的**——那 5 个 `icon` 不是结构槽，
        而是被拼进 `label` 喂给 `<select>` 的 `<option>`，而 `renderCapSelect` 用 `o.textContent`
        落位、`<option>` 的内容模型**只能是文本**。迁 SVG 只会让下拉里显示一屏 `<svg…>` 字面量。
        按 §1.4「文本槽内符号允许保留」**豁免**（就地注释 + 契约测试豁免清单自检）。
        **教训：按字段名（`icon:`）启发式收集会过度收集——必须按「渲染槽」判定**，
        这正是 §1.4 存在的意义，也说明该边界写得及时。
      - **结构槽余量比预想大**：我最初的扫描**限定在 `preview-3d/` 目录**，于是漏掉
        `views/app-preview/`（3D 预览的菜单节点/卡片图标：shot-panel-shared / detail-3d /
        preview-router）。全域重扫后，收口了共十余处结构槽，新增 `camera` / `play` / `visibility`
        三个语义图标（对拍 107↔107）。
      - **契约测试升级为可复用两层**（`menu/menu-icons.test.ts` 取代 `defs.test.ts`）：
        ① 数据层直查可 import 的表；② **源码层扫描**——适配器的图标写在 `build: (o) => ({…})`
        闭包内，静态 import 枚举不到，只能源码扫描（与 `check-menu-health` 的正则解析同源思路）。
        另设「豁免清单自检」：断言 `env.ts` 仍走 `label` 文本拼接，若将来改为结构槽渲染会提醒撤销豁免。
    - **第 3 批（全域侦察 + 结构槽收口，2026-09）**：全域扫描曾估「约 40 处仍在账外」，
      但**按渲染槽逐个查消费端**后发现绝大多数**不是结构槽**——它们走
      `utils/dom/modal-core.ts` 的 `esc()` 通道（对话框/toast 的 title 前缀，SVG 会被转义成
      字面量）或 `features/context-menu` 的 `BATCH_TPL`（toast 文案模板）。
      按 §1.4 属**文本槽豁免**。**真实结构槽余量只有 11 处**：
      - `views/app-nav/index.ts`（左导航）：本已**局部迁移**（logo/navigate/random 用 UI_ICONS），
        导航项却还是 emoji → 迁 `book`/`game`/`appearance`/`parser`/`tools`/`settings`
      - `views/app-preview/tpl.ts`（包内文件清单芯片）→ 迁 `video`/`controls`/`web`/`parser`/`image`
      - **两处零新增图标**（UI_ICONS 全部已有）；映射表仅补 📚→book
      - **顺带修 5 个 i18n 泄漏**：芯片 label 原为硬编码中文（经 `${esc(c.label)}` 进 DOM），
        切语言后仍显示中文；它逃过 `i18n-ui-check` 的原因与 JS 侧 UI 槽同源——闸要求
        「含 HTML 标记 + 含中文 + 未包 t()」，而这是**对象字面量字段**，无 HTML 标记
      - **又一次误判纠正**：曾怀疑「ADR-245 声称右键菜单已迁完却仍有字形」，核实后
        **ADR-245 完好**——那些 emoji 在 `BATCH_TPL`（toast 模板）里，不是菜单项。
        **同一教训第三次现身：按字段名 `icon:` 收集会误伤，必须按渲染槽判定。**
    - **收口状态**：结构槽图标已清（3D 菜单 + 导航域），仅剩 `menu/env.ts` 那 5 处**文本槽**
      （`<option>` 只能文本）——已在就地注释与契约测试的**豁免自检**中显式登记，防豁免退化成漏检。
    - **第 4 批（让口径自我 enforcing + 一次「提议被证据否决」）**：
      - **仓级扫描进契约测试**：`menu/menu-icons.test.ts` 新增第 ④ 组——递归扫全 `frontend/src`，
      任何**未登记**文件出现 `icon:` 字形即失败（提示「结构槽请迁语义名并登记 MIGRATED_FILES；
      文本槽请连同通道证据登记 TEXT_SLOT_FILES」）。vitest 本就在 pre-push 门禁里跑，
      故无需动 scripts/ 的基线与口径（避开「新口径 → 新增基线」的复杂度）。
      实测：全仓 0 越界；**并造样本验证守门有牙齿**（临时加一个 `icon: "🎮"` 文件 → 精确报出
      `文件:行号`；删除后复跑全绿）。
      - **「删 applyIcon 兜底」的提议被证据否决**（重要）：原打算「结构槽已迁完 → 兜底可退场」，
      核实发现该通道**合法地**会收到 emoji——`resource_types.json` 的**数据图标**（§1.3 🚨不可动）
      经 `typeCache` → `preview-router.ts|routeTypeMeta`（带 `|| "📦"` 兜底）→ 卡片 icon
      流入 `applyIcon`。**删兜底 = 数据图标整片消失**。已在 `resolve.ts` 就地改写注释
      （原写「全表迁完即可删兜底」，是错的承诺，留着会误导后来人删掉它）。
      这条也再次印证 §1.3 的必要性：**「结构槽已迁完」与「该通道仍会收到字形」可以同时为真**
      ——UI 图标与数据图标两个来源本就必须分流。
      - **仓级扫描的边界（有意为之）**：只扫**字面量** `icon: "…"`。动态赋值（`icon: cap.icon`、
      `icon: def?.icon || "📦"`）不在其内，因为那正是数据图标的合法来源——已在测试注释里写明，
      避免后来人误以为是遗漏。
    - **第 5 批（放宽标点形态口径 → 又现形一族）**：仓级扫描原用 `icon:\s*"…"`（对象字面量），
      而**能力类用字段声明 `readonly icon = "🌍"`（等号）**——整族 9 处逃过前几批全部侦察。
      放宽为 `icon\s*[:=]\s*"…"` 后立刻现形 11 处，收口 **10 处能力类图标**
      （经 `menu/env.ts|envCapRow` 流入菜单行，属结构槽）+ 1 处数据图标兜底登记豁免
      （`diagnostics/dedup-scan.ts` 的 `|| "📦"`，与 `preview-router.ts` 同族）。
      新增 3 个语义图标 `mirror` / `shadow` / `sky` → 对拍 110↔110。
      **教训第四度现身，这次是「按标点形态」**：判据写在哪一层就只看得见那一层
      （按字段名→按渲染槽→按标点）。
      - 扫描器**补剥注释**：文档注释里常引用 `icon="🦴"` 形式的示例（实测命中且那条注释已过时），
        不剥会把注释当违规行——与 `check-redlines` R8「扫描器不剥注释」是同一个坑。
      - **并发放行的进与出**：迁移中发现 `sky-capability.ts` 正被并行会话重构（sky 三件套在途），
        只提交它会把他人的半成品切进本提交 → 曾加临时 `PENDING_RIVAL_WIP` 让行清单；
        对方随即落定（`a6211a1bd`），让行条件解除 → 补迁并**撤掉该清单**（不留空壳）。
        原则：**豁免清单里只放永久豁免（渲染槽决定），临时时序问题修掉即撤**。
    - **踩坑记录**：`check-redlines` 的 R8 扫描器**不剥注释**——文档注释里写「innerHTML + 空格等号
      + 空格 + 函数调用」的字面形态会被当违规行拦下（且带反引号时「含反引号」豁免项反而失效）。
      引用被禁模式时须改描述式措辞，不要写出可被正则命中的字面形态。


- ✅ **刀㉖ 图标字段类型化：用类型取代清单与扫描**（2026-09，用户点题「为啥一个 icon 写得这么复杂」）：
  - **问题不在图标，在「三件事叠一个 string 字段」**：UI 图标（`UI_ICONS` 语义名）、
    数据图标（`resource_types.json`，§1.3 🚨不可动）、文本装饰（toast/对话框标题前缀、
    `<option>` 标签）——**三者源码里长得一模一样**，而 `icon: string` 让类型系统分不出。
    再叠加四种渲染目标（`innerHTML` / `textContent` / `<option>` / `esc()` 后 `innerHTML`，
    同一段 SVG 只在其中一两种合法），于是每个消费端都要靠约定鉴别，约定就要靠闸守。
  - **清债本身产出的机器**：2 份人工清单（已迁文件 / 文本槽豁免带通道标记）+ 1 条仓级正则扫描；
    而扫描口径四轮里补了四次——**按字段名 → 按渲染槽 → 按标点形态（`:` vs `=`）→ 剥注释**。
    这是文本扫描法的结构性成本：**闸只看得见它被写死的那一类位置**。
  - **根治（ADR-248 D1–D5）**：`UI_ICONS` 收紧为字面量键并导出 `UiIconName`
    （拼错即编译错）；数据图标打 `DataGlyph` 品牌（不可由裸字面量构造）；
    结构槽字段类型 `IconSpec = UiIconName | DataGlyph`（**裸 emoji 两者皆不满足 → tsc 报错**）；
    模态的文本装饰参数更名 `titleIcon`（命名即边界）；**2 份清单 + 仓级扫描整体删除**
    （契约测试 41 用例 → 2 用例，只留「语义名能否解析出 SVG」与 icon-map 对拍）。
  - **类型的连锁暴露**：收紧后 tsc 列出 44 处，**生产代码 0 处**、42 处在测试夹具
    （此前无约束随手写字形）——反证前几批迁移已把结构槽收干净，也说明**此前生产侧的
    「干净」是靠迁移纪律而非类型保证的**。
  - **方法论**：能用类型表达的约束不该用闸表达；闸是给类型表达不了的横切不变量用的。
    本仓「有门禁的规矩守得住」是对的，但**门禁的下一层是类型**——这条线正好是
    「本该用类型、却用了闸」的样本：代价是每加一个位置种类就要补一轮口径。
  - 实现细节与已知遗留见 [ADR-248](../adr/ADR-248-icon-field-typing.md) §3（`isIconName` 已随 D3 补齐删除，原记录其使用处为 `app-nav` 有误，实为 `context-menu`
    双源字段已随类型化退役；`ICON_KIT` 与 `UI_ICONS` 两条来源已于同日收敛为一条——ICON_KIT 并入 UI_ICONS 并删除该模块）。

- ✅ **刀㉗ 状态 tab 的三层问题与「闸的位置口径」再证**（2026-09，用户贴 `⛔ 已禁用` 那段代码问「是 i18n 还是硬编码」）：
  - **结论先摆清**：**不是 i18n 问题**——文案来自 `t("syncManager.status.disabled")` ✓（用户看到的是**渲染结果**，非源码字面量）。
    真问题是三层叠加：**硬编码字形** + **同一组字形两处来源** + **行内样式**。
  - **两处来源**：`tpl.ts` 的 `STATUS_ICON` 表（自称「单一事实源」）与 tab 构建器里写死的字形
    （`renderer.ts` 的 `` `⛔ ${t(...)}` ``）并存，且构建器**根本没 import 那张表**。
  - **闸为什么齐哑**（各自有理，合起来留出整片盲区）：
    - `i18n-ui-check`：口径「含 HTML 标记 + 含中文 + **未包 `t()`**」→ 它**已包 `t()`** → 正确地不报；
    - emoji 闸：口径「**标签内容起始处**」（`>😀` / `' + 😀`）→ 三种形态全在体外：① 模板字面量起始（反引号后）；
    ② 数据字面量（表内）；③ 更隐蔽——`statusTabHTML` 是 `'…">' + label + '</button>'` **字符串拼接**，
    `>` 与字形**被拆进不同片段**，连「标签内容起始」也照不到；
    - 令牌闸：**确实管行内样式**，但只认**字面量**值（`inline-style-font-size/radius/color`）——
      该处行内样式全是 `var()`，无字面量可令牌化 → 不报。
  - **处置**：`STATUS_ICON` 改填**语义名**并收紧类型（`Record<string, UiIconName>`）；`statusIconOf` 经 `resolveIcon()`
    出 SVG；**tab 构建器改为复用它**（消两处来源）；补 `all: "chart"`；`diverged` 取 `warning` 而非另造 `diff`
    （语义即「需注意」，行色已由 `STATUS_COLOR` 标 accent）→ **零新增图标**；
    行内样式全归样式表（`.sm-status-tab` / `.sm-status-tab.active` / `.sm-cur-type` / `.sm-empty`），
    12px 横向内边距走新令牌 `--btn-padding-filter`（沿用 `--btn-padding-*` 既有简写约定）。
  - **顺带真还了一笔债**：`emptyHintHTML` 的内联 `font-size:20px` 原是基线内已知债（`inline-style-font-size`）。
    教训：**闸对硬编码字号位置无关**——搬进样式表仍算 `css-font-size`（不算还债）；按既有「归最近档位」口径
    收为 `--fs-xl(24px)` 后债才真正消失 → **design-tokens 基线 108 → 107**。
  - **回归锁**（`tpl.test.ts`）：`STATUS_ICON` 值必须是语义名且能解析出 SVG（字形正则拦截）；
    `statusTabHTML` 输出**不得含 `style=`**（钉住「样式归样式表」）。
  - **仍待办**：emoji 闸口径未扩（模板字面量起始 + 数据字面量）——扩它会在全仓暴露同类存量，
    须与基线策略一起决策，故本轮**只记不扩**。

- ✅ **刀㉘ 「扩 emoji 闸口径」提案被实测否决 + 找到唯一可精确判定的那一类**（2026-09，承接刀㉗）：
  - **先更正刀㉗ 的一个说法**：我说「模板串起始不在 emoji 闸口径内」——读实现后发现**不对**：
    闸的正则 `(?:>|["'\`])\s?(GRAPHIC)…` **早就接受反引号**；真正把那些行挡在外面的是**前置门槛**
    `if (!/class\s*=|<\w+|data-testid/.test(line)) return []`（「同行须有标签特征」）——
    `["disabled", \`⛔ ${t(...)}\`, …]` 这行**没有任何标签特征** → 整行不扫。
  - **拟扩展的两条口径**（不依赖标签特征）：② 整值即字形；③ 模板串起始为字形且紧跟 `${…}`。
  - **实测结果（决定性）**：扩展后语言包外 **235 处 / 80 文件**，而抽样显示**绝大多数是合法文本装饰**
    ——toast 文案前缀（`msg: \`❌ ${friendlyError(…)}\``）、toast 前缀配置（`toast: { prefix: "⚠️ " }`）、
    状态文案（`summary.textContent = \`⚠️ ${t(…)}\``）；语言包里更有 **378 条译文本身就是
    「emoji 开头的文本」**（`✅ 字号已更新` 这类）——即 ADR-238 §1.4 明确允许的文本槽装饰。
    → **结论：这个口径不能扩。**「图标位 vs 文案前缀」**不是字符串形状能表达的**（两者长得一样）。
    这恰好再次印证 [ADR-248](../adr/ADR-248-icon-field-typing.md) 的论点：
    **那条边界是「哪个字段/哪个槽」的类型层事实，不是文本层事实** → 类型能守，正则守不了。
  - **替代方案：只抓唯一可精确判定的那一类——「槽的全部内容就是一个字形」**（没有文字可装饰 ⇒ 只能是图标）。
    实测全仓仅 **5 处**，**全部真阳性**：`download-queue-progress` 的 `pctEl.textContent = "❌"`、
    `download-queue` 的两处 `icon.textContent = "⬇️"`、`roles-views` 的 `append.textContent = "➕"`、
    `slide-menu` 的 `backBtn.textContent = "←"`。已全部改为 `UI_ICONS` + `innerHTML`。
  - **顺带结清一笔旧债**：`←` 正是 ADR-238 §1.4 里按「缺语义名**不硬塞**」记下的那笔
    （当时拒绝拿 `pointerLeft` 冒充「返回」，免得腐蚀 D2 语义命名）——本次正式补上 `UI_ICONS.back`
    与 `UI_ICONS.add`（➕），对拍 **114↔114**。
  - **新守护**：`utils/icon/glyph-only-slots.test.ts` —— 仓级扫描「槽 = 纯字形」赋值
    （`textContent/innerText/innerHTML = "字形"`），实测有牙齿（造样本即准确报出文件行）。
  - **闸的盲区补收（2026-09，同题续）**：用户问「为何这几个按钮是 emoji 不是 SVG」→ 实测根因**不止**
    「运行时 `textContent` 覆盖模板层 SVG」一条，而是**闸本身两处失明**：
    ① `glyph-only-slots.test.ts` 的 `GRAPHIC` 字符集只有四段（`1F300-1FAFF` / `2600-27BF` /
    `2B00-2BFF` / `2190-21FF`），**`⏳`=U+231B（与 U+23F3 同属「杂项技术符号」2300-23FF）落在段外**
    → 「槽=纯字形」这一整类对 `⏳` 家族静默；补 `2300-23FF` 后实测共收 6 处（`data.ts` /
    `download-queue.ts` / `download-queue-progress.ts` / `toolbar-events.ts` / `site/edit.ts` 等）。
    ② 更隐蔽的一处：`check-design-tokens.ts` 扫描主循环的**快速预筛表**里又**第三份硬编码**字符集
    （比判定层的 `GRAPHIC_EMOJI` 窄，缺 `2190-21FF` 与 `2300-23FF`）——命中行在预筛即 `continue`，
    **永远到不了判定函数**。后果：`<div class="big-icon">⏳</div>` 这类**行内没有 `style=`/`color`
    等关键词**的行整类逃逸（有 `style=` 的行反而正常报出，制造「闸在工作」的假象）。实测该单点修复
    后 emoji-icon 命中从 3 → 10。**修法（结构性，非补丁）**：删除预筛里的硬编码字符集，改由判定层
    导出**同一事实源** `hasGraphicEmoji(line)`（`_lib/design-tokens.ts`）——预筛与判定从此不可能再漂移。
  - **本轮教训（可复用）：同一份「字符集/关键词表」在仓里出现第二份手抄副本 = 定时炸弹**。
    `check-design-tokens.ts` 预筛表的抬头注释**早已写明**这个规律（「新增判定种类时必须同步本表——
    否则新判定形同虚设且极难察觉」），但**emoji 字符集这一份仍然漂了**——说明「写在注释里」拦不住，
    只能用**导出单一事实源 + 预筛/判定共用**的机制拦。排查同类问题的口诀：
    **「闸报 0」不等于「无违规」，先验证闸有牙齿（造样本 / 比对两处副本）**。
  - **口径未变**：`→`（旧名与新名之间的连接符，如 `rename.ts` / `tpl-batch-rename.ts`）属
    **文本槽内的排版符号**（ADR-238 §1.4），**刻意保留**；变换后全仓 emoji-icon 仅余此 2 处，
    且均为真豁免而非漏网——这正是「图标位 vs 文案前缀」边界在人工判定下的正确落点。
    覆盖边界已在文件头写明（只认同行赋值；属性槽如 `title` 不算图标位；变量赋值是数据图标通道）。
  - **方法论**：**提案要经得起实测**——这次若凭直觉扩口径，会把 235 条合法文案变成"债"，
    逼出一次大规模基线膨胀与误改。闸的口径宁窄勿宽：**宽口径的假阳性会稀释真信号**。

- ✅ **刀㉙ 美学体检：渲染态量测首次落地 + 三处 WCAG 实证修复**（2026-09，用户点题「前端设计美学如何，担心」）：
  - **方法层的补课**：刀①–㉘ 全在**源码/文档层**（令牌、图标、a11y 结构），**从未量过渲染结果**。本轮用 Playwright + mock bridge，跨 Shadow DOM 遍历 `getComputedStyle`，量对比度 / 字号种类 / padding 节奏 / 点击命中区——「美学」第一次变成可复现的数字。
  - **实测三症**（1440×900，7 页 × 多主题）：
    ① **层级扁平**：每页 `--muted` 用量压过 `--txt`（diagnostics 21:2、workshop 22:15、repo 19:15）——设计哲学「可扫描」被次色泛滥抵消；
    ② **亮色主题塌陷**：warm `--muted` 三面全不合格（bg 3.94 / surf 3.55 / card 4.16），cyber 对 `--card` 4.11 亦不合格——**同一令牌在不同表面合格性不同，而令牌表只记一个值**（sakura 2026-08-15 修过，warm 未进那轮审计）；
    ③ **规范与渲染漂移**：`app-nav/tpl.ts|.nav-item` 的 `calc(var(--fs-nav) + 2px)` 渲染成 **15px**（文档写 13px，语义令牌被就地改写等于没用）、单页 **22 种 padding**（规范 5 档）、5px 圆角 7 处（不在令牌集）。
  - **已修（本刀只做客观项；审美取向项如导航 13↔15px 留用户拍板）**：`frontend/css/variables.css`——warm `--muted` `#8b7355`→`#786140`（三面 5.15/4.63/5.43）、cyber `--muted` `#8b7fad`→`#9a8fbb`（card 5.03）、`.skip-link` `color:#fff`→`var(--bg)`（白字在 pro/ocean accent 上仅 **2.31**；改后与 `.btn-base.primary` 同口径，两端恒成立）。
  - **端到端验收（不只看测试绿）**：重建后**重渲染复测**，对比度失败 **cyber repo 1→0 / warm repo 17→0 / cyber workshop 3→0**，且 `mutedCount` 不变（19/22，同批元素仅由不合格转合格）。`vite build` ✅ / `npm run typecheck` ✅ / `check-design-tokens --baseline` 新增 **0** ✅。
  - **⚠️ 顺带发现（覆盖面缺口）**：`frontend/css/` **不在 biome 覆盖面内**——`check-biome --files frontend/css/variables.css` 报 `No files were processed`（`biome.json` 忽略该路径）。那 5 个手写样式表当前**唯一守卫就是设计令牌闸**。
  - **方法论（与刀⑲–㉘ 同构的下一站）**：令牌闸守的是「有没有写成 `var()`」，**对「`var()` 取值对不对」零感知**。`warm --muted = 3.94` 能活到今天不是没人认真，是**它不在任何闸的视野里**——**闸只看得见它被写死的那一类位置**。
- ✅ **刀㉝ padding 立闸：454 处硬编码 padding 入账 + 判定层补齐 + 间距体系断层定位**（2026-09，承接刀㉙ 遗留「22 种 padding 归 5 档」）：
  - **先核验旧记录**：刀㉙ 记的「7 处 5px 圆角」已被提交 `e007af034`（2026-09-17）全仓收编（2px→xs、5px→sm、12/14px→xl），现仓零命中——**旧记录过期，先划掉再动**。padding 的「22 种」则**严重低估**：全仓源码口径实测 **454 处**（css-padding 350 + inline-style-padding 104）、**113 种值**（`2px 8px`×25、`12px`×24、`0 4px`×17、`4px 12px`×17 等）。
  - **立闸（本刀交付）**：`scripts/_lib/design-tokens.ts` 新增 `css-padding`/`inline-style-padding` 两种 kind + `suggestPaddingToken`/`nearestPadToken`（`PAD_TOKEN_VERTICAL` 6 档表）+ `findStyleAttrViolations` ⑥ padding 判定段 + `fixLineTokens` 安全单值替换；`check-design-tokens.ts` 预筛关键词表加 `padding`（防静默失明）+ ERROR_KINDS + KIND_LABEL；`variables.css` 补 `--pad-tab: calc(5px + ...)`（文档 §语义化间距变量有记载、CSS 缺定义，顺手补齐）。契约测试补 block 19（±预筛同步锁探针）。
  - **口径（与 transition 反转同哲学：硬编码即债，能安全归位才给建议）**：一律报 `padding: Npx`（内联/CSS 块）；建议只在**单值**且**就近垂直档 ≤2px** 时给（`4px→--pad-filter`）；组合值（`4px 8px` 等）涉及横向语义 → 建议 null 但照报；`padding: 0`/全 0 → 纯零豁免（令牌化无意义）；`padding-block`/`padding-inline` 子属性、`--my-padding` 自定义属性、calc/var/百分比 → 一律不判（防 `padding-block:8px` 被误当组合 padding；防 `--fix` 改写自定义属性定义）。`--fix` 只动单值精确命中，组合值不碰（会改横向语义）。
  - **实测现实 = 「5 档」的架构断层**：存量值落点正是 UI-Design.md §5 间距系统（4/6-8/10-12/14-16/20-24px 五档），但那 5 档**只有文档无 CSS 变量**；`--pad-*` 是按钮/标签的 3-6px 缩放垂直档，**不承载内容间距语义**（`.diag-stat` 的 `12px` 是内容大间距，硬套 `--pad-*` 是语义冒充）。**收敛 = 先补 5 档间距变量体系（该走 ADR）+ 按元素语义分批归档**，非机械替换。故本轮只立闸入账 463 条基线（阻断新增债 + 存量可量化），收敛留路线图：①补 `--sp-1..5` 间距档（ADR）→ ②按元素语义分批归档 → ③极限收缩基线。
  - **验收**：契约测试 103/103 ✅ / `vite build` ✅ / `typecheck` ✅ / `check-design-tokens --baseline` 新增 0 ✅ / 基线由 108 → 463 条（padding 债计入）。
- ✅ **刀㉚ features 层执法：R8 HTML 字面量闸立法**（2026-09-20，本会话用户「锐评 /features」落地）：
  - **锐评总判**：features 纪律仓库天花板（R5 seam 零违例 / 全层零 `: any` 零 `@ts-ignore` / 跨 feature 依赖 DAG 无环 / 死代码仅 1 运行时孤儿导出），唯一结构性原罪 = **逻辑层私藏视图**——maintenance 三文件手写内联 style HTML 串、`_dots` 转圈状态挂 DOM 节点自定义属性。
  - **立法**：`check-layering` 新增 **R8（防回退）**：features 生产文件禁 HTML 字符串/模板字面量（政策 ADR-190 D1a / ADR-208 D2 早立但从未执法，本条补闸）；存量 5 文件 76 处入基线（dialogs 三件套 + community render/show-repo-models，ADR-208「已知遗留」点名项，big-bang 在 ADR 里被显式反对），新增即红；行级豁免尾注 `// layering-allow: html`。扫描器 `htmlLiteralHits` = 手写词法态机（剥注释/抽字符串跨/模板插值嵌套），纯函数导出 + 合成样本契约测试直测，同 `matchImports`/`r7EdgeViolates` 防空转惯例。同号异策：与 check-redlines R8 勿混。
  - **顺带修好一个隐藏死闸 bug**：`--force` 基线逃生阀在 parseArgs bools 漏登记 → 被 ADR-043 unknown-flag 拒于门外，从未可达；补登记后本次才第一次真能用。
  - **存量收敛（maintenance 三文件清零退出基线）**：状态行改 DOM 构建（`statusRow()`/replaceChildren/textContent 自转义，❌ emoji 换 `UI_ICONS.error`）；modal bodyHTML 改 `outerHTML` 拼接（字符串契约与兄弟节点结构双保持）；`_dots`/`_dotTimer` 迁 `CmPgCtx` 闭包 + 双次进锁清孤儿动画；`forceRefreshCommunitySites` 零消费孤儿删除（`clearAllCommunityCache` 已覆盖站点键）。
  - **明拒不做什么**：基线内存量按 ADR-208「改动即顺手收敛」不集中迁；adv-filter 六连 querySelector 收拢、community/ 影子小应用拆包——留给下次触碰/未来 ADR。
  - **验收**：check-layering 绿 / 契约测试 15 用例全过（含 R8 两层）/ maintenance+community 255 用例全绿 / vite build / tsc / biome --write 后复检绿。
- ✅ **刀㉛ 图标字段的字符串出口收口 + R8 模板闸立法**（2026-09-21，SVG 接入审计，提交 `39691ae76`）：
  - **病症**：SVG 接入各面板后，图标字段在 innerHTML 模板里被三种口径消费——预构建 SVG 常量（`UI_ICONS.x`）、语义名（要 `resolveIcon`）、数据字形（emoji，要 `esc`）；调用点各写各的，`resolveIcon(x) || esc(x)` 这类局部发明又把 SVG 常量二次转义成字面文本。
  - **根治（通用化，复用既有 applyIcon 契约）**：新增 `utils/icon/resolve.ts|renderIconHtml(icon)` = `applyIcon` 的**模板串孪生**——三态判别收口一处（含 `<svg` → 透传；语义名 → `resolveIcon`；其余 → `esc`），消费方统一写 `${renderIconHtml(x)}`。顺带修掉既有假渲染：`preview-router.ts` 传的 `icon:"unknown"`、detail-3d 的 `"build"/"avatar"/"voice"` 以前把语义名当字面文本上屏（回归锁 `utils/icon/resolve.test.ts`）。
  - **同批清零 29 处 innerHTML 模板裸插值**（全部改代码、零 `r8-allow` 豁免）：外部数据（MC 路径、`.litematic` 的 `meta.version`/`minecraftDataVersion`）走 `esc`；数字走 `.toLocaleString()`；预构建 HTML 局部按命名约定改名（`extra`→`extraHtml`、`items`→`itemsHtml`、`overflow`→`overflowHtml`、`detail`→`detailHtml`、`icon`→`iconSvg`）；modal 三件套取消按钮补 `esc(cancel)`。
  - **闸法**：check-redlines R8 补「模板插值卫生」子规则（扫描核 `scripts/_lib/innerhtml-hygiene.ts` + 契约测试 34 断言），从「只抓裸变量赋值」升级为覆盖模板串主力形态。⚠️ 与 check-layering R8（features 禁 HTML 字面量）**同号异策**，勿混。
  - **原生 `<option>` 是纯文本内容模型（本次未动，留判决）**：`<option>`+`UI_ICONS` 写法全仓约 15 处（`app-content/settings/tpl-settings*.ts`、`app-tree/tpl-batch-rename.ts` 等），SVG 恒显字面标记（`menu/env.ts` 早有实证注释）。两条路：**A** 删掉 option 内图标（零视觉回归——它们从未渲染出来过）；**B** 设置页原生 `<select>` 迁自定义 dd-menu（真图标，工作量大）。待用户拍板。
- ✅ **刀㉜ 层级扁平治理：正文级 muted→txt 提升 13 处 + 文字层级口径成文**（2026-09-21，用户点题「担心主题设计不佳」续——架构三病根（system 映射/默认值漂移/theme-auto 重启）修复后，审美层由用户拍板「层级扁平」方向）：
  - **病症**（刀㉙ 实测量测①复核）：全仓声明层 `--muted` 274 处 vs `--txt` 180 处；导航项 `.nav-item` base 色 = muted——常驻正文全员次色，「可扫描」被抵消：全都次要 = 没有主次。
  - **口径（成文三处：`variables.css` 头注释 / `UI-Design.md` §CSS 变量体系 / theme 卡不变量）**：`--txt` = 正文级（列表主名/数值读数/错误正文/主操作按钮文字/导航项）；`--muted` = 真次要（提示/说明/元信息/时间戳/占位/空态/禁用与非激活态色/装饰图标）。**闸判不了这层语义分工**（令牌闸只看「有没有写成 var()」）——成文口径 + 人审是唯一防线，此即刀㉙「取值对不对」盲区的方法论续。
  - **提升 13 处**：`.nav-item`/`.nav-viewer-fab` base（激活态本有 --hover 底 + accent 指示条，不靠底色深浅；连带清除因此失效的 hover/active 死色行）；`.gh-error-msg`（错误正文）、`.gh-progress-pct`（下载读数）；`.perf-bar-val`（测量值 = 面板产出）；`.setting-row .value`（消除与同页 `.td-camspeed-val` 用 txt 的内部矛盾）；`.cr-edit-btn`/`.repo-bar-btn`×2/`.rec-card .actions button`/sync pull 按钮/回收站计数（主操作按钮文字对齐 `.btn-base` 正典 `color:var(--txt)`，css.ts:7）。
  - **明拒不做什么**：未激活 tab/分段选项、取消/返回按钮、`-muted` 命名变体、locked/existing 行降色、提示与 meta 与时间戳与装饰图标一律**保留 muted**（它们是状态语义与真次要，不是扁平）——层级治理是「纠误用」不是「整体调亮」。无新闸。
  - **验收**：vite build ✅ / biome ✅ / 相关测试（nav/sync/recycle/perf/download-queue/site render）全绿。

## 相关

- [frontend_repo_audit](frontend_repo_audit.md)：代码质量基线（4.1/5，2026-08-26）
- [3d-patterns](3d-patterns.md)：R1-P1-1 每帧复用 Vector3 铁律
- [preview_core](preview_core.md)、[render-federation](render-federation.md)：3D 会话外壳与联邦渲染
- [ui_components](ui_components.md)、[dialog-modal](dialog-modal.md)：自研 UI 组件与弹窗基座
