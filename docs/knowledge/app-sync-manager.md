---
kind: app-sync-manager
name: 整合包同步页 app-sync-manager
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-sync-manager/index.ts
  - frontend/src/views/app-sync-manager/tpl.ts
tests:
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-resource-manager/index.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/context-menu/index.test.ts
use_when:
  - 整合包同步
  - 同步状态
  - 推送资源
  - 拉取资源
  - 待推送
  - 可拉取
  - 已禁用
  - 实例资源
---

# 整合包同步页 app-sync-manager

## 概览

`app-sync-manager` 是整合包管理页内嵌的同步状态面板（light DOM），由 `app-content` 在收到 `package:selected` 后以 `<app-sync-manager instance="版本名" default-type="ysm">` 挂载。它一次性加载指定整合包内所有资源类型的同步条目（扁平列表），前端按类型标签与状态标签过滤，支持单文件推送/拉取。

## 核心职责

- `index.ts` — `<app-sync-manager>` 组件：`observedAttributes: ["instance", "default-type"]`；`_loadTypeConfig` 读类型配置（图标/名称）、`_loadData` 调 `GetInstanceSyncStatus` 拉全量条目、`_render` 渲染「模型类（ysm/mmd-skin/vrchat-avatar）| 资源类（resourcepack/shaderpack/create-blueprint/litematic）」类型标签 + 状态筛选标签（全部/已同步/待推送/已禁用/可拉取/旧仓库遗留）+ 条目列表；`_pushSingleFile` / `_pullSingleFile` 单文件同步，由 `_singleBusy` 在途守卫防连点并发（`finally` 复位）
- `_init` 代际计数 `_gen`：每次进入自增，`await` 类型配置与数据后若 `gen !== this._gen` 直接返回，丢弃 instance 快速切换产生的过期渲染与订阅
- `tpl.ts` — 模板：`containerHTML` / `itemHTML` / `statusTabHTML` / `emptyHTML` / `loadingHTML` + `SyncItem` 类型

## 对外 API / 入口

- 自定义元素：`<app-sync-manager instance="1.20.1-Fabric" default-type="ysm">`
- 导出类：`AppSyncManager`
- 监听 bus：`stats:refresh`（重新 `_loadData` + `_render`；回调内以 `isConnected` 守卫，重订阅前先清旧 `_unsubs`；`_loadData().then()` 链尾接 `.catch` 打 `console.warn`，避免 `_render` 抛错被 Promise 静默吞掉）
- 派发 bus：`repo:rtype-changed`（类型标签切换联动 `app-sidebar`）、`toast:show`、`stats:refresh`（单文件操作成功后）
- Go 调用（动态 import bindings）：`LoadResourceTypes`、`GetInstanceSyncStatus`、`PushSingleResourceToInstance`、`PullSingleResourceFromInstance`

## 与其他子系统关系

- 由 `app-content` instances 页响应 `package:selected` 挂载（见知识卡 `app_content`）；选中卡片来自 `app-sidebar`（见知识卡 `app_sidebar`）
- 数据源对应 Go 端 `go/sync` 包；binding 位于 `internal/app/app_install.go`（`GetInstanceSyncStatus` / `PushSingleResourceToInstance` / `PullSingleResourceFromInstance`）与 `app_scan.go`（`ListVersionInstances`）（见知识卡 `go_sync`）
- Go 端 `SyncResources` / `SyncResourcesDirLevel` 的 Walk 会 `SkipDir` 跳过 `.recycle`（`go/sync/sync.go:400`、`sync.go:428`、`sync.go:539`），口径与 `scanner.ScanEntries` 对齐；否则回收站内模型会被当成仓库活跃模型，在本面板误显示为 `missing` 且可推送
- 类型标签切换派发 `repo:rtype-changed`，与仓库页 subtab、`app-sidebar` 统计共享同一类型状态
- 错误消息经 `friendlyError` 转用户可读文案后 toast

## 不变量

- `_init` 可能因属性变更多次执行，重订阅 `stats:refresh` 前必须先清旧 `_unsubs`；`disconnectedCallback` 清理后必须 `this._unsubs = []` 置空，否则重连时复用旧数组会对已清理的 fn 再执行一次
- 异步加载后一律先比对 `_gen` 代际再落 DOM / 建订阅，禁止在 `await` 之后无守卫地写 `innerHTML`
- `_loading` 标记覆盖加载全程；`_render` 异常时保留错误提示不吞没；`_loadData` 失败必须 toast 告警，不能让界面停在「暂无资源文件」误导用户
- 模块级 `_lastSelectedType` 跨实例记住上次选中类型（整合包间共享），并以 localStorage 键 `ysm_syncLastType` 持久化
- 状态六态（synced/missing/disabled/optional/legacy/all）与 Go 端 `go/sync` 返回的状态字段一一对应，前端不自造状态
- 组件 `define` 前先 `customElements.get` 守卫，防 HMR / 重复 import 重复注册

## 相关

- `go/sync/` — 同步状态计算核心
- `internal/app/app_install.go` — 推送/拉取 binding
- 知识卡：`app_content`、`app_sidebar`、`go_sync`、`app_resource_manager`
