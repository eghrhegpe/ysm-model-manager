---
kind: go_ccheck
name: Go 团队复杂度扫描 ccheck（check-complexity 对拍镜像）
tier: leaf
category: go
status: active
source_files:
  - go/ccheck/ccheck.go
auto_fields:
  symbols_with_lines:
    - CognitiveFromSeq
    - Event
    - FnBodyToEvents
    - FuncResult
    - ScanDir
    - ScanFile
use_when:
  - ccheck
  - 认知复杂度
  - cognitive
  - 复杂度扫描
  - check-complexity 对拍
  - go 复杂度
invariant_anchors:
  - go/ccheck/ccheck.go|CognitiveFromSeq
---

# Go 团队复杂度扫描 ccheck（check-complexity 对拍镜像）

## 概览

`go/ccheck` 提供 Go 源码的**团队复杂度**（认知复杂度 + 嵌套深度）扫描，是前端
`scripts/check-complexity.ts` 的 **Go 端对齐镜像**（ADR-154 对拍风格）：同一数学
（Sonar Cognitive Complexity 简化），纯函数可按位置换，双端由共享契约向量
`tests/parity/go-ts-complexity.json` 互锁（本包 `parity_test.go` ↔
`tests/test_complexity_parity.ts`）。

## 核心职责

- **认知复杂度**：控制流结构每命中一次 +1，且处于嵌套层级 d 时另 +d（深嵌套迷宫高分）。
  嵌套型（进 depth 再算）：`if` / `for` / `range` / `switch` / `type-switch` / `select`；
  即时型（不增层）：`else` / `case` / 逻辑运算符 `&&` `||`（Go 无三元）。
- **嵌套深度**：整个函数最大控制流嵌套层数。

## 对外 API / 入口

- `FnBodyToEvents(fd)` → 事件流（nest / flat / nestClose）
- `CognitiveFromSeq(seq)` → `(复杂度, 嵌套深度)` 元组
- `emitFromNode`：只把 `go/ast` 翻译成事件流，**不含任何复杂度语义**——跨语言无法向量对拍发射器，发射端为尽力对齐，语义收敛点在 `CognitiveFromSeq` 规约器。

## 与其他子系统关系

- 前端镜像：`scripts/check-complexity.ts`（`cognitiveFromSeq` 语义逐字一致）。
- 对拍契约：`tests/parity/go-ts-complexity.json`（双端互锁，改一侧必须改契约另一侧）。

## 不变量

- `CognitiveFromSeq` 与 TS `cognitiveFromSeq` 对同一向量输入产出相同（复杂度, 深度）。
- 发射器（emitFromNode）不携带复杂度语义——语义只存在于规约器，保证「翻译层可替换」。

## 相关

- 知识卡：`golangci-lint.md`（Go 静态分析真空面——errcheck/gocritic 等，与 ccheck 复杂度扫描分工互补）
- 前端：`scripts/check-complexity.ts`；契约：`tests/parity/go-ts-complexity.json`
