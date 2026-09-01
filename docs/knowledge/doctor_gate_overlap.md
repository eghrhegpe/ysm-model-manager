---
kind: doctor_gate_overlap
name: 质量闸门双调度器重叠审计
tier: leaf
category: go
source_files:
  - scripts/doctor.ts
  - scripts/pre-push-gate.ts
  - scripts/check-redlines.ts
use_when:
  - 双调度器
  - 质量闸门重叠
  - doctor gate 差异
  - 治理红线下沉
invariant_anchors:
  - scripts/doctor.ts|function delegate
  - scripts/check-redlines.ts|function runChecks
---

# 质量闸门双调度器重叠审计

## 概览

2026-08-14 摸排结论：推送测试链路本身不臃肿，但质量闸门体系存在**双调度器 + 双重实现**，约 250 行重复逻辑，已出现参数漂移。

## 已知缺口

| # | 缺口 | 影响 |
|---|------|------|
| 1 | gate `go test` 少测 `./internal/app/` | 内部 app 测试不跑推送门禁 |
| 2 | `tsc --noEmit` 全链路缺失 | TS 类型错误无门禁覆盖 |
| 3 | `checkGovernance` 是 `check-redlines` 过时子集 | doctor 全量不查 16 条新红线表 |
| 4 | gate 缺 updater helper 前置构建 | 干净 checkout 下裸崩 |

## 双调度器重复清单

| 检查 | doctor 全量 | pre-push-gate |
|------|------------|--------------|
| go build | `checkGoBuild()` | 内联 |
| go test | `checkGoTest()`（含 `./internal/app/`） | 内联（缺 `./internal/app/`） |
| go vet | `checkGoVet()` | 内联 |
| 契约测试 | `checkContractTests()` | `runContractTests()` |
| vite build | `checkFrontendBuild()` | 内联 |
| vitest | `checkFrontendTest()` | 内联 |
| check-layering | STATIC_TOOLS | 前端域 |
| link-checker | `--strict` | 解析 JSON |
| binding-check | STATIC_TOOLS | Go 域 |
| check-redlines | ❌ 无（只有手写 `checkGovernance` 子集） | 完整 16 条规则 |

## 决策记录

2026-08-14 摸排后曾决定不修复（"折腾"），仅留知识卡存档。
**2026-08-14 已实施合并（方案 A）**：doctor.mjs 缩为薄派发器（603→68 行），三模式全部委托 pre-push-gate.mjs（`--all` / `--docs` / `--dry-run`）。4 个缺口全部修复：
- `go test` 范围对齐（含 `./internal/app/`）
- `tsc --noEmit` 补入前端域
- updater helper 前置构建补入 Go 域
- `checkGovernance` 手写规则废弃（由 check-redlines R1/R5/R8/W2 覆盖）

顺带修复：`cmd/updater/main.go` 存量编译错误（`pid` 声明未使用，807c81a5 引入）——由新 gate 的 updater helper 检查暴露。

存量债务（与本次重构无关）：`check-circular.mjs`（context-menu-handlers 循环依赖）与 `check-deadcode-baseline.mjs`（baseline 过期，25b31fed 改源码未更新基线）在 --all 全量模式下仍 FAIL，需单独处理。
**2026-08-14 二次治本（已解决）**：并行工作区 `f259643c` 拆出 context-menu-shared.ts 破除循环依赖（check-circular 归零）；本会话清理死代码（提交 `feb00e05`）——删除 4 处死 re-export、8 处去 export、debug-render↔cleanup-helper dispose 去重、dnd-collector.mergeDropFiles 删除，`check-deadcode` errors 归零，全量 doctor 36/36。

**2026-08-26 变更域过滤（已实施）**：check-redlines 接受 `--files <换行分隔文件列表>`（pre-push-gate 在文件驱动/push 模式透传本次变更文件），仅把「变更文件内」的违规计入新增阻断——避免只改 Go/文档时被仓库内其他文件（如未提交 frontend）存量新增红线卡住。`--all`/`--docs` 不传 `--files`，保持全库基线比对。键过滤逻辑抽为可测纯函数 `redlineFilterKeysByChangedFiles`，契约测试 `tests/test_redlines_changed_files.mjs` 锁定。
