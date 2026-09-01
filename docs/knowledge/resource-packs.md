---
kind: resource-packs
name: 资源包功能 resource-packs
tier: architecture
category: feature
source_files:
  - frontend/src/views/app-preview/detail.ts
  - frontend/src/views/app-nav/
tests:
  - frontend/src/views/app-preview/detail.test.ts
invariant_anchors:
  - frontend/src/views/app-preview/detail.ts|showResourcePack
  - frontend/src/views/app-preview/detail.ts|showShaderpack
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 资源包、光影包、resourcepack / shaderpack
  - showResourcePack、showShaderpack
  - 蓝图、投影、资源管理
quick_risk_lines:
  - 资源包 / 光影包详情必须经 detail.ts 的 showResourcePack/showShaderpack，禁止手写详情渲染
pitfalls:
  - 手写详情渲染 → 与模型详情样式不一致、缺 Go 侧 ReadPackMeta/ReadShaderpackLang；必须复用
  - 光影包配置未读 ReadShaderpackLang → 显示名 / 配置简介缺失；必须经 Go 侧读取

use_when:
  - 资源包
  - 光影包
  - 蓝图
  - 投影
  - resourcepack
  - shaderpack
  - 资源管理
---

# 资源包功能 resource-packs

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
