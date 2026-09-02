---
kind: app_content_settings
name: 设置页 settings
tier: leaf
category: ui
source_files:
  - frontend/src/views/app-content/settings/init.ts
  - frontend/src/views/app-content/settings/keymap.ts
  - frontend/src/views/app-content/settings/path-cards.ts
  - frontend/src/views/app-content/settings/store.ts
  - frontend/src/views/app-content/settings/theme.ts
  - frontend/src/views/app-content/settings/ui-prefs.ts
  - frontend/src/views/app-content/settings/worker-prefs.ts
auto_fields:
  symbols_with_lines:
    - applyUIPrefs
    - bindPathClick
    - cardRefreshers
    - cfg
    - initAdvancedGrid
    - initKeymap
    - initMcDetect
    - initSettings
    - initTheme
    - initUiPrefs
    - initWorkerPrefs
    - isBusy
    - resetSettingsStore
    - saveCfg
    - setBusy
    - SettingsCfg
    - toastError
  tests:
    - frontend/src/views/app-content/settings/init.test.ts
    - frontend/src/views/app-content/settings/keymap.test.ts
    - frontend/src/views/app-content/settings/theme.test.ts
  quick_groups:
    - 配置与注册表
  quick_intents:
    - 设置页、主题设置、键位、路径配置
    - 界面偏好、字号、worker-prefs
    - settings/init / keymap / store
  quick_risk_lines:
    - 设置项必须经 settings/store.ts 持久化，禁止页面组件各自读写 localStorage
  pitfalls:
    - 各组件各自读写 localStorage → 值不同步、设置页显示与页面行为不一致；必须经 store 单点
    - 键位未持久化 → 重启恢复默认；必须经 store 的 safeSet 落盘
  use_when:
    - 设置页
    - 主题设置
    - 键位
    - 路径配置
    - 界面偏好
  invariant_anchors:
    - frontend/src/views/app-content/settings/init.ts|initSettings
tests:
  - frontend/src/views/app-content/settings/init.test.ts
  - frontend/src/views/app-content/settings/keymap.test.ts
  - frontend/src/views/app-content/settings/theme.test.ts
quick_groups:
  - 配置与注册表
quick_intents:
  - 设置页、主题设置、键位、路径配置
  - 界面偏好、字号、worker-prefs
  - settings/init / keymap / store
quick_risk_lines:
  - 设置项必须经 settings/store.ts 持久化，禁止页面组件各自读写 localStorage
pitfalls:
  - 各组件各自读写 localStorage → 值不同步、设置页显示与页面行为不一致；必须经 store 单点
  - 键位未持久化 → 重启恢复默认；必须经 store 的 safeSet 落盘

use_when:
  - 设置页
  - 主题设置
  - 键位
  - 路径配置
  - 界面偏好
invariant_anchors:
  - frontend/src/views/app-content/settings/init.ts|initSettings
status: active
---

# 设置页 settings

## 概览

`settings/` 是 `app-content` 的「设置」页子域，由主卡 `app-content` 的 `init-pages.ts` 在切到设置页时分发初始化。内部高内聚：`init.ts` 汇聚全部子模块（键位 / 路径卡 / 存储 / 主题 / 界面偏好 / worker 偏好），子模块之间只依赖 `store.ts`，对外只依赖 `core/i18n` / `bus` / `backend` / `utils` / `features/version-updater` 基础设施，**不反向依赖 app-content 其他子域**（归属边界干净，ADR-138 拆分依据）。

## 核心职责

- `init.ts` — 设置页 `initSettings`：直接解构 bindings（`LoadAppConfig` / `SaveAppConfig` / `SelectDirectory` / `GetMinecraftPaths` / `SetLinkMode`），配置变更派发 `config:updated` / `stats:refresh` / `toast:show`，并接入 `initVersionUpdater`；「启动默认页面」下拉读写 localStorage `ui-default-page`，显示值兜底 `repository`（与 `resolveInitialPage` 的兜底一致）
- `store.ts` — 设置存储桥接：`LoadAppConfig` / `SaveAppConfig`（`backend/app.ts`）+ `core/context-menu-shared.ts` 共享
- `keymap.ts` — 键位绑定编辑（依赖 `preview-3d/model3d.ts` 的 `loadTdKeymap`，相机快捷键与 3D 预览键位同源）
- `path-cards.ts` — 路径配置卡片（目录选择器 `utils/dom/directory-picker` + 注册表 `utils/resource/registry`）
- `theme.ts` — 主题设置（写 `window.applyTheme` + localStorage，见知识卡 `theme`）
- `ui-prefs.ts` — 界面偏好（字号 `--fs-scale` / 字体 / 密度 / 动画开关 `.no-animations`），`app-modules` 启动 IIFE 内 import 调用
- `worker-prefs.ts` — worker 线程数偏好

## 对外 API / 入口

- 由主卡 `app-content` 的 `init-pages.ts` 调用：切设置页 → `settings/init.ts` 的 `initSettings(root)`
- 监听 bus：`config:updated` / `stats:refresh` / `toast:show`（配置变更派发）
- 样式：`.stg-*` 设置页样式 + `#set-advanced-panel` 的 advPanel 动画定义在 `app-content` 样式层 `content-stg.ts`（跨子域共享，不随本卡迁移）

## 与其他子系统关系

- `theme`（主题系统）→ `settings/theme.ts` 消费端（设置页入口点选 → `applyTheme` + localStorage）
- `version-updater`（自动更新）→ `settings/init.ts` 的 `initVersionUpdater` 接入
- `preview-3d/model3d.ts` → `settings/keymap.ts` 键位同源
- 主卡 `app-content` 负责页面编排与分发；本卡只管设置页自身的初始化与渲染

## 不变量

- 配置变更三事件（`config:updated` / `stats:refresh` / `toast:show`）必须齐全，否则改配置后界面不刷新
- `ui-default-page` 显示值兜底 `repository`，与 `resolveInitialPage` 的兜底一致
- 主题写回必须过白名单（cyber/warm/pro/sakura/ocean/mint/system），防脏值污染持久层

## 相关

- 主卡：`docs/knowledge/app-content.md`
- 知识卡：`theme`、`version-updater`、`app-modules`、`app-content`
- `frontend/src/views/app-content/content-stg.ts` — 设置页样式层（主卡持有）
