# 知识卡引用深度与耦合分析

> **自动生成**：`node scripts/analyze-knowledge-refs.mjs` 产出，禁止手改。
> 用途：审核范围划定 + 文件浅移决策的依据（量化「卡→源码」深度与「源码→卡」牵动面）。
> 生成时间：2026-08-31T04:56:09.419Z

## 摘要

| 指标 | 值 |
|------|----|
| 知识卡总数 | 134 |
| 分类数 | 6 |
| source_files 引用总数 | 414 |
| 磁盘命中引用 | 414 |
| 缺失引用（漂移） | 0 |
| 卡间互链总数 | 197 |
| 单卡最深引用（目录层数） | 5 |

> 深度口径：`source_files` 路径的目录层数（`a/b/c.ts` → 2）。文件移动决策看「引用该路径的卡数」+「路径深度」双指标。

## 一、分类膨胀度

| 分类 | 卡数 | 引用数 | 最深 | 说明 |
|---|---|---|---|---|
| go | 40 | 115 | 3 | Go 后端包（安装、下载、回收站、YSM 解析等） |
| utils | 33 | 75 | 5 | 工具函数（display、fmt、dom、animation） |
| ui | 28 | 114 | 5 | 前端 UI 组件（tree、sidebar、preview、content） |
| core | 18 | 78 | 5 | 核心基础设施（事件总线、页面状态、Wails 桥接） |
| config | 8 | 18 | 4 | 配置与注册表（resource_types、AppConfig） |
| feature | 7 | 14 | 4 | 业务功能（导入队列、同步、社区） |

## 二、卡 → 源码引用深度榜（Top 30）

| 卡 | 分类 | 引用数 | 命中 | 最深 | 平均深度 |
|---|---|---|---|---|---|
| `app-content` | ui | 28 | 28 | 5 | 4.6 |
| `animation-system` | utils | 10 | 10 | 5 | 4.3 |
| `pointer-events` | core | 9 | 9 | 5 | 4.1 |
| `i18n` | core | 6 | 6 | 5 | 4.5 |
| `i18n_accuracy` | core | 5 | 5 | 5 | 3.4 |
| `dialog-adv-filter` | ui | 2 | 2 | 5 | 5 |
| `dialog-batch-rename` | ui | 2 | 2 | 5 | 5 |
| `dialog-rename` | ui | 2 | 2 | 5 | 5 |
| `dialog-tag-editor` | ui | 2 | 2 | 5 | 5 |
| `dialog-modal` | ui | 1 | 1 | 5 | 5 |
| `optimization_log` | config | 12 | 12 | 4 | 3.4 |
| `preview_panel_declarative` | ui | 9 | 9 | 4 | 4 |
| `render-federation` | utils | 9 | 9 | 4 | 4 |
| `app-sidebar` | ui | 8 | 8 | 4 | 4 |
| `context-menu` | ui | 8 | 8 | 4 | 3.3 |
| `multi_model_select` | ui | 7 | 7 | 4 | 3.4 |
| `preview_core` | utils | 7 | 7 | 4 | 3 |
| `3d-patterns` | ui | 6 | 6 | 4 | 3.5 |
| `global-handlers` | core | 6 | 6 | 4 | 3.7 |
| `preview_menu_session_key` | ui | 6 | 6 | 4 | 4 |
| `utils-export` | utils | 5 | 5 | 4 | 3.2 |
| `bone-tools` | utils | 4 | 4 | 4 | 3.5 |
| `preview_menu_settings_state` | ui | 4 | 4 | 4 | 4 |
| `ysm-anim-pipeline` | utils | 4 | 4 | 4 | 3.8 |
| `ysm-baked` | core | 4 | 4 | 4 | 3.5 |
| `3d-oversize-file-codesplit-feasibility` | ui | 3 | 3 | 4 | 4 |
| `app-toast` | ui | 3 | 3 | 4 | 4 |
| `preview_state` | ui | 3 | 3 | 4 | 4 |
| `resource-registry` | config | 3 | 3 | 4 | 2.3 |
| `android-bridge` | core | 2 | 2 | 4 | 4 |

## 三、源码 → 卡反向引用榜（Top 30，审核牵动面）

> 改某源码文件 → 被多少张卡引用 = 需要核对/更新的卡数。

| 源码路径 | 深度 | 引用卡数 | 引用卡 |
|---|---|---|---|
| `frontend/src/preview-3d/adapters/mount-preview-core.ts` | 4 | 6 | 3d-oversize-file-codesplit-feasibility, 3d-patterns, mount-preview-module-singleton-race, mount3d-584-giant, preview_menu_session_key, render-federation |
| `frontend/src/preview-3d/caps/ground-capability.ts` | 4 | 5 | 3d-oversize-file-codesplit-feasibility, ground-cap-gcbuildmaterialgroup-133, ground_surface_spec, preview_core, render-federation |
| `frontend/src/preview-3d/adapters/mmd-adapter.ts` | 4 | 3 | 3d-oversize-file-codesplit-feasibility, optimization_log, preview_panel_declarative |
| `frontend/src/preview-3d/adapters/ysm-adapter.ts` | 4 | 3 | preview_menu_session_key, preview_panel_declarative, ysm-anim-pipeline |
| `internal/app/app_download.go` | 2 | 3 | app_cycle_injection, go-download, wails-bindings |
| `internal/app/app.go` | 2 | 3 | app_cycle_injection, go-android-platform-guard, wails-bindings |
| `go/litematic/voxel.go` | 2 | 3 | go-litematic, multi_model_select, preview_core |
| `resource_types.json` | 0 | 3 | classify-routing, go-types, resource-registry |
| `frontend/src/views/app-content/settings/init.ts` | 5 | 2 | app-content, pointer-events |
| `frontend/src/views/app-content/site/edit.ts` | 5 | 2 | app-content, pointer-events |
| `frontend/src/core/i18n/locales/en.ts` | 5 | 2 | i18n, i18n_accuracy |
| `frontend/src/core/i18n/locales/ja.ts` | 5 | 2 | i18n, i18n_accuracy |
| `frontend/src/core/i18n/locales/zh-CN.ts` | 5 | 2 | i18n, i18n_accuracy |
| `frontend/src/views/app-preview/skeleton.ts` | 4 | 2 | 3d-patterns, pointer-events |
| `frontend/src/utils/animation/animation.ts` | 4 | 2 | animation-system, ysm-anim-pipeline |
| `frontend/src/utils/animation/molang.ts` | 4 | 2 | animation-system, ysm-anim-pipeline |
| `frontend/src/core/handlers/instance-ops.ts` | 4 | 2 | context-menu, global-handlers |
| `frontend/src/preview-3d/adapters/pack-model-adapter.ts` | 4 | 2 | mc-ao-tint, multi_model_select |
| `frontend/src/views/app-preview/mmd-controls.ts` | 4 | 2 | multi_model_select, preview_panel_declarative |
| `frontend/src/views/app-preview/litematic-3d.ts` | 4 | 2 | multi_model_select, pointer-events |
| `frontend/src/views/app-tree/toolbar-events.ts` | 4 | 2 | pointer-events, toolbar-search |
| `frontend/src/preview-3d/caps/sky-capability.ts` | 4 | 2 | preview_core, render-federation |
| `frontend/src/views/app-preview/ysm-controls.ts` | 4 | 2 | preview_menu_session_key, preview_panel_declarative |
| `frontend/src/preview-3d/state/preview-state.ts` | 4 | 2 | preview_menu_settings_state, preview_state |
| `frontend/src/preview-3d/menu/settings.ts` | 4 | 2 | preview_menu_settings_state, preview_state |
| `frontend/src/preview-3d/menu/node-types.ts` | 4 | 2 | preview_panel_declarative, preview_state |
| `frontend/src/preview-3d/ysm-animation-player.ts` | 3 | 2 | animation-system, ysm-anim-pipeline |
| `frontend/src/views/app-nav` | 3 | 2 | app-nav, resource-packs |
| `frontend/src/backend/app.ts` | 3 | 2 | backend-idb, wails-bridge |
| `frontend/src/backend/browser-adapter.ts` | 3 | 2 | backend-idb, wails-bridge |

## 四、引用孤岛

- **零源码引用卡**（3 张）：`extensibility-index-reconciliation`, `extensibility-index`, `extensibility-round2`
- **零互链卡**（46 张）：`3d-oversize-file-codesplit-feasibility`, `3d-patterns`, `android-bridge`, `android-events`, `app-nav`, `app_cycle_injection`, `doctor_gate_overlap`, `dom-storage`, `event-graph-guard`, `extensibility-index`, `extensibility-round2`, `fbx-cli-pipeline`, `format-ysm-anim-config`, `frontend_repo_audit`, `frontend_test_audit`, `go-android-platform-guard`, `go-avatar-decode`, `go-config`, `go-executil`, `go-launcher`, `go-scanner`, `go-testutil`, `ground-cap-gcbuildmaterialgroup-133`, `ground_surface_spec`, `ik_solver`, `mc-ao-tint`, `mount-preview-module-singleton-race`, `mount3d-584-giant`, `multi_model_select`, `optimization_log`, `pointer-events`, `preview_3d_migration`, `preview_menu_session_key`, `preview_menu_settings_state`, `preview_panel_declarative`, `preview_state`, `render-federation`, `rust-android-bridge`, `scene_capability_registry`, `scripts_argv`, `scripts_jscpd_go`, `test-utils`, `utils-array`, `vitest-env-switch`, `worker-bridge-settleerror-fallback`, `ysm-anim-pipeline`

## 五、缺失引用（漂移，需修复）

*无。全部 source_files 命中磁盘。*

## 六、完整卡 → 源码引用明细

### `app-content`（ui，引用 28/28，最深 5 层）

- `frontend/src/views/app-content/`
- `frontend/src/views/app-content/content-creator.ts`
- `frontend/src/views/app-content/content-diag.ts`
- `frontend/src/views/app-content/content-util.ts`
- `frontend/src/views/app-content/site/render.ts`
- `frontend/src/views/app-content/community-data.ts`
- `frontend/src/views/app-content/diagnostics/init.ts`
- `frontend/src/views/app-content/diagnostics/logs.ts`
- `frontend/src/views/app-content/diagnostics/dedup.ts`
- `frontend/src/views/app-content/diagnostics/health.ts`
- `frontend/src/views/app-content/diagnostics/conflicts.ts`
- `frontend/src/views/app-content/settings/init.ts`
- `frontend/src/views/app-content/tpl-recycle.ts`
- `frontend/src/views/app-content/tpl-settings.ts`
- `frontend/src/views/app-content/tpl-settings-about.ts`
- `frontend/src/views/app-content/settings/store.ts`
- `frontend/src/views/app-content/settings/path-cards.ts`
- `frontend/src/views/app-content/settings/theme.ts`
- `frontend/src/views/app-content/settings/ui-prefs.ts`
- `frontend/src/views/app-content/settings/keymap.ts`
- `frontend/src/views/app-content/site-view.ts`
- `frontend/src/views/app-content/site/drag.ts`
- `frontend/src/views/app-content/site/edit.ts`
- `frontend/src/views/app-content/site/events.ts`
- `frontend/src/views/app-content/site/render.ts`
- `frontend/src/views/app-content/site/types.ts`
- `frontend/src/views/app-content/workshop-data.ts`
- `frontend/src/utils/icon/workshop-icons.ts`

### `animation-system`（utils，引用 10/10，最深 5 层）

- `frontend/src/utils/animation/animation.ts`
- `frontend/src/utils/animation/animate.ts`
- `frontend/src/utils/animation/stagger.ts`
- `frontend/src/utils/animation/molang.ts`
- `frontend/src/utils/animation/animation-controller.ts`
- `frontend/src/utils/animation/molang-lib/molang.js`
- `frontend/src/utils/animation/molang-lib/easing.js`
- `frontend/src/utils/animation/molang-lib/math.js`
- `frontend/src/utils/animation/molang-lib/molang-prism-syntax.js`
- `frontend/src/preview-3d/ysm-animation-player.ts`

### `pointer-events`（core，引用 9/9，最深 5 层）

- `frontend/src/preview-3d/adapters/input-and-animation.ts`
- `frontend/src/preview-3d/model2d.ts`
- `frontend/src/views/app-preview/zoom.ts`
- `frontend/src/views/app-preview/skeleton.ts`
- `frontend/src/views/app-preview/litematic-3d.ts`
- `frontend/src/views/app-content/index.ts`
- `frontend/src/views/app-content/settings/init.ts`
- `frontend/src/views/app-content/site/edit.ts`
- `frontend/src/views/app-tree/toolbar-events.ts`

### `i18n`（core，引用 6/6，最深 5 层）

- `frontend/src/core/i18n/t.ts`
- `frontend/src/core/i18n/tr.ts`
- `frontend/src/core/i18n/locale.ts`
- `frontend/src/core/i18n/locales/en.ts`
- `frontend/src/core/i18n/locales/ja.ts`
- `frontend/src/core/i18n/locales/zh-CN.ts`

### `i18n_accuracy`（core，引用 5/5，最深 5 层）

- `frontend/src/core/i18n/locales/zh-CN.ts`
- `frontend/src/core/i18n/locales/en.ts`
- `frontend/src/core/i18n/locales/ja.ts`
- `scripts/i18n-key-naming.mjs`
- `tests/test_i18n_key_naming.mjs`

### `dialog-adv-filter`（ui，引用 2/2，最深 5 层）

- `frontend/src/utils/dom/dialogs/adv-filter.ts`
- `frontend/src/utils/dom/dialogs/adv-filter-util.ts`

### `dialog-batch-rename`（ui，引用 2/2，最深 5 层）

- `frontend/src/utils/dom/dialogs/batch-rename.ts`
- `frontend/src/utils/dom/dialogs/batch-rename-util.ts`

### `dialog-rename`（ui，引用 2/2，最深 5 层）

- `frontend/src/utils/dom/dialogs/rename.ts`
- `frontend/src/utils/dom/dialogs/rename-format.ts`

### `dialog-tag-editor`（ui，引用 2/2，最深 5 层）

- `frontend/src/utils/dom/dialogs/tag-editor.ts`
- `frontend/src/utils/dom/dialogs/tag-set.ts`

### `dialog-modal`（ui，引用 1/1，最深 5 层）

- `frontend/src/utils/dom/dialogs/modal.ts`

### `optimization_log`（config，引用 12/12，最深 4 层）

- `frontend/src/preview-3d/adapters/mmd-adapter.ts`
- `frontend/src/preview-3d/adapters/mmd-ktx2-encoder.ts`
- `frontend/src/preview-3d/adapters/mmd-ktx2-basis.ts`
- `frontend/src/preview-3d/adapters/mmd-ktx2-worker.ts`
- `frontend/src/preview-3d/adapters/mmd-ktx2-texture-loader.ts`
- `frontend/src/preview-3d/adapters/mmd-pmx-parser.ts`
- `frontend/src/preview-3d/adapters/mmd-pmx-parser.worker.ts`
- `frontend/src/preview-3d/adapters/mmd-texture-decoder.ts`
- `frontend/src/utils/main-thread-watch.ts`
- `internal/app/app_model.go`
- `internal/app/app_texture_cache.go`
- `go/texture_cache/texture_cache.go`

### `preview_panel_declarative`（ui，引用 9/9，最深 4 层）

- `frontend/src/preview-3d/menu/core.ts`
- `frontend/src/preview-3d/menu/render.ts`
- `frontend/src/preview-3d/menu/node-types.ts`
- `frontend/src/preview-3d/adapters/mmd-adapter.ts`
- `frontend/src/preview-3d/adapters/ysm-adapter.ts`
- `frontend/src/preview-3d/adapters/morph-controls.ts`
- `frontend/src/views/app-preview/mmd-controls.ts`
- `frontend/src/views/app-preview/ysm-controls.ts`
- `frontend/src/views/app-preview/shot-panel-shared.ts`

### `render-federation`（utils，引用 9/9，最深 4 层）

- `frontend/src/preview-3d/caps/scene-capability-registry.ts`
- `frontend/src/preview-3d/caps/sky-capability.ts`
- `frontend/src/preview-3d/caps/ground-capability.ts`
- `frontend/src/preview-3d/caps/light-capability.ts`
- `frontend/src/preview-3d/caps/postprocessing-capability.ts`
- `frontend/src/preview-3d/caps/environment-capability.ts`
- `frontend/src/preview-3d/caps/fog-capability.ts`
- `frontend/src/preview-3d/caps/shadow-capability.ts`
- `frontend/src/preview-3d/adapters/mount-preview-core.ts`

### `app-sidebar`（ui，引用 8/8，最深 4 层）

- `frontend/src/views/app-sidebar/index.ts`
- `frontend/src/views/app-sidebar/tpl.ts`
- `frontend/src/views/app-sidebar/data.ts`
- `frontend/src/views/app-sidebar/loader.ts`
- `frontend/src/views/app-sidebar/render.ts`
- `frontend/src/views/app-sidebar/events.ts`
- `frontend/src/views/app-sidebar/sidebar-css.ts`
- `frontend/src/views/app-sidebar/launcher-detect.ts`

### `context-menu`（ui，引用 8/8，最深 4 层）

- `frontend/src/views/context-menu/index.ts`
- `frontend/src/core/context-menus.ts`
- `frontend/src/core/menu-defs.ts`
- `frontend/src/core/context-menu-dir-handlers.ts`
- `frontend/src/core/context-menu-file-handlers.ts`
- `frontend/src/core/context-menu-handlers.ts`
- `frontend/src/core/context-menu-shared.ts`
- `frontend/src/core/handlers/instance-ops.ts`

### `multi_model_select`（ui，引用 7/7，最深 4 层）

- `frontend/src/preview-3d/menu/multi-model.ts`
- `frontend/src/views/app-preview/mmd-controls.ts`
- `frontend/src/preview-3d/adapters/pack-model-adapter.ts`
- `frontend/src/preview-3d/adapters/litematic-adapter.ts`
- `frontend/src/views/app-preview/litematic-3d.ts`
- `internal/app/container_entries.go`
- `go/litematic/voxel.go`

### `preview_core`（utils，引用 7/7，最深 4 层）

- `frontend/src/preview-3d/adapters/`
- `frontend/src/preview-3d/bone-tools.ts`
- `frontend/src/preview-3d/caps/sky-capability.ts`
- `frontend/src/preview-3d/caps/ground-capability.ts`
- `internal/app/container_entries.go`
- `go/litematic/voxel.go`
- `frontend/src/backend/web-fs.ts`

### `3d-patterns`（ui，引用 6/6，最深 4 层）

- `frontend/src/preview-3d/debug-render.ts`
- `frontend/src/preview-3d/model-group-builder.ts`
- `frontend/src/preview-3d/adapters/mount-preview-core.ts`
- `frontend/src/preview-3d/cleanup-helper.ts`
- `frontend/src/views/app-preview/preview-library.ts`
- `frontend/src/views/app-preview/skeleton.ts`

### `global-handlers`（core，引用 6/6，最深 4 层）

- `frontend/src/core/handlers/global.ts`
- `frontend/src/features/import-dnd.ts`
- `frontend/src/core/handlers/instance-ops.ts`
- `frontend/src/core/handlers/sync.ts`
- `frontend/src/core/handlers/require-mcroot.ts`
- `frontend/src/core/error-diary.ts`

### `preview_menu_session_key`（ui，引用 6/6，最深 4 层）

- `frontend/src/preview-3d/adapters/schema-registry.ts`
- `frontend/src/views/app-preview/ysm-controls.ts`
- `frontend/src/preview-3d/adapters/ysm-adapter.ts`
- `frontend/src/preview-3d/adapters/mount-preview-core.ts`
- `frontend/src/preview-3d/adapters/switch-preview.ts`
- `frontend/src/views/app-preview/skeleton-fill-panel.ts`

### `utils-export`（utils，引用 5/5，最深 4 层）

- `frontend/src/preview-3d/screenshot-render.ts`
- `frontend/src/preview-3d/screenshot-lights.ts`
- `frontend/src/preview-3d/texture-loader.ts`
- `frontend/src/preview-3d/decoder/cache.ts`
- `frontend/src/preview-3d/screenshot.ts`

### `bone-tools`（utils，引用 4/4，最深 4 层）

- `frontend/src/preview-3d/bone-tools.ts`
- `frontend/src/preview-3d/adapters/vrm-bone.ts`
- `frontend/src/preview-3d/adapters/vrm-bone-ui.ts`
- `frontend/src/preview-3d/mmd-bones.ts`

### `preview_menu_settings_state`（ui，引用 4/4，最深 4 层）

- `frontend/src/preview-3d/state/preview-state.ts`
- `frontend/src/preview-3d/menu/settings.ts`
- `frontend/src/preview-3d/menu/cap-controls.ts`
- `frontend/src/preview-3d/caps/scene-capability.ts`

### `ysm-anim-pipeline`（utils，引用 4/4，最深 4 层）

- `frontend/src/preview-3d/ysm-animation-player.ts`
- `frontend/src/preview-3d/adapters/ysm-adapter.ts`
- `frontend/src/utils/animation/molang.ts`
- `frontend/src/utils/animation/animation.ts`

### `ysm-baked`（core，引用 4/4，最深 4 层）

- `frontend/src/preview-3d/decoder/wasm-decode.ts`
- `frontend/src/preview-3d/decoder/geometry.ts`
- `frontend/public/wasm/YSMParser.js`
- `frontend/public/wasm/YSMParser.wasm`

### `3d-oversize-file-codesplit-feasibility`（ui，引用 3/3，最深 4 层）

- `frontend/src/preview-3d/adapters/mmd-adapter.ts`
- `frontend/src/preview-3d/adapters/mount-preview-core.ts`
- `frontend/src/preview-3d/caps/ground-capability.ts`

### `app-toast`（ui，引用 3/3，最深 4 层）

- `frontend/src/views/app-toast/index.ts`
- `frontend/src/utils/dom/feedback.ts`
- `frontend/src/utils/dom/toast-ms.ts`

### `preview_state`（ui，引用 3/3，最深 4 层）

- `frontend/src/preview-3d/state/preview-state.ts`
- `frontend/src/preview-3d/menu/settings.ts`
- `frontend/src/preview-3d/menu/node-types.ts`

### `resource-registry`（config，引用 3/3，最深 4 层）

- `resource_types.json`
- `frontend/src/services/registry.ts`
- `frontend/src/utils/resource/registry.ts`

### `android-bridge`（core，引用 2/2，最深 4 层）

- `frontend/src/utils/dom/android-bridge.ts`
- `frontend/src/utils/dom/directory-picker.ts`

### `app-tree`（ui，引用 2/2，最深 4 层）

- `frontend/src/views/app-tree/index.ts`
- `frontend/src/views/app-tree/`

### `ground_surface_spec`（utils，引用 2/2，最深 4 层）

- `frontend/src/preview-3d/caps/ground-surface-spec.ts`
- `frontend/src/preview-3d/caps/ground-capability.ts`

### `mc-ao-tint`（utils，引用 2/2，最深 4 层）

- `frontend/src/preview-3d/adapters/pack-model-adapter.ts`
- `frontend/src/preview-3d/mc-tints.ts`

### `model3d`（utils，引用 2/2，最深 4 层）

- `frontend/src/preview-3d/`
- `frontend/src/views/app-preview/model3d-loader.ts`

### `resource-packs`（feature，引用 2/2，最深 4 层）

- `frontend/src/views/app-preview/detail.ts`
- `frontend/src/views/app-nav/`

### `scene_capability_registry`（utils，引用 2/2，最深 4 层）

- `frontend/src/preview-3d/caps/`
- `frontend/src/preview-3d/adapters/scene-registry.ts`

### `shared-styles`（ui，引用 2/2，最深 4 层）

- `frontend/src/utils/dom/css.ts`
- `frontend/src/views/app-tree/app-tree-styles.ts`

### `toolbar-search`（ui，引用 2/2，最深 4 层）

- `frontend/src/views/app-tree/toolbar-search.ts`
- `frontend/src/views/app-tree/toolbar-events.ts`

### `utils-mc-format`（utils，引用 2/2，最深 4 层）

- `frontend/src/utils/format/mc-format.ts`
- `frontend/src/utils/format/pack-format.ts`

### `android-events`（core，引用 1/1，最深 4 层）

- `frontend/src/core/handlers/android-events.ts`

### `dom-fab`（ui，引用 1/1，最深 4 层）

- `frontend/src/utils/dom/fab.ts`

### `dom-storage`（utils，引用 1/1，最深 4 层）

- `frontend/src/utils/dom/storage.ts`

### `dom_tooltip`（utils，引用 1/1，最深 4 层）

- `frontend/src/utils/dom/tooltip.ts`

### `format-ysm-anim-config`（utils，引用 1/1，最深 4 层）

- `frontend/src/utils/format/ysm-anim-config.ts`

### `ground-cap-gcbuildmaterialgroup-133`（utils，引用 1/1，最深 4 层）

- `frontend/src/preview-3d/caps/ground-capability.ts`

### `mount-preview-module-singleton-race`（utils，引用 1/1，最深 4 层）

- `frontend/src/preview-3d/adapters/mount-preview-core.ts`

### `mount3d-584-giant`（utils，引用 1/1，最深 4 层）

- `frontend/src/preview-3d/adapters/mount-preview-core.ts`

### `utils-display`（utils，引用 1/1，最深 4 层）

- `frontend/src/utils/dom/display.ts`

### `utils-errors`（utils，引用 1/1，最深 4 层）

- `frontend/src/utils/dom/errors.ts`

### `utils-extensions`（utils，引用 1/1，最深 4 层）

- `frontend/src/utils/resource/extensions.ts`

### `utils-fmt`（utils，引用 1/1，最深 4 层）

- `frontend/src/utils/dom/format.ts`

### `utils-icon`（utils，引用 1/1，最深 4 层）

- `frontend/src/utils/icon/icon.ts`

### `utils-misc`（utils，引用 1/1，最深 4 层）

- `frontend/src/utils/debug/debug.ts`

### `utils-summarize`（utils，引用 1/1，最深 4 层）

- `frontend/src/utils/format/summarize.ts`

### `worker-bridge-settleerror-fallback`（utils，引用 1/1，最深 4 层）

- `frontend/src/preview-3d/adapters/worker-bridge.ts`

### `backend-idb`（core，引用 13/13，最深 3 层）

- `frontend/src/backend/idb.ts`
- `frontend/src/backend/types.ts`
- `frontend/src/backend/app.ts`
- `frontend/src/backend/browser-adapter.ts`
- `frontend/src/backend/web-common.ts`
- `frontend/src/backend/web-fs.ts`
- `frontend/src/backend/web-store.ts`
- `frontend/src/backend/web-stats.ts`
- `frontend/src/backend/web-community.ts`
- `frontend/src/backend/platform.ts`
- `frontend/src/workers/stats-core.ts`
- `frontend/src/workers/stats-protocol.ts`
- `frontend/src/workers/stats.worker.ts`

### `import-queue`（feature，引用 5/5，最深 3 层）

- `frontend/src/features/import-executor.ts`
- `frontend/src/features/import-dnd.ts`
- `frontend/src/features/dnd-shared.ts`
- `frontend/src/features/dnd-collector.ts`
- `frontend/src/features/pack-dnd.ts`

### `model-stats`（core，引用 4/4，最深 3 层）

- `frontend/src/workers/stats-core.ts`
- `frontend/src/workers/stats-protocol.ts`
- `frontend/src/workers/stats.worker.ts`
- `frontend/src/backend/web-stats.ts`

### `ui-slide-menu`（ui，引用 4/4，最深 3 层）

- `frontend/src/ui/ui-slide-menu.ts`
- `frontend/src/ui/ui-slide-menu-styles.ts`
- `frontend/src/ui/ui-helpers.ts`
- `frontend/src/ui/ui-components-styles.ts`

### `wails-bridge`（core，引用 4/4，最深 3 层）

- `frontend/src/backend/app.ts`
- `frontend/src/backend/platform.ts`
- `frontend/src/backend/extract.ts`
- `frontend/src/backend/browser-adapter.ts`

### `app-modules`（ui，引用 3/3，最深 3 层）

- `frontend/src/app-modules.ts`
- `frontend/src/utils/module-loader.ts`
- `frontend/src/startup-reveal.ts`

### `cli_quality_audit`（go，引用 3/3，最深 3 层）

- `go/cli/`
- `internal/app/cli_bridge.go`
- `frontend/src/services/cli-bridge.ts`

### `utils-resource-types`（utils，引用 3/3，最深 3 层）

- `frontend/src/utils/resource/`
- `frontend/src/utils/types-re-export.ts`
- `frontend/src/features/repo-rtype.ts`

### `community-feature`（feature，引用 2/2，最深 3 层）

- `frontend/src/features/community/`
- `frontend/src/utils/gh-links.ts`

### `ik_solver`（core，引用 2/2，最深 3 层）

- `frontend/src/preview-3d/ik-solver.ts`
- `frontend/src/preview-3d/mmd-foot-ik.ts`

### `app-nav`（ui，引用 1/1，最深 3 层）

- `frontend/src/views/app-nav/`

### `app-preview`（ui，引用 1/1，最深 3 层）

- `frontend/src/views/app-preview/`

### `app-sync-manager`（ui，引用 1/1，最深 3 层）

- `frontend/src/views/app-sync-manager/`

### `core_utils`（utils，引用 1/1，最深 3 层）

- `frontend/src/utils/core/`

### `go-testutil`（go，引用 1/1，最深 3 层）

- `go/internal/testutil/testutil.go`

### `model2d`（utils，引用 1/1，最深 3 层）

- `frontend/src/preview-3d/model2d.ts`

### `oldest-models`（feature，引用 1/1，最深 3 层）

- `frontend/src/features/oldest-models.ts`

### `page-store`（core，引用 1/1，最深 3 层）

- `frontend/src/core/page-store.ts`

### `perception`（utils，引用 1/1，最深 3 层）

- `frontend/src/preview-3d/perception/`

### `recycle-bin`（feature，引用 1/1，最深 3 层）

- `frontend/src/features/recycle-bin.ts`

### `safe_error_msg`（utils，引用 1/1，最深 3 层）

- `frontend/src/utils/safe-error-msg.ts`

### `utils-array`（utils，引用 1/1，最深 3 层）

- `frontend/src/utils/array.ts`

### `utils-dom`（utils，引用 1/1，最深 3 层）

- `frontend/src/utils/dom/`

### `version-updater`（feature，引用 1/1，最深 3 层）

- `frontend/src/features/version-updater.ts`

### `rust-android-bridge`（core，引用 12/12，最深 2 层）

- `go/rustbridge/bridge_android.go`
- `go/rustbridge/bridge_linux.go`
- `go/rustbridge/bridge_darwin.go`
- `go/rustbridge/types.go`
- `go/scanner/rust_backend_android.go`
- `go/scanner/rust_backend_linux.go`
- `go/scanner/rust_backend_darwin.go`
- `scripts/compile-android-rust.mjs`
- `scripts/compile-rust-static.mjs`
- `scripts/android-build.mjs`
- `build/linux/Taskfile.yml`
- `build/darwin/Taskfile.yml`

### `wails-bindings`（go，引用 12/12，最深 2 层）

- `internal/app/app.go`
- `internal/app/app_avatar.go`
- `internal/app/app_config.go`
- `internal/app/app_download.go`
- `internal/app/app_files.go`
- `internal/app/app_install.go`
- `internal/app/app_model.go`
- `internal/app/app_scan.go`
- `internal/app/app_tags.go`
- `internal/app/app_workshop.go`
- `internal/app/resource_bindings.go`
- `internal/app/wasm_embed.go`

### `go-sync`（go，引用 11/11，最深 2 层）

- `go/sync/sync.go`
- `go/sync/sync_diff.go`
- `go/sync/sync_hash.go`
- `go/sync/sync_dirlevel.go`
- `go/sync/sync_discovery.go`
- `go/sync/sync_push.go`
- `go/sync/sync_relink.go`
- `go/sync/conflict.go`
- `go/sync/sync_cache.go`
- `go/fsutil/hardlink_windows.go`
- `go/fsutil/hardlink_other.go`

### `go-fsutil`（go，引用 9/9，最深 2 层）

- `go/fsutil/walk.go`
- `go/fsutil/write.go`
- `go/fsutil/copy.go`
- `go/fsutil/perms.go`
- `go/fsutil/bom.go`
- `go/fsutil/b64.go`
- `go/fsutil/hardlink_other.go`
- `go/fsutil/crossdevice_other.go`
- `go/fsutil/`

### `rustbridge`（go，引用 9/9，最深 2 层）

- `go/rustbridge/bridge_windows.go`
- `go/rustbridge/doc.go`
- `go/rustbridge/embedded_windows.go`
- `go/rustbridge/types_windows.go`
- `go/rustbridge/common.go`
- `rust-core/src/model.rs`
- `rust-core/src/policy.rs`
- `rust-core/src/scan.rs`
- `rust-wails-bridge/`

### `go-litematic`（go，引用 8/8，最深 2 层）

- `go/litematic/parser.go`
- `go/litematic/schematic.go`
- `go/litematic/structure.go`
- `go/litematic/bedrock.go`
- `go/litematic/palette.go`
- `go/litematic/nbt.go`
- `go/litematic/voxel.go`
- `go/litematic/`

### `go-android-platform-guard`（go，引用 7/7，最深 2 层）

- `internal/app/app_files.go`
- `internal/app/app_scan.go`
- `internal/app/app_config.go`
- `internal/app/wasm_decoder.go`
- `internal/app/app.go`
- `internal/app/app_config_android.go`
- `internal/app/pathmgr_android.go`

### `go-types`（go，引用 7/7，最深 2 层）

- `go/types/types.go`
- `go/types/config.go`
- `go/types/resource.go`
- `go/types/extensions.go`
- `go/types/bedrock.go`
- `go/types/`
- `resource_types.json`

### `classify-routing`（go，引用 3/3，最深 2 层）

- `go/types/classify.go`
- `go/types/resource.go`
- `resource_types.json`

### `go-geometry`（go，引用 3/3，最深 2 层）

- `go/geometry/parse.go`
- `go/geometry/archive.go`
- `go/geometry/ysm_parser.go`

### `theme`（core，引用 3/3，最深 2 层）

- `frontend/src/app-modules.ts`
- `frontend/src/theme-core.ts`
- `frontend/css/variables.css`

### `ysm-wasm`（utils，引用 3/3，最深 2 层）

- `frontend/src/wasm/`
- `internal/app/wasm_decoder.go`
- `go/avatar/avatar_decode.go`

### `app_cycle_injection`（go，引用 2/2，最深 2 层）

- `internal/app/app_download.go`
- `internal/app/app.go`

### `go-avatar`（go，引用 2/2，最深 2 层）

- `go/avatar/avatar.go`
- `go/avatar/`

### `go-cli-search`（go，引用 2/2，最深 2 层）

- `go/cli/model.go`
- `go/cli/cli.go`

### `go-download`（go，引用 2/2，最深 2 层）

- `go/download/`
- `internal/app/app_download.go`

### `go-executil`（go，引用 2/2，最深 2 层）

- `go/executil/hidewindow_windows.go`
- `go/executil/hidewindow_other.go`

### `go-installer`（go，引用 2/2，最深 2 层）

- `go/installer/installer.go`
- `go/installer/`

### `go-logs`（go，引用 2/2，最深 2 层）

- `go/logs/logs.go`
- `go/logs/runtime.go`

### `go-packs`（go，引用 2/2，最深 2 层）

- `go/packs/mcmeta.go`
- `go/packs/`

### `go-tags`（go，引用 2/2，最深 2 层）

- `go/tags/tags.go`
- `go/tags/`

### `go-threejs`（go，引用 2/2，最深 2 层）

- `go/threejs/spec.go`
- `go/threejs/`

### `backend_web`（core，引用 1/1，最深 2 层）

- `frontend/src/backend/`

### `event-bus`（core，引用 1/1，最深 2 层）

- `frontend/src/bus.ts`

### `go-avatar-decode`（go，引用 1/1，最深 2 层）

- `go/avatar/avatar_decode.go`

### `go-config`（go，引用 1/1，最深 2 层）

- `go/config/config.go`

### `go-container`（go，引用 1/1，最深 2 层）

- `go/container/container.go`

### `go-launcher`（go，引用 1/1，最深 2 层）

- `go/launcher/detect.go`

### `go-version`（go，引用 1/1，最深 2 层）

- `go/version/version.go`

### `scripts_argv`（config，引用 1/1，最深 2 层）

- `scripts/_lib/parse-args.mjs`

### `test-utils`（ui，引用 1/1，最深 2 层）

- `frontend/src/test-utils/`

### `ui_components`（ui，引用 1/1，最深 2 层）

- `frontend/src/ui/`

### `doctor_gate_overlap`（go，引用 3/3，最深 1 层）

- `scripts/doctor.mjs`
- `scripts/pre-push-gate.mjs`
- `scripts/check-redlines.mjs`

### `frontend_test_audit`（core，引用 3/3，最深 1 层）

- `tests/`
- `frontend/e2e/`
- `frontend/e2e-web/`

### `fbx-cli-pipeline`（go，引用 2/2，最深 1 层）

- `go/cli/`
- `scripts/`

### `preview_3d_migration`（feature，引用 2/2，最深 1 层）

- `scripts/pre-push-gate.mjs`
- `scripts/check-dynamic-import.mjs`

### `drift-scan`（go，引用 1/1，最深 1 层）

- `scripts/drift-scan.mjs`

### `event-graph-guard`（core，引用 1/1，最深 1 层）

- `scripts/event-graph.mjs`

### `frontend_repo_audit`（ui，引用 1/1，最深 1 层）

- `frontend/src/`

### `go-dedup`（go，引用 1/1，最深 1 层）

- `go/dedup/`

### `go-fileops`（go，引用 1/1，最深 1 层）

- `go/fileops/`

### `go-importer`（go，引用 1/1，最深 1 层）

- `go/importer/`

### `go-instance`（go，引用 1/1，最深 1 层）

- `go/instance/`

### `go-paths`（go，引用 1/1，最深 1 层）

- `go/paths/`

### `go-recycle`（go，引用 1/1，最深 1 层）

- `go/recycle/`

### `go-scanner`（go，引用 1/1，最深 1 层）

- `go/scanner/`

### `go-updater`（go，引用 1/1，最深 1 层）

- `go/updater/`

### `go-watcher`（go，引用 1/1，最深 1 层）

- `go/watcher/`

### `go-ysm-parser`（go，引用 1/1，最深 1 层）

- `go/ysm/`

### `go_repoaudit`（go，引用 1/1，最深 1 层）

- `go/repoaudit/`

### `scripts_jscpd_go`（config，引用 1/1，最深 1 层）

- `scripts/jscpd-go.mjs`

### `vitest-env-switch`（config，引用 1/1，最深 1 层）

- `frontend/vitest.config.ts`

### `extensibility-index-reconciliation`（config，引用 0/0，最深 0 层）

*无引用*

### `extensibility-index`（config，引用 0/0，最深 0 层）

*无引用*

### `extensibility-round2`（config，引用 0/0，最深 0 层）

*无引用*

## 七、浅移决策建议（依据上面的量化结果）

> 以下为**数据驱动的候选动作**，仅作决策输入，需人工/ADR 拍板后执行。

**深度 ≥5 的引用路径共 32 个，按区域分布：**

| 区域 | 路径数 |
|---|---|
| views | 16 |
| utils | 13 |
| core | 3 |

**候选动作（按收益排序）：**

1. **`preview-3d/` 已随 ADR-138 上提为 `src/preview-3d`（深度 5→4）**，≥5 层引用清零，
   深度问题已消解——后续只需对剩余区域按上表分布关注。
2. **`app-content` 卡引用 28 个文件**（全库最大引用面），是分类膨胀的样本。候选：按子视图
   （site / settings / diagnostics / content）拆分卡片，让审核范围可细化。
3. **Go 端最深仅 3 层**（`go/`、`internal/` 路径天然浅），**无需移动**——深度问题全部在前端。
4. **零互链卡 46 张**中，`frontend_test_audit` / `cli_quality_audit` 等审计报告型卡是历史快照，
   可归档到 `docs/review/` 而非知识卡目录（卡目录保持「可导航的活文档」）。
5. 移动任何源码前，先跑 `node scripts/check-knowledge-drift.mjs --affected <新路径>` 验证卡面
   同步；源码移动后统一 `node scripts/gen-knowledge-index.mjs` 刷新索引。
