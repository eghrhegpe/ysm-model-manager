---
kind: app-sync-manager
name: 整合包同步页 app-sync-manager
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-sync-manager/
auto_fields:
  symbols_with_lines:
    - actionBtnHTML
    - applyFilter
    - AppSyncManager
    - bindDelegatedEvents
    - cleanupSyncVirtualScroll
    - containerHTML
    - emptyHintHTML
    - EventSelf
    - getLastSelectedType
    - itemHTML
    - LAST_TYPE_KEY
    - loadData
    - loadingHTML
    - loadTypeConfig
    - NetworkSelf
    - performSingleOp
    - render
    - setLastSelectedType
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
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 整合包同步页、推送 / 拉取资源
  - 待推送 / 可拉取 / 已禁用 / 实例资源
  - 同步状态、app-sync-manager
quick_risk_lines:
  - app-sync-manager 的同步状态渲染必须经 _gen 单点生成，禁止各列各自查询状态
pitfalls:
  - 各列各自查询同步状态 → 状态不一致、并发冲突；必须经 _gen 单点生成
  - 同步操作未进队列 → 并发 push/pull 冲突；必须经 sync-manager 排队

use_when:
  - 整合包同步
  - 同步状态
  - 推送资源
  - 拉取资源
  - 待推送
  - 可拉取
  - 已禁用
  - 实例资源
perf:
  - io-bound
invariant_anchors:
  - frontend/src/views/app-sync-manager/index.ts|_guard
status: active
---

# 整合包同步页 app-sync-manager

## 概览

`app-sync-manager` 是整合包管理页内嵌的同步状态面板（light DOM），由 `app-content` 在收到 `package:selected` 后以 `<app-sync-manager instance="版本名" default-type="ysm">` 挂载。它一次性加载指定整合包内所有资源类型的同步条目（扁平列表），前端按类型标签与状态标签过滤，支持单文件推送/拉取。

## 核心职责

- `index.ts` — `<app-sync-manager>` 组件（拆分模式）：`observedAttributes: ["instance", "default-type"]`；`store.ts` 的 `loadTypeConfig` 同步读 `schema.ts` 的 `allResourceTypes`（ADR-269 D3③：废 `LoadResourceTypes` RPC 旁路，构建期内联、无空表窗口与失败降级）、`_loadData` 调 `GetInstanceSyncStatus` 拉全量条目，`renderer.ts` 的 `render` 渲染「当前类型只读指示（`shortLabelOf`，类型选择已全局化到 app-nav 下拉）+ 状态筛选标签」（全部/已同步/待推送/已禁用/可拉取/旧仓库遗留）+ **`.sm-summary` 摘要栏（`GetSyncScanDirs` 返回仓库基准/实例实际扫描目录，兜底路径可见）** + 条目列表；`network.ts` 的 `performSingleOp` 单文件 push/pull（原 `_pushSingleFile`/`_pullSingleFile` 80% 重复已合并），由 `_singleBusy`（`Set<string>` 按 path 粒度）防重入——不同行可并发，同一行串行；busy 视觉由 `_singleBusy.size > 0` 派生
- `_init` 代际守卫 `_guard`（`createLoadGuard`，ADR-230 收口，原裸 `_gen` 计数退役）：每次进入 `_guard.next()`，`await` 类型配置与数据后若 `_guard.stale(gen)` 直接返回，丢弃 instance 快速切换产生的过期渲染与订阅
- `renderer.ts` — 渲染层：`render`（**骨架幂等**：`.sm-list` 已存在则不重建，防丢滚动位置）→ 状态页签 / 摘要栏 → **行级虚拟滚动**（`flattenRows` 展平 + `renderSlice` 窗口化，行高 CSS 定、首帧实测校正以尊重用户 `--fs-scale`；零高度降级全量渲染）；`cleanupSyncVirtualScroll` 由 `disconnectedCallback` 与 `_init` 重建骨架前调用（与 app-tree 的 `cleanupVirtualScroll` 同款范式）
- `tpl.ts` — 模板：`containerHTML`（骨架 + 定高行样式）/ `syncDirRowHTML` / `itemHTML` / `statusTabHTML` / `emptyHintHTML` / `loadingHTML` + `SyncItem` 类型；行高 `calc(var(--fs-sm) * 1.4 + 9px)` 定高（窗口化前提），缩进由渲染层按树深经 `padding-left` 注入（不再套逐级 wrapper）

## 对外 API / 入口

- 自定义元素：`<app-sync-manager instance="1.20.1-Fabric" default-type="ysm">`
- 导出类：`AppSyncManager`
- 监听 bus：`stats:refresh`（重新 `_loadData` + `_render`；回调内以 `isConnected` 守卫，重订阅前先清旧 `_unsubs`；`_loadData().then()` 链尾接 `.catch` 打 `logWarn`（`utils/base/log.ts` 环形日志），避免 `_render` 抛错被 Promise 静默吞掉）
- 派发 bus：`repo:rtype-changed`（类型标签切换联动 `app-sidebar`）、`toast:show`、`stats:refresh`（单文件操作成功后）
- Go 调用（动态 import bindings）：`GetInstanceSyncStatus`、`GetSyncScanDirs`（同步目录可见性，返回 `{global, instance, warningCode, warningParams}`；`warningCode="scan_dir_wide"` 时仓库基准疑似过宽（含 mods/config/FilesRoot 特征），显示文案由前端 i18n 组装，防静默混入）、`PushSingleResourceToInstance`、`PullSingleResourceFromInstance`（类型配置不再走 `LoadResourceTypes` RPC，改 `schema.ts` 同步读——ADR-269 D3③）

## 与其他子系统关系

- 由 `app-content` instances 页响应 `package:selected` 挂载（见知识卡 `app_content`）；选中卡片来自 `app-sidebar`（见知识卡 `app_sidebar`）
- 数据源对应 Go 端 `go/sync` 包；binding 位于 `internal/app/app_install.go`（`GetInstanceSyncStatus` / `PushSingleResourceToInstance` / `PullSingleResourceFromInstance`）与 `app_scan.go`（`ListVersionInstances`）（见知识卡 `go_sync`）
- Go 端 `SyncResources` / `SyncResourcesDirLevel` 的 Walk 会 `SkipDir` 跳过 `.recycle`（sync.go 统一 collect 闭包内 `fsutil.IsRecycleDir`），口径与 `scanner.ScanEntries` 对齐；否则回收站内模型会被当成仓库活跃模型，在本面板误显示为 `missing` 且可推送。ADR-064 后 `SyncResources` 为相对路径对比（嵌套文件可见可拉取），条目经 `packs.IsTypeModelFile` 过滤（ADR-144 下沉）
- 类型标签切换派发 `repo:rtype-changed`，与仓库页 subtab、`app-sidebar` 统计共享同一类型状态
- 错误消息经 `friendlyError` 转用户可读文案后 toast

## 不变量

- `_init` 可能因属性变更多次执行，重订阅 `stats:refresh` 前必须先清旧 `_unsubs`；`disconnectedCallback` 清理后必须 `this._unsubs = []` 置空，否则重连时复用旧数组会对已清理的 fn 再执行一次
- 异步加载后一律先比对 `_gen` 代际再落 DOM / 建订阅，禁止在 `await` 之后无守卫地写 `innerHTML`。**`stats:refresh` 的 `.then` 重渲染与 `_loadData` 写 `_allItems` 同样必须比对 `_gen`**（P2 修复：原两处无守卫，instance 快速切换后旧代际数据覆盖新面板 / 后续过滤基于错误数据）
- **`_render` 异常必须保留错误提示不吞没**（2026-09 修复：曾整段死码 21 行）；`_loadData` 失败必须 toast 告警，不能让界面停在「暂无资源文件」误导用户；`_init` 三段 `await`（loadTypeConfig/loadData/loadRepoRoots）必须整体 try/catch 转错误 UI + toast——原为浮动 Promise，reject 即 unhandled rejection + spinner 永久卡死
- **⚠️ `render()` 必须同步返回 void（禁止 `async`）**（2026-09 修复）：函数体零 `await`，标 `async` 会让抛出的异常变成 rejected promise 被调用方 `.catch` 静默吞掉，令 `_renderWithErrorFeedback` 的 try/catch 永不触发（错误 div + toast 全段死码）。同步契约由 `index.ts` 的 `_RENDER_SYNC_GUARD` 编译期守卫锁定，改回 async 即编译失败
- **代际守卫唯一出口 `_guard`（ADR-230）**：2026-09 删除并存的手搓 `private _initGen`（语义不等价——`_guard.invalidate()` 打不进早期 bail）。禁止再引入第二套计数；`app-sidebar` 侧的 `_reloadGen` 同属待并轨项
- 模块级 `_lastSelectedType` 跨实例记住上次选中类型（整合包间共享），并以 localStorage 键 `ysm_syncLastType` 持久化
- 状态六态（synced/missing/disabled/optional/legacy/all）与 Go 端 `go/sync` 返回的状态字段一一对应，前端不自造状态
- 组件 `define` 前先 `customElements.get` 守卫，防 HMR / 重复 import 重复注册
- **事件绑定一次性委托于组件根（light DOM）**：`events.ts` 的 `bindDelegatedEvents` 在 `_init` 单次执行，render 重建 DOM 不影响委托——消除原 `bindEvents` 每次 render 后 `.then` 全量重绑导致的并发双绑竞态（目录行点一次=翻转两次）；`btn` 分支须 `e.stopPropagation()` 防冒泡到父，恢复对等性
- **⚠️ 委托生命周期跟随元素连接，不随 `_init`（2026-10 修复，曾致整页点击全死）**：click 委托的 unsub 曾误入 `_unsubs` 桶——`_init` 顶部会对 `_unsubs` 全量 unsub（本意清 bus 订阅），同元素第二次 `_init`（`instance` 属性变更）把委托连带销毁（`_clickHandler=null` + `_cbRef=undefined`），而 `_eventsBound` 仍 true → else 分支 `if(self._cbRef)` 不命中 → 委托永不重绑，状态页签/目录行/push/pull 点击全死。现委托 unsub 单独存 `_clickUnsub`，由 `disconnectedCallback` 统一清理（`index.ts` 有注释锚点）；`_unsubs` 桶只装生命周期跟随 `_init` 的 bus 订阅
- **列表渲染窗口化三条不可回退（2026-10，治「上百个 MMD 模型显示诡异」）**：① **行必须等高**——`tpl.ts` 以 `height:calc(var(--fs-sm)*1.4+9px)` 定高（行不等高则窗口范围算不准），TS 侧首帧实测取整（用户 `--fs-scale` 可调，常量会漂）；② **行不得挂入场动画**——窗口化随滚动反复注入节点，`animation-fill-mode: both` 会持续重播成滚动闪烁（ADR-015 §2.4 约束 3 及该 ADR「已知例外」，模型树当年同因禁用子行淡入）；③ **`render` 不得重建 `.sm-list` 骨架**——重建即丢滚动位置（用户停在中段时列表弹回顶部）。效果：DOM 行数由视口决定、与条目数解耦，`paddingTop/Bottom` 撑出滚动总高保证末行可达

## 已知限制 / 待治理（2026-08-24 审计）

- **✅ 已治理（2026-08-24）：applyFilter 递归 + filter-keep-ancestors**——原类型/状态筛选只过滤顶层条目，容器 synced 时内部 disabled/legacy 子项在对应 tab 不可发现。现 `store.ts applyFilter` 递归筛选：子项命中即保留父链（filter-keep-ancestors），type/status 逐节点独立判定（`matches`），`tabStatus` 统一 diverged→missing 折叠口径（store 与 renderer 计数共用，防漂移）；**status 筛选激活时**把「有命中后代的目录 path」写入 `_forceOpenPaths`，renderer 渲染时对未点过（`_dirOpen[path]` 未定义）的目录强制展开——折叠目录下的命中子项无需手动展开即可见（点过折叠则尊重用户）。计数同步递归（徽标数 = 列表可见行数）
- 嵌套展开状态 `dirOpen` 以 `item.path` 为 key，而容器绝对路径由 Go 端 `dirLevelContainerPath` 按聚合状态选源侧——同一容器在状态变化后（diverged → optional）path 变化，旧展开状态失联（体验小瑕疵，非错误）

## 相关

- `go/sync/` — 同步状态计算核心
- `internal/app/app_install_instance.go` — `GetInstanceSyncStatus` / `GetSyncScanDirs` / 推送/拉取 binding
- 知识卡：`app_content`、`app_sidebar`、`go_sync`
