---
kind: check_threshold_scanners
name: 三档阈值扫描器（复杂度/参数/类型安全）
tier: leaf
category: config
status: active
source_files:
  - scripts/check-complexity.ts
  - scripts/check-params.ts
  - scripts/check-type-safety.ts
auto_fields:
  symbols_with_lines:
    - cognitiveFromSeq
    - collectNamedFunctions
    - countLineSignals
    - CxEvent
    - EROSION_WEIGHTS
    - erosionOf
    - ErosionTier
    - fnBodyToEvents
    - isProdSourceFile
    - scanCapDecision
    - tierOf
    - trapReasons
    - trapScore
    - trapTier
    - TypeErosionSignal
use_when:
  - check-complexity
  - check-params
  - 认知复杂度
  - 参数陷阱
  - 阈值扫描器
  - gate debt 档
  - --files 传参
pitfalls:
  - "在函数内部把箭头回调拆成小箭头 → 认知复杂度**不降**（未命名箭头计入外层具名函数）"
  - "--files 用空格拼接传参 → 被当成单个路径，scopeFilter.requested=1、扫 0 文件静默假绿"
  - "把 debt 档 FAIL 当成推送被拦 → gate 只在 hard 档阻断，debt 只记录"
  - "为把 p6 压到 p5 硬塞语义无关形参进 options 对象 → 为过闸而扭曲 API"
quick_groups:
  - 门禁
  - 重构
quick_intents:
  - "知道 check-complexity 报错会不会阻断推送"
  - "把认知复杂度降到阈值下却分数不变"
  - "本地复现三档扫描器的门禁范围"
  - "给 exported 函数消参数陷阱但不扭曲 API"
quick_risk_lines:
  - "认知复杂度的度量单位是**具名函数**，不是语法上的函数字面量"
invariant_anchors:
  - scripts/check-complexity.ts|collectNamedFunctions
  - scripts/check-params.ts|isBoolParam
  - scripts/check-type-safety.ts|TypeErosionSignal
---

# 三档阈值扫描器（复杂度/参数/类型安全）

## 概览

`check-complexity`（认知复杂度 + 最大嵌套）、`check-params`（长参数列表 / 布尔陷阱）、
`check-type-safety`（any / `@ts-expect-error` / 非空断言）三个「情报型」扫描器同域同档，
回答「这份代码好不好维护」的复杂度/边界/类型三个维度。三者共用
`scripts/check-complexity.ts` 的 `collectNamedFunctions` 收集口径与
`scripts/_lib/changed-scope.ts` 的变更域过滤。

## 核心职责

- 默认阈值：黄 15 / 橙 30 / 红 45（复杂度和类型安全）；参数侧为「params ≥ 6 或 boolParams ≥ 2」。
- 全库扫描 + 全库计数，**入门禁时靠 `scopedFiles: true` 把命中收敛到本次变更文件**
  （否则未触碰文件的存量债会把每次推送刷成全红）。

## 对外 API / 入口

```bash
node scripts/check-complexity.ts                                  # 全库
node scripts/check-complexity.ts --files "$(git diff --name-only)" # 增量（换行分隔，见下）
node scripts/check-complexity.ts --changed                         # 相对默认分支基线自解析
node scripts/check-complexity.ts --strict --json                   # 有命中 exit 1
```

## 门禁语义（最容易误判的一条）

`scripts/_lib/gate-config.ts` 给这三者登记的 `blockPolicy: "debt"`。
`scripts/_lib/gate-ctx.ts` 的阻断判定是「非 `debt` 且非 `failClosed` 才算 blocked」，
**因此三档扫描器 FAIL 不会阻断 push**——它只在门禁摘要里留一条存量债记录。
真正阻断推送的只有 `hard` 档（如 golangci-lint 的圈复杂度）。

## `--files` 传参契约（踩过）

`--files` 收的是**换行分隔的相对路径**，且必须是**单个 argv 元素**：

```bash
# ✅ 换行保留在同一个参数里
node scripts/check-params.ts --files "$(cat changed-files.txt)"
# ❌ 把换行转成空格 → 整串被当成一条路径
node scripts/check-params.ts --files "$(tr '\n' ' ' < changed-files.txt)"
```

失败形态是**静默假绿**：`_summary.scopeFilter` 出现 `requested: 1, matched: 0`，
扫描 0 个文件而 `ok: true`。看到 `requested` 与预期文件数不符，先怀疑传参。
门禁侧走数组式 `procRun` 直传（`shell:false`），规避 Windows cmd 8191 上限。

## 降复杂度：度量单位是**具名函数**

认知复杂度归属**外层具名函数**——事件处理器、`map`/`forEach` 回调、IIFE 里的分支与循环
会**计入**包住它的那个具名函数。由此推出：

- 在原函数内把箭头体拆成更小的箭头 → **分数纹丝不动**（只是搬家）。
- 正确手法是抽**顶层 `function`**（并给它起名），让它成为独立度量单元，各自 < 15。
- 拆分时要检查被抽出的闭包自身分数，别把 41 分原样搬成一个同样超标的具名函数。
- 惰性语义别改：原本在回调内**每次渲染重算**的派生值，别图省事提到工厂外一次性算好，
  否则重渲染会读到陈旧状态（抽函数 ≠ 提前求值）。

## 对外 API 消参数陷阱

给 exported 函数消参数陷阱（p6→p5/p4/p3）时**优先复用已存在的 deps 接口**：
若模块已有一个「依赖注入」接口恰好覆盖这些形参，直接把形参收成 `deps: ThatDeps`，
调用方往往只改一行（`buildVrmScene(ctx, path, deps)`），且测试调用点的迁移由 tsc 兜底
（类型不匹配即编译期报错，比人眼可靠）。

## 与其他子系统关系

- `_lib/changed-scope.ts`：`--files`/`--changed`/`--staged` 三入口的统一实现。
- `_lib/gate-parse.ts`：`buildScanVerdict()` 产出 `_summary.ok/errors`，门禁据此判定。
- `_lib/gate-config.ts`：`blockPolicy` 与 `scopedFiles` 的唯一定义点。
- `scripts/pre-push-gate.ts`：push 时按变更集裁剪调用。

## 不变量

- 三个扫描器的 `_summary` 必须由 `buildScanVerdict()` 生产，否则判定退回 rc（恒 0）→ 静默假绿。
- `--files` 解析失败或结果为空一律 fail-closed，**不许静默退回全库**。
- 无 `--files`/`--changed` 时 scope = null = 全库，是刻意保留的向后兼容行为。

## 相关

- `docs/knowledge/scripts_argv.md` —— parseArgs 通用参数规范
- `docs/knowledge/pre_push_gate.md` —— push 门禁全貌
- `docs/knowledge/doctor_gate_overlap.md` —— doctor / 门禁职责重叠
