---
kind: global-handlers
name: 全局事件处理 global-handlers
tier: architecture
category: core
source_files:
  - frontend/src/views/app-content/index.ts
  - frontend/src/features/dnd/import-dnd.ts
  - frontend/src/features/pack-ops/instance-ops.ts
  - frontend/src/features/sync/sync.ts
  - frontend/src/features/require-mcroot.ts
  - frontend/src/core/error-diary.ts
auto_fields:
  symbols_with_lines:
    - appContentStyle
    - bindTreeDnD
    - DiaryEntry
    - DiaryHandle
    - DiarySink
    - DiaryStatus
    - downloadMissing
    - DownloadOutcome
    - handleTreeDrop
    - PackOutcome
    - pushToDiary
    - registerErrorDiary
    - registerInstanceOps
    - registerSync
    - requireMcRoot
    - SyncDownloadPayload
    - unregisterErrorDiary
  tests:
    - frontend/src/core/error-diary.test.ts
    - frontend/src/features/import-dnd.test.ts
    - frontend/src/core/handlers/instance-ops.test.ts
    - frontend/src/core/handlers/sync.test.ts
    - frontend/src/features/dnd-shared.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 全局事件、拖拽导入、拖拽提示
  - 同步缺失、清空整合包、导出清单
  - registerGlobalHandlers、instance-ops
quick_risk_lines:
  - 全局事件必须经 global-handlers 单点注册，禁止各页面各自 bindGlobalHandler
pitfalls:
  - 各页面各自注册全局事件 → 重复绑定、冲突处理；必须经 global-handlers 单点
  - 拖拽导入未进 import-dnd → 与全局拖拽状态冲突；必须经 features/import-dnd.ts
  - 丢弃 cleanup 前先判危害——挂在目标元素自身无泄漏，挂在 document/window 或共享单例计数上才是真问题

use_when:
  - 全局事件
  - 拖拽导入
  - 拖拽提示
  - 同步缺失
  - 清空整合包
  - 导出清单
invariant_anchors:
  - frontend/src/views/app-content/index.ts|registerSync
status: active
---

# 全局事件处理 global-handlers

## 概览

全局 handler 注册入口在 ADR-188 中从 `core/handlers/global.ts` 汇编壳收敛为 **app-content 直接编排**：`connectedCallback` 依次调 `registerSync`/`registerContextMenus`/`registerInstanceOps`/`registerAndroidEvents`，把右键菜单、同步、实例操作、Android 事件四组 handler 的 unsub 函数收回，另单独调用 `registerResourceManagerGlobal()` 收资源管理器全局 handler，`disconnectedCallback` 统一释放。页面切换时 handler 不丢、不重复累积。仓库页 DnD（ADR-060）已收敛为 `app-tree` 组件级绑定，不再注册 document 级全局 DnD。

## 核心职责

- **注册编排（ADR-188）**：app-content `index.ts` 直接注册 4 组（registerContextMenus/registerSync/registerInstanceOps/registerAndroidEvents），unsub 统一收 `globalUnsubs`；core 不再设壳层；`registerResourceManagerGlobal` 由 app-content 单独编排（index.ts registerResourceManagerGlobal 调用点，文件头注释自述「features/views 层注册由 app-content 编排」）——功能单点注册不变量仍成立（app-content 单点注册/单点释放）
- **推送链已去总线化（ADR-340，2026-10-14）**：`sync:download:missing`/`sync:download:done` 两事件退役，`features/sync|downloadMissing(payload): Promise<DownloadOutcome>` 是导入缺失唯一入口——原总线回执协议四件套（token 单调序号 / done(skipped) 回执 / waitBusQuiet 静默宽限 / 订阅竞态猜测）随实现删除，busy 命中由返回值 `{skipped:true, skipReason:"busy"}` 表达（`withLock` 模块级锁挡跨页并发写）
- `import-dnd.ts`（bindTreeDnD，ADR-060）：**document 级监听**（WebView2 shadow drop 限制的同款绕道，`dragover`/`dragleave`/`drop`/`dragend` 四件套注册在 `document`，用 `composedPath` 判定是否命中容器，cleanup 成对移除）；`<app-tree>` 的 `connectedCallback` 对 `#tree` 容器调用 `bindTreeDnD(treeEl)`，监听并返回 cleanup；`dragover` 命中 Files 时显示 `#tree-drop-hint`（`.tree-drop-hint`）显式提示 + **`#tree` 加 `.droppable` 可放置态**（2026-10-13 锐评：accent 虚线 outline + 轻微内发光，给「松手落进哪里」的跟随信号；**摘除时机单点 = `hideHint()`**——dragleave/dragend/drop 三处收口共用，类切换若独立于 hideHint 必复现 2026-09 收债的提示滞留债），drop/dragleave 隐藏；dot 呼吸动画走 `views/css/keyframes.ts|PULSE_DOT`（shadow 本地注入，no-animations 桥自动关停）；drop 经 `features/dnd-collector.ts` 的 `collectFiles` 递归收集文件夹（`entry.file` Promise 化，深度上限 10；readEntries 带错误回调 + 3s 超时兜底，防 WebView2 目录读取挂起 onDrop；不支持 `webkitGetAsEntry` 时回退 `getAsFile`），单个文件 ≤100MB；收集到的文件经 `import-executor` 全局执行器（`directImport`）入仓，完成后广播 `import:history-changed` 驱动导入页刷新列表（致命陷阱 #10 的解法）。⚠️ **document 监听意味着「树内移动」与「拖拽导入」在 document 层并存**，两侧须共用 `move-dnd.ts|isTreeMoveDrag` 单一事实源分流（见 [app_tree](./app-tree.md) P0-1）
- `sync.ts`：`downloadMissing`（ADR-340 直调导出）— 按 `GetResourceInstanceStatus` 的 Missing 列表逐文件 `InstallModelTo`/`InstallResourceToInstance`，完成后 `InvalidateScanCache`，恒 settle 返回 `{ok, fail, skipped, skipReason, errors, packs}`（`packs` = 锐评 P1-3 包级归因，见 [sync-manager](./sync-manager.md) 裁定记录）；`tree:reload` 仅在实际完成安装时广播（P2 审核修复：配置缺失短路无写操作不触发全树重扫）；**ADR-310 后清单语义不变**（仍是仓库侧文件级绝对路径、恒不含目录；侧栏徽章数改取 `MissingCount` 单元计数）；**第二路 `MissingDirs`**（夹内无可逐文件安装的受支持文件）改调 folder-aware 的 `PushSingleResourceToInstance`，成功/失败同样计入 `ok/fail`——两路合起来保证每个待推送单元都有安装动作；批量模式（instanceNames）静默不弹结果 toast（反馈权归发起方汇总一条，锐评 P2-1）。`registerSync` 现仅注册 `sync:toggle:status` — 遍历整合包 `SyncModelToggleStatus` 同步启用/禁用并写 `AddImportLog`，`finally` 发 `tree:reload`（致命陷阱 #3 的解法；`sync.ts` 的 `toggleLock`（`BusyLock`，ADR-341）并发守卫防连点竞态）
- `instance-ops.ts`（registerInstanceOps）：`instance:export-list` — `GetSubDirMap` + `ListFileNames` 汇总清单写剪贴板；`instance:clear` — `CountInstanceResources` 统计后 `modalConfirm` 二次确认，`ClearInstanceResources` 执行（走回收站可恢复）
- `require-mcroot.ts`（`requireMcRoot()`）：读取游戏目录（`LoadAppConfig` 的 mcRoot），未配置时发 warn toast 并返回 null（配置守卫，去重 D-1）
- `error-diary.ts`（`registerErrorDiary()` + `pushToDiary`）：`toast:show` 的 error/warn → `AddOpLog` 落日记；`window.onerror`/`unhandledrejection` 由 `utils/dom/global-error-listeners.ts` 经 `pushToDiary` 收口（core 不摸 window，ADR-189 D4）；注册在 app-modules 启动期，不属于 app-content 编排

## 对外 API / 入口

- 导出：`downloadMissing(payload): Promise<DownloadOutcome>`（ADR-340 直调唯一入口）、`registerSync(unsubs)`、`registerInstanceOps(unsubs)`、`registerAndroidEvents(unsubs)`、`registerContextMenus(unsubs)`；`registerSync` 调用方为 app-content `index.ts`（ADR-188 后无 registerGlobalHandlers 聚合壳）
- DnD 导出：`features/import-dnd.ts` 的 `bindTreeDnD(container): () => void`，由 `<app-tree>` 内部绑定
- 监听 bus：`sync:toggle:status`、`instance:export-list`、`instance:clear`
- 派发 bus：`toast:show`、`stats:refresh`、`tree:reload`
- DOM 监听：仓库页 DnD 为 `document` 上的 `dragover`/`dragleave`/`drop`/`dragend`（`bindTreeDnD` 内注册，cleanup 配对完整），用 `composedPath` 判定命中容器；**与树内移动共用 document 层，必须 `isTreeMoveDrag` 分流**（P0-1）
- getApp()/binding 调用：`ImportModelFile`（经 import-executor 的 directImport 间接调用）、`LoadAppConfig`、`ListVersionInstances`、`GetResourceInstanceStatus`、`InstallModelTo`、`InstallResourceToInstance`、`GetRepoRoot`、`InvalidateScanCache`、`SyncModelToggleStatus`、`AddImportLog`、`ListFileNames`、`GetSubDirMap`、`CountInstanceResources`、`ClearInstanceResources`

## 与其他子系统关系

- 五组 register* 唯一调用方 [app_content](./app-content.md) `index.ts`：`connectedCallback` 注册、`disconnectedCallback` 逐个 unsub；`bindTreeDnD` 唯一调用方 [app_tree](./app-tree.md)
- 收集到的文件经 [import_queue](./import-queue.md) 的全局执行器入仓，导入完成后经 `import:history-changed` 驱动其刷新已导入列表
- 页面判断依赖 [page_store](./page-store.md)；同步执行后端见 [go_sync](./go-sync.md)/[go_installer](./go-installer.md)；清空整合包走 [go_recycle](./go-recycle.md) 回收站
- 确认弹窗走 [dialog_modal](./dialog-modal.md)，反馈走 [app_toast](./app-toast.md)

## 不变量

- 全局 handler 只能在 app-content 单点编排注册一次（ADR-188：core 无壳层，app-content 直接调各 register*）；features/views 层事件（如仓库页 DnD）按 ADR-060 在组件内绑定，必须以 cleanup 函数交还清理权，禁止再注册 document 级全局 DnD/遮罩（致命陷阱 #2）
- ~~`sync:download:missing` 的完成事件必须放 `finally`（含 token）~~ 已由 **ADR-340 结构性消解**：直调 `await` 天然「无论成败都有结果」（恒 settle），按钮解锁不再依赖事件回执——致命陷阱 #3（忘发 done 永久卡死）从「纪律要求」降级为「不可能」
- DnD 收集必须走 `webkitGetAsEntry` 并在不支持时回退 `getAsFile`；`entry.file` 回调必须 Promise 化（致命陷阱 #10）
- DnD 提示显隐由 `bindTreeDnD` 的 `dragover`/`dragleave`/`drop` 驱动：`dragover` 命中 Files 时显示 `#tree-drop-hint`，`drop`/真正离开容器时隐藏；不再依赖 `dragDepth` 深度计数器或 `#global-drop-overlay`（ADR-060）
- **类型安全事件处理器模式**（审计发现）：存储 `EventListener` 时使用具体类型（`EventListener`）而非 `unknown as () => void`。`removeEventListener` 要求传入的函数与 `addEventListener` 时传入的函数是**同一个引用**，类型转换会破坏引用相等性导致无法移除（P3）。`error-diary.ts` 已修复：`_unsubError`/`_unsubRejection` 改为 `EventListener` 类型。
- **「丢弃 cleanup 要不要修」的判据（2026-10 全量对账结论）**：监听挂在**谁**身上决定危害量级——
  - **挂在目标元素自身**（如 `trapFocus` 挂 overlay、`attachTooltip` 挂 el 的三个监听）→ 元素被 GC 时监听随之消失，丢弃 cleanup **无泄漏**，不值得改。
  - **挂在 `document`/`window`**（如 `key-router` 的 keydown、`dropdown` 的外点关闭、`tooltip` 的 scroll）→ 必须成对清理，否则常驻全局。
  - **共享单例上的引用计数**（`tooltip` 的 `scrollRef`）→ 丢弃 cleanup 表现为「计数只增不减、全局监听挂一次后不摘」，**有界、非累积**（`scrollRef === 0` 门保证只挂一次），且 `dispose()` 的 `while (scrollRef > 0)` 可兜底归零。
  对账结果（2026-10，覆盖 `bindRoving`/`initDropdown`/`registerShortcut`/`trapFocusAcrossShadow`/`attachTooltip`/`createBusyLock` 等全部 cleanup 型原语）：**唯一实际丢弃点**是 `attachTooltip` 的 3 处生产调用（fab/roles-views），危害 = 1 个常驻 scroll 监听，已判为不值得重构（详见 `dom_tooltip` 卡）。⚠️ **`attachTooltip` 的 per-element 监听会随元素消失，但 `scrollRef` 不会**——别把两类混为一谈。
- **`createLoadGuard` 的代际作废必须在 cleanup 接上**（2026-10 全量对账）：`invalidate()` 不是可选的「锦上添花」——不调用时 `stale(gen)` 恒 false，整条代际守卫退化为装饰，卸载后仍在途的续体会给游离 root 重渲染（`app-sidebar`/`app-tree` 两处曾漏接，均已修 + 回归锁）。**审计口径**：凡在 `disconnectedCallback`（或等价 cleanup）里解订阅/定时器的组件，都要问一句「它的 `_guard.invalidate()` 呢」；替代方案（如 `app-sync-manager` 在每处 await 后配 `!this.isConnected`）同样成立，但**必须显式选择其一**，不能两不沾。

## 相关

- [app_content](./app-content.md) — 注册与清理宿主
- [import_queue](./import-queue.md) — 导入页 UI 与已导入列表刷新
- [page_store](./page-store.md) — 页面状态判断
- [go_sync](./go-sync.md) — 同步后端实现
