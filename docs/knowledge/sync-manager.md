---
kind: sync-manager
name: 整合包同步管理器 sync-manager
tier: architecture
category: feature
source_files:
  - frontend/src/views/app-sync-manager/index.ts
  - frontend/src/views/app-sync-manager/state.ts
  - frontend/src/views/app-sync-manager/store.ts
  - frontend/src/views/app-sync-manager/renderer.ts
  - frontend/src/views/app-sync-manager/events.ts
  - frontend/src/views/app-sync-manager/network.ts
  - frontend/src/views/app-sync-manager/tpl.ts
  - frontend/src/views/app-sidebar/index.ts
  - frontend/src/views/app-sidebar/loader.ts
  - frontend/src/views/app-sidebar/events.ts
  - frontend/src/views/app-sidebar/render.ts
  - frontend/src/views/app-sidebar/sync-flow.ts
  - frontend/src/features/sync/sync.ts
auto_fields:
  symbols_with_lines:
    - actionBtnHTML
    - applyFilter
    - appSidebarStyle
    - AppSyncManager
    - bindCardEvents
    - bindDelegatedEvents
    - bindFooter
    - bindSelectAll
    - bindSyncSelected
    - cleanupSyncVirtualScroll
    - containerHTML
    - EmitDedupe
    - emptyHintHTML
    - EventSelf
    - getLastSelectedType
    - groupMmdVariants
    - itemHTML
    - LAST_TYPE_KEY
    - loadData
    - loadingHTML
    - loadInstances
    - loadTypeConfig
    - MmdVariantGroups
    - NetworkSelf
    - performSingleOp
    - registerSync
    - render
    - renderVersionCards
    - restoreCheckboxes
    - setLastSelectedType
    - SidebarHost
    - STATUS_COLOR
    - STATUS_ICON
    - statusColorOf
    - statusIconOf
    - statusTabHTML
    - syncDirRowHTML
    - SyncItem
    - SyncManagerFields
    - SyncManagerSelf
    - SyncRenderSelf
    - SyncStoreSelf
    - tabStatus
    - VIEW_TESTIDS
  tests:
    - frontend/src/views/app-sync-manager/index.test.ts
    - frontend/src/views/app-sync-manager/index.branches.test.ts
    - frontend/src/views/app-sync-manager/renderer.virtual.test.ts
    - frontend/src/views/app-sync-manager/tpl.test.ts
    - frontend/src/views/app-sidebar/app-sidebar.sync.test.ts
    - frontend/src/views/app-sidebar/app-sidebar.component.test.ts
    - frontend/src/views/app-sidebar/events.test.ts
    - frontend/src/views/app-sidebar/loader.test.ts
    - frontend/src/views/app-sidebar/render.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 整合包同步、推送 / 拉取
  - 整合包列表、同步状态、勾选
  - PushSingleResource / PullSingleResource
  - sync:download:missing 缺包回拉
quick_risk_lines:
  - 同步操作必须经 sync-manager 的 queue 排队，禁止 app-sidebar 直接调 PushSingleResource
pitfalls:
  - app-sidebar 直接发 push/pull 请求 → 并发冲突 / 状态错乱；必须经 sync-manager 排队
  - PullSingleResource 未完成前刷新侧边栏 → 半同步状态显示；必须等 store 状态收敛
use_when:
  - 整合包同步
  - 推送
  - 拉取
  - 跨组件同步编排
  - 缺包回拉
  - PullSingleResource
  - sync:download:missing
invariant_anchors:
  - frontend/src/views/app-sidebar/sync-flow.ts|runPush
  - frontend/src/views/app-sidebar/sync-flow.ts|runPull
  - frontend/src/views/app-sync-manager/network.ts|performSingleOp
  - frontend/src/views/app-sync-manager/store.ts|applyFilter
  - frontend/src/views/app-sync-manager/index.ts|_gen
  - frontend/src/features/sync/sync.ts|runDownloadMissing
status: active
---

# 整合包同步管理器 sync-manager

## 概览

`app-sync-manager` 是一个 Web Component 视图组件（`<app-sync-manager>`），承担**单个整合包（instance）内「仓库 ↔ 实例」双向同步状态展示与逐文件推送/拉取编排**：

- **单实例视角**：一次只展示一个 `instance`（如 `1.20.1-Fabric`）下的同步状态
- **层级渲染**：通过 `GetInstanceSyncStatus` 拉取该实例下该 rtype 的全部条目（`SyncItem[]`），逐节点递归渲染，`isDir` 支持目录级展开/折叠
- **逐文件 push/pull**：单行内嵌按钮，由 `network.ts` 的 `performSingleOp` 顺序守卫执行
- **整包同步在 sidebar**：`app-sidebar` 底部菜单走 `sync:download:missing` handler 编排后台安装，与本组件的**逐文件操作**分工解耦

> **差异化定位**：`go-sync.md` 描述 Go 端同步算法（哈希对比/冲突/重链接），`app-sidebar.md` 描述侧边栏 UI，`app-sync-manager.md` 描述同步面板；本 feature 卡专注**跨组件端到端同步编排视角**——用户从 sidebar 选整合包 → sync-manager 展示状态 → 逐文件/整包 push/pull 的全链路。

## 核心职责

### `app-sync-manager`（逐文件级）
- **状态呈现**：`loadData` 拉取 `SyncItem[]` → `applyFilter`（`tabStatus` 把 `diverged` 折叠进 `missing` tab）→ `flattenRows` 展平为定高行数组 → `renderSlice` 窗口化渲染（只注入可见行 ± 缓冲）
- **单文件 push/pull**：`performSingleOp` 顺序守卫 + `_singleBusy` 按钮视觉
- **摘要栏**：`GetSyncScanDirs` 显示实际扫描目录 + `scan_dir_wide` 告警

### `app-sidebar`（整包级）
- **`runPush`**：顺序 `for insName × for rtype` → `sync:download:missing` handler 后台安装缺失，等 `sync:download:done` token（30s 超时，skipped reject）
- **`runPull`**：`Promise.allSettled` 并拉 `PullResourceFromInstance`
- **`_syncInProgress`** 守卫：防止并发 sync 竞态
- **同步流程层（`sync-flow.ts`，2026-09-08 从 `index.ts` 拆出）**：`runPush`/`runPull`/`bindSelectAll`/`bindSyncSelected`/`restoreCheckboxes` + `_checkedSets`（按 rtype 隔离的勾选状态 Map）全部迁至独立文件，`index.ts` 仅保留 Web Component 生命周期与渲染编排

### `features/sync.ts`（bus 调度）
- **`sync:download:missing`**：`downloadFlag.busy` 守卫 → `runDownloadMissing`（`ListVersionInstances` → `GetResourceInstanceStatus` → 遍历 targets × Missing：`InstallModelTo`(YSM) / `InstallResourceToInstance`(other) → `InvalidateScanCache`）
- **`sync:toggle:status`**：`.ban`/`.disabled` 启禁同步

## 数据流（后端 → store → 渲染）

```
getApp().GetInstanceSyncStatus(instance, subtype, rtype)
  → store.loadData(self)
    → self._allItems (SyncItem[], 含 isDir/children/subdir 层级)
    → self._scanDirs[type] = { global, instance, warningCode?, warningParams? }
  → renderer.render(self)
    → applyFilter(self)     // 递归 filterNode → _filteredItems + _forceOpenPaths
    → flattenRows(self)     // 可见树（展开态 + _forceOpenPaths）压平为定高行数组
    → renderSlice(listEl)   // 窗口化：只注入可见窗口 ± 缓冲行，paddingTop/Bottom 撑出滚动总高
  → bindDelegatedEvents(...)  // 一次性委托（_init 单次绑定，render 重建 DOM 不影响）
```

**sidebar 整包推送链**：
```
用户点击 push 菜单项
  → asbBeginSync（取 selected + _syncInProgress + 按钮 loading）
  → runPush
    → 顺序 for insName × for rtype
       → asbPushOne(insName, rt)
         → token = `${insName}:${rt}:${Date.now()}`
         → bus.emit("sync:download:missing", { instanceName, rtype, token })
         → Promise 等待 sync:download:done（匹配 token，30s 超时）
         → asbWaitBusQuiet（防并发竞态）
    → 汇总 toast
  → finally：按钮复位 + _syncInProgress=false
```

## 关键 bus 事件

| 事件 | 方向 | 说明 |
|------|------|------|
| `stats:refresh` | 广播 → 订阅 | 变异完成 → sidebar 300ms 防抖 `_reload(true)` + sync-manager 重拉 |
| `tree:reload` | 广播 → 订阅 | 整棵树重扫（sync:download:missing 成功后、sync:toggle:status finally） |
| `package:selected` | sidebar → app-content | 携带 `{name, rtype}`（`bus.ts` 契约；无 `dir` 字段）→ `app-content` 以 `innerHTML` 挂载 `<app-sync-manager instance default-type>` |
| `repo:rtype-changed` | 全局 nav → 各处 | 切 rtype 重载 |
| `repo:subdir-changed` | 全局 nav → sync-manager | MMD 子目录切换重载 |
| `sync:download:missing` | sidebar → handler | 载荷 `{instanceName, rtype, token}` |
| `sync:download:done` | handler → sidebar | 载荷 `{token, instanceName, skipped, skipReason}`；skipped=true 触发 reject |
| `sync:toggle:status` | app-tree → handler | 启禁同步 |
| `ctx:show` | sidebar 右键 → 菜单 | 携带 `{instanceName, path, rtype, subdir}` |

## Go 绑定（通过 `getApp()`）

| 绑定 | 消费者 | 用途 |
|------|--------|------|
| ~~`LoadResourceTypes()`~~ | ~~sync-manager/store.ts~~ | ADR-269 D3③ 已废：store.ts 改同步读 `utils/resource/schema.ts`，前端不再调此 RPC |
| `GetInstanceSyncStatus(instance, subtype, rtype)` | sync-manager/store.ts | 拉层级 `SyncItem[]` |
| `GetSyncScanDirs(rtype, instance)` | sync-manager/store.ts | 摘要栏扫描目录 |
| `GetRepoRoot(rtype)` | sync-manager/index.ts、features/sync.ts | 仓库根路径 |
| `PushSingleResourceToInstance(rtype, instance, path)` | sync-manager/network.ts | 单文件推送 |
| `PullSingleResourceFromInstance(rtype, path, instance)` | sync-manager/network.ts | 单文件拉取 |
| `PullResourceFromInstance(rtype, instance)` | sidebar/index.ts | 整包拉取 |
| `InstallModelTo / InstallResourceToInstance` | features/sync.ts | 缺失安装 |
| `ListVersionInstances / GetResourceInstanceStatus` | features/sync.ts、sidebar/loader.ts | 实例列表 + 缺失/多余 |
| `SyncModelToggleStatus(ins.CustomDir, filesRoot)` | features/sync.ts | 启禁同步 |
| `InvalidateScanCache()` | features/sync.ts | 强制刷新 30s 缓存 |
| `AddImportLog` | features/sync.ts | 同步日志 |

## 与其他子系统关系

```
sidebar 卡片点击
  → bus.emit("package:selected", {name, rtype})
    → app-content/init-pages.ts 在 #ins-content 内注入 <app-sync-manager instance="X" default-type="Y">
      → app-sync-manager 组件生命周期：
          connectedCallback / _init
            → loadTypeConfig / loadData / applyFilter
            → renderer.render / bindEvents
          卸载：disconnectedCallback 清理 unsubs + 复位状态

sidebar 底部 push/pull 菜单（整包级，与 sync-manager 组件解耦）
  → runPush → sync:download:missing handler → 后台安装缺失
  → runPull → PullResourceFromInstance 后台整包拉取
```

**`features/sync.ts`** 是**整包级**调度，与 `app-sync-manager` 组件的**逐文件级**操作分工明确：
- 组件内单行按钮 → `getApp().PushSingleResourceToInstance` / `PullSingleResourceFromInstance`
- sidebar 底部 push 菜单 → bus `sync:download:missing` → handler `runDownloadMissing` → `InstallModelTo`/`InstallResourceToInstance`

## 不变量

- **依赖 DAG 无循环**（index.ts 顶部注释）：`index → store/renderer/events/network/state`；leaf 模块互不反向依赖；共享状态下沉至 `state.ts` 打破 `index↔events` 循环
- **组件实例单注册**：`customElements.get("app-sync-manager")` 守卫；`registerSync` 顶层调一次
- **`_singleBusy` 按 path 粒度防重入**（network.ts）：`Set<string>` 而非全局布尔——不同行可并发 push/pull，同一行防重入
- **⚠️ busy 视觉两侧同为 per-path 口径**（2026-09 修复「只做一半」）：`setRowButtonsBusy(self, path, busy)` 只锁/只解禁本行——原进入时 `setButtonsBusy(true)` 全局禁用把无关行一并锁死，令 per-path 并发在 UI 层形同虚设；原 finally 用 `size > 0` 全局派生，先结束的 op 会提前解禁仍在途行（守卫按 path、复位按全局，两半自相矛盾）。配套：窗口化每帧 `replaceChildren` 会冲掉禁用态，由 `renderer.restoreBusyState` 按 `st.busy`（引用同一 `_singleBusy`）贴回，否则用户重复点击同 path 被 Set 静默吞（"点了没反应"）
- **代际守卫**：所有异步加载函数用 `_gen` 丢弃过期结果（`gen !== self._gen` 早退），防 `await` 期间 attribute 切换导致脏写入
- **`_dirOpen` 显式折叠优先于 `_forceOpenPaths` 强制展开**（renderer.ts）：`??` 而非 `||`——用户点过折叠即尊重；只有 undefined 才允许 status 筛选强制展开
- **筛选口径一致性**（store.ts `applyFilter`）：`tabStatus` 把 `diverged` 折叠进 `missing` tab，renderer 计数与递归 `filterNode` 复用同一 `tabStatus`，保证"徽标数 = 列表可见行数"
- **空 rtype 拦截**（sidebar/events.ts + init-pages.ts）：点击路径允许 fallback YSM（预览无害），右键拒绝（操作危险）
- **busy 语义对称**：download/toggle 两个 handler 的 busy 命中都显式反馈，不静默吞事件
- **`sync:download:missing` 载荷 rtype 必填**：缺参显式失败（P2 修复）
- **`tree:reload` 仅在真正做过安装时广播**（handler P2）：配置缺失短路时无任何写操作
- **`SidebarHost`/`EmitDedupe` 去重**：同组件 reload 不复位（防反复重发 `package:selected` → 反复重建 sync-manager 丢状态），宿主持有状态
- **`_syncInProgress/_loading` 卸载时复位**：否则重挂载后按钮点击被静默 return
- **Storage**：一律用 `safeGet/safeSet/safeRemove`（ADR-044），防隐私模式 `localStorage` 禁用抛错
- **Go 绑定**：统一 `getApp()` 入口，禁止直调 `window.go.main.App.*`

## 相关

- [go-sync](./go-sync.md) — Go 端同步算法（哈希对比/冲突/重链接/缓存）
- [app-sidebar](./app-sidebar.md) — 侧边栏 UI（卡片/底部菜单/整合包列表）
- [app-sync-manager](./app-sync-manager.md) — 同步面板组件（本卡的实现层对应）
- [go-installer](./go-installer.md) — 缺失文件安装（`InstallModelTo`/`InstallResourceToInstance`）
- [go-tags](./go-tags.md) — `SyncModelToggleStatus` 启禁同步的后端
- [go-watcher](./go-watcher.md) — 文件监听触发自动同步

