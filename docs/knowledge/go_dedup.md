---
kind: go_dedup
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

- 基于文件哈希/元数据检测重复
- 返回重复匹配信息

## 对外 API / 入口

- `FindDuplicateFiles` — 扫描目录，按文件哈希/元数据分组，返回重复文件组（`FileEntry`/`Group`）
- `CountDuplicates` — 统计重复文件总数
- `CleanEmptyDirs` — 清理空目录（内部 `removeEmptyDirs`/`isEmptyDir` 递归实现）

## 与其他子系统关系

- `go/importer/`: 导入前去重
- `go/ysm/`: 解析元数据用于比对

## 不变量

- 重复检测不影响已安装资源

## 相关

- `go/importer/`
