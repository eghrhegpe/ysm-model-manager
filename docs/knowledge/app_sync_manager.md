---
kind: app_sync_manager
name: 整合包同步页 app-sync-manager
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-sync-manager/index.ts
  - frontend/src/views/app-sync-manager/tpl.ts
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

- `index.ts` — `<app-sync-manager>` 组件：`observedAttributes: ["instance", "default-type"]`；`_loadTypeConfig` 读类型配置（图标/名称）、`_loadData` 调 `GetInstanceSyncStatus` 拉全量条目、`_render` 渲染「模型类（ysm/mmd-skin/vrchat-avatar）| 资源类（resourcepack/shaderpack/create-blueprint/litematic）」类型标签 + 状态筛选标签（全部/已同步/待推送/已禁用/可拉取/旧仓库遗留）+ 条目列表；`_pushSingleFile` / `_pullSingleFile` 单文件同步
- `tpl.ts` — 模板：`containerHTML` / `itemHTML` / `statusTabHTML` / `emptyHTML` / `loadingHTML` + `SyncItem` 类型

## 对外 API / 入口

- 自定义元素：`<app-sync-manager instance="1.20.1-Fabric" default-type="ysm">`
- 导出类：`AppSyncManager`
- 监听 bus：`stats:refresh`（重新 `_loadData` + `_render`；回调内以 `isConnected` 守卫，重订阅前先清旧 `_unsubs`）
- 派发 bus：`repo:rtype-changed`（类型标签切换联动 `app-sidebar`）、`toast:show`、`stats:refresh`（单文件操作成功后）
- Go 调用（动态 import bindings）：`LoadResourceTypes`、`GetInstanceSyncStatus`、`PushSingleResourceToInstance`、`PullSingleResourceFromInstance`

## 与其他子系统关系

- 由 `app-content` instances 页响应 `package:selected` 挂载（见知识卡 `app_content`）；选中卡片来自 `app-sidebar`（见知识卡 `app_sidebar`）
- 数据源对应 Go 端 `go/sync` 包；binding 位于 `internal/app/app_install.go`（`GetInstanceSyncStatus` / `PushSingleResourceToInstance` / `PullSingleResourceFromInstance`）与 `app_scan.go`（`ListVersionInstances`）（见知识卡 `go_sync`）
- 类型标签切换派发 `repo:rtype-changed`，与仓库页 subtab、`app-sidebar` 统计共享同一类型状态
- 错误消息经 `friendlyError` 转用户可读文案后 toast

## 不变量

- `_init` 可能因属性变更多次执行，重订阅 `stats:refresh` 前必须先清旧 `_unsubs`，`disconnectedCallback` 兜底清理，防止 handler 翻倍
- `_loading` 标记覆盖加载全程；`_render` 异常时保留错误提示不吞没
- 模块级 `_lastSelectedType` 跨实例记住上次选中类型（整合包间共享）
- 状态六态（synced/missing/disabled/optional/legacy/all）与 Go 端 `go/sync` 返回的状态字段一一对应，前端不自造状态

## 相关

- `go/sync/` — 同步状态计算核心
- `internal/app/app_install.go` — 推送/拉取 binding
- 知识卡：`app_content`、`app_sidebar`、`go_sync`、`app_resource_manager`
