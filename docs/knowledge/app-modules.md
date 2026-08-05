---
kind: app-modules
name: 组件入口 app-modules
tier: architecture
category: ui
source_files:
  - frontend/src/app-modules.ts
use_when:
  - 组件入口
  - 模块装配
  - 启动流程
  - 主题初始化
  - 服务注册
  - 检查更新
  - import 组件
  - 新组件注册
---

# 组件入口 app-modules

## 概览

`app-modules.ts` 是前端所有 ES module 组件的统一装配入口：注册可替换服务、按「轻量静态 + 重量级动态」策略导入全部 Web Components、注册右键菜单映射、初始化主题与 UI 偏好、静默检查更新。新增组件必须在此文件登记 import（致命陷阱 #9：新 JS 放 `frontend/src/` 并在此加入口）。

## 核心职责

- `app-modules.ts` —
  - 服务注册：`register("loadInstances", ...)`（app-sidebar/loader）与 `register("loadEntries", ...)`（app-tree/loader）写入 `services/registry.ts`
  - 静态导入轻量组件：`app-nav.ts` / `context-menu.ts` / `app-toast.ts`（失败直接报错，不 try/catch 以免静默吞错）
  - 动态导入重组件：`app-tree` / `app-sidebar` / `app-content` / `app-resource-manager` / `app-sync-manager`（字面量路径确保 Vite 构建解析，`.catch` 输出 `console.warn` 告警不阻塞）
  - `registerContextMenus()` 注册右键菜单映射（仅此处调用一次）
  - 主题：`applyTheme`（cyber/warm/pro/sakura/ocean/mint/system 白名单，system 跟随 `prefers-color-scheme`）挂 `window.applyTheme`；`initTheme` 从 Go `LoadAppConfig` 或 localStorage 读主题；`applyUIPrefs` 应用字号（`--fs-scale`）/字体/密度/动画开关（`.no-animations`）
  - 启动 IIFE：`initTheme()` → `applyUIPrefs()` → 动态 import `features/version-updater.ts` 的 `checkUpdateSilent()` 静默检查更新
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
- `registerContextMenus()` 只调用一次，重复注册会造成菜单 handler 翻倍（ADR-008）
- 不引入 `window.__*` 全局变量（治理红线 §3.1）；唯一例外是显式声明类型的 `window.applyTheme`
- 主题白名单外的值一律回落 `system`；动画全局开关经 `document.documentElement` 的 `.no-animations` 类控制，组件动画必须响应该类

## 相关

- `frontend/index.html` — 以 module script 引入本文件
- `frontend/src/services/registry.ts` — 服务注册表
- `frontend/src/features/version-updater.ts` — 更新检查
- 知识卡：`app_content`、`context_menu`、`resource_registry`、`event_bus`
