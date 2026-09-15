#!/usr/bin/env node
/**
 * 契约测试：gate-config blockPolicy 分层声明完整性。
 *
 * 背景（2026-09-08 门禁鸡肋审查）：gate-config.ts 定义了 BlockPolicy 类型
 * （hard / debt / failClosed），但 ALL_STATIC_TOOLS 里 38 项 **0 项显式声明**
 * blockPolicy——全部走默认 hard 阻断。结果：boolean-naming 135 误报、
 * orphan-exports 28 设计产物、deadcode-baseline 存量债、jscpd-go 82s 慢扫描
 * 全部硬阻断推送。
 *
 * 正确的分层应该是：
 *   hard      → 功能正确性守卫（编译/测试/绑定契约/模板引用/事件漂移）
 *   debt      → 代码质量建议（命名/孤儿导出/死代码基线/重复代码/scripts 内部治理）
 *   failClosed → 生成物 autoFix（断了能自动修）+ 路径索引漂移（提交时会修）
 *
 * 本测试：
 *   1. 读取当前 gate-config 声明，统计各分层数量
 *   2. 对比期望分层清单（基于脚本性质分类）
 *   3. 验证关键鸡肋检查（boolean-naming / orphan-exports / deadcode-baseline / jscpd-go）
 *      不应是 hard 阻断
 *   4. 一旦脚本显式声明了 blockPolicy，应精确命中期望分类
 *
 * 运行：node tests/test_gate_policy_baseline.ts
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_STATIC_TOOLS,
  FRONTEND_STATIC_TOOLS,
  GO_STATIC_TOOLS,
} from "../scripts/_lib/gate-config.ts";

// gate-config.ts 的 BlockPolicy 类型（内联，因为是 type-only 导出）
type BlockPolicy = "hard" | "debt" | "failClosed";

// ── 1. 当前声明统计 ──────────────────────────────────

function countPolicies(tools: typeof ALL_STATIC_TOOLS) {
  let hard = 0,
    debt = 0,
    fc = 0,
    total = tools.length;
  const undeclared: string[] = [];
  for (const entry of tools) {
    const tool = typeof entry === "string" ? entry : entry.tool;
    const policy = typeof entry === "object" ? entry.blockPolicy : undefined;
    if (!policy) {
      undeclared.push(tool);
      hard++; // 默认 hard
    } else if (policy === "hard") hard++;
    else if (policy === "debt") debt++;
    else if (policy === "failClosed") fc++;
  }
  return { hard, debt, fc, total, undeclared };
}

const allCount = countPolicies(ALL_STATIC_TOOLS);
const _feCount = countPolicies(FRONTEND_STATIC_TOOLS);
const _goCount = countPolicies(GO_STATIC_TOOLS);

console.log("  当前 ALL_STATIC_TOOLS 声明:");
console.log(
  `    total=${allCount.total}, hard=${allCount.hard}, debt=${allCount.debt}, failClosed=${allCount.fc}`,
);
console.log(`    未显式声明的: ${allCount.undeclared.length}/${allCount.total}`);
if (allCount.undeclared.length > 0) {
  console.log(`    未声明项: ${allCount.undeclared.join(", ")}`);
}

const allExplicit = allCount.debt + allCount.fc + (allCount.hard - allCount.undeclared.length);
console.log(`    显式声明数: ${allExplicit}/${allCount.total}`);

// ── 2. 期望分层清单 ──────────────────────────────────
// 分类原则：
//   hard        → 功能正确性守卫（编译/测试/绑定契约/模板引用/事件漂移/语言包/Shadow DOM/Android 黑名单）
//   debt        → 代码质量建议（命名/孤儿导出/死代码基线/重复代码/scripts 内部治理/恒绿）
//   failClosed  → 生成物 autoFix + 路径索引漂移

const EXPECTED_POLICY: Record<string, BlockPolicy> = {
  // —— hard ——
  "check-doc-drift.ts": "hard",
  "check-adr-health.ts": "hard",
  "check-tpl-refs.ts": "hard",
  "check-dynamic-import.ts": "hard",
  "auto-import.ts": "hard",
  "event-graph.ts": "hard",
  "check-workflow-refs.ts": "hard",
  "i18n-check.ts": "hard",
  "css-layer-check.ts": "hard",
  "check-android-unavailable.ts": "hard",

  // —— debt ——
  "check-boolean-naming.ts": "debt",
  "check-circular.ts": "debt",
  "check-orphan-exports.ts": "debt",
  "check-deadcode-baseline.ts": "debt",
  "jscpd-go.ts": "debt",
  "check-proc-adoption.ts": "debt",
  "check-lib-adoption.ts": "debt",
  "check-toast-duration.ts": "debt",
  // 设计令牌守规（2026-09 接线）：基线比对 + 增量模式，存量 128 条债在
  // scripts/baseline/design-tokens-baseline.json 放行——属「代码质量建议」类，
  // 与 check-complexity/check-params 同档（全库阈值 + 存量债），故记 debt。
  "check-design-tokens.ts": "debt",
  // i18n 未使用键（2026-09 接线）：同为基线比对 + 只拦新增；判定含启发式成分
  // （动态查表无法静态判定），故记 debt。
  "check-i18n-unused.ts": "debt",

  // —— failClosed（仅 rg 等环境依赖工具；生成物漂移类恢复 hard——
  //    迁移时误降 failClosed 会让过期生成物静默过闸，code_review 03a6005ed 撤销）——
  "build-novel-index.ts": "hard",
  "gen-routes.ts": "hard",
  "gen-routes-quick.ts": "hard",
  "gen-cli-doc.ts": "hard",
  "gen-cli-completion.ts": "hard",
  "gen-knowledge-autogen.ts": "hard",
  "check-readme-index.ts": "hard",
};

const expectedDebt = Object.entries(EXPECTED_POLICY).filter(([, p]) => p === "debt").length;
const expectedHard = Object.entries(EXPECTED_POLICY).filter(([, p]) => p === "hard").length;
const expectedFc = Object.entries(EXPECTED_POLICY).filter(([, p]) => p === "failClosed").length;
console.log(
  `\n  期望分层: hard=${expectedHard}, debt=${expectedDebt}, failClosed=${expectedFc}（共 ${expectedHard + expectedDebt + expectedFc} 项有明确期望）`,
);

// ── 3. 关键鸡肋检查不应是 hard 阻断 ────────────────────

// 这 4 项是审查中发现的最严重 hard 阻断：
const SHAMEFUL_HARD_DEBT = [
  "check-boolean-naming.ts", // 命名建议 → debt
  "check-orphan-exports.ts", // 设计产物豁免后余真孤儿 → debt
  "check-deadcode-baseline.ts", // baseline 跟踪器，存量债 → debt
  "jscpd-go.ts", // 过滤测试债后转绿，属债务语义 → debt
];

// 绿阶段断言：这 4 项已显式声明非 hard（debt），不再因误报/存量债阻断推送
function policyOf(tool: string): BlockPolicy | undefined {
  const entry = ALL_STATIC_TOOLS.find((e) =>
    typeof e === "string" ? e === tool : e.tool === tool,
  );
  return entry && typeof entry === "object" ? entry.blockPolicy : undefined;
}
for (const tool of SHAMEFUL_HARD_DEBT) {
  const p = policyOf(tool);
  console.log(`    ${tool}: blockPolicy=${p || "(缺省 hard)"}`);
  assert.ok(
    p === "debt",
    `${tool} 应已降级为 debt（当前=${p || "未声明，仍默认 hard"}）——审查要求的鸡肋降级未完成`,
  );
}

console.log("  ✓ 4 项最严重鸡肋检查已降 debt（不再硬阻断推送）");

// ── 4. 显式声明完整性断言（绿阶段） ─────────────────

const CURRENT_EXPLICIT_DEBT = allCount.debt;
const CURRENT_EXPLICIT_FC = allCount.fc;

console.log(`\n  显式 debt: ${CURRENT_EXPLICIT_DEBT}/${expectedDebt}（期望 ${expectedDebt}）`);
console.log(`  显式 failClosed: ${CURRENT_EXPLICIT_FC}/${expectedFc}（期望 ${expectedFc}）`);

// 绿阶段：ALL_STATIC_TOOLS 的显式 debt/failClosed 应达到期望值
assert.equal(
  CURRENT_EXPLICIT_DEBT,
  expectedDebt,
  `显式 debt 应匹配期望（got ${CURRENT_EXPLICIT_DEBT}, want ${expectedDebt}）`,
);
assert.equal(
  CURRENT_EXPLICIT_FC,
  expectedFc,
  `显式 failClosed 应匹配期望（got ${CURRENT_EXPLICIT_FC}, want ${expectedFc}）`,
);

console.log("\n  ✓ 绿阶段确认：显式 debt/failClosed 声明达到期望，分层完成");

// ── 5. 后续清理路径 ────────────────────

console.log("\n📋 gate-config 改造蓝图：");
console.log("  改造对象：ALL_STATIC_TOOLS + FRONTEND_STATIC_TOOLS + GO_STATIC_TOOLS");
console.log('  改造方式：在 { tool: "...", blockPolicy: "xxx" } 对象里显式声明');
console.log("");
console.log("  第一步（最小改动）：先把 4 个最严重鸡肋降级为 debt");
console.log('    - check-boolean-naming.ts → blockPolicy: "debt"');
console.log('    - check-orphan-exports.ts → blockPolicy: "debt"');
console.log('    - check-deadcode-baseline.ts → blockPolicy: "debt"');
console.log("    - jscpd-go.ts → 移到 debt 或先修（过滤 *_test.go）");
console.log("");
console.log("  第二步（完整分层）：声明全部 23 项有明确期望的 blockPolicy");
console.log(`    hard=${expectedHard}, debt=${expectedDebt}, failClosed=${expectedFc}`);

// ── 6. record() 会自动尊重 blockPolicy（实现已迁 _lib/gate-ctx.ts） ──

// ADR-206 阶段 1（2026-09-13）：record() 从 pre-push-gate.ts 内联迁入 _lib/gate-ctx.ts，
// 本节断言随之换锚点。关键逻辑（与迁移前一致）：
//   const record = (label, ok, { blockPolicy }) => {
//     results.push({ label, ok, time, note, tail, raw, blockPolicy });  // ← blockPolicy 须落库
//     if (!ok && blockPolicy !== "debt" && blockPolicy !== "failClosed") blocked = true;
//   };
// 所以只要 gate-config 里显式声明了 blockPolicy: 'debt'，FAIL 就不会置 blocked=true。
//
// 分工：本节的 grep 断言是**弱保险**（证明判定字符串在实现里）；
// record 的完整行为（阻断矩阵 / blocked 活值 / blockPolicy 落库 / raw cap）由
// tests/test_gate_ctx.ts 做行为级断言——源码 grep 只能证明「字符串存在」，不能证明「行为对」。
const gateSrc = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "scripts",
    "_lib",
    "gate-ctx.ts",
  ),
  "utf8",
);
assert.ok(
  /blockPolicy\s*!==\s*["']debt["']\s*&&\s*.*blockPolicy\s*!==\s*["']failClosed["']/s.test(
    gateSrc,
  ) || /blockPolicy[^;\n]*!==\s*["']debt["']/.test(gateSrc),
  'gate-ctx.ts record() 应含 blockPolicy !== "debt"/"failClosed" 判定（否则 debt 降级失效，FAIL 恒阻断）',
);
// 归属落库（2026-09-13 修复）：blockPolicy 不落进 results 条目，gate-report.policyTag
// 读到 undefined → 所有 FAIL（含 debt 存量债）被标「本次引入」，误导归因。
assert.ok(
  /results\.push\(\{[^}]*blockPolicy[^}]*\}\)/s.test(gateSrc),
  "gate-ctx.ts record() 必须把 blockPolicy 一并 push 进 results（FAIL 明细归属标签的事实源）",
);

console.log("\n  ✓ gate-ctx.ts record() 已正确实现 blockPolicy 判定 + 归属落库——");
console.log("     只需要 gate-config 里声明就能生效，无需改 gate 核心逻辑");
console.log("");
console.log("🟢 改造成本极低：gate-config.ts 加 blockPolicy 字段即可");
console.log("   影响面：pre-push-gate.ts 自动消费，doctor.ts --all 自动降级");
