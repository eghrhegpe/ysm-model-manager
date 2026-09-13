#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/gate-coverage.ts 的覆盖口径计算。
 *
 * 背景（2026-09-13 锐评 P2）：「门禁全绿 ≠ 仓库无风险」此前只活在知识卡里，
 * 现升格为 pre-push-gate 输出的固定尾行（coverageTailLine）。本测试锁定其数据源
 * 的行为不变量——覆盖尾行若静默失真（如 gate-config 清单改名后脚本被漏算），
 * 诚实性提醒就退化成了装饰。
 *
 * 锁定的语义（行为断言，非源码 grep）：
 *   1. 全集非空且恰为 scripts/check-*.ts 动态枚举（与 fs 枚举一致，不写死数字）
 *   2. covered ≤ total；uncovered 与 covered 无交集、与全集并集 = 全集
 *   3. 域直连六项（layering/redlines 等）必须计为已覆盖——它们不在 gate-config 清单里
 *   4. coverageTailLine() 必含「covered/total」形状与「全绿 ≠」警示语（尾行是消费契约）
 *
 * 依赖：node:assert / node:fs / 被测模块。
 * 用法：node tests/test_gate_coverage.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败（node:assert 抛错）。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  coverageTailLine,
  gateCoverage,
  listAllCheckScripts,
  listCoveredCheckScripts,
} from "../scripts/_lib/gate-coverage.ts";
import { ROOT } from "../scripts/_lib/scan-files.ts";

// 1. 全集 = 动态枚举（独立用 fs 重算，验证被测函数没有写死/过滤错）
const expected = fs
  .readdirSync(path.join(ROOT, "scripts"))
  .filter((f) => /^check-.*\.ts$/.test(f))
  .sort();
assert.deepStrictEqual(listAllCheckScripts(), expected);
assert.ok(expected.length > 0, "scripts/check-*.ts 全集不应为空");

// 2. 覆盖数与互斥/完备性
const c = gateCoverage();
assert.strictEqual(c.total, expected.length);
assert.ok(c.covered > 0 && c.covered <= c.total);
const coveredSet = listCoveredCheckScripts();
for (const u of c.uncovered) {
  assert.ok(!coveredSet.has(u), `uncovered 项 ${u} 不应同时出现在 covered 集`);
}
// 并集完备：covered ∪ uncovered = 全集
const union = new Set([...expected.filter((f) => coveredSet.has(f)), ...c.uncovered]);
assert.strictEqual(union.size, expected.length);

// 3. 域直连项必须计为已覆盖（它们是「门禁真的会跑」的检查，漏算会虚减覆盖数）
for (const domain of [
  "check-layering.ts",
  "check-redlines.ts",
  "check-path-hygiene.ts",
]) {
  assert.ok(coveredSet.has(domain), `域直连项 ${domain} 必须计为已覆盖`);
}

// 4. 尾行消费契约：含 N/M 形状 + 警示语
const line = coverageTailLine();
assert.match(line, new RegExp(`${c.covered}/${c.total}`));
assert.ok(line.includes("全绿"), "尾行必须含「全绿 ≠ 仓库无风险」警示语");
assert.ok(line.includes("未接入") || c.uncovered.length === 0, "有未接入项时尾行必须点名");

console.log("[OK] test_gate_coverage.ts 全部断言通过");
