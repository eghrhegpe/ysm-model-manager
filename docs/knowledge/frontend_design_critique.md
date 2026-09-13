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
  - frontend/src/preview-3d/menu/roles.ts
  - frontend/src/utils/dom/modal-core.ts
  - frontend/src/features/dialogs/adv-filter.ts
  - frontend/src/features/dialogs/batch-rename.ts
  - frontend/src/preview-3d/menu/components-styles.ts
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

## 相关

- [frontend_repo_audit](frontend_repo_audit.md)：代码质量基线（4.1/5，2026-08-26）
- [3d-patterns](3d-patterns.md)：R1-P1-1 每帧复用 Vector3 铁律
- [preview_core](preview_core.md)、[render-federation](render-federation.md)：3D 会话外壳与联邦渲染
- [ui_components](ui_components.md)、[dialog-modal](dialog-modal.md)：自研 UI 组件与弹窗基座
