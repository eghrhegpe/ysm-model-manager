---
kind: resource-registry
name: 资源注册表 registry
tier: architecture
category: config
source_files:
  - resource_types.json
  - frontend/src/services/registry.ts
  - frontend/src/utils/resource/registry.ts
tests:
  - frontend/src/services/registry.test.ts
  - frontend/src/utils/resource/registry.test.ts
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
- 前端 `services/registry.ts` 是**服务注册表**（`register`/`get`/`has`/`unregister`/`clear` 存 Service 实现到 Map），与资源类型定义（`resource_types.json`）无关
- Go 端 `go/types/` 包同步读取同一份定义

## 对外 API / 入口

- `register(name, service)` — 注册服务（`ServiceName` 联合类型收窄 + 泛型，拼错编译期拦截）
- `get(name)` / `has(name)` — 获取 / 检查服务是否存在（`get` 用 `Map.has()` 判定，falsy 值 `0/""/false/null` 如实返回，P3 修复）
- `unregister(name)` / `clear()` — 注销单个 / 清空全部
- `loadResourceRegistry()`（`utils/resource/registry.ts`）— 加载资源类型注册表；**空结果/异常不缓存**（Go 失败返回 `"{}"` 时不会写入 `_registry`，下次调用可重试，P2 修复）；失败路径 `console.warn` 告警（P3 修复，对齐 Go 端损坏回退告警）

## 与其他子系统关系

- `go/types/`: Go 端注册表加载
- `frontend/src/utils/resource/registry.ts`: 前端资源类型注册表加载（Go `LoadResourceTypes` binding）
- `frontend/src/utils/resource/types.ts`: 前端类型工具

## 不变量

- 新增资源类型必须在 `resource_types.json` 中添加，不可在 Go/Frontend 中手写新条目
- 一致性测试（`type-consistency.py`）自动校验 JSON ↔ Go ↔ JS 一致性

## 相关

- `resource_types.json` — 单一事实源
- 治理红线 §五.4: 注册表优先
