---
kind: go_importer
name: 导入策略 go/importer
tier: architecture
category: go
source_files:
  - go/importer/
use_when:
  - 导入
  - 策略
  - 导入队列
  - importer
---

# 导入策略 go/importer

## 概览

`go/importer/` 包定义模型导入策略，包括从社区/外部源导入模型资源。

## 核心职责

- 导入队列管理
- 导入来源验证
- 资源重复检测

## 对外 API / 入口

- `Register` / `Get` — 导入策略注册表（`Handler` 接口，按资源类型取策略）
- `NewSimpleCopy` — 简单复制策略（`SimpleCopyImporter`：resourcepack/shaderpack/vrchat-avatar 等）
- `NewDirectoryCopy` — 目录复制策略（`DirectoryCopyImporter`：mmd-skin 等按文件夹为单位）
- `Import` — 执行导入（`sanitizePath` 路径清理 / `copyDirRecursive` 递归复制）

## 与其他子系统关系

- `go/dedup/`: 导入前去重
- `frontend/src/features/import-queue.ts`: 前端导入队列 UI

## 不变量

- 导入前必须检查已存在资源

## 相关

- `frontend/src/features/import-queue.ts`
