---
kind: orphan_export_scanner
name: 孤儿导出检测器（扫描盲区）
tier: leaf
category: config
status: active
source_files:
  - scripts/check-orphan-exports.ts
auto_fields:
  symbols_with_lines:
    - isOrphanExempt
use_when:
  - 修改 check-orphan-exports.ts 扫描逻辑
  - 门禁报孤儿导出，判定是真死代码还是扫描漏检
  - 新增 export * 转发壳 / 测试包装函数后复核孤儿读数
quick_groups:
  - 工具与门禁
quick_intents:
  - 孤儿导出误报、扫描盲区、转发即消费
  - check-orphan-exports 三类漏检修复
quick_risk_lines:
  - ⚠️ 孤儿读数为 0 才可信；出现孤儿先判「真死代码 vs 扫描漏检」再动手删
pitfalls:
  - ❌ 曾漏检三类消费形态，导致活代码被误报孤儿并倒逼出遮蔽性豁免规则（僵尸规则）
  - ⚠️ 豁免规则超期未清 = 检测器失明；契约测试硬编码条数，删规则须同步 tests/test_orphan_exports_smart.ts
invariant_anchors:
  - scripts/check-orphan-exports.ts|collectStarForwards
  - scripts/check-orphan-exports.ts|转发即消费
---

# 孤儿导出检测器（扫描盲区）

## 概览

`scripts/check-orphan-exports.ts` 审计 `frontend/src/` 下零消费者的导出符号。它同时扫描 `.ts` 与 `.js`（ADR-014 后并存），用文本正则（零依赖，不建 AST）解析导出与消费。

**核心纪律**：检测器报孤儿 ≠ 死代码。必须先判定「真死代码」还是「扫描漏检」——历史上多次因漏检把活代码判成孤儿，进而催生遮蔽性豁免规则（僵尸规则），最终让检测器对真实债失明。

## 核心职责

1. 提取每个模块的导出符号（`export const/function/class`、`export { a, b }`）
2. 统计符号的跨文件消费者数（import 具名 / 命名空间取属性 / 动态解构 / 同文件自引用）
3. 输出孤儿（0 消费者）+ 命中豁免规则明细（带 reason，供追责）
4. `--strict` 下孤儿 > 0 则 rc=1；`--min-consumers N` 只报低消费符号

## 对外 API / 入口

```
node scripts/check-orphan-exports.ts              # 文本报告
node scripts/check-orphan-exports.ts --json       # JSON（doctor 门禁消费）
node scripts/check-orphan-exports.ts --strict     # 孤儿 > 0 → rc=1
node scripts/check-orphan-exports.ts --min-consumers 3
```

导出 `isOrphanExempt`、`ORPHAN_EXEMPT_RULES` 供契约测试 `tests/test_orphan_exports_smart.ts` 校验（单一事实源）。`main()` 有直跑守卫（`pathToFileURL` 模式），测试 import 不触发全量扫描。

## 三类历史扫描盲区（2026-09-11 全部修复）

| # | 形态 | 表现 | 修复 |
|---|------|------|------|
| 1 | `export * from "./y"` 通配转发 | ADR-217 兼容壳 `backend/idb.ts` 转发的 6 个符号全被误报孤儿 | `collectStarForwards` 收集转发目标，主流程按目标模块导出集逐符号 +1 |
| 2 | 包装函数动态解构 | `async function freshMod(): Promise<typeof M> { return await import("./x.ts") }` 后 `const { foo } = await freshMod()` — 只认字面 `await import(...)`，包装层之后断链（`tooltip.test.ts` 的 `disposeTooltipCore`） | 扫「返回类型标注 `Promise<typeof X>` 且函数体含 `await import`」的包装函数 → 解析调用处解构 |
| 3 | 类型别名间接形式 | `import type * as M from "./x.ts"` + `Promise<typeof M>` | 建立类型别名→target 映射后再匹配包装函数 |

修复前读数 5 孤儿（含 4 个假阳性 + 1 个真死代码），修复后 **0 孤儿**。

## 与其他子系统关系

- **doctor 门禁**：`node scripts/doctor.ts` 调 `--json` 读 `orphan`/`flagged`（当前 `orphan=0 flagged=0`）
- **契约测试**：`tests/test_orphan_exports_smart.ts` 校验豁免规则（硬编码各档条数，改规则必须同步）
- **伴生检测器**：`check-deadcode-baseline.ts`（死代码基线）、`check-orphan-exports` 与联邦 MikuMikuAR 的 `check-consumers` 同名异实（ADR-241 §Phase 2）
- **豁免规则来源**：设计产物（`VIEW_TESTIDS`）/ 生成物（wasm glue）/ ADR-196 重构中间态

## 不变量

- **转发即消费**：`export {a} from` 与 `export * from` 的转发方都算目标符号的消费者（否则仅经转发壳使用的符号会被误判）。
- **豁免规则须可追溯**：每条 `reason` 注明 ADR/commit/来源，且须定期清理——规则超期未清即检测器失明。
- **删除导出前须双证**：既无具名消费者、又无转发链消费，且同文件兄弟函数对照（如 `fireDrop` 14 处 vs `fireDrag` 0 处）方可判死。

## 相关

- `scripts/README.md` 条目：`check-orphan-exports.ts`
- 契约测试：`tests/test_orphan_exports_smart.ts`
- 伴生：`docs/knowledge/module_global_state.md`（模块级全局治理）
