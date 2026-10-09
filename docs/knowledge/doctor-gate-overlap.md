---
kind: doctor-gate-overlap
name: 质量闸门双调度器重叠审计
tier: leaf
category: go
broad_claim: true
source_files:
  - scripts/doctor.ts
  - scripts/pre-push-gate.ts
  - scripts/check-redlines.ts
auto_fields:
  symbols_with_lines:
    - redlineFilterKeysByChangedFiles
use_when:
  - 双调度器
  - 质量闸门重叠
  - doctor gate 差异
  - 治理红线下沉
invariant_anchors:
  - scripts/doctor.ts|function delegate
  - scripts/check-redlines.ts|function runChecks
status: active
---

# 质量闸门双调度器重叠审计

> **source_files 覆盖声明**：本卡为跨切面视图（质量闸门双调度器重叠审计，横跨 doctor / pre-push-gate / check-redlines 三脚本），source_files 覆盖为有意为之，非重复登记。

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

## 三方依赖链摸排（2026-10-05，commit / pre-commit / pre-push）

**问题**：纯文档提交也花 25s（`commit-with-check`），是否"凭空创造窗口期"？

**方法**（可复用）：抽取三个入口各自 spawn 的脚本集，求交集。
抽取须覆盖三种写法，否则漏抽（本次踩过）：① 带前缀字面量 `"scripts/foo.ts"`；
② **裸短名** `"foo.ts"` + 模板拼接 `` `scripts/${tool}` ``（`_lib/commit-check.ts` 与
`_lib/gate-blocks/static-tools.ts` 都是这种，首轮全漏）；③ 清单文件间接（`_lib/gen-cmds.ts`、
`_lib/gate-config.ts` 须展开）。

**实测交集**：

| 交集 | 项 | 判定 |
|---|---|---|
| commit ∩ pre-commit | `check-knowledge-drift` | **非真重复**——参数不同：commit 用 `--files <提交清单>`，pre-commit 用 `--affected`（反向查「源码变更 → 受影响卡」，commit 阶段不做这件事） |
| commit ∩ pre-push | `check-doc-drift` / `check-knowledge-drift` | **真重复但亚秒级**（0.27s + 0.21s），且属 ADR-155 **有意**的 fail-fast（commit=我的 diff 干净吗 ｜ push=整域还建得起来吗） |

**关键结论：重复 ≠ 浪费，要看量级与是否同名同参**。真正的耗时账（热态 8.0s）：

| 项 | 耗时 | 重复？ |
|---|---|---|
| `check-redlines`（19 条规则全仓扫 + fail-closed） | 3.9s | 否（仅 commit 阶段跑） |
| 契约测试（按域选子集） | 3.2s | 否 |
| `check-doc-drift` / `check-knowledge-drift` / `check-twin-siblings` | <0.6s | 亚秒级，可忽略 |

**已修的真正浪费**（不在交集里，是「无条件跑全集」）：`commit-with-check` 原有一轮
「gen 预刷新」（串行跑全 15 个 `GEN_CMDS` ~4s），与 pre-commit 的 gen **重复且对本工具无用**
（本工具走 `--files`，唯一读 gen 产物的「索引断链」检查被 `if (!FILES_SET)` 跳过）——2026-10-05 已删，
11.5s → 8.0s。详见 `commit-with-check.md` 的 pitfalls。

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

**2026-08-26 变更域过滤（已实施）**：check-redlines 接受 `--files <换行分隔文件列表>`（pre-push-gate 在文件驱动/push 模式透传本次变更文件），仅把「变更文件内」的违规计入新增阻断——避免只改 Go/文档时被仓库内其他文件（如未提交 frontend）存量新增红线卡住。`--all`/`--docs` 不传 `--files`，保持全库基线比对。键过滤逻辑抽为可测纯函数 `redlineFilterKeysByChangedFiles`，契约测试 `tests/test_redlines_changed_files.ts` 锁定。

**2026-09-21 R8 补模板插值盲区（已实施，提交 `39691ae76`）**：原 R8 正则 `innerHTML\s*=\s*[^'"`]` 只盯「RHS 是裸变量」，**以反引号开头的模板串恒不命中**——而模板插值恰是全仓 HTML 拼接主力形态（SVG 接入审计实证：`app-sidebar/events.ts` 把外部 MC 路径裸插进 innerHTML 模板，整道闸静默放行）。现 R8 拆两条子规则：`innerHTML concat (non-literal)`（原正则）+ `innerHTML template interpolation hygiene`（新增）。
- **扫描核** = `scripts/_lib/innerhtml-hygiene.ts`（纯函数、零依赖，导出 `isTrustedExpr` / `scanSource`）：提取全部顶层 `${...}` 插值，按可信源白名单判定（`UI_ICONS`/`ICONS` 常量、`t()`/`tOf()`、`esc()` 系、`resolveIcon()` 系图标产物、`render*`/`build*`/`*HTML()` builder、`*Html`/`*Svg`/`*CSS` 命名约定、字面量三元、`toLocaleString()` 数值文本）。
- **豁免**：行注 `// r8-allow: <理由>`（赋值行前 4 行 ~ 模板结束行 +1 窗口内）——本轮实测**零豁免**即把全仓 29 处破口清零，故当前无任何 marker 依赖。
- **契约测试** `tests/test_innerhtml_hygiene.ts`（34 断言：非空转 + 游标泄漏回归 + 白名单形态 + 豁免 + 嵌套模板出口收口）。
- **两条踩坑（防重踩）**：① 表达式分段器「跳过字符串/模板后必须精确落到下一未读字符」——初版漏普通字符收尾，条件段被切成空串后 `slice(1)` 错位，`a !== 1 ? \`<p>${m.count || 0}</p>\` : ""` 这类模板链被误判可信（假阴性）；② 嵌套模板「内层插值全可信即短路」必须再加一层「骨架无顶层运算符（`??`/`||`/`&&`/`? :`/`+`）」——否则 `rawData ?? \`安全模板\`` 的左侧照样被注入（假阳性放行）。
