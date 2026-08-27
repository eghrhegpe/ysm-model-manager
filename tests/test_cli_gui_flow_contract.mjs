#!/usr/bin/env node
/**
 * 契约测试：CLI 性能命令输出格式 ↔ 前端解析 契约锚定。
 *
 * B-1 目标（规划：CLI→Wails 桥协同的「静态层」）：锁住 Go CLI 输出格式与前端
 * diagnostics/perf.ts 解析正则之间的契约，防止一端改样一端不感知导致面板空转。
 * 纯静态、读源码 + 文本样本、零副作用、零 Go 编译，可进每次 push 门禁。
 *
 * 断言三件事：
 *  1. 性能命令（gui-flow / single-bench / perf-log）在前端 cli-bridge 白名单内
 *  2. Go 侧 gui-flow 输出模板（阶段行/总耗时）仍存在，且能被前端解析正则命中
 *  3. Go 侧 single-bench 输出模板（阶段行/总耗时）仍存在，且能被前端解析正则命中
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BRIDGE = path.join(ROOT, 'frontend/src/services/cli-bridge.ts');
const CLI_ALLOWLIST = path.join(ROOT, 'frontend/src/backend/cli-allowlist.ts');
const FLOW_GO = path.join(ROOT, 'go/cli/flow.go');
const CONCURRENT_GO = path.join(ROOT, 'go/cli/concurrent.go');

const errors = [];
function must(cond, msg) {
  if (!cond) errors.push(msg);
}

/** 硬性前置：文件必须存在，否则直接失败并打印可读信息。 */
function readOrDie(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    errors.push(`MISSING: ${rel}`);
    return '';
  }
  return fs.readFileSync(p, 'utf8');
}

const bridge = readOrDie('frontend/src/services/cli-bridge.ts');
const allowlist = readOrDie('frontend/src/backend/cli-allowlist.ts');
const flowGo = readOrDie('go/cli/flow.go');
const concurrentGo = readOrDie('go/cli/concurrent.go');

// ── 1) 命令白名单契约（前端 cli-allowlist 单一事实源）────────────
// 白名单字符串字面量从 cli-allowlist.ts 找（cli-bridge.ts 仅 re-export，无字面量）。
const PERF_COMMANDS = ['gui-flow', 'single-bench', 'perf-log', 'concurrent-bench', 'benchmark'];
if (allowlist) {
  for (const cmd of PERF_COMMANDS) {
    must(
      allowlist.includes(`"${cmd}"`),
      `CLI 命令 ${cmd} 未在前端 cli-allowlist 白名单（CLI_ALLOWLIST）`,
    );
  }
}

// ── 2) gui-flow 阶段行格式契约 ────────────────────────────────────
// Go printFlowReport: fmt.Printf("\n%s [%d] %s (%.2fms)\n") → `✅ [1] ① 配置加载 (1.23ms)`
// 前端 perf.ts: /^([✅❌])\s*\[\d+\]\s*(.+?)\s*\(([\d.]+)ms\)$/
const guiStageRe = /^([✅❌])\s*\[\d+\]\s*(.+?)\s*\(([\d.]+)ms\)$/;
const guiTotalRe = /⏱️\s*总耗时:\s*([\d.]+)ms/;

if (flowGo) {
  // Go 侧模板仍存在（锚定上游格式；攻破方向：有人改了 Go 输出格式）
  must(
    flowGo.includes('[%d] %s (%.2fms)'),
    'gui-flow 阶段行模板失效：go/cli/flow.go 不再包含 "[%d] %s (%.2fms)"',
  );
  must(
    flowGo.includes('总耗时: %.2fms'),
    'gui-flow 总耗时模板失效：go/cli/flow.go 不再包含 "总耗时: %.2fms"',
  );
}

// 下游解析契约：前端正则必须命中由 Go 模板生成的样本
{
  const sample = '✅ [1] ① 配置加载 (1.23ms)';
  const m = sample.match(guiStageRe);
  must(
    m && m[2].trim() === '① 配置加载' && m[3] === '1.23',
    `gui-flow 阶段行契约失配（前端正则漏接 Go 模板输出）: ${sample}`,
  );
}
must(
  guiTotalRe.test('⏱️  总耗时: 231.73ms'),
  'gui-flow 总耗时契约失配（前端正则漏接 "⏱️  总耗时: Xms"）: ⏱️  总耗时: 231.73ms',
);

// ── 3) single-bench 阶段行格式契约 ───────────────────────────────
// Go printSingleModelStages: "   %-20s %10.2fms %s" → `   ② JSON 解析  1993.66ms 🔴 瓶颈`
// 前端 perf.ts: /^\s+(.+?)\s+(\d+(?:\.\d+)?)ms(?:\s+(.*))?$/
const sbStageRe = /^\s+(.+?)\s+(\d+(?:\.\d+)?)ms(?:\s+(.*))?$/;
const sbTotalRe = /⏱️\s*总耗时.*?([\d.]+)ms/;

if (concurrentGo) {
  must(
    concurrentGo.includes('%10.2fms'),
    'single-bench 阶段行模板失效：go/cli/concurrent.go 不再包含 "%10.2fms"',
  );
  must(
    concurrentGo.includes('总耗时（'),
    'single-bench 总耗时模板失效：go/cli/concurrent.go 不再包含 "总耗时（"',
  );
}

{
  const sample = '   ② JSON 解析            1993.66ms 🔴 瓶颈';
  const m = sample.match(sbStageRe);
  must(
    m && m[1].trim() === '② JSON 解析' && m[2] === '1993.66',
    `single-bench 阶段行契约失配（前端正则漏接 Go 模板输出）: ${sample}`,
  );
}
must(
  sbTotalRe.test('⏱️  总耗时（3 次迭代）: 6554.70ms'),
  'single-bench 总耗时契约失配：⏱️  总耗时（3 次迭代）: 6554.70ms',
);

// ── 汇总结论 ─────────────────────────────────────────────────────
if (errors.length) {
  console.error('❌ 契约测试失败（gui-flow/single-bench 输出格式 ↔ 前端解析）：');
  for (const e of errors) console.error(`  - ${e}`);
  const note = 'frontend/perf.ts 的正则仅接收由 Go 模板生成的输出；若 Go 改了输出格式或前端改了正则，需同步并更新本契约样本。';
  console.error(`  提示：${note}`);
  process.exit(1);
}
console.log('✅ 契约测试通过：CLI 性能命令输出格式与前端解析锚定一致（白名单 + gui-flow + single-bench）');
process.exit(0);