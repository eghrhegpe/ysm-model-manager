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
 * 退出码：0 全绿；非 0 断言失败（node:assert 抛错 / check+ok 收集的 failures 经 finish 裁决）。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  BYPASS_CHECKS,
  coverageTailLine,
  gateCoverage,
  listAllCheckScripts,
  listAllGateScripts,
  listCoveredCheckScripts,
} from "../scripts/_lib/gate-coverage.ts";
import { ROOT } from "../scripts/_lib/scan-files.ts";
import { check, finish } from "./_lib.mts";

// 1. 全集 = 动态枚举（独立用 fs 重算，验证被测函数没有写死/过滤错）
const expected = fs
  .readdirSync(path.join(ROOT, "scripts"))
  .filter((f) => /^check-.*\.ts$/.test(f))
  .sort();
assert.deepStrictEqual(listAllCheckScripts(), expected);
assert.ok(expected.length > 0, "scripts/check-*.ts 全集不应为空");

// 2. 覆盖数与互斥/完备性
// 2026-10-08 口径修正（第三轮审计 P0）：全集不再是「check-* 文件名枚举」，而是
// 「门禁清单条目 ∪ check-* 全集」（清单里真实在跑的非 check-* 命名条目，如 jscpd-go /
// auto-import / gen-*，经 pre-push-gate --static 在 CI 真跑，此前被结构性漏计）。
const c = gateCoverage();
const allGate = listAllGateScripts();
assert.deepStrictEqual(allGate, [...new Set(allGate)].sort(), "全集应去重且有序");
for (const f of expected) {
  assert.ok(allGate.includes(f), `check-* 全集项 ${f} 必须仍在门禁全集内（分母不得缩水）`);
}
assert.strictEqual(c.total, allGate.length);
assert.ok(c.covered > 0 && c.covered <= c.total);
const coveredSet = listCoveredCheckScripts();
for (const u of c.uncovered) {
  assert.ok(!coveredSet.has(u), `uncovered 项 ${u} 不应同时出现在 covered 集`);
}
// 并集完备：covered ∪ uncovered = 全集
const union = new Set([...allGate.filter((f) => coveredSet.has(f)), ...c.uncovered]);
assert.strictEqual(union.size, allGate.length);

// 3. 域直连项必须计为已覆盖（它们是「门禁真的会跑」的检查，漏算会虚减覆盖数）
for (const domain of ["check-layering.ts", "check-redlines.ts", "check-path-hygiene.ts"]) {
  assert.ok(coveredSet.has(domain), `域直连项 ${domain} 必须计为已覆盖`);
}

// 3b. 非 check-* 命名的真闸必须计入分子与分母（2026-10-08 第三轮审计 P0 回归网）。
// 事故：分母/分子两侧都用 `/^check-/` 过滤，导致清单里真实在跑（经 pre-push-gate --static
// 在 CI 执行）的 12 条非 check- 条目全部隐身，尾行报「41/44」属结构性低估。
// 本断言钉死：清单条目无论命名一律在册——改名/新增不前缀项都不会再让它消失。
const NON_CHECK_NAMED = [
  "jscpd-go.ts",
  "auto-import.ts",
  "event-graph.ts",
  "gen-knowledge-autogen.ts",
  "i18n-check.ts",
  "css-layer-check.ts",
];
for (const t of NON_CHECK_NAMED) {
  assert.ok(coveredSet.has(t), `非 check-* 命名的真闸 ${t} 必须计为已覆盖（不得按文件名过滤掉）`);
  assert.ok(allGate.includes(t), `非 check-* 命名的真闸 ${t} 必须进入分母`);
}
assert.ok(
  c.total > expected.length,
  `分母必须大于 check-* 枚举数（${c.total} > ${expected.length}）——否则说明又按文件名收窄了口径`,
);

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
  // 幻影防线：BYPASS_CHECKS 登记的文件必须真实存在（否则清单腐化）
  for (const b of BYPASS_CHECKS) {
    assert.ok(
      fs.existsSync(path.join(ROOT, "scripts", b)),
      `BYPASS_CHECKS 登记了不存在的脚本 ${b}——请从清单删除`,
    );
  }
  // 「确属 uncovered」半边：b 若在 coveredSet（已被 gate 接入）则旁路清单失实——
  // 尾行会把它从「刻意旁路」组静默吞掉，须在此双向锁定（注释承诺的完整契约）
  for (const b of BYPASS_CHECKS) {
    assert.ok(
      !listCoveredCheckScripts().has(b),
      `BYPASS_CHECKS 登记了 ${b} 但实际已接入 gate（coveredSet 命中）——请从旁路清单删除`,
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
    "--json 模式应静默逐条 OK 明细（logPush muted），防 stderr 被 32 行 OK 灌满",
  );
});

check("--json 双通道终态（2026-10-08 CI 碎片流复盘）：终态行走 logPushVerdict 直通 stderr", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "pre-push-gate.ts"), "utf-8");
  // 静音保留（OK 明细）+ 终态直通（FAIL 块/结论/SKIP/coverageTail）双向锁定：
  // 只静音不直通 → CI 人读结论被淹没（本次修的病）；只直通不静音 → stderr 灌满 32 行 OK。
  assert.ok(
    /logPushVerdict\(/.test(src),
    "pre-push-gate 终态行应走 logPushVerdict（无视 muted 写 stderr），否则 --json 下人读结论全被静音淹没",
  );
  // 结论 PASS/FAIL 两行必须经 logPushVerdict（人读终态的核心，非逐条 OK）
  assert.ok(
    /logPushVerdict\(\s*`结论: PASS/.test(src) && /logPushVerdict\(\s*`结论: FAIL/.test(src),
    "PASS/FAIL 结论行应走 logPushVerdict 直通（消费方是人眼，尤其 CI Actions 面板）",
  );
  // 逐条 OK 明细仍走静音 logPush（防回归到「全直通灌满 stderr」）
  assert.ok(
    /for \(const r of okResults\)\s*\{\s*logPush\(/.test(src),
    "逐条 OK 明细应保持静音 logPush（否则 32 行 OK 灌满 stderr、失去策展尾部意义）",
  );
});

// 尾部裁决：failures 非空 exit 1，否则 finish 统一打 OK（ok/check 收集的失败在此处汇总裁决）
finish("test_gate_coverage.ts 全部断言通过");
