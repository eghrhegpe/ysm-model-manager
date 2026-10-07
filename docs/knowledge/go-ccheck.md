---
kind: go-ccheck
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
quick_groups:
  - 后端桥接与数据存储
quick_intents:
  - 认知复杂度、嵌套深度、cognitive complexity
  - go/ccheck 包、复杂度扫描器在哪
  - check-complexity 双端对拍、复杂度契约向量
quick_risk_lines:
  - Go 与 TS 两侧认知复杂度数字不可横向比较（TS 侧 else 分支永不命中），前端战役只看 TS 侧、Go 战役只看 Go 侧
pitfalls:
  - 改复杂度口径等于全量重基线，须先拍板；勿顺手给 TS 补 flat("else") 对齐
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
  即时型：`else` / `case` / 逻辑运算符 `&&` `||`（Go 无三元）——**不增加嵌套层，但仍按当前
  深度计分（`+1+d`）**：「不增层」≠「与深度无关」。对拍向量已覆盖此点（
  `tests/parity/go-ts-complexity.json` 的「if 条件内双 &&（flat logic 在 d1 计分）」）；
  重构含义 = 把布尔链 / `else` 提到顶层具名函数，同一串从 `1+d` 降到 `1`。
- **嵌套深度**：整个函数最大控制流嵌套层数。

## 对外 API / 入口

- `FnBodyToEvents(fd)` → 事件流（nest / flat / nestClose）
- `CognitiveFromSeq(seq)` → `(复杂度, 嵌套深度)` 元组
- `emitFromNode`：只把 `go/ast` 翻译成事件流，**不含任何复杂度语义**——跨语言无法向量对拍发射器，发射端为尽力对齐，语义收敛点在 `CognitiveFromSeq` 规约器。

## 与其他子系统关系

- 前端镜像：`scripts/check-complexity.ts`（`cognitiveFromSeq` 语义逐字一致）。
- 对拍契约：`tests/parity/go-ts-complexity.json`（双端互锁，改一侧必须改契约另一侧）。
  ⚠️ **契约锁的是规约器（事件序列 → 复杂度），不锁发射器**——它不喂源码给发射器，
  故「同一语法在两侧产出不同事件」结构上不可见。
- **实测分叉：`else` 两侧不同口径**（2026-10-07 判别实验）：Go `emitIf` 显式发
  `flat("else")`（`+1+d`），而 TS 侧那条 `ElseClause` 分支在 TS AST 上**永不命中**
  （ElseClause 是 Roslyn 概念，非 TS），故 TS **从不给 `else` 计分**。判别法：`if(a){..}`
  与 `if(a){..}else{..}` 在 TS 侧同为 1 分；同为 3 链 else-if 时 **TS 6 分 / Go 15 分**
  （深度递增在两侧一致，差的只是每链那个 `flat`）。
  ⇒ **两侧认知复杂度数字不可横向比较**（前端战役只看 TS 侧、Go 战役只看 Go 侧，各自纵向比）。
  改口径（给 TS 补 `flat("else")`）等于全量重基线，须先拍板，勿顺手做。
- **又一处非显然的计分机制（两侧共有，2026-10-07 实测）**：发射器**递归整棵 AST 且不为内嵌函数重置
  depth**——写在 `for`/`while` 体内的**箭头回调**（如 `.sort(cb)` 的比较器、`.map(cb)`），其内部的
  `??`/`||`/三元按**外层 depth** 计分。故「把回调提到顶层具名函数」是纯收益的削平手段：前例
  `flattenVisible` 的比较器在 while 帧内每条 `??` 白背 d=2；提取后 108 → 25。
  （这不是缺陷，是「AST 遍历式发射器」相对真 Sonar 作用域模型的简化；两侧一致，故不影响对拍。）

## 不变量

- `CognitiveFromSeq` 与 TS `cognitiveFromSeq` 对同一向量输入产出相同（复杂度, 深度）。
- 发射器（emitFromNode）不携带复杂度语义——语义只存在于规约器，保证「翻译层可替换」。

## 相关

- 知识卡：`golangci-lint.md`（Go 静态分析真空面——errcheck/gocritic 等，与 ccheck 复杂度扫描分工互补）
- 前端：`scripts/check-complexity.ts`；契约：`tests/parity/go-ts-complexity.json`
