---
kind: go-fsutil
name: 文件遍历 go/fsutil
tier: leaf
category: go
source_files:
  - go/fsutil/walk.go
  - go/fsutil/
use_when:
  - 遍历
  - 目录
  - walk
  - 空目录
  - 文件数
---

# 文件遍历 go/fsutil

## 概览

`go/fsutil/` 是纯工具小包，集中管理 `WalkDir` 逻辑：递归收集文件/目录路径、统计文件数、清理空目录，并内置对 `.recycle` 回收站目录的跳过开关。

## 核心职责

- `walk.go` — 文件遍历、目录后序遍历、计数、空目录清理

## 对外 API / 入口

- `WalkAllFiles(dir string, skipRecycle bool) []string` — 递归返回所有文件完整路径（不限扩展名）；单点遍历错误静默跳过
- `WalkAllDirs(dir string, skipRecycle bool) []string` — 返回所有子目录（不含根目录），后序：子目录在前、父目录在后，便于删除类操作
- `CountFiles(dir string, skipRecycle bool) int` — 文件计数
- `CleanEmptyDirs(dir string, skipRecycle bool) int` — 利用后序结果由深到浅删空目录，返回删除数

## 与其他子系统关系

- 被 `internal/app/app_scan.go`（模型扫描取文件列表）与 `internal/app/app_install.go`（计数、遍历、删库后清空目录）调用
- 与 [go_recycle](./go-recycle.md) 协作：`skipRecycle=true` 时跳过 `.recycle`，扫描/清理不触碰回收站数据

## 不变量

- `skipRecycle` 判定大小写不敏感（目录基名 `.recycle`）
- 遍历中单个文件/目录读取失败不中断整体（返回 nil/跳过该项）
- 空目录路径、空输入一律返回 nil 而非空切片字面量，调用方按 len 判断即可

## 相关

- [go_recycle](./go-recycle.md) — `.recycle` 目录语义
- [go_sync](./go-sync.md) — 同步扫描的底层遍历补充（sync 内部另有局部 Walk）
