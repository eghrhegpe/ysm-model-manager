---
layout: page
title: 决策记录（ADR）
permalink: /adr/
---

<!-- 本文件由 scripts/gen-docs-index.mjs 自动生成，禁止手改。重跑：node scripts/gen-docs-index.mjs -->

# 决策记录（ADR）

> 架构决策日志，共 **32** 篇。决策真相源 = 各 ADR 文件首部「状态」行；本页为规范索引（按状态分组，可锚点跳转）。

## 按状态分布

| 状态 | 数量 |
|------|------|
| [🔄 部分采纳](#部分采纳) | 1 |
| [⚠️ 已采纳但遗留未修复](#已采纳但遗留未修复) | 2 |
| [✅ 已采纳](#已采纳) | 29 |
| [🧊 已废弃](#已废弃) | 0 |
| [❌ 已取代](#已取代) | 0 |

## 🔄 部分采纳

| ADR | 主题 | 状态 |
|-----|------|------|
| [ADR-022](./ADR-022-vitepress-site.md) | VitePress 建站 | 🔄 部分采纳（内容体系已就绪，站点搭建由并行 AI 推进中） |

## ⚠️ 已采纳但遗留未修复

| ADR | 主题 | 状态 |
|-----|------|------|
| [ADR-012](./ADR-012-binding-call-consistency.md) | Wails Binding 调用路径一致性 | ⚠️ 已采纳（当前不一致，未修复） |
| [ADR-011](./ADR-011-path-separator-inconsistency.md) | 前端路径拼接分隔符不一致 | ⚠️ 已采纳（违规未修复） |

## ✅ 已采纳

| ADR | 主题 | 状态 |
|-----|------|------|
| [ADR-033](./ADR-033-updater-download-truncation-version-compare.md) | 更新包下载截断检测与版本比较加固 | ✅ 已采纳 |
| [ADR-032](./ADR-032-sync-diff-detection-failure-visibility.md) | 同步差异检测与失败可见性加固 | ✅ 已采纳 |
| [ADR-031](./ADR-031-watcher-lifecycle-sync-serialization.md) | 文件监听生命周期与同步串行化加固 | ✅ 已采纳 |
| [ADR-030](./ADR-030-backend-robustness-contract.md) | 后端持久化与健壮性契约 | ✅ 已采纳 |
| [ADR-029](./ADR-029-ysmparser-wasm-embed.md) | YSMParser 解码架构：WASM 内嵌取代 sidecar EXE | ✅ 已采纳 |
| [ADR-028](./ADR-028-installer-atomic-link-relink.md) | 安装器链接模式原子替换与 relink 回滚保护 | ✅ 已采纳 |
| [ADR-027](./ADR-027-web-component-contract-normalization.md) | Web Component 对外契约规范化 | ✅ 已采纳 |
| [ADR-026](./ADR-026-ysm-parser-ethics-boundary.md) | YSM 解析器集成伦理边界 | ✅ 已采纳 |
| [ADR-025](./ADR-025-download-mirror-fallback.md) | 工坊下载镜像回退架构 | ✅ 已采纳 |
| [ADR-024](./ADR-024-multi-resource-federation.md) | 多资源类型联邦架构（ResourceAdapter + resource_types.json 注册表） | ✅ 已采纳 |
| [ADR-023](./ADR-023-test-framework.md) | 测试体系 | ✅ 已采纳（L1/L2/L3 三层全部落地并接入质量门禁——pre-push-gate / doctor / CI + v8 覆盖率阈值；L3 用例 26 文件持续扩充中） |
| [ADR-021](./ADR-021-declarative-menu-testing.md) | 前端声明式菜单自动化测试方案 | ✅ 已采纳（A/B 层已实施；C 层 E2E 按决策不引入、列为远期） |
| [ADR-020](./ADR-020-script-toolchain.md) | 脚本体系 | ✅ 已采纳 |
| [ADR-019](./ADR-019-knowledge-base.md) | 知识卡体系 | ✅ 已采纳 |
| [ADR-018](./ADR-018-user-guide.md) | 用户指南体系 | ✅ 已采纳 |
| [ADR-017](./ADR-017-frontend-enhancement-backlog.md) | 前端增强待办决策 | ✅ 已采纳（E-1/E-2 已完成） |
| [ADR-016](./ADR-016-ui-experience-improvement.md) | 前端 UI 体验优化决策 | ✅ 已采纳（P0/P1/P2 全部完成） |
| [ADR-015](./ADR-015-unified-animation-system.md) | 前端统一动画系统设计决策 | ✅ 已采纳 |
| [ADR-014](./ADR-014-typescript-migration.md) | 前端 TypeScript 渐进迁移 | ✅ 已采纳 |
| [ADR-013](./ADR-013-governance-convergence.md) | 治理体系收敛 — 文档宪法对账与联邦基线对齐 | ✅ 已采纳 |
| [ADR-010](./ADR-010-resource-type-literals.md) | 资源类型字面量硬编码治理 | ✅ 已采纳（2026-08-03 清零完成） |
| [ADR-008](./ADR-008-event-registration-pattern.md) | 事件注册位置与防重复规范 | ✅ 已采纳 |
| [ADR-007](./ADR-007-context-menu-structure.md) | 右键菜单代码组织决策 | ✅ 已采纳 |
| [ADR-006](./ADR-006-rename-strictness.md) | 重命名文件名格式约束决策 | ✅ 已采纳 |
| [ADR-005](./ADR-005-frontend-governance-rules.md) | 前端治理规则体系 | ✅ 已采纳 |
| [ADR-004](./ADR-004-3d-rendering-pipeline.md) | 3D 骨骼渲染管线与坐标系决策 | ✅ 已采纳 |
| [ADR-003](./ADR-003-logic-sinking.md) | 业务逻辑从 Binding 层下沉至纯 Go 包（Logic Sinking） | ✅ 已采纳（P0/P1/P1.5/P2/P3 全部完成） |
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
| [ADR-033](./ADR-033-updater-download-truncation-version-compare.md) | 更新包下载截断检测与版本比较加固 | ✅ 已采纳 | 2026-08-04 |
| [ADR-032](./ADR-032-sync-diff-detection-failure-visibility.md) | 同步差异检测与失败可见性加固 | ✅ 已采纳 | 2026-08-04 |
| [ADR-031](./ADR-031-watcher-lifecycle-sync-serialization.md) | 文件监听生命周期与同步串行化加固 | ✅ 已采纳 | 2026-08-04 |
| [ADR-030](./ADR-030-backend-robustness-contract.md) | 后端持久化与健壮性契约 | ✅ 已采纳 | 2026-08-04 |
| [ADR-029](./ADR-029-ysmparser-wasm-embed.md) | YSMParser 解码架构：WASM 内嵌取代 sidecar EXE | ✅ 已采纳 | 2026-08-04 |
| [ADR-028](./ADR-028-installer-atomic-link-relink.md) | 安装器链接模式原子替换与 relink 回滚保护 | ✅ 已采纳 | 2026-08-04 |
| [ADR-027](./ADR-027-web-component-contract-normalization.md) | Web Component 对外契约规范化 | ✅ 已采纳 | 2026-08-04 |
| [ADR-026](./ADR-026-ysm-parser-ethics-boundary.md) | YSM 解析器集成伦理边界 | ✅ 已采纳 | 2026-08-04（原决策 2026-06-07） |
| [ADR-025](./ADR-025-download-mirror-fallback.md) | 工坊下载镜像回退架构 | ✅ 已采纳 | 2026-08-04（原方案 2026-06-06 定稿） |
| [ADR-024](./ADR-024-multi-resource-federation.md) | 多资源类型联邦架构（ResourceAdapter + resource_types.json 注册表） | ✅ 已采纳 | 2026-08-04（决策时间线：联邦愿景 2025-06-07 起草 / P7 多资源计划 2026-06-10 定稿 / 注册表现行落地） |
| [ADR-023](./ADR-023-test-framework.md) | 测试体系 | ✅ 已采纳（L1/L2/L3 三层全部落地并接入质量门禁——pre-push-gate / doctor / CI + v8 覆盖率阈值；L3 用例 26 文件持续扩充中） | 2026-08-03（初定），2026-08-04（L3 落地 + 覆盖率基线 + 进门禁/CI + 阈值红线 + 补测报告脚本） |
| [ADR-022](./ADR-022-vitepress-site.md) | VitePress 建站 | 🔄 部分采纳（内容体系已就绪，站点搭建由并行 AI 推进中） | 2026-08-03 |
| [ADR-021](./ADR-021-declarative-menu-testing.md) | 前端声明式菜单自动化测试方案 | ✅ 已采纳（A/B 层已实施；C 层 E2E 按决策不引入、列为远期） | 2026-08-03 |
| [ADR-020](./ADR-020-script-toolchain.md) | 脚本体系 | ✅ 已采纳 | 2026-08-03 |
| [ADR-019](./ADR-019-knowledge-base.md) | 知识卡体系 | ✅ 已采纳 | 2026-08-03 |
| [ADR-018](./ADR-018-user-guide.md) | 用户指南体系 | ✅ 已采纳 | 2026-08-03 |
| [ADR-017](./ADR-017-frontend-enhancement-backlog.md) | 前端增强待办决策 | ✅ 已采纳（E-1/E-2 已完成） | 2026-08-03 |
| [ADR-016](./ADR-016-ui-experience-improvement.md) | 前端 UI 体验优化决策 | ✅ 已采纳（P0/P1/P2 全部完成） | 2026-08-03（初定，决策时间线 2026-06-16） |
| [ADR-015](./ADR-015-unified-animation-system.md) | 前端统一动画系统设计决策 | ✅ 已采纳 | 2026-08-03（初定，决策时间线 v1.7.6） |
| [ADR-014](./ADR-014-typescript-migration.md) | 前端 TypeScript 渐进迁移 | ✅ 已采纳 | 2026-08-03 |
| [ADR-013](./ADR-013-governance-convergence.md) | 治理体系收敛 — 文档宪法对账与联邦基线对齐 | ✅ 已采纳 | 2026-08-03 |
| [ADR-012](./ADR-012-binding-call-consistency.md) | Wails Binding 调用路径一致性 | ⚠️ 已采纳（当前不一致，未修复） | 2026-08-03 |
| [ADR-011](./ADR-011-path-separator-inconsistency.md) | 前端路径拼接分隔符不一致 | ⚠️ 已采纳（违规未修复） | 2026-08-03 |
| [ADR-010](./ADR-010-resource-type-literals.md) | 资源类型字面量硬编码治理 | ✅ 已采纳（2026-08-03 清零完成） | 2026-08-03 |
| [ADR-008](./ADR-008-event-registration-pattern.md) | 事件注册位置与防重复规范 | ✅ 已采纳 | 2026-08-03 |
| [ADR-007](./ADR-007-context-menu-structure.md) | 右键菜单代码组织决策 | ✅ 已采纳 | 2026-08-03 |
| [ADR-006](./ADR-006-rename-strictness.md) | 重命名文件名格式约束决策 | ✅ 已采纳 | 2026-08-03 |
| [ADR-005](./ADR-005-frontend-governance-rules.md) | 前端治理规则体系 | ✅ 已采纳 | 2026-08-03（初定，规则时间线 v1.5.1 → 持续维护） |
| [ADR-004](./ADR-004-3d-rendering-pipeline.md) | 3D 骨骼渲染管线与坐标系决策 | ✅ 已采纳 | 2026-08-03（初定，决策时间线 v1.5.1 → v1.8.7） |
| [ADR-003](./ADR-003-logic-sinking.md) | 业务逻辑从 Binding 层下沉至纯 Go 包（Logic Sinking） | ✅ 已采纳（P0/P1/P1.5/P2/P3 全部完成） | 2026-08-03（初定），原方案记录于 2026-06-16 |
| [ADR-002](./ADR-002-project-health-assessment.md) | 项目全面评估与改进方向 | ✅ 已采纳 | 2026-08-03 |
| [ADR-001](./ADR-001-wails3-migration.md) | 升级至 Wails 3 | ✅ 已采纳 | 2026-07-14 |
