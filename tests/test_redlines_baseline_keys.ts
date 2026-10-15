#!/usr/bin/env node
/**
 * 契约测试：check-redlines 基线键构造（漂移不误报 / 真新增不漏放）。
 *
 * 病根（锐评 2026-10-15 推送阻断复盘）：`collectViolationKeys` 对**阻断规则**
 * 曾退回纯行号键（`文件:规则:行号`），而基线 97/97 条全以行号为键 —— 于是任何
 * 行插入都让存量违规漂移到新行号，比对即判「新增红线违规」阻断推送。实测：
 * `internal/app/resource_bindings.go` 的 W7 违规因相邻函数加 6 行锁，由 400 行
 * 漂到 418 行，硬阻断把一次无关提交卡死。
 *
 * 本测试锁住修复后的双向契约（缺一即回归）：
 *   ① 行号漂移（插入若干行，同文件同规则同内容）→ 键集合**完全不变**，不误报；
 *   ② 真新增（同位置写入不同内容）→ 产生基线里没有的新键，必被拦；
 *   ③ 同文件同规则下**内容相同的多处**违规 → 键须彼此不同（出现序号保多重集），
 *      否则去重会把「又抄了一遍相同代码行」的真实新增吞掉（放行一切的反面风险）。
 *
 * 用法：node tests/test_redlines_baseline_keys.ts
 * 退出码：0 = 通过；1 = 失败。
 */
import { collectViolationKeys } from "../scripts/check-redlines.ts";

const failures = [];
let assertCount = 0;

function assert(cond, msg) {
  assertCount++;
  if (!cond) failures.push(msg);
}

function splitEq(keys, want, msg) {
  const got = keys.slice().sort();
  const w = want.slice().sort();
  assert(
    got.length === w.length && got.every((v, i) => v === w[i]),
    `${msg} | got=${JSON.stringify(keys)} want=${JSON.stringify(want)}`,
  );
}

/** 构造一条违规结果集（results 的最小形状：rule_id + violations[]）。 */
function result(rule_id, violations) {
  return [{ rule_id, violations }];
}

const FILE = "internal/app/resource_bindings.go";
const W7 = "W7"; // 阻断规则（∉ WARN_RULES）—— 漂移误报就发生在这一类
const R13 = "R13"; // WARN 规则（∈ WARN_RULES）—— 对照组，历史上已带内容键
const LINE_A = "if err := os.RemoveAll(realClean); err != nil {";
const LINE_B = "cfg.CustomRoots[rtype] = path";

// ── ① 行号漂移：同文件同规则同内容，仅行号变化 → 键集合不变 ──────────────
const before = collectViolationKeys(result(W7, [{ file: FILE, line: 400, snippet: LINE_A }]));
const after = collectViolationKeys(result(W7, [{ file: FILE, line: 418, snippet: LINE_A }]));
splitEq(after.blocking, before.blocking, "行号漂移 400→418 不应改变阻断键集合");

// 漂移后再加几行（模拟相邻函数插入注释/代码）仍须稳定
const afterMore = collectViolationKeys(result(W7, [{ file: FILE, line: 424, snippet: LINE_A }]));
splitEq(afterMore.blocking, before.blocking, "再次漂移 418→424 仍不应改变键集合");

// 键里不得含行号成分——否则漂移必然误报（这是回归的最小判据）
assert(
  !after.blocking.some((k) => k.endsWith(":400") || k.endsWith(":418")),
  `阻断键不得以行号结尾，否则行号漂移即误报 | got=${JSON.stringify(after.blocking)}`,
);
assert(
  after.blocking[0]?.includes(LINE_A),
  `阻断键应含行内容（漂移免疫的载体）| got=${JSON.stringify(after.blocking)}`,
);

// ── ② 真新增：同位置写入不同内容 → 必须产生新键 ──────────────────────────
const newViolations = result(W7, [
  { file: FILE, line: 400, snippet: LINE_A },
  { file: FILE, line: 401, snippet: LINE_B },
]);
const newKeys = collectViolationKeys(newViolations).blocking;
assert(
  newKeys.length === 2,
  `新增一行违规内容应产生 2 个键（不得塌成一个）| got=${JSON.stringify(newKeys)}`,
);
const baseSet = new Set(before.blocking);
const added = newKeys.filter((k) => !baseSet.has(k));
assert(
  added.length === 1 && added[0].includes(LINE_B),
  `新内容应产生基线外的新键（真新增必被拦）| added=${JSON.stringify(added)}`,
);

// ── ③ 同文件同规则、内容相同的两处违规 → 键须不同（多重集不被去重吞掉）─────
const dup = collectViolationKeys(
  result(W7, [
    { file: FILE, line: 400, snippet: LINE_A },
    { file: FILE, line: 455, snippet: LINE_A },
  ]),
).blocking;
assert(
  dup.length === 2 && new Set(dup).size === 2,
  `同文件同规则同内容的两处违规须产出 2 个不同键（防去重吞真实新增）| got=${JSON.stringify(dup)}`,
);

// ── 对照组：WARN 规则本就走内容键，行为不得因本次改动而回退 ──────────────
const warnBefore = collectViolationKeys(result(R13, [{ file: FILE, line: 319, snippet: LINE_B }]));
const warnAfter = collectViolationKeys(result(R13, [{ file: FILE, line: 331, snippet: LINE_B }]));
splitEq(warnAfter.advisory, warnBefore.advisory, "WARN 规则行号漂移同样不应改变 advisory 键");

// ── 跨文件隔离：不同文件的相同内容不得撞成同一键 ─────────────────────────
const crossFile = collectViolationKeys([
  { rule_id: W7, violations: [{ file: "a/x.go", line: 1, snippet: LINE_A }] },
  { rule_id: W7, violations: [{ file: "b/y.go", line: 1, snippet: LINE_A }] },
]).blocking;
assert(
  crossFile.length === 2 && new Set(crossFile).size === 2,
  `跨文件相同内容须产出 2 个键（文件维度是键的一部分）| got=${JSON.stringify(crossFile)}`,
);

if (failures.length) {
  console.error(`✗ ${failures.length} 个断言失败（共 ${assertCount}）:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ 基线键构造契约通过（${assertCount} 断言：漂移不误报 / 真新增不漏放 / 多重集保序）`);
