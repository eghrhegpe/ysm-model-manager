---
kind: load_guard
name: 代际守卫唯一出口 createLoadGuard
tier: leaf
category: utils
status: active
source_files:
  - frontend/src/utils/async/load-guard.ts
auto_fields:
  symbols_with_lines:
    - createLoadGuard
    - LoadGuard
tests:
  - frontend/src/utils/async/load-guard.test.ts
use_when:
  - 新增需要「丢弃过期一轮结果」的代际逻辑
  - 见到单文件目录想顺手收敛进 utils/base/
  - 判断全仓代际守卫是否还有手搓残留
  - 想给 LoadGuard 加并发限制之前
pitfalls:
  - 单文件目录 ≠ 待收敛孤岛（ADR-230 钉死，迁移 = 违反 ADR + 无谓 churn）
  - 「D1/D2 已落地」≠「全仓零手搓」——范围性目标非穷举保证，判断干净必须 grep 实证
  - LoadGuard 只管代际不管并发；「单飞 + 尾随补跑」属并发控制，勿混入
quick_groups:
  - 代际守卫
quick_intents:
  - 新增代际逻辑时，唯一出口是 createLoadGuard() 四件套
  - 想迁移/收敛 load-guard.ts 前，先查 ADR-230
  - 判断「全仓干净」用 grep 实证，不引用历史注脚作证据
quick_risk_lines:
  - 迁移或删除 load-guard.ts = 违反 ADR-230
invariant_anchors:
  - frontend/src/utils/async/load-guard.ts|export function createLoadGuard
---

# 代际守卫唯一出口 createLoadGuard

## 概览

`utils/async/load-guard.ts` 是全仓唯一代际守卫出口，由 **ADR-230 钉死**。本卡承接原 AGENTS.md「src/core 准入准则」下的 ADR-230 注脚链全文（2026-10-04 迁入，常驻层瘦身），正文以本卡为准。

## 核心职责

- **只管代际**（丢弃哪一轮结果），**不管并发**（同一时刻允许几个请求在跑）。
- 「单飞 + 尾随补跑」属并发控制，全仓仅 `app-sidebar` 一处消费（`_reloadInFlight`/`_reloadPending`），不抽象为通用原语（ADR-230 D4）。

## 对外 API / 入口

`createLoadGuard()` → `next()` / `stale()` / `invalidate()` / `current` 四件套。

## 历史与边界（事故化石记录）

- 原 `views/app-preview/gen-guard.ts`、`perf-common.ts:makeGenGuard`、`app-tree:atBeGenGuard` 三套同构实现及 app-tree 22 处 raw `_gen` 均已退役并入此出口（D1/D2 已落地）。路径写入 ADR 与 25 处 import。
- ⚠️ **「D1/D2 已落地」≠「全仓零手搓」**（2026-09 修正：原注脚写作「零残留」，属由 ADR 落地状态反推全仓，措辞过宽）。D1/D2 是按当时 grep 圈定的**范围性目标**，非穷举保证——复核曾发现 3 处范围外漏网：`app-sidebar:_reloadGen`、`preview-3d/session-ledger:_gen`、`app-sync-manager:_initGen`（后两处已并入、末者删除，见 ADR-230 D4）。

## 不变量

- 新增代际逻辑一律走 `createLoadGuard()`；判断是否「全仓干净」必须 `grep` 实证，不得引用历史注脚作证据。
- `load-guard.ts` **禁止迁入 `utils/base/`**——它虽零依赖纯函数（符合 pure/ 准入），但迁移 = 违反 ADR-230 + 无谓 churn。后续会话见「单文件目录」勿自动判为待收敛孤岛，先查 ADR 索引。

## 相关

- ADR-230（决策与理由）；ADR-189 D4（core 准入，见知识卡 `fe_layering_seams.md`）
- 消费方知识卡：app-preview / app-tree / app-sync-manager
