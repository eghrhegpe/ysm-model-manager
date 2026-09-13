#!/usr/bin/env node
/**
 * pre-push-gate 并行 IIFE 结构性契约（历史事故 fd3d0431 的回归锁）。
 *
 * 2026-09-13 硬化（ADR-206 阶段 6 前置）：旧版用硬编码缩进 + 字面量匹配域 IIFE
 * （"(async () => {\n      if (!plan.go) return;"）且写死 EXPECTED_IIFE_COUNT=3——
 * 任何合法重构（搬域块进 gate-blocks、缩进调整、新增并行块）都会被误判红灯。
 * 现改为结构性判定：
 *   1. 文件内每个 async IIFE 都必须有调用括号 )()（防漏 () 静默跳过域检查——原始事故）；
 *   2. Promise.all 并行域块（Go ∥ 前端）在调度侧至少以 await/并行容器形式被调用；
 *   3. main().then(async ...) 入口存在。
 * 不锁缩进、不锁换行、不锁数量——锁「每个 IIFE 都被调用」这一事故语义。
 *
 * 运行：node tests/test_gate_iife_correctness.ts
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const GATE_FILE = path.join(ROOT, "scripts", "pre-push-gate.ts");

const fails: string[] = [];

function check(cond: boolean, msg: string) {
  if (!cond) fails.push(msg);
}

// ---- 1. 读取 gate 源码 ----
let gateSrc: string;
try {
  gateSrc = fs.readFileSync(GATE_FILE, "utf8");
} catch (e) {
  console.error(`❌ 无法读取 ${GATE_FILE}: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

// ---- 2. 收集所有 async IIFE 起始位置（索引，非行号——对换行/缩进鲁棒）----
const iifeRe = /\(async\s*\([^)]*\)\s*=>\s*\{/g;
const iifeStarts: number[] = [];
for (const m of gateSrc.matchAll(iifeRe)) iifeStarts.push(m.index);

check(
  iifeStarts.length > 0,
  "源码中至少应存在一个 async IIFE（若域块已全部迁出 gate-blocks，本断言连同 main 入口断言应同步退役）",
);

// ---- 3. 事故语义锁：每个 IIFE 必须有调用括号 )() ----
// main().then(async ...) 是 promise chain，不需要 )()（容忍跨行书写）。
const callIdx: number[] = [];
for (let i = gateSrc.indexOf(")()"); i !== -1; i = gateSrc.indexOf(")()", i + 1)) {
  callIdx.push(i);
}
for (const start of iifeStarts) {
  // 该 IIFE 起始前的 80 字符若命中 main().then（容忍 .then 与 ( 间空白），视为 promise chain，豁免
  const head = gateSrc.slice(Math.max(0, start - 80), start);
  if (/main\(\)\s*\.then\s*$/.test(head)) continue;
  const nextCall = callIdx.find((c) => c > start);
  const nextIife = iifeStarts.find((s) => s > start);
  check(
    !!nextCall && (!nextIife || nextCall < nextIife),
    `async IIFE（偏移 ${start}）漏调用括号 ()(：未在其后找到 )() 调用——漏 () 会静默跳过整域检查（fd3d0431 事故）`,
  );
}

// ---- 4. 域并行容器语义：Go ∥ 前端若同文件内联，必须包在 Promise.all 里 ----
const hasGoIife = /\(async\s*\(\)\s*=>\s*\{[^}]*plan\.go\b/.test(gateSrc);
const hasFrontendIife = /\(async\s*\(\)\s*=>\s*\{[^}]*plan\.frontend\b/.test(gateSrc);
if (hasGoIife || hasFrontendIife) {
  // 只要仍有内联域 IIFE，就要求 Promise.all 容器存在（迁出后此断言自动熄火）
  check(
    gateSrc.includes("Promise.all("),
    "内联域 IIFE 必须包在 Promise.all 并行容器中（ADR-088：域间并行）",
  );
}

// ---- 5. 入口存在 ----
check(/main\(\)\s*\.then\(async/.test(gateSrc), "main().then(async ...) 必须存在（门禁入口）");

// ---- 汇总 ----
if (fails.length === 0) {
  console.log(
    `✅ test_gate_iife_correctness 全部通过（${iifeStarts.length} 个 async IIFE，调用括号完整，结构性判定）`,
  );
  process.exit(0);
} else {
  console.log("❌ test_gate_iife_correctness 失败:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
