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
  - frontend/src/preview-3d/perception/gaze.ts
  - frontend/src/preview-3d/perception/autodance.ts
  - frontend/src/preview-3d/safe-dispose.ts
  - frontend/src/preview-3d/adapters/scene-registry.ts
  - frontend/src/preview-3d/menu/roles.ts
  - frontend/src/features/dialogs/modal.ts
  - frontend/src/features/dialogs/adv-filter.ts
  - frontend/src/features/dialogs/batch-rename.ts
  - frontend/src/ui/ui-components-styles.ts
  - frontend/src/views/app-content/settings/path-cards.ts
  - frontend/src/views/app-content/settings/theme.ts
  - frontend/src/views/app-preview/detail-3d.ts
  - frontend/src/preview-3d/adapters/worker-bridge.ts
  - frontend/src/preview-3d/render-budget.ts
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
    - Disposable
    - fillRoles
    - fmtMB
    - getFrameIntervalMs
    - getLastModelPath
    - getMaxFps
    - getMaxPixelRatio
    - initAdvancedGrid
    - initDiagnosticsPage
    - initGithubPage
    - initInstancesPage
    - initMcDetect
    - initRepositoryPage
    - initSettingsPage
    - initWorkshopPage
    - installUiComponentsStyles
    - invalidateMaxFpsCache
    - MAX_FPS_DEFAULT
    - MAX_FPS_KEY
    - MAX_MODELS
    - MAX_PIXEL_RATIO_KEY
    - modalConfirm
    - ModalConfirmOptions
    - modalPicker
    - ModalPickerItem
    - ModalPickerOptions
    - ModalPickerResult
    - modalProgress
    - ModalProgressHandle
    - ModalProgressOptions
    - modalPrompt
    - ModalPromptOptions
    - modalSelect
    - ModalSelectOptions
    - modelDetailView
    - ModelEntry
    - motionDetailView
    - PREVIEW_FRAME_INTERVAL_MS
    - previewPixelRatio
    - registerDlg
    - rememberModelPath
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
    - uiComponentsCss
    - uiComponentsStyleSheet
    - VIEW_TESTIDS
    - WorkerBridge
    - WorkerErrorStrategy
tests:
  - frontend/src/preview-3d/adapters/scene-registry.test.ts
  - frontend/src/preview-3d/adapters/worker-bridge.test.ts
  - frontend/src/preview-3d/menu/roles.test.ts
  - frontend/src/preview-3d/perception/autodance.test.ts
  - frontend/src/preview-3d/perception/gaze.test.ts
  - frontend/src/preview-3d/render-budget.test.ts
  - frontend/src/preview-3d/safe-dispose.test.ts
  - frontend/src/test-utils/index.test.ts
  - frontend/src/features/dialogs/modal.test.ts
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
| 架构 | 4.0 | `app-content/index.ts` 7个死代码转发壳（L274-302）、`app-sidebar` `_checkedSets` 模块级泄漏（L37）、`app-nav` `_focusRepoSearch` 轮询耦合（L328-342） |
| UI/UX | 3.7 | 所有弹窗缺 `role="dialog"`（modal.ts:134）、adv-filter label 未 for 关联（L57）、batch-rename checkbox 无 aria-label（L185）、`--uih-accent-dim` 硬编码遗漏（ui-components-styles.ts:14） |
| 3D/性能 | 3.4 | WASM 解码无单模型超时（ysm-worker-loader.ts:198）、`pickModelByObject` 每帧 O(roots) 遍历（scene-registry.ts:215）、Blob URL 成功路径永不 revoke（ysm-worker-loader.ts:118）、render-budget 缺 GPU 计量（render-budget.ts:60） |

## 实证锚点（主模型抽查背书，2026-09-05）

| 指控 | 验证结果 |
|------|----------|
| `app-content/index.ts:274-302` 7个死代码转发壳 | ✅ 属实；`_bindTabs`/`_initDiagnostics`/`_initInstances`/`_initRepository`/`_initWorkshop`/`_initGithub`/`_initSettings` 仅转发 `init-pages.ts`，实际调用走 `PAGE_REGISTRY` |
| `app-sidebar/index.ts:37` `_checkedSets` 模块级泄漏 | ⚠️ 撤回：设计意图非 bug——`sync.test.ts:131-140`「重新挂载 → 恢复已勾选状态」明确依赖跨 disconnectedCallback 保留，按 rtype 隔离 |
| `app-nav/index.ts:328-342` `_focusRepoSearch` 轮询耦合 | ✅ 属实；setTimeout 循环 20 次等待 `app-tree` 挂载，依赖查询链 `appContent?.shadowRoot?.querySelector("app-tree")?.shadowRoot?.getElementById("srch")` |
| `modal.ts:134-146` overlay 缺 `role="dialog"` | ✅ 属实；`buildOverlay` 仅设 `className`/`tabIndex`，未设 `role`/`aria-modal` |
| `adv-filter.ts:57` label 无 for 关联 | ✅ 属实；`<label style="display:block">` 无 `for` 属性，对应 `input#afv-kw` 无关联 |
| `batch-rename.ts:185` checkbox 无 aria-label | ✅ 属实；批量条目 checkbox 仅 `class="br-file-cb"` + `data-ci`，无 `aria-label` |
| `scene-registry.ts:215-223` `pickModelByObject` 线性遍历 | ✅ 属实；每次 raycast 双重循环遍历所有 root，应建 WeakMap 缓存 |
| `ysm-worker-loader.ts:198-233` WASM 解码无单模型超时 | ✅ 属实；`decodeYsmInWorker` 直接 ccall，无 watchdog |
| `render-budget.ts:60-63` 缺 GPU 资源计量 | ✅ 属实；仅 pixelRatio 自适应 + MAX_MODELS=8 计数上限，无 draw call/三角面/纹理字节预算 |

## 共识问题榜（交集 = 高置信，按 ROI 排序）

1. **可访问性债务集中爆发**（UIUX 2.5/5）：modal overlay 缺 `role="dialog"` / `aria-modal`、adv-filter label 未 for 关联、batch-rename checkbox 无 aria-label。一刀切：modal.ts buildOverlay 加 ROLE_ATTR，业务弹窗统一继承。
2. **模块级状态泄漏**（架构 3.5/5）：`app-sidebar` `_checkedSets` Map 无 reset、`init-pages.ts:314` `_lastModelPath` 模块级无 reset。一刀切：disconnectedCallback 兜底清理，或改实例级。
3. **性能预算仍靠信仰**（3D 2.5/5）：`render-budget.ts` MAX_MODELS=8 是计数非预算、`scene-registry.ts` 拾取每帧线性遍历。一刀切：读 `renderer.info.render` 统计 draw calls，建 WeakMap 缓存拾取。
4. **WASM 解码无单模型超时**（3D 3.5/5）：`ysm-worker-loader.ts` 畸形文件可阻塞 60s 才降级。一刀切：`stats.worker.ts` 层加 `Promise.race` 软超时（5s），超时返回 `ERROR_STATS` 而非杀池。

## 仲裁修正（主模型对子代理报告的裁定）

1. 架构子代理「死代码转发壳」指控属实，但删除需同步清理 `AppContentHost` 接口声明，避免接口漂移。
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

## 相关

- [frontend_repo_audit](frontend_repo_audit.md)：代码质量基线（4.1/5，2026-08-26）
- [3d-patterns](3d-patterns.md)：R1-P1-1 每帧复用 Vector3 铁律
- [preview_core](preview_core.md)、[render-federation](render-federation.md)：3D 会话外壳与联邦渲染
- [ui_components](ui_components.md)、[dialog-modal](dialog-modal.md)：自研 UI 组件与弹窗基座
