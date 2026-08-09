---
kind: go-dedup
name: 去重 go/dedup
tier: architecture
category: go
source_files:
  - go/dedup/
use_when:
  - 去重
  - 重复检测
  - dedup
---

# 去重 go/dedup

## 概览

`go/dedup/` 包提供资源去重检测，避免重复导入相同资源。

## 核心职责

- 基于文件哈希（**纯 SHA256 内容哈希，元数据 name/size/modtime 仅随 FileEntry 展示、不参与重复判定**——知识卡旧文「哈希/元数据检测」表述漂移已修正）检测重复
- 返回重复匹配信息

## 对外 API / 入口

- `FindDuplicateFiles` — 扫描目录，按文件哈希分组，返回重复文件组（`FileEntry`/`Group`）；符号链接跳过防环、空文件跳过、超大文件流式全量哈希（`io.Copy` 错误已检查）
- `CountDuplicates` — 统计重复文件总数
- `CleanEmptyDirs` — 清理空目录（内部 `removeEmptyDirs`/`isEmptyDir` 递归实现）；**无 `skipRecycle` 参数**（与 fsutil 签名不一致，且全仓库无生产消费方——闲置 API，P3 观察）

## 与其他子系统关系

- **实际消费方**：`internal/app/resource_bindings.go`（Wails 绑定，`FindDuplicateFiles`/`CountDuplicates`）；前端 `app-content/diagnostics/community.ts` 去重页
- **无 `go/importer` 引用**（导入前去重的旧表述为幽灵关系，知识卡已自纠）；**无 `go/ysm` 引用**（元数据比对同为幽灵关系）
- 去重只检测不删除；实际删除走 `go/recycle.DeduplicateEntries`（recycle_clean.go），已安装资源不受影响

## 不变量

- 重复检测不影响已安装资源
- `CleanEmptyDirs` 只删空**子目录**，根目录自身永不删除（与 `go/fsutil.CleanEmptyDirs` 语义对齐）
- **`.recycle` 判定大小写不敏感**（P3 修复：`strings.EqualFold`，与 fsutil.isRecycleDir 对齐——原大小写敏感，Windows `.RECYCLE` 目录会漏排）

## 相关

- `go/fsutil/`（CleanEmptyDirs 同类实现）
