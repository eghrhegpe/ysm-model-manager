---
kind: resource_registry
name: 资源注册表 registry
tier: architecture
category: config
source_files:
  - resource_types.json
  - frontend/js/services/registry.ts
use_when:
  - 资源类型
  - 注册表
  - resource_types
  - registry
  - 文件类型
---

# 资源注册表 registry

## 概览

`resource_types.json` 是 YSM 资源类型定义的单一事实来源（Single Source of Truth）。所有资源类型、子目录、扩展名的定义均以此处为准。

## 核心职责

- 定义资源类型及其 `StorageSubDir`、`specificRoot`、`ResourceExts`
- 前端 `services/registry.js` 加载并缓存类型定义
- Go 端 `go/types/` 包同步读取同一份定义

## 与其他子系统关系

- `go/types/`: Go 端注册表加载
- `frontend/js/utils/resource-types.ts`: 前端类型工具
- `frontend/js/utils/resource-registry.ts`: 前端资源注册服务

## 不变量

- 新增资源类型必须在 `resource_types.json` 中添加，不可在 Go/Frontend 中手写新条目
- 一致性测试（`type-consistency.py`）自动校验 JSON ↔ Go ↔ JS 一致性

## 相关

- `resource_types.json` — 单一事实源
- 治理红线 §五.4: 注册表优先
