---
kind: context-menu
name: 右键菜单系统
tier: architecture
category: ui
source_files:
  - frontend/src/views/context-menu/index.ts
  - frontend/src/core/context-menus.ts
  - frontend/src/core/menu-defs.ts
  - frontend/src/core/context-menu-dir-handlers.ts
  - frontend/src/core/context-menu-file-handlers.ts
  - frontend/src/core/context-menu-handlers.ts
  - frontend/src/core/context-menu-shared.ts
  - frontend/src/core/handlers/instance-ops.ts
tests:
  - frontend/src/core/context-menus.test.ts
  - frontend/src/core/handlers/instance-ops.test.ts
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/context-menu/index.test.ts
use_when:
  - 右键菜单
  - 右键
  - 上下文菜单
  - ctx:show
  - menu:show
  - 批量操作
  - 移入回收站
  - 重命名
invariant_anchors:
  - frontend/src/core/context-menus.ts|registerContextMenus
  - frontend/src/core/menu-defs.ts|MENU_DEFS
  - frontend/src/core/menu-defs.ts|getMenuDef
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - 右键菜单、添加菜单项
  - 菜单行为执行、ctx:show
quick_risk_lines:
  - 菜单结构声明在 menu-defs.ts（唯一事实来源），行为在 core/context-menus.ts
  - 禁止 view 层手写菜单项
pitfalls:
  - 「view 层」内联菜单结构 → 必须声明进 menu-defs.ts
---

# 右键菜单系统

## 概览

右键菜单系统采用「声明与行为分离」的三层结构：`menu-defs.ts` 声明菜单结构（唯一事实来源），`core/context-menus.ts` 把 `ctx:show` 事件翻译成带行为的 `menu:show` 载荷，`views/context-menu/index.ts` 是纯渲染容器。四类菜单（整合包 instance / 多选 batch / 文件 file / 目录 dir）覆盖重命名、移动、复制、推送到整合包、标签编辑、回收站、打开位置、复制路径、导出清单等全部右键操作。整合包两项（导出清单 / 清空）只派发事件，真正执行落在 `core/handlers/instance-ops.ts`。

## 核心职责

- `views/context-menu/index.ts` — `<context-menu>` Shadow DOM 渲染容器：监听 `menu:show({ x, y, items })` 渲染菜单项（label/icon/danger/divider，逐项 `itemSlideIn` 入场动画）、绑定点击回调（`try/finally` 包裹 `onClick`，抛异常也必 `hide()` 防菜单残留）、视口边界检测（先移到 -9999px 离屏测量再经 `requestAnimationFrame` 定位，避免跳变）；document 级 click/contextmenu 关闭菜单，Esc 键监听在 `show()` 时「先 remove 再 add」注册、`disconnectedCallback` 一并摘除
- `core/context-menus.ts` — 注册与行为层：`registerContextMenus(unsubs)` 监听 `ctx:show` → `buildMenuItems` 组装后派发 `menu:show`，unsub 收进传入数组；`HANDLERS` 行为表（action id → handler）覆盖 `noop` / `instance.*` / `batch.*` / `file.*` / `dir.*`；**行为 toast/弹窗文案全量 i18n**（2026-XX P3 收敛：handler 层 48 处裸中文 → `ctx.*` key，三语言包同步）——`runBatchFileOp` 从「中文 verb/message」改为 `BATCH_TPL` mode 模板表（move/copy 的 progress/okAll/okPartial/failAll/dialog 文案集中定义），file/dir/shared handler 一律 `tr()` 兜底（缺失键显英文）；viewer-mode 过滤收敛为单一 `canWebAction(action)`（来自 `utils/dom/capabilities.ts`，P3 收敛——纯前端动作 `VIEWER_PURE_ACTIONS` 恒可达 + binding 走 `can()` 探测），`buildMenuItems` filter 链：① `visibleWhen` ② viewer-mode 守卫（两关 AND）；下载操作委托 `utils/dom/download-text.ts`（P2-2）；工具函数 `refreshUI()`（派发 `tree:reload` + `stats:refresh`）、`toast()`、`toastError()`（错误 toast 统一入口：`❌ friendlyError(e)` 模板 + long 时长，2026-XX 收敛 handler 层 12 处行内模板）、`isUnsafeFolderName`（禁止 `..` 与绝对路径）、`resolveDstDir()`（move/copy 四处共用：弹窗输入 → 安全检查 → `GetRepoRoot(YSM)` → 拼目标目录，取消/失败返回 null）；连点防护从单一 `_batchBusy` 模块 flag 改为按 verb 独立闭包（`moveBusy / copyBusy / recycleBusy`）——同一 verb 连点互斥，不同 verb 可并发；复制类动作（`batch.copy-paths` / `file.copy-path`）统一走 `utils/dom/clipboard.ts copyText`（Clipboard API + textarea fallback）
- 异常兜底（0b1f6a9）：`file.recycle` / `file.push-to-pack` / `file.edit-tags` 的**外层** await 链各自套 `try/catch`（内层 Go 调用另有一层 catch），弹窗被抢占结算或 bindings 加载失败都会转成 `friendlyError` toast，不再冒泡成 unhandledrejection
- `core/menu-defs.ts` — 声明式菜单规格（ADR-021 B 层）：`MENU_DEFS` 四类菜单的完整声明 + `getMenuDef(type)`；加菜单项只改这里。instance/batch 首项为 `noop` 标题项（label 由 ctx 动态生成）。`MenuItemDef.label` 已收紧为纯函数式 `(ctx) => string`（2026-XX 删除死 string 分支）——所有声明 `() => tr("menu.xxx", "English Fallback")` 或 `(ctx) => 动态`，让「label 必须经 i18n 或 ctx 动态生成」成为**类型级约束**，防新增裸字符串 label 漏 i18n。`tr()` 来自 `core/i18n/tr.ts`（P2-1 抽取），发版前漏译显示可读文案而非裸 key。`MenuItemDef.visibleWhen?: (ctx) => boolean` 节点级显隐守卫（与 3D 菜单 `PreviewMenuNode.visibleWhen` 同构，吃 ctx 快照、纯函数），filter 在 `buildMenuItems` 中**先于 viewer-mode 守卫**求值（两关 AND；未定义时行为不变）
- `core/handlers/instance-ops.ts` — 整合包两个重活的落地方：`instance:export-list` 走 `requireMcRoot` → `ListVersionInstances` → `GetSubDirMap` 按 rtype 分组 `ListFileNames` → 清单写剪贴板；`instance:clear` 走 `CountInstanceResources`（统计失败显式报错，不静默当空）→ `modalConfirm` → `ClearInstanceResources` → `stats:refresh`

## 对外 API / 入口

- 自定义元素：`<context-menu>`
- 导出函数：`registerContextMenus(unsubs: Array<() => void>)`（core/context-menus.ts，由 `core/handlers/global.ts` 的 `registerGlobalHandlers()` 调用一次）、`MENU_DEFS` / `getMenuDef`（core/menu-defs.ts）、`registerInstanceOps(unsubs)`（core/handlers/instance-ops.ts）
- 监听 bus：`ctx:show`（core/context-menus.ts）、`menu:show`（views/context-menu/index.ts）、`instance:export-list` / `instance:clear`（core/handlers/instance-ops.ts）
- 派发 bus：`menu:show`；行为 handler 内再派发 `instance:export-list` / `instance:clear` / `batch:rename` / `dir:rename` / `dir:batch-rename` / `dir:mkdir` / `dir:recycle` / `toast:show` / `tree:reload` / `stats:refresh`
- Go 调用（handler 内经 `getApp()`（backend/app.ts）取 bindings，不再逐处动态 import）：`OpenInstanceFolder`、`MoveModelFile`、`CopyModelFile`、`GetRepoRoot(rtype)`、`MoveToRecycle`、`RenameFile`、`InstallModelTo`、`ListVersionInstances`、`LoadAppConfig`、`RevealInExplorer`；instance-ops 侧另有 `ListFileNames`、`GetSubDirMap`、`CountInstanceResources`、`ClearInstanceResources`
- `ctx:show` 派发方：`app-tree`（file/dir/batch）、`app-sidebar`（instance）

## 与其他子系统关系

- 弹窗交互委托 `utils/dom/dialogs/`：`modalPrompt` / `modalConfirm` / `modalSelect`（modal.ts）、`showRenameDialog`（rename.ts）、`modalTagEditor`（tag-editor.ts）
- `dir:*` / `batch:rename` 等事件由 `app-tree/bus-handlers.ts` 消费（批量重命名弹窗见知识卡 `dialog_batch_rename`）
- 错误文案统一走 `context-menu-shared.ts` 的 `toastError(err, fallback?, prefix?)`（内部转 `utils/dom/errors.ts` 的 `friendlyError`，long 时长），避免把 Go 原始错误串直接抛给用户——handler 层 catch 一律 `toastError`，不手写 `toast("❌ " + ...)` 模板
- 回收站行为最终走 Go `go/recycle` 包（`MoveToRecycle`）
- 注册时机随 `app-content` 的 `connectedCallback` → `registerGlobalHandlers()` 生效，`disconnectedCallback` 统一退订（见知识卡 `global_handlers`、`app_content`）

## 不变量

- 菜单结构只允许在 `menu-defs.ts` 修改；`MenuItemDef.action` 与 `HANDLERS` 表一一对应，`buildMenuItems` 对失配 action 打 `console.warn`，契约测试遍历声明断言零警告（缺 handler 会测试失败；2026-XX 升级直接对账声明表 vs handler 表，不再依赖 spy）
- `visibleWhen` 与 viewer-mode 全局过滤 AND：两边都通过才出现在 items；与 3D `PreviewMenuNode.visibleWhen`（[doc:adr-126-p4-d]）语义同构（都吃状态快照/ctx 快照的纯函数谓词），共享「声明式菜单唯一条件守卫口」精神面
- `registerContextMenus(unsubs)` 只由 `registerGlobalHandlers()` 调用一次且必须把 unsub 收进数组，禁止组件内重复注册（事件无守卫注册反模式，ADR-008）
- 菜单项 label/icon 一律过 `_esc`（委托 utils/dom/html.ts 的 `esc`）转义；移动/复制目标文件夹名过 `isUnsafeFolderName` 安全过滤
- 每个 async handler 的最外层 await 链都要有 catch 出口——右键菜单点击是「发射后不管」调用，未捕获异常只会变成 unhandledrejection，用户看不到任何反馈。**已全量补齐**（P2 修复）：batch.move/batch.copy/batch.recycle 补外层 catch，file.move/file.copy/dir.move/dir.copy 的 `resolveDstDir`/`getApp` 与 file.reveal 的 `getApp` 纳入 try——原实现 `getApp`（import 失败 rethrow）与 `resolveDstDir`（内含 GetRepoRoot）在 try 外，reject 时 rejection 逸出
- `ysm.json` 禁止单文件重命名（ADR-038 D3），`file.rename` 直接 warn toast 引导改目录名
- `<context-menu>` 的 `bus.on` 与 document 级 click/contextmenu/keydown 监听在 `disconnectedCallback` 成对清理

## 相关

- `frontend/src/views/dialogs/` — modal / rename / batch-rename / tag-editor 弹窗
- `frontend/src/core/context-menus.test.ts` — 声明与 handler 的契约测试
- `frontend/src/views/context-menu/index.test.ts` — 渲染容器测试
- 知识卡：`global_handlers`、`app_tree`、`app_sidebar`、`app_content`、`dialog_batch_rename`、`event_bus`
