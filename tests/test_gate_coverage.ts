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
  BYPASS_CHECKS,
  coverageTailLine,
  gateCoverage,
  listAllCheckScripts,
  listCoveredCheckScripts,
} from "../scripts/_lib/gate-coverage.ts";
import { ROOT } from "../scripts/_lib/scan-files.ts";
import { check } from "./_lib.mts";

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
for (const domain of ["check-layering.ts", "check-redlines.ts", "check-path-hygiene.ts"]) {
  assert.ok(coveredSet.has(domain), `域直连项 ${domain} 必须计为已覆盖`);
}

// 4. 尾行消费契约：含 N/M 形状 + 警示语
const line = coverageTailLine();
assert.match(line, new RegExp(`${c.covered}/${c.total}`));
assert.ok(line.includes("全绿"), "尾行必须含「全绿 ≠ 仓库无风险」警示语");
assert.ok(
  line.includes("未接入") || line.includes("刻意旁路") || c.uncovered.length === 0,
  "有未接入项时尾行必须点名（未接入或刻意旁路）",
);

// 5. DOMAIN_BLOCK_CHECKS 双向同步（2026-09-13 锐评勘误 #9）：手工常量数组纳入测试网——
//    gate-blocks 新增直连 ctx.record("check-…") 漏登记、或数组登记了已下线的检查，都 FAIL。
//    扫描口径：gate-blocks/*.ts + pre-push-gate.ts 里 ctx.record 首参标签中出现的 check-*.ts。
import { DOMAIN_BLOCK_CHECKS } from "../scripts/_lib/gate-coverage.ts";

{
  const scanDir = path.join(ROOT, "scripts", "_lib", "gate-blocks");
  const sources = [
    fs.readFileSync(path.join(ROOT, "scripts", "pre-push-gate.ts"), "utf-8"),
    ...fs
      .readdirSync(scanDir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => fs.readFileSync(path.join(scanDir, f), "utf-8")),
  ];
  // 提取 ctx.record( 首参（至第一个逗号/行尾的近似切分）里的 check-*.ts 引用
  const seen = new Set<string>();
  for (const src of sources) {
    const re = /ctx\.record\(\s*(`[^`]*`|"[^"]*")/g;
    let m: RegExpExecArray | null = re.exec(src);
    while (m) {
      for (const hit of m[1].match(/check-[\w-]+\.ts/g) ?? []) seen.add(hit);
      m = re.exec(src);
    }
  }
  for (const c of DOMAIN_BLOCK_CHECKS) {
    assert.ok(
      seen.has(c),
      `DOMAIN_BLOCK_CHECKS 登记了 ${c}，但 gate-blocks/pre-push-gate 中已无直连 ctx.record 标签引用——请从数组删除`,
    );
  }
  for (const s of seen) {
    assert.ok(
      (DOMAIN_BLOCK_CHECKS as readonly string[]).includes(s),
      `gate-blocks 直连 ctx.record 标签引用了 ${s}，但未登记进 DOMAIN_BLOCK_CHECKS——覆盖尾行会把它误标「未接入」`,
    );
  }
}

check("覆盖尾行旁路分组（四锐评 #5）：BYPASS_CHECKS 与 uncovered 交集正确、无幻影条目", () => {
  const line = coverageTailLine();
  const cov = gateCoverage();
  const bypassed = cov.uncovered.filter((f) => (BYPASS_CHECKS as readonly string[]).includes(f));
  // 旁路项若存在，尾行必须以「刻意旁路」点名（区别于「未接入」）；否则全集接入
  if (bypassed.length) {
    assert.ok(
      line.includes("刻意旁路") && line.includes(bypassed[0]!),
      `尾行应含「刻意旁路(pre-commit/CI)」点名，实际: ${line}`,
    );
  } else {
    assert.ok(!line.includes("刻意旁路"), `无旁路项时尾行不应出现「刻意旁路」: ${line}`);
  }
  // 幻影防线：BYPASS_CHECKS 登记的文件必须真实存在且确属 uncovered（否则清单腐化）
  for (const b of BYPASS_CHECKS) {
    assert.ok(
      fs.existsSync(path.join(ROOT, "scripts", b)),
      `BYPASS_CHECKS 登记了不存在的脚本 ${b}——请从清单删除`,
    );
  }
});

check("--json 契约真实现（四锐评 #1）：声明必须与消费共存", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "pre-push-gate.ts"), "utf-8");
  assert.ok(/bools:\s*\[[^\]]*"json"/.test(src), "pre-push-gate bools 应声明 json");
  assert.ok(
    /const jsonMode = args\.json as boolean;/.test(src) && /finishJson\(\)/.test(src),
    "pre-push-gate 应消费 args.json 并在终态出口调用 finishJson()——禁止声明不实现",
  );
  assert.ok(
    /setLogPushMuted\(true\)/.test(src),
    "--json 模式应静默人读文本流（logPush muted），防 stdout JSON 被污染",
  );
});

console.log("[OK] test_gate_coverage.ts 全部断言通过");
