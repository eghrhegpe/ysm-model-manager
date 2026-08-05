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
---

# 整合包实例 go/instance

## 概览

`go/instance/` 包处理整合包（Minecraft 版本实例）的资源同步项构建，是 `app_install.go` 中 `GetResourceInstanceStatus` 等 Binding 的下沉逻辑。

## 核心职责

- 将版本实例 + 资源类型 + 仓库根映射为 `ResourceSyncItem[]`（同步状态列表）

## 对外 API / 入口

- `BuildSyncItems(ins, rtypes, repoRoots)` — 构建实例的资源同步项（供同步管理界面展示）

## 与其他子系统关系

- `internal/app/app_install.go`：薄壳调用（`GetResourceInstanceStatus`）
- `go/types/`：`VersionInstance` / `ResourceSyncItem` / `ResourceTypeInfo`
- `go/sync/`：同步比对（`CompareGlobalInstanceHashes` 等）

## 相关

- ADR-024（多资源类型联邦架构：按资源类型分目录同步）
