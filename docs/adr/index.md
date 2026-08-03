---
layout: page
title: 决策记录（ADR）
permalink: /adr/
---

<!-- 本文件由 scripts/gen-docs-index.mjs 自动生成，禁止手改。重跑：node scripts/gen-docs-index.mjs -->

# 决策记录（ADR）

> 架构决策日志，共 **16** 篇。决策真相源 = 各 ADR 文件首部「状态」行；本页为规范索引（按状态分组，可锚点跳转）。

## 按状态分布

| 状态 | 数量 |
|------|------|
| [🔄 部分采纳](#部分采纳) | 2 |
| [⚠️ 已采纳但遗留未修复](#已采纳但遗留未修复) | 3 |
| [✅ 已采纳](#已采纳) | 11 |
| [🧊 已废弃](#已废弃) | 0 |
| [❌ 已取代](#已取代) | 0 |

## 🔄 部分采纳

| ADR | 主题 | 状态 |
|-----|------|------|
| [ADR-016](./ADR-016-ui-experience-improvement.md) | 前端 UI 体验优化决策 | 🔄 部分采纳（P0/P1 已完成，P2 待实施） |
| [ADR-003](./ADR-003-logic-sinking.md) | 业务逻辑从 Binding 层下沉至纯 Go 包（Logic Sinking） | 🔄 部分采纳（P0/P1/P1.5 已完成，P2/P3 进行中） |

## ⚠️ 已采纳但遗留未修复

| ADR | 主题 | 状态 |
|-----|------|------|
| [ADR-012](./ADR-012-binding-call-consistency.md) | Wails Binding 调用路径一致性 | ⚠️ 已采纳（当前不一致，未修复） |
| [ADR-011](./ADR-011-path-separator-inconsistency.md) | 前端路径拼接分隔符不一致 | ⚠️ 已采纳（违规未修复） |
| [ADR-010](./ADR-010-resource-type-literals.md) | 资源类型字面量硬编码治理 | ⚠️ 已采纳（违规未修复） |

## ✅ 已采纳

| ADR | 主题 | 状态 |
|-----|------|------|
| [ADR-017](./ADR-017-frontend-enhancement-backlog.md) | 前端增强待办决策 |  |
| [ADR-015](./ADR-015-unified-animation-system.md) | 前端统一动画系统设计决策 | ✅ 已采纳 |
| [ADR-014](./ADR-014-typescript-migration.md) | 前端 TypeScript 渐进迁移 | ✅ 已采纳 |
| [ADR-013](./ADR-013-governance-convergence.md) | 治理体系收敛 — 文档宪法对账与联邦基线对齐 | ✅ 已采纳 |
| [ADR-008](./ADR-008-event-registration-pattern.md) | 事件注册位置与防重复规范 | ✅ 已采纳 |
| [ADR-007](./ADR-007-context-menu-structure.md) | 右键菜单代码组织决策 | ✅ 已采纳 |
| [ADR-006](./ADR-006-rename-strictness.md) | 重命名文件名格式约束决策 | ✅ 已采纳 |
| [ADR-005](./ADR-005-frontend-governance-rules.md) | 前端治理规则体系 | ✅ 已采纳 |
| [ADR-004](./ADR-004-3d-rendering-pipeline.md) | 3D 骨骼渲染管线与坐标系决策 | ✅ 已采纳 |
| [ADR-002](./ADR-002-project-health-assessment.md) | 项目全面评估与改进方向 | ✅ 已采纳 |
| [ADR-001](./ADR-001-wails3-migration.md) | 升级至 Wails 3 | ✅ 已采纳 |

## 🧊 已废弃

_（暂无）_

## ❌ 已取代

_（暂无）_

---

## 全量列表（按编号倒序）

| ADR | 主题 | 状态 | 日期 |
|-----|------|------|------|
| [ADR-017](./ADR-017-frontend-enhancement-backlog.md) | 前端增强待办决策 |  | - |
| [ADR-016](./ADR-016-ui-experience-improvement.md) | 前端 UI 体验优化决策 | 🔄 部分采纳（P0/P1 已完成，P2 待实施） | 2026-08-03（初定，决策时间线 2026-06-16） |
| [ADR-015](./ADR-015-unified-animation-system.md) | 前端统一动画系统设计决策 | ✅ 已采纳 | 2026-08-03（初定，决策时间线 v1.7.6） |
| [ADR-014](./ADR-014-typescript-migration.md) | 前端 TypeScript 渐进迁移 | ✅ 已采纳 | 2026-08-03 |
| [ADR-013](./ADR-013-governance-convergence.md) | 治理体系收敛 — 文档宪法对账与联邦基线对齐 | ✅ 已采纳 | 2026-08-03 |
| [ADR-012](./ADR-012-binding-call-consistency.md) | Wails Binding 调用路径一致性 | ⚠️ 已采纳（当前不一致，未修复） | 2026-08-03 |
| [ADR-011](./ADR-011-path-separator-inconsistency.md) | 前端路径拼接分隔符不一致 | ⚠️ 已采纳（违规未修复） | 2026-08-03 |
| [ADR-010](./ADR-010-resource-type-literals.md) | 资源类型字面量硬编码治理 | ⚠️ 已采纳（违规未修复） | 2026-08-03 |
| [ADR-008](./ADR-008-event-registration-pattern.md) | 事件注册位置与防重复规范 | ✅ 已采纳 | 2026-08-03 |
| [ADR-007](./ADR-007-context-menu-structure.md) | 右键菜单代码组织决策 | ✅ 已采纳 | 2026-08-03 |
| [ADR-006](./ADR-006-rename-strictness.md) | 重命名文件名格式约束决策 | ✅ 已采纳 | 2026-08-03 |
| [ADR-005](./ADR-005-frontend-governance-rules.md) | 前端治理规则体系 | ✅ 已采纳 | 2026-08-03（初定，规则时间线 v1.5.1 → 持续维护） |
| [ADR-004](./ADR-004-3d-rendering-pipeline.md) | 3D 骨骼渲染管线与坐标系决策 | ✅ 已采纳 | 2026-08-03（初定，决策时间线 v1.5.1 → v1.8.7） |
| [ADR-003](./ADR-003-logic-sinking.md) | 业务逻辑从 Binding 层下沉至纯 Go 包（Logic Sinking） | 🔄 部分采纳（P0/P1/P1.5 已完成，P2/P3 进行中） | 2026-08-03（初定），原方案记录于 2026-06-16 |
| [ADR-002](./ADR-002-project-health-assessment.md) | 项目全面评估与改进方向 | ✅ 已采纳 | 2026-08-03 |
| [ADR-001](./ADR-001-wails3-migration.md) | 升级至 Wails 3 | ✅ 已采纳 | 2026-07-14 |
