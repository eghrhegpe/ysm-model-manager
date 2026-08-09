---
kind: go-instance
name: 整合包实例 go/instance
tier: architecture
category: go
source_files:
  - go/instance/
use_when:
  - 整合包
  - 实例
  - 版本实例
  - VersionInstance
  - 同步项
  - BuildSyncItems
  - 资源同步
invariant_anchors:
  - go/instance/instance.go|ysmsync.SyncResources
---

# 整合包实例 go/instance

## 概览

`go/instance/` 包处理整合包（Minecraft 版本实例）的资源同步项构建，是 `app_install.go` 中 `GetInstanceSyncStatus` Binding 的下沉逻辑（知识卡旧文称 `GetResourceInstanceStatus` 为消费方属漂移——该 Binding 走 `ysmsync.GetInstanceStatus`/`CompareGlobalInstanceHashes`，与本包无关）。

## 核心职责

- 将版本实例 + 资源类型 + 仓库根映射为 `ResourceSyncItem[]`（同步状态列表）。`ResourceTypeInfo` 定义于本包 `instance.go:16`（go/types 下无此类型，知识卡旧文漂移已修正）

## 对外 API / 入口

- `BuildSyncItems(ins, rtypes, repoRoots)` — 构建实例的资源同步项（供同步管理界面展示）；内部同步比对走 `ysmsync.SyncResources`（sync.go:396），非 `CompareGlobalInstanceHashes`（知识卡旧文漂移已修正）

## 与其他子系统关系

- `internal/app/app_install.go`：薄壳调用（`GetInstanceSyncStatus`）
- `go/types/`：`VersionInstance` / `ResourceSyncItem` / `ResourceTypeInfo`（本包定义）
- `go/sync/`：同步比对（`SyncResources`）

## 不变量

- 兜底 Walk 的覆盖集合已改为**注册表驱动**（P2 修复：原硬编码后缀清单含 `.litematic`，蓝图与 litematic 共享 `schematics` 目录时 `.litematic` 文件被蓝图兜底重复加为 optional——现用 `extMatch` 按注册表扩展名过滤，天然排除跨类型重复）
- 资源包文件夹条目在 Synced/Missing/Extra 三分支**放行**（P2 修复：原 `extMatch` 过滤掉无后缀文件夹名，真同步文件夹进不了 Synced、兜底 Walk 误标 Optional——现 `isResourcePackFolder(p)` 放行，保持 SyncResources 判定的真实状态）

## 相关

- ADR-024（多资源类型联邦架构：按资源类型分目录同步）
