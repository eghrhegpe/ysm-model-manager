---
kind: resource-packs
name: 资源包功能 resource-packs（已归档）
tier: architecture
category: feature
source_files:
  - frontend/src/views/app-nav/
auto_fields:
  symbols_with_lines:
    - navCSS
    - VIEW_TESTIDS
  tests:
    - frontend/src/views/app-preview/detail.test.ts
  invariant_anchors:
    - frontend/src/views/app-preview/detail.ts|showResourcePack
    - frontend/src/views/app-preview/detail.ts|showShaderpack
  use_when:
    - 资源包
    - 光影包
    - resourcepack
    - shaderpack
affected: false
tests:
  - frontend/src/views/app-preview/detail.test.ts
invariant_anchors:
  - frontend/src/views/app-preview/detail.ts|showResourcePack
  - frontend/src/views/app-preview/detail.ts|showShaderpack
use_when:
  - 资源包
  - 光影包
  - resourcepack
  - shaderpack
pitfalls:
  - resource-packs.ts 已于 2026-08-18 删除——引用旧路径会编译错误
  - 独立资源管理组件 app-resource-manager 已于 2026-08-24 删除
  - 启禁/详情已改由 ToggleEnable + app-preview 承载
  - 旧代码中对 resource-packs.ts 或 app-resource-manager 的残留引用需排查
quick_intents:
  - 理解资源包/光影包的历史架构迁移路径
  - 查找资源包详情与启禁的当前入口（app-preview + ToggleEnable）
  - 排查旧代码中的残留引用
status: archived
affected: false
last_verified: 2026-08-27
---

# 资源包功能 resource-packs（已归档）

## 概览

**已删除（2026-08-18）**。原 `frontend/src/features/resource-packs.ts` 是一个薄 wrapper，把仓库页的各类资源包 tab 统一委托给 `<app-resource-manager>` 组件渲染。

## 删除原因

仓库页的资源类型切换已改由 `app-nav` 下拉 + `app-tree` 重渲染（ADR-095），`resource-packs.ts` 无运行时消费者，作为死代码清理。

## 替代方案

- **仓库页**：`app-nav` 全局类型下拉 → `repo:rtype-changed` bus → `app-tree` 重渲染；资源包/光影包详情 & 启禁由 `app-preview`（`showResourcePack`/`showShaderpack`）与统一 `ToggleEnable` 承载
- **整合包页**：`app-sync-manager` 直接管理同步状态（推/拉），不再嵌套 `<app-resource-manager>`
- **独立资源管理**：`<app-resource-manager rtype="...">` 组件已于 2026-08-24 一并删除——启禁走统一 `ToggleEnable`、详情走 `app-preview`

## 相关

- [app_sync_manager](./app-sync-manager.md) — 整合包同步面板（已移除 RM 嵌套）
- [app-preview](./app-preview.md) — 资源包/光影包详情预览入口
