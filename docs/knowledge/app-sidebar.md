---
kind: app_sidebar
name: 侧边栏 app-sidebar
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-sidebar/index.ts
  - frontend/src/views/app-sidebar/tpl.ts
  - frontend/src/views/app-sidebar/data.ts
  - frontend/src/views/app-sidebar/loader.ts
  - frontend/src/views/app-sidebar/render.ts
  - frontend/src/views/app-sidebar/events.ts
  - frontend/src/views/app-sidebar/sidebar-css.ts
use_when:
  - 侧边栏
  - 整合包列表
  - 版本卡片
  - 推送
  - 拉取
  - 一键安装
  - 同步状态
  - 勾选
---

# 侧边栏 app-sidebar

## 概览

`app-sidebar` 是仓库页左栏的整合包列表组件（Shadow DOM），展示当前资源类型下各整合包（Minecraft 版本实例）的同步状态卡片，支持选中联动、勾选批量推送/拉取、一键安装缺失资源。它遵循标准组件拆分规范（index/tpl/data/loader/render/events）。

## 核心职责

- `index.ts` — `<app-sidebar>` 生命周期编排：`observedAttributes: ["rtype"]`、订阅刷新事件、全选/同步所选（推送走 `sync:download:missing` 事件 + correlation token，拉取直调 `PullResourceFromInstance`）、`_reload` 带 `_loading` 并发守卫
- `tpl.ts` — 布局模板：`headerHTML` / `footerHTML` / `listContainerHTML` / `vcHeaderHTML`（版本卡片头）
- `data.ts` — 数据层类型：`SidebarInstance` 接口
- `loader.ts` — `loadInstances(rtype)`：调 Go 拉取实例与同步状态并转换为渲染格式（含 MMD `.pmx` 变体按父文件夹聚合 `groupMmdVariants`），前后派发 `loading:start` / `loading:end`
- `render.ts` — `renderVersionCards`：卡片逐个 `createElement` 入场（40ms 阶梯延迟）
- `events.ts` — `bindCardEvents`（事件委托在 `#vg`，点击派发 `package:selected`、右键派发 `ctx:show` type=instance；localStorage `sb_selectedName_<rtype>` 恢复选中）+ `bindFooter`（MC 路径按钮、完全同步计数动画）
- `sidebar-css.ts` — Shadow DOM 样式表（adoptedStyleSheets）

## 对外 API / 入口

- 自定义元素：`<app-sidebar rtype="ysm">`（属性变更触发 `_reload` 与按钮文案更新）
- 监听 bus：`stats:refresh`（300ms 防抖重载）、`repo:rtype-changed`（随仓库页类型切换重载）、`sync:download:done`（按 token 匹配推送结果，30s 超时）
- 派发 bus：`package:selected`、`ctx:show`、`sync:download:missing`（含 token）、`toast:show`、`stats:refresh`、`tree:reload`、`nav:change`（底部路径按钮跳设置页）、`loading:start` / `loading:end`
- Go 调用：统一经 `getApp()` 取绑定（ADR-012 红线，禁 `window.go.main.App.*`）——`LoadAppConfig` / `ListVersionInstances` / `GetResourceInstanceStatus` / `GetRepoRoot`（loader.ts）、`PullResourceFromInstance`（index.ts 拉取）、`LoadAppConfig` / `SaveAppConfig` / `GetMinecraftPaths`（events.ts bindFooter 自动检测 MC 路径）；「推送到整合包」由 `core/context-menus.ts` 的 `file.push-to-pack` 走 `InstallModelTo`（见知识卡 `context_menu`）
- 导出符号：`loadInstances`（loader.ts，被 `app-modules.ts` 注册为全局服务）

## 与其他子系统关系

- 卡片点击派发 `package:selected` → `app-content` instances 页据此挂载 `<app-sync-manager>`（见知识卡 `app_content`、`app_sync_manager`）
- 右键派发 `ctx:show`（type=instance）→ `core/context-menus.ts` 转 `menu:show`（见知识卡 `context_menu`）
- 推送经 `sync:download:missing` 交给全局同步 handler（`core/handlers/sync.ts` 的 `registerSync`，由 `app-content` 经 `registerGlobalHandlers` 注册）；数据源对应 Go 端 `go/sync` 包与 `internal/app/app_install.go`
- `loadInstances` 经 `services/registry.ts` 注册，可被测试或其他模块替换（见知识卡 `resource_registry`）
- 刷新由 `stats:refresh` 驱动，派发方包括设置页、右键菜单操作、去重流程等

## 不变量

- `bus.on` 订阅全部收进 `_unsubs` 并在 `disconnectedCallback` 清理；`_cardCleanup` / `_docClickHandler`（document 级）同步清理
- `_loading` 守卫防止并发 `_reload`（`_reloadGen` 代数校验丢弃过期结果 + `_pendingReload` 补跑最新 rtype）；`_syncInProgress` 守卫防止推送/拉取并发触发；`stats:refresh` 走 300ms 防抖
- 模块级 `_checkedSets`（按 rtype 隔离的 Map）跨重渲染持久化勾选状态；事件绑定用事件委托 + 「list 未变则复用 handler」防止监听累积
- 渲染后经 `_restoreCheckboxes` 恢复勾选，选中卡片经 localStorage 恢复

## 相关

- `internal/app/app_install.go` — `GetResourceInstanceStatus` / `PullResourceFromInstance` / `InstallModelTo` binding
- `go/sync/` — 整合包同步核心逻辑
- 知识卡：`app_content`、`app_sync_manager`、`context_menu`、`go_sync`、`app_modules`
