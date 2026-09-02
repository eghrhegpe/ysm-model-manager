---
kind: app-modules
name: 组件入口 app-modules
tier: architecture
category: ui
source_files:
  - frontend/src/app-modules.ts
  - frontend/src/utils/module-loader.ts
  - frontend/src/startup-reveal.ts
auto_fields:
  symbols_with_lines:
    - applyTheme
    - initTheme
    - loadView
    - normalizeTheme
    - revealMainWindow
    - unregisterDevtools
  tests:
    - frontend/src/app-modules.test.ts
  quick_groups:
    - 跨组件通信与页面
  quick_intents:
    - 组件入口、模块装配、启动流程
    - 主题初始化、服务注册、检查更新
    - 新组件注册、import 组件、startup reveal
  quick_risk_lines:
    - 新增 JS 组件必须登记进 app-modules.ts 的 import 列表，致命陷阱 #9
  pitfalls:
    - 新 JS 未登记进 app-modules.ts → 组件不加载、Shadow DOM 未升级；必须在 app-modules.ts 加入口
    - 主题值未归一化 → 脏值污染 localStorage 持久层；必须经 normalizeTheme 白名单过滤
  use_when:
    - 组件入口
    - 模块装配
    - 启动流程
    - 主题初始化
    - 服务注册
    - 检查更新
  perf:
    - io-bound
  invariant_anchors:
    - frontend/src/utils/module-loader.ts|loadView
    - frontend/src/app-modules.ts|register
tests:
  - frontend/src/app-modules.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 组件入口、模块装配、启动流程
  - 主题初始化、服务注册、检查更新
  - 新组件注册、import 组件、startup reveal
quick_risk_lines:
  - 新增 JS 组件必须登记进 app-modules.ts 的 import 列表，致命陷阱 #9
pitfalls:
  - 新 JS 未登记进 app-modules.ts → 组件不加载、Shadow DOM 未升级；必须在 app-modules.ts 加入口
  - 主题值未归一化 → 脏值污染 localStorage 持久层；必须经 normalizeTheme 白名单过滤

use_when:
  - 组件入口
  - 模块装配
  - 启动流程
  - 主题初始化
  - 服务注册
  - 检查更新
perf:
  - io-bound
invariant_anchors:
  - frontend/src/utils/module-loader.ts|loadView
  - frontend/src/app-modules.ts|register
status: active
---

# 组件入口 app-modules

## 概览

`app-modules.ts` 是前端所有 ES module 组件的统一装配入口：注册可替换服务、按「轻量静态 + 重量级动态」策略导入全部 Web Components、注册右键菜单映射、初始化主题与 UI 偏好、静默检查更新。新增组件必须在此文件登记 import（致命陷阱 #9：新 JS 放 `frontend/src/` 并在此加入口）。

## 核心职责

- `app-modules.ts` —
  - 服务注册：`register("loadInstances", ...)`（app-sidebar/loader）与 `register("loadEntries", ...)`（app-tree/loader）写入 `services/registry.ts`
  - 静态导入轻量组件：`context-menu.ts` / `app-toast.ts`（失败直接报错，不 try/catch 以免静默吞错）
  - 动态导入重组件：`app-nav` / `app-tree` / `app-sidebar` / `app-content` / `app-sync-manager`（字面量路径确保 Vite 构建解析，`.catch` 输出 `console.warn` 告警不阻塞）——其中 `app-nav` 通过启动 IIFE（`await initI18n()` 后 `await import`）延迟加载，避免首帧渲染时 i18n bundle 尚未就绪导致 `[i18n]` 缺失 key 警告；`app-resource-manager` 已于 2026-08-24 删除
  - 右键菜单注册：`registerContextMenus()` 由 `core/handlers/global.ts` 经 `registerGlobalHandlers` 单次调用（app-modules.ts 不直接调用）
  - 主题：`applyTheme`（cyber/warm/pro/sakura/ocean/mint/system 白名单，system 跟随 `prefers-color-scheme`）挂 `window.applyTheme`；`initTheme` 从 Go `LoadAppConfig` 或 localStorage 读主题，**归一化后回写合法值**（白名单外回落 system，防脏值污染持久层）；`applyUIPrefs`（定义在 `views/app-content/settings/ui-prefs.ts`，本文件启动 IIFE 内 import 调用）应用字号（`--fs-scale`）/字体/密度/动画开关（`.no-animations`）
  - 启动 IIFE：`initTheme()` → `applyUIPrefs()` → `checkUpdateSilent()` 静默检查更新（**静态导入** `features/version-updater.ts`，非动态 import）
- **窗口显示**：经 `startup-reveal.ts` 的 `revealMainWindow(show)` 控制——等待 DOM 升级 + 两帧 rAF 完成后调 `show()`；rAF 节流兜底 1.5s 超时强制显示（防止隐藏窗口下 Chromium/WebView2 节流导致窗口永久不可见）
  - 杂项：capture 阶段拦截旧版 document 拖拽处理器（`#ws-page` / `#dl-drop` / `.ws-page` 区域）；dev 模式（`?dev=1` 或 localStorage `_devtools`）启用 F12/Ctrl+Shift+I 打开 DevTools（`Window.OpenDevTools`）

## 对外 API / 入口

- 无导出符号（副作用模块），由 HTML 入口以 `<script type="module">` 加载
- 挂载全局：`window.applyTheme(mode)`（类型声明 `Window.applyTheme`）
- 派发 bus：`toast:show`（system 主题跟随切换提示）
- 依赖 Go：`LoadAppConfig`（主题读取）、`features/version-updater.ts` 间接走 updater binding

## 与其他子系统关系

- 装配的全部组件：见知识卡 `app_nav`、`app_toast`、`context_menu`、`app_tree`、`app_sidebar`、`app_content`、`app_resource_manager`、`app_sync_manager`
- 服务注册表：`frontend/src/services/registry.ts`（见知识卡 `resource_registry`），`loadInstances` / `loadEntries` 可被测试替换
- 主题切换与设置页联动：设置页改主题后经 localStorage `theme` + `window.applyTheme` 生效
- 静默更新走 `features/version-updater.ts`（Go 端 `go/updater`）

## 不变量

- 新组件一律在此登记 import；轻量组件静态导入（失败显式报错），重组件动态导入（失败 `console.warn` 告警不阻塞启动）
- 右键菜单只注册一次（由 `global.ts` 调用），重复注册会造成菜单 handler 翻倍（ADR-008）
- 不引入 `window.__*` 全局变量（治理红线 §3.1）；唯一例外是显式声明类型的 `window.applyTheme`
- 主题白名单外的值一律回落 `system`；动画全局开关经 `document.documentElement` 的 `.no-animations` 类控制，组件动画必须响应该类
- **隐私模式 localStorage 读写全部走 safe 包装**（P3 修复：`initTheme` 的 try/catch 两分支、`applyUIPrefs` 四项、`_devtools` 标志——原裸调在存储禁用时抛错会中断启动 IIFE 或中止模块求值）；`?dev=1` 与 `_devtools` 均生效（`_devtools` 无写入方，实际仅 ?dev=1 可用，注释声明）

## 相关

- `frontend/index.html` — 以 module script 引入本文件
- `frontend/src/services/registry.ts` — 服务注册表
- `frontend/src/features/version-updater.ts` — 更新检查
- 知识卡：`app_content`、`context_menu`、`resource_registry`、`event_bus`
