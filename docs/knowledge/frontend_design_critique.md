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
  - frontend/src/services/registry.ts
  - frontend/src/preview-3d/perception/gaze.ts
  - frontend/src/preview-3d/perception/autodance.ts
  - frontend/src/preview-3d/safe-dispose.ts
  - frontend/src/preview-3d/adapters/scene-registry.ts
  - frontend/src/preview-3d/menu/roles.ts
  - frontend/src/utils/dom/dialogs/modal.ts
  - frontend/src/ui/ui-components-styles.ts
  - frontend/src/views/app-content/settings/path-cards.ts
  - frontend/src/views/app-content/settings/theme.ts
  - frontend/src/views/app-preview/detail-3d.ts
  - frontend/src/preview-3d/adapters/worker-bridge.ts
  - frontend/src/preview-3d/render-budget.ts
auto_fields:
  symbols_with_lines:
    - __resetModalStateForTest
    - AdaptiveRenderBudget
    - appContentStyle
    - AutoDanceOptions
    - BeatDetectorLike
    - bindPathClick
    - clear
    - closeActiveDialog
    - closeDlg
    - createAdaptiveRenderBudget
    - createAutoDanceController
    - createGazeController
    - createResolveModeBridge
    - createWorkerBridge
    - CreateWorkerBridgeOpts
    - createWorkerParser
    - Disposable
    - fillRoles
    - fmtMB
    - frRoleRowStyle
    - get
    - getDedupConfig
    - getFrameIntervalMs
    - getLastModelPath
    - getMaxFps
    - getMaxPixelRatio
    - has
    - initAdvancedGrid
    - initDedupConfig
    - initDiagnosticsPage
    - initGithubPage
    - initInstancesPage
    - initMcDetect
    - initRepositoryPage
    - initSettingsPage
    - initTheme
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
    - register
    - registerDlg
    - rememberModelPath
    - resetDedupConfig
    - ResolveModeBridge
    - ResolveModeResponse
    - roleBaseName
    - safeDispose
    - sampleAdaptivePixelRatio
    - saveCfg
    - sceneRegistry
    - ServiceName
    - shouldRenderAtFps
    - shouldRenderPreviewFrame
    - showFbxPreview
    - showMmdPreview
    - showMorphPreview
    - showScenePreview
    - showStagePreview
    - showVrmMeta
    - startDedup
    - trapFocus
    - uiComponentsCss
    - uiComponentsStyleSheet
    - unregister
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
  - frontend/src/services/registry.test.ts
  - frontend/src/test-utils/index.test.ts
  - frontend/src/utils/dom/dialogs/modal.test.ts
  - frontend/src/utils/resource/registry.test.ts
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
  - 重构与技术债评估
quick_intents:
  - 前端设计评审 / 锐评
  - 主题系统审查（token 失守）
  - 3D 性能与内存预算审查
  - 页面生命周期审查（整 DOM 重建）
quick_risk_lines:
  - 样式必须走主题 token（var(--accent)），禁止硬编码品牌色散落（rgba(124,131,255) 全仓 19 处待收编）
  - 页面切换必须 tab-panel 常驻 + active 切换，禁止整 DOM innerHTML 重建
  - 帧循环内禁止 new 对象分配，prealloc 复用是 3D 性能铁律（perception 是唯一站规则外的子系统）
---

# 前端设计锐评

## 概览

2026-09-03 三子代理并发只读锐评（架构 / UI/UX / 3D性能），主模型对每份报告的最强断言逐条实地抽查，**无幻觉指控**。基线：`frontend_repo_audit`（2026-08-26，4.1/5，偏代码质量）。本卡为**设计视角增量批评快照**，不重复审计卡结论。

加权总分 **≈3.4/5**：架构 3.7 / UIUX 3.2 / 3D性能 3.4。一句话：工程化治理行业级（红线零违、bus 类型化、门禁齐备），但「跑起来的设计」欠三本账——主题 token 失守、生命周期全量重建、性能预算靠信仰。

## 三路评分

| 视角 | 分 | 主炮 |
|------|----|------|
| 架构 | 3.7 | 切页整 DOM 重建（index.ts:147）、dedup 全局锁无 reset（dedup.ts:15,19）、services/registry 仅 2 服务空转（registry.ts:11） |
| UI/UX | 3.2 | 硬编码 accent 绕开 --accent（全仓 19 处 rgba(124,131,255)）、深色 fallback 当主题系统、--uih-* 第二套色卡、modalConfirm Enter 不确认、FOCUSABLE_SEL 死选择器、中文标点未走 i18n |
| 3D/性能 | 3.4 | perception 每帧 new 对象 GC 血雨、safeDispose 静默吞错、MAX_MODELS=8 数字幻觉、WorkerBridge reject-mode 终止整池、adaptive budget 单轴、100MB 防线未校准 |

## 实证锚点（主模型抽查背书，2026-09-03）

| 指控 | 验证结果 |
|------|----------|
| index.ts:147 每次切页 innerHTML 整段重建 | ✅ 属实；lang:changed（index.ts:114-116）也整页重建，问题面比报告更大 |
| gaze.ts:71-97 / autodance.ts:147-148 每帧 new Quaternion/Euler | ✅ 属实（perception 下 grep 19 处分配） |
| 硬编码 rgba(124,131,255) 绕开 --accent | ✅ 属实，全仓 19 处，波及 fab.ts / model2d-draw.ts / ui-slide-menu-styles.ts |
| scene-registry.ts:218 MAX_MODELS=8 无资源预算 | ✅ 属实 |
| safe-dispose.ts:11-16 吞错无留痕、不递归 | ✅ 属实 |
| modal.ts:25 FOCUSABLE_SEL 含死选择器裸 tabindex | ✅ 属实，纯冗余 |
| init-pages.ts:45-50 手工 &quot; 拼接 | ⚠️ 属实但严重度降级：attribute 上下文只有 `"` 能逃逸，非 XSS 漏洞；违反「凡进 innerHTML 必 esc()」不变量，属口径违规 |

## 共识问题榜（交集 = 高置信，按 ROI 排序）

1. **主题系统半身不遂**：--uih-* 第二套色卡 + 19 处裸 accent + 深色 fallback 当主题系统用。6 个主题只切换 ~30% 元素色。翻身仗 = 让 6 个主题真正覆盖 6 种色。
2. **生命周期 = 全量销毁重建**：切页/切语言整 DOM 重建；dedup busy 锁无 reset → tab 再进永久卡死（审计快照点名 4 个月未修）；3D dispose 靠适配器各自擦屁股非递归链路。三处同源：状态生命周期无统一收敛原语。
3. **性能预算缺位**：MAX_MODELS=8 是计数不是预算；pixelRatio 0.75 是预算地板再无退路；100MB 防线文档自认未校准。perception 每帧 ~15 次分配 × 8 模型 = 7200 次/秒 GC 抖动是第一个现形处。
4. **弹窗键盘一致性**：modalConfirm Enter 不确认、FOCUSABLE_SEL 死选择器，prompt/confirm 行为分裂。

## 仲裁修正（主模型对子代理报告的裁定）

1. 架构修 `_render` 的报告正确，靶心扩到「三处全重建」：nav:changed / lang:changed / repo:search-creator 都走 `_render()`。常驻 tab-panel 一次收编三条路径。
2. XSS 指控降级为「口径违规」：不构成注入，但违反仓内不变量，随 esc() 统一口径顺手修，不单独立项。
3. UIUX 与 3D 病根同源：内联 style 字符串是主题失守与 XSS 口径违规的共同载体——抽 token + 走 CSS 类，一刀切三处。

## 不变量（锐评快照结论，非既有红线）

- 样式一律走主题 token；硬编码品牌色（#7c83ff / rgba(124,131,255)）是待收编存量。
- 页面切换常驻 + active 切换，禁止整 DOM 重建。
- 帧循环内 prealloc 复用，禁止 new 对象分配（perception 需对齐 R1-P1-1）。
## 动刀进度（实施记录，2026-09-03 起）

- ✅ **刀① perception 帧内 prealloc**：`perception/gaze.ts`、`perception/autodance.ts` 闭包级 scratch（Quaternion/Euler/Vector3 复用），每帧 0 分配；EYE_IDS / 左右臂 Set 提常量。45 感知测试全绿。
- ✅ **刀② accent 收编 var(--accent)**：8 文件 15 处 `rgba(124,131,255)` → `color-mix(in srgb,var(--accent) X%,transparent)`；`#7c83ff` → `var(--accent)`；canvas 2D（model2d-draw.ts）加 `accentRgba()` 运行时解析（fillStyle 不解析 CSS 变量）；`variables.css --mmd-morph-active-bg` 改派生。roles/switch/vrm-bone-ui 样式串提纯函数（happy-dom 不认 color-mix()，测试直断字符串）。全量 5171 测试 + typecheck + vite build 全绿。
- ⏳ **刀③ _render → tab-panel 常驻**：ADR-163 已立项（`docs/adr/ADR-163-content-page-tab-panel-persistent.md`），待实施。

## 相关

- [frontend_repo_audit](frontend_repo_audit.md)：代码质量基线（4.1/5，2026-08-26）
- [3d-patterns](3d-patterns.md)：R1-P1-1 每帧复用 Vector3 铁律
- [preview_core](preview_core.md)、[render-federation](render-federation.md)：3D 会话外壳与联邦渲染
- [ui_components](ui_components.md)、[dialog-modal](dialog-modal.md)：自研 UI 组件与弹窗基座
