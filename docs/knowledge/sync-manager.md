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
  - frontend/src/utils/async/sync-op-timeout.ts
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
    - bindMcPathLabel
    - bindSelectAll
    - bindSyncSelected
    - cleanupSyncVirtualScroll
    - collectCounts
    - containerHTML
    - downloadMissing
    - DownloadOutcome
    - EmitDedupe
    - emptyHintHTML
    - EventSelf
    - getLastSelectedType
    - itemHTML
    - LAST_TYPE_KEY
    - loadData
    - loadingHTML
    - loadInstances
    - loadTypeConfig
    - NetworkSelf
    - noInstanceHTML
    - PackOutcome
    - performSingleOp
    - pruneCheckedSets
    - registerSync
    - render
    - renderLoadError
    - renderVersionCards
    - restoreCheckboxes
    - setLastSelectedType
    - SidebarHost
    - STATUS_COLOR
    - STATUS_ICON
    - statusColorOf
    - statusIconOf
    - statusTabHTML
    - SYNC_OP_TIMEOUT_MS
    - syncDirRowHTML
    - SyncDownloadPayload
    - SyncItem
    - SyncManagerFields
    - SyncManagerSelf
    - SyncRenderSelf
    - SyncStoreSelf
    - tabStatus
    - VIEW_TESTIDS
    - withSyncOpTimeout
  tests:
    - frontend/src/views/app-sync-manager/index.test.ts
    - frontend/src/views/app-sync-manager/index.branches.test.ts
    - frontend/src/views/app-sync-manager/renderer.virtual.test.ts
    - frontend/src/views/app-sync-manager/tpl.test.ts
    - frontend/src/views/app-sync-manager/a11y.dom.test.ts
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
  - sync:download:missing 缺包回拉（已退役，ADR-340 直调 downloadMissing）
quick_risk_lines:
  - 同步写操作并发守卫 = features/sync 的模块级 BusyLock（downloadMissing withLock）+ sync-manager network.performSingleOp 的 per-path 防重入（同一行串行、异行并发）——历史上无「queue 队列」实体，勿去找它；整包推送唯一入口 = features/sync|downloadMissing 直调（ADR-340 去总线化，原 sync:download:missing 事件链已退役），app-tree 逐文件走 performSingleOp、禁止各自另写安装循环（2026-10-14 锐评 P2-3 + ADR-340）
  - 状态筛选的 a11y 键盘语义只走 events.ts 单一 keydown 委托 + tpl.ts 模板出属性，禁止逐 tab 补 handler / 手搓 aria
pitfalls:
  - app-sidebar 直接发 push/pull 请求 → 并发冲突 / 状态错乱；写链守卫 = features/sync BusyLock + performSingleOp per-path
  - PullSingleResource 未完成前刷新侧边栏 → 半同步状态显示；必须等 store 状态收敛
use_when:
  - 整合包同步
  - 推送
  - 拉取
  - 跨组件同步编排
  - 缺包回拉
  - PullSingleResource
  - downloadMissing
invariant_anchors:
  - frontend/src/views/app-sidebar/sync-flow.ts|runPush
  - frontend/src/views/app-sidebar/sync-flow.ts|runPull
  - frontend/src/views/app-sync-manager/network.ts|performSingleOp
  - frontend/src/views/app-sync-manager/store.ts|applyFilter
  - frontend/src/views/app-sync-manager/index.ts|_guard
  - frontend/src/views/app-sync-manager/events.ts|bindDelegatedEvents
  - frontend/src/features/sync/sync.ts|runDownloadMissing
  - frontend/src/features/sync/sync.ts|downloadMissing
status: active
---

# 整合包同步管理器 sync-manager

## 概览

`app-sync-manager` 是一个 Web Component 视图组件（`<app-sync-manager>`），承担**单个整合包（instance）内「仓库 ↔ 实例」双向同步状态展示与逐文件推送/拉取编排**：

- **单实例视角**：一次只展示一个 `instance`（如 `1.20.1-Fabric`）下的同步状态
- **层级渲染**：通过 `GetInstanceSyncStatus` 拉取该实例下该 rtype 的全部条目（`SyncItem[]`），逐节点递归渲染，`isDir` 支持目录级展开/折叠
- **逐文件 push/pull**：单行内嵌按钮，由 `network.ts` 的 `performSingleOp` 顺序守卫执行（并包同步兜底超时，见不变量）
- **整包同步在 sidebar**：`app-sidebar` 底部菜单走 `downloadMissing` 直调（ADR-340）编排后台安装，与本组件的**逐文件操作**分工解耦
- **计数口径统一（ADR-310，2026-09）**：sidebar 徽章已换线到本面板链（`go/instance.BuildInstanceStatusCounts` 折 `BuildSyncItems`），红 = `missing ∪ diverged`、橙 = `optional ∪ legacy`、`disabled` 单独计；但**一键安装读的 `Missing` 仍是仓库侧文件级清单**（一个缺夹展开多条文件路径，`len(Missing)` 与计数无固定关系；夹内无可逐文件安装的文件时整夹落在 `MissingDirs`，一键安装同样调用本卡 `PushSingleResourceToInstance` 这条 folder-aware 路径，故计数单元全都有安装动作）——徽章数只看 Go 的计数字段，别再用数组长度
- **fileLevel 分叉行自 ADR-340-d2 起也标 `diverged`**：`ResourceDiff` 新增的 `Diverged`（⊂ `Missing`）经 `go/instance|processOneResourceType` 落到单元状态——此前 fileLevel（fbx / resourcepack 等）的内容分叉只报 `missing`，于是 🔴 冒充「待推送」且**本组件 `events.ts` 的 ADR-310 分叉确认闸对文件级类型形同虚设**（`status === "diverged"` 才弹「两侧均已修改」确认框）；现两类类型同口径，分叉行推送前一律先确认。计数/筛选不变（`store.ts|tabStatus` 与 `renderer` 早已把 diverged 折进 missing tab）

> **差异化定位**：`go-sync.md` 描述 Go 端同步算法（哈希对比/冲突/重链接），`app-sidebar.md` 描述侧边栏 UI，`app-sync-manager.md` 描述同步面板；本 feature 卡专注**跨组件端到端同步编排视角**——用户从 sidebar 选整合包 → sync-manager 展示状态 → 逐文件/整包 push/pull 的全链路。

## 核心职责

### `app-sync-manager`（逐文件级）
- **状态呈现**：`loadData` 拉取 `SyncItem[]` → `applyFilter`（`tabStatus` 把 `diverged` 折叠进 `missing` tab）→ `flattenRows` 展平为定高行数组 → `renderSlice` 窗口化渲染（只注入可见行 ± 缓冲）
- **单文件 push/pull**：`performSingleOp` 顺序守卫 + `_singleBusy` 按钮视觉
- **摘要栏**：`GetSyncScanDirs` 显示实际扫描目录 + `scan_dir_wide` 告警；该调用失败属非关键路径（用户侧静默，`logWarn` 留痕），但**主加载失败时须清 `_scanDirs`**（2026-10：否则摘要栏残留上一任目标的目录对，与失败态列表说两套话）
- **a11y 模板语义（2026 复测补缺）**：状态筛选栏 = `role="radiogroup"` + 六个 `role="radio"`（`aria-checked` + roving tabindex 由 `statusTabHTML` 模板随重渲染自动迁移）；目录行箭头为原生 `button` + `aria-expanded` + 名称标签；装饰图标 `aria-hidden`；加载态 `role="status"`；错误 div `role="alert"`。键盘半边 = `bindDelegatedEvents` 的单点 keydown 委托（方向键循环移动即激活、Home/End 只移焦点——仓内先例 `tabs-shell.ts` diag 子切换同口径），契约 `tpl.test.ts`（属性字符串）+ `a11y.dom.test.ts`（键盘行为）

### `app-sidebar`（整包级）
- **`runPush`**：按类型循环 `await downloadMissing({instanceNames})` **直调**（ADR-340 去总线化，2026-10-14：原 `sync:download:missing` 事件 + token 回执 + `waitBusQuiet` 静默宽限四件套整体退役，Promise 返回值即 `{ok, fail, skipped, skipReason, packs}`），累加计数汇总一条 toast；**包级归因（锐评 P1-3）**：跨类型把 `packs` 累加进 `Map<包名, {ok,fail}>`，有失败的包按失败数降序点名（`sidebar.pushPackFailDetail`「失败集中在 N 个整合包：狐妖(3)、MMD(1)」，超 3 个截断加 `import.moreSuffix`）——用户看到「失败 3」时直接读到是哪个包；binding 挂起由 `withTimeout`(120s) 兜底且**超时即早停**（治锐评 P1-2 级联——原总线实现超时后续发只会撞 handler 持锁 busy 假跳过）。原 `for insName × for rtype` 逐包逐类型 N×T 次已收敛为 O(类型) 次（ADR-310 性能修复，2026-10）
- **`runPull`**：`Promise.allSettled` 并拉 `PullResourceFromInstance`
- **`_syncLock`（`BusyLock`）** 守卫：防止并发 sync 竞态（ADR-341 归一，`beginSync` tryStart / `runPush`·`runPull` finally finish）
- **同步流程层（`sync-flow.ts`，2026-09-08 从 `index.ts` 拆出）**：`runPush`/`runPull`/`bindSelectAll`/`bindSyncSelected`/`restoreCheckboxes` + `_checkedSets`（按 rtype 隔离的勾选状态 Map）全部迁至独立文件，`index.ts` 仅保留 Web Component 生命周期与渲染编排

### `features/sync.ts`（同步执行层）
- **`downloadMissing(payload): Promise<DownloadOutcome>`**（ADR-340 唯一入口，直调非事件）：`withLock(downloadLock)` 互斥 → `runDownloadMissing`（`ListVersionInstances` → `GetResourceInstanceStatus` → 按 `instanceName`/`instanceNames` 过滤 targets × Missing：`InstallModelTo`(YSM) / `InstallResourceToInstance`(other) → `InvalidateScanCache`）；`instanceNames` 优先（批量一次覆盖多包），单次调用内只扫一次状态；恒 settle 返回 `{ok, fail, skipped, skipReason, errors, packs}`（`packs` = 锐评 P1-3 包级归因 `PackOutcome {name, ok, fail, errors}`，包内缘由封顶 2 条，仅本次真有安装动作的包占条目），批量模式静默不弹结果 toast（`errors`/`packs` 交发起方汇总，见「失败明细必点名」条）
- **`sync:toggle:status`**（bus 事件，registerSync 注册）：`.ban`/`.disabled` 启禁同步

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

**sidebar 整包推送链（ADR-340 去总线化 + ADR-310 批量收敛，2026-10-14）**：
```
用户点击 push 菜单项
  → beginSync（取 selected + _syncLock.tryStart + 按钮 loading）
  → runPush（按类型循环，非逐包×逐类型）
    → for rt in types
       → await withTimeout(downloadMissing({ instanceNames: selected, rtype: rt }), 120s)
         // 直调即请求-响应：Promise settle 值 = {ok, fail, skipped, skipReason}
         // 原总线四件套已删——token/nextPushToken（回执匹配）、done(skipped)（busy
         // 解锁）、waitBusQuiet/2s 宽限（竞态猜测）皆 Promise 免费提供
       → 累加 installOk/installFail；skipped 按 skipReason 分流（busy=被跳过 /
         config,error=未完成）
       → 超时（binding 挂起是唯一成因）→ 计入 timedOut 并 break **早停**
    → 汇总一条 toast（失败计数可见，锐评 P1-1 契约）
  → finally：按钮复位 + _syncLock.finish()
```

**sidebar 整包拉取链（批D 与推送对齐，2026-10-14 锐评）**：
```
用户点击 pull 菜单项
  → beginSync（同上：取 selected + _syncLock.tryStart + 按钮 loading）
  → runPull（按整合包循环）
    → for ins in selected
       → await withTimeout(Promise.allSettled(types.map(rt => PullResourceFromInstance(rt, ins))), 120s)
         // ⚠️ 原实现**完全没有** withTimeout：binding 挂起 → allSettled 永不 settle
         // → await 不返回 → finally 不执行 → _syncLock 被**永久占住**，此后所有
         // 推送/拉取都被拒收（而那条拒收此前还是静默的）
       → fulfilled 累加 pulled、rejected 计 failed；超时计 timedOut 并 **break 早停**
    → 汇总一条 toast（超时段追加「N 个整合包拉取超时，已停止后续拉取」）
  → finally：按钮复位 + _syncLock.finish()（超时也必须走到这里）
```

**busy 拒收必须可见（批D）**：`beginSync` 在 `lock.tryStart()` 失败时弹 `sidebar.syncBusy` 提示，不再静默 return——原注释称「按钮 loading 态就是可见反馈」不成立：loading 赋值发生在本 return **之后**，且锁是 push/pull **共用**的，点另一个按钮时那个按钮根本不会进 loading（叠加「拉取无超时可永久占锁」，用户会以为同步入口彻底坏了）。回归锁 `app-sidebar.sync.test.ts`「拉取 binding 挂起 → 超时早停 + 锁释放 + 如实计入」与「busy 拒收必须可见」

## 关键 bus 事件

| 事件 | 方向 | 说明 |
|------|------|------|
| `stats:refresh` | 广播 → 订阅 | 变异完成 → sidebar 300ms 防抖 `_reload(true)` + sync-manager 重拉 |
| `tree:reload` | 广播 → 订阅 | 整棵树重扫（downloadMissing 实际安装后、sync:toggle:status finally） |
| `package:selected` | sidebar → app-content | 携带 `{name, rtype}`（`bus.ts` 契约；无 `dir` 字段）→ `app-content` **复用**同一 `<app-sync-manager>` 实例并改 `instance`/`default-type` 属性（2026-09 起不再 `innerHTML` 重建） |
| `repo:rtype-changed` | 全局 nav → 各处 | 切 rtype 重载 |
| `repo:subdir-changed` | 全局 nav → sync-manager | MMD 子目录切换重载 |
| `sync:toggle:status` | app-tree → handler | 启禁同步 |
| `ctx:show` | sidebar 右键 → 菜单 | 携带 `{instanceName, path, rtype, subdir}` |

## Go 绑定（通过 `getApp()`）

| 绑定 | 消费者 | 用途 |
|------|--------|------|
| ~~`LoadResourceTypes()`~~ | ~~sync-manager/store.ts~~ | ADR-269 D3③ 已废：store.ts 改同步读 `utils/resource/schema.ts`，前端不再调此 RPC |
| `GetInstanceSyncStatus(instance, subtype, rtype)` | sync-manager/store.ts | 拉层级 `SyncItem[]` |
| `GetSyncScanDirs(rtype, instance)` | sync-manager/store.ts | 摘要栏扫描目录 |
| `GetRepoRoot(rtype)` | features/sync.ts | 仓库根路径（sync-manager/index.ts 侧的 `_filesRoots` 死缓存消费已于 2026-10 锐评摘除——只写不读，勿回接） |
| `PushSingleResourceToInstance(rtype, instance, path)` | sync-manager/network.ts | 单文件推送 |
| `PullSingleResourceFromInstance(rtype, path, instance)` | sync-manager/network.ts | 单文件拉取 |
| `PullResourceFromInstance(rtype, instance)` | sidebar/index.ts | 整包拉取（**返回 `PullSyncResult{ok, failed, firstError}`**，ADR-340-d1：error 只表示前置不满足——旧 `(int, error)` 体裁下部分失败会让整批 reject，成功计数在途中丢失） |
| `InstallModelTo / InstallResourceToInstance` | features/sync.ts | 缺失安装（downloadMissing 直调） |
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
  → runPush → downloadMissing 直调（ADR-340）→ 安装缺失并 await 结果
  → runPull → PullResourceFromInstance 后台整包拉取
```

**`features/sync.ts`** 是**整包级**调度，与 `app-sync-manager` 组件的**逐文件级**操作分工明确：
- 组件内单行按钮 → `getApp().PushSingleResourceToInstance` / `PullSingleResourceFromInstance`
- sidebar 底部 push 菜单 → 直调 `downloadMissing` → `runDownloadMissing` → `InstallModelTo`/`InstallResourceToInstance`（ADR-340：原 bus 通道退役）

## 不变量

- **依赖 DAG 无循环**（index.ts 顶部注释）：`index → store/renderer/events/network/state`；leaf 模块互不反向依赖；共享状态下沉至 `state.ts` 打破 `index↔events` 循环
- **组件实例单注册**：`customElements.get("app-sync-manager")` 守卫；`registerSync` 顶层调一次
- **`_singleBusy` 按 path 粒度防重入**（network.ts）：`Set<string>` 而非全局布尔——不同行可并发 push/pull，同一行防重入
- **行内 op 必须包同步兜底超时（批D）**：`performSingleOp` 原先裸 `await` binding——Go 侧 `InstallLock` 竞争/慢盘上不收口时 `_singleBusy` 永不删除、该行按钮永久 `disabled`（半径是 per-path 一行，小于侧栏全局锁，但仍是「点了永远没反应」）。现两个 binding 都经 `@/utils/async/sync-op-timeout.ts|withSyncOpTimeout`（120s 单点事实源，与侧栏批量链共用；label 写「推送/拉取 `<path>`」），超时按 `TimeoutError` 分流到专属文案 `syncManager.opTimedOut`（不混进业务错误串），`finally` 保证解锁。回归锁 `network.test.ts`「binding 挂起 → 超时收口 + 该行解锁 + 专属超时文案」「push 走同步兜底超时收口（label 含动作与路径）」
- **⚠️ busy 视觉两侧同为 per-path 口径**（2026-09 修复「只做一半」）：`setRowButtonsBusy(self, path, busy)` 只锁/只解禁本行——原进入时 `setButtonsBusy(true)` 全局禁用把无关行一并锁死，令 per-path 并发在 UI 层形同虚设；原 finally 用 `size > 0` 全局派生，先结束的 op 会提前解禁仍在途行（守卫按 path、复位按全局，两半自相矛盾）。配套：窗口化每帧 `replaceChildren` 会冲掉禁用态，由 `renderer.restoreBusyState` 按 `st.busy`（引用同一 `_singleBusy`）贴回，否则用户重复点击同 path 被 Set 静默吞（"点了没反应"）
- **代际守卫走 `createLoadGuard()`（ADR-230 唯一出口）**：所有异步加载函数用 `_guard.next()/stale(gen)` 丢弃过期结果，防 `await` 期间 attribute 切换导致脏写入。2026-09 已删除并存的手搓 `_initGen`（语义不等价：`_guard.invalidate()` 打不进早期 bail）；同批 `app-sidebar:_reloadGen` 与 `preview-3d/session-ledger:_gen` 亦并入（见 ADR-230 D4）
- **`_dirOpen` 显式折叠优先于 `_forceOpenPaths` 强制展开**（renderer.ts）：`??` 而非 `||`——用户点过折叠即尊重；只有 undefined 才允许 status 筛选强制展开
- **筛选口径一致性**（store.ts `applyFilter`）：`tabStatus` 把 `diverged` 折叠进 `missing` tab，renderer 计数与递归 `filterNode` 复用同一 `tabStatus`，保证"徽标数 = 列表可见行数"
- **空 rtype 拦截**（sidebar/events.ts + init-pages.ts）：点击路径允许 fallback YSM（预览无害），右键拒绝（操作危险）
- **busy 语义对称**：download/toggle 两个 handler 的 busy 命中都显式反馈，不静默吞事件
- **`downloadMissing` 入参 rtype 必填**：缺参返回 `{skipped:true, skipReason:"config"}` 显式失败（P2 修复；ADR-340 后落点从事件载荷改为直调入参）
- **失败明细必点名（锐评 UX 高项收口，2026-10-14）**：`runDownloadMissing` 原 `catch { totalFail++ }` 吞掉错误对象、`InvalidateScanCache` 失败只 `dbg()`——用户看到「失败 3」却不知道是哪几个包/文件、为何失败；装成功却等不到新模型（缓存失效）也无从察觉（会反复重试/怀疑安装失败）。现两处都产出 `errors[]`（`包名/文件路径: friendlyError 缘由`，上限 3 条），经 `DownloadOutcome.errors` 上抛：单包模式并入结果 toast 括号内；批量模式由 `runPush` 跨类型汇总（再限 5 条防 15 类型累积成超长 toast），**安装全成功但缓存失效失败也出warn toast**（独立分支，非静默）。新增 i18n 键 `sync.cacheInvalidateFailed`。回归锁：`features/sync/sync.test.ts`「失败明细带包名与文件路径，上限 3 条」+「InvalidateScanCache 失败 → errors 携带可读缘由且 toast 可见」两例，均变异验证
- **`tree:reload` 仅在真正做过安装时广播**（handler P2）：配置缺失短路时无任何写操作
- **`SidebarHost`/`EmitDedupe` 去重**：同组件 reload 不复位，宿主持有状态。2026-09 定位降级——app-content 已复用面板实例（同值 `setAttribute` 被组件 `oldVal===newVal` 拦下），重复 emit 不再有丢状态代价，本状态机退化为省事件扩散的优化，**不再是防回归的救命稻草**
- **⚠️ 面板复用而非重建**（2026-09 修复）：`init-pages.mountSyncManager` 首次注入元素、后续仅 `setAttribute`，实例跨整合包存活；切包时由组件 `_init` 内的 `_resetViewState()` 复位视图状态（展开态/筛选/子类型）。**改回 `innerHTML` 重建会被 `init-pages.test.ts` 的「复用同一实例」用例拦下**
- **`_syncLock`（BusyLock）/`_reloadInFlight` 卸载时释放**：否则重挂载后按钮点击被静默 return（ADR-341）
- **Storage**：一律用 `safeGet/safeSet/safeRemove`（ADR-044），防隐私模式 `localStorage` 禁用抛错
- **Go 绑定**：统一 `getApp()` 入口，禁止直调 `window.go.main.App.*`
- **⚠️ a11y 属性模板生成原则（2026 复测补缺）**：本视图全部 a11y 属性由 `tpl.ts` 模板单点产出（renderer/events 层零手写 aria）；键盘委托唯一出口 = `events.ts|bindDelegatedEvents` 的 keydown 单委托——新增可交互元素先扩模板，不逐处打属性
- **diverged 行推送须先确认（ADR-310 安全闸，2026-10）**：`diverged` 与 `missing` 共用同一 push 按钮（`tpl.actionBtnHTML` 不区分），但 diverged = 仓库与整合包两侧都已修改，推送会用仓库版**不可逆覆盖**整合包侧编辑。故 `events.ts|handleItemButton` 在 `status === "diverged"` 且 action 为 push 时，先 `modalConfirm`（`syncManager.divergedWarnTitle`/`divergedWarnMsg`，`danger: true`）确认后才调 `cb.doPerformOp("push", path)`；取消则完全不推送。`missing` 行走原直接推送路径。`tpl.ts` 的 diverged 状态图标带 `title`（悬停提示冲突）。回归锁 `events.test.ts`「diverged 行 push → 先弹确认框」「diverged 行 push → 用户取消 → 不推送」「missing 行 push → 不弹确认框」


## 裁定记录

- `2026-10-14`：DownloadOutcome 扩展 packs?: PackOutcome[]（包级归因，成功路径恒有），文件级 ok/fail/errors 原口径不变｜锐评 P1-3：只报「失败 N 个文件」时用户无从知道是哪个包失败，包名归因须随计数一并上抛；纯加字段向后兼容｜回退 = `frontend/src/features/sync/sync.ts|DownloadOutcome`
- `2026-10-15`：PackOutcome 扩展 files?: string[]（推送侧逐文件点名 = 每包**安装成功**的项清单：Missing 文件 srcPath + MissingDirs 目录 dirPath，来源是前端逐条绑定安装当次的条目路径，**零 Go 新增字段**——推送安装本就是前端循环直调，清单在调用点天然可得）；失败项不入列（浮层只展示真正落位的）。侧栏同步浮层（`app-sidebar`）据此每包一行「包名: +N」下挂缩进文件行（每包上限 8 条，超出记「…另 N」，tpl 侧全清单 100 条总闸兜底）。纯加字段向后兼容｜裁定 = `frontend/src/features/sync/sync.ts|PackOutcome` + `frontend/src/views/app-sidebar/sync-flow.ts|renderSyncResultPanel`

## 相关

- [go-sync](./go-sync.md) — Go 端同步算法（哈希对比/冲突/重链接/缓存）
- [app-sidebar](./app-sidebar.md) — 侧边栏 UI（卡片/底部菜单/整合包列表）
- [app-sync-manager](./app-sync-manager.md) — 同步面板组件（本卡的实现层对应）
- [go-installer](./go-installer.md) — 缺失文件安装（`InstallModelTo`/`InstallResourceToInstance`）
- [go-tags](./go-tags.md) — `SyncModelToggleStatus` 启禁同步的后端
- [go-watcher](./go-watcher.md) — 文件监听触发自动同步

