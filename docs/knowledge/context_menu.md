---
kind: context_menu
name: 右键菜单系统
tier: architecture
category: ui
source_files:
  - frontend/js/components/context-menu.ts
  - frontend/js/core/context-menus.ts
  - frontend/js/core/menu-defs.ts
use_when:
  - 右键菜单
  - 右键
  - 上下文菜单
  - ctx:show
  - menu:show
  - 批量操作
  - 移入回收站
  - 重命名
---

# 右键菜单系统

## 概览

右键菜单系统采用「声明与行为分离」的三层结构：`menu-defs.ts` 声明菜单结构（唯一事实来源），`context-menus.ts` 把 `ctx:show` 事件翻译成带行为的 `menu:show` 载荷，`context-menu.ts` 是纯渲染容器。四类菜单（整合包 instance / 多选 batch / 文件 file / 目录 dir）覆盖重命名、移动、复制、推送到整合包、标签编辑、回收站等全部右键操作。

## 核心职责

- `components/context-menu.ts` — `<context-menu>` 渲染容器：监听 `menu:show({ x, y, items })` 渲染菜单项（label/icon/danger/divider，逐项入场动画）、绑定点击回调、视口边界检测（先移到 -9999px 离屏测量再经 `requestAnimationFrame` 定位，避免跳变）；document 级 click/contextmenu 关闭菜单
- `core/context-menus.ts` — 注册与行为层：`registerContextMenus()` 监听 `ctx:show` → `buildMenuItems` 组装后派发 `menu:show`；`HANDLERS` 行为表（action id → handler）覆盖 `instance.*` / `batch.*` / `file.*` / `dir.*`；工具函数 `refreshUI()`（派发 `tree:reload` + `stats:refresh`）、`toast()`、`isUnsafeFolderName`（禁止 `..` 与绝对路径）
- `core/menu-defs.ts` — 声明式菜单规格（ADR-021 B 层）：`MENU_DEFS` 四类菜单的完整声明 + `getMenuDef(type)`；加菜单项只改这里

## 对外 API / 入口

- 自定义元素：`<context-menu>`
- 导出函数：`registerContextMenus()`（core/context-menus.ts，由 `app-modules.ts` 启动时调用一次）、`MENU_DEFS` / `getMenuDef`（core/menu-defs.ts）
- 监听 bus：`ctx:show`（context-menus.ts）、`menu:show`（context-menu.ts）
- 派发 bus：`menu:show`；行为 handler 内再派发 `instance:export-list` / `instance:clear` / `batch:rename` / `dir:rename` / `dir:batch-rename` / `dir:mkdir` / `dir:recycle` / `toast:show` / `tree:reload` / `stats:refresh`
- Go 调用（handler 内动态 import bindings）：`OpenInstanceFolder`、`MoveModelFile`、`CopyModelFile`、`GetRepoRoot`、`MoveToRecycle`、`RenameFile`、`InstallModelTo`、`ListVersionInstances`、`LoadAppConfig`、`RevealInExplorer`
- `ctx:show` 派发方：`app-tree`（file/dir/batch）、`app-sidebar`（instance）

## 与其他子系统关系

- 弹窗交互委托 `dialogs/`：`modalPrompt` / `modalConfirm` / `modalSelect`（modal.ts）、`showRenameDialog`（rename.ts）、`modalTagEditor`（tag-editor.ts）
- `dir:*` / `batch:rename` 等事件由 `app-content` 注册的全局 handler 与对话框模块消费（见知识卡 `app_content`）
- 回收站行为最终走 Go `go/recycle` 包（`MoveToRecycle`）
- 组件与菜单的映射关系在 `app-modules.ts` 装配时经 `registerContextMenus()` 生效（见知识卡 `app_modules`）

## 不变量

- 菜单结构只允许在 `menu-defs.ts` 修改；`MenuItemDef.action` 与 `HANDLERS` 表一一对应，契约测试遍历声明断言完整性（缺 handler 会测试失败）
- `registerContextMenus()` 只在 `app-modules.ts` 调用一次，禁止组件内重复注册（事件无守卫注册反模式，ADR-008）
- 菜单项 label/icon 一律过 `_esc` 转义；新建文件夹名过 `isUnsafeFolderName` 安全过滤
- `<context-menu>` 的 `bus.on` 与 document 级监听在 `disconnectedCallback` 成对清理

## 相关

- `frontend/js/dialogs/` — modal / rename / batch-rename / tag-editor 弹窗
- `frontend/js/components/context-menu.test.js` — 菜单结构契约测试
- 知识卡：`app_modules`、`app_tree`、`app_sidebar`、`app_content`、`event_bus`
