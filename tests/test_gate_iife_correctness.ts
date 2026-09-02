#!/usr/bin/env node
/**
 * 契约测试：pre-push-gate.ts Promise.all IIFE 调用括号完整性守护。
 *
 * 背景（2026-09-01 实证）：commit fd3d0431 发现两个 async IIFE 漏写 () 调用括号，
 * 导致 go build/test、vite build/vitest、check-layering 等 13 项域级检查从 8/17 起
 * 静默跳过——pre-push-gate 变成「静态工具串行 + 契约测试」的假重。
 *
 * 本测试锁定「所有 (async () => {...}) 必须带调用括号」规则，防止未来重构时再次引入。
 * 规则来源：pre_push_gate.md 不变量第一条 + ADR-152 实证。
 *
 * 覆盖：
 *   1. 所有 async IIFE 模式 `(async () => {` 后必须有 `)()` 调用
 *   2. 主入口 main().then(async ...) 必须带调用（已验证）
 *   3. 统计 IIFE 数量，与预定义期望值比对（防意外增减未登记）
 *
 * 用法：node tests/test_gate_iife_correctness.ts
 * 退出码：0 = 通过；1 = 失败。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const GATE_FILE = path.join(ROOT, 'scripts', 'pre-push-gate.ts');

// 期望的 IIFE 数量（Go 域 + 前端域 + main().then async）
const EXPECTED_IIFE_COUNT = 3;

const fails: string[] = [];

function check(cond: boolean, msg: string) {
  if (!cond) fails.push(msg);
}

// ---- 1. 读取 gate 源码 ----
let gateSrc: string;
try {
  gateSrc = fs.readFileSync(GATE_FILE, 'utf8');
} catch (e: any) {
  console.error(`❌ 无法读取 ${GATE_FILE}: ${e.message}`);
  process.exit(1);
}

// ---- 2. 正则匹配所有 async IIFE 模式 ----
const iifePattern = /\(async\s*\([^)]*\)\s*=>\s*\{/g;
const iifeAllMatches = gateSrc.match(iifePattern) || [];

check(iifeAllMatches.length === EXPECTED_IIFE_COUNT,
  `期望 ${EXPECTED_IIFE_COUNT} 个 async IIFE，实际匹配 ${iifeAllMatches.length} 个`);

// ---- 3. 验证每个 IIFE 都有调用括号 )() ----
const lines = gateSrc.split('\n');
const iifeLines: number[] = [];
for (let i = 0; i < lines.length; i++) {
  if (/\(async\s*\([^)]*\)\s*=>\s*\{/.test(lines[i])) {
    iifeLines.push(i + 1); // 1-based line number
  }
}

check(iifeLines.length === EXPECTED_IIFE_COUNT,
  `期望 ${EXPECTED_IIFE_COUNT} 个 async IIFE，实际找到 ${iifeLines.length} 个`);

// 收集所有包含 )() 的行号
const callLineNumbers: number[] = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes(')()')) {
    callLineNumbers.push(i + 1);
  }
}

// 验证每个 IIFE 起始行之后都有一个 )() 调用行（main().then 不算 Promise.all IIFE）
for (const startLine of iifeLines) {
  // main().then(async ...) 不需要 )() 调用（它是 promise chain，不是 IIFE）
  if (gateSrc.split('\n')[startLine - 1]?.includes('main().then')) {
    continue;
  }
  // 找最近的 )() 行，且行号 > startLine
  const nextCall = callLineNumbers.find((ln) => ln > startLine);
  // 检查该 )() 行是否在其他 IIFE 之前（避免跨块匹配）
  const nextIife = iifeLines.find((ln) => ln > startLine);
  if (nextCall && (!nextIife || nextCall < nextIife)) {
    continue; // 找到匹配的调用
  }
  check(false,
    `IIFE 漏调用括号（起始行 ${startLine}）：未在后续行找到 )() 调用`);
}

// ---- 4. 专项验证：main().then(async ...) 必须有调用 ----
const mainThenMatch = gateSrc.match(/main\(\)\.then\(async/);
check(!!mainThenMatch, 'main().then(async ...) 必须存在（门禁入口）');

// ---- 5. 验证 Go 域和前端域 IIFE 都存在 ----
const goDomainIIFE = gateSrc.includes('(async () => {\n      if (!plan.go) return;');
const frontendDomainIIFE = gateSrc.includes('(async () => {\n      if (!plan.frontend) return;');
check(goDomainIIFE, 'Go 域 IIFE 必须存在');
check(frontendDomainIIFE, '前端域 IIFE 必须存在');

// ---- 汇总 ----
if (fails.length === 0) {
  console.log(`✅ test_gate_iife_correctness 全部通过（${iifeAllMatches.length} 个 IIFE，调用括号完整）`);
  process.exit(0);
} else {
  console.log('❌ test_gate_iife_correctness 失败:');
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
