#!/usr/bin/env node
/**
 * perf-gate.mjs — single-bench 性能回归守卫（B-2「性能护栏」关键环节）。
 *
 * 与 gui-flow-gate.mjs 的关系：
 *  - gui-flow-gate 验证「加载链健康」（success/fail）；
 *  - 本门禁验证「性能不倒退」——把 single-bench 各阶段耗时存为 baseline 锚点，
 *    后续运行逐阶段对比，任一阶段超阈值（默认 1.5x）即告警。
 * 价值：优化成果被量化锁住，重构不敢悄悄拖慢单模型加载（"单模型快 = 所有场景快"）。
 *
 * ⚠️ 副作用须知：真跑 `go run . --cli single-bench` 会触发 DispatchCommand 经 saveConfigFn
 *   落盘 files-root 到用户配置，宜在 CI/无真实用户环境执行；本地跑会改写用户默认仓库路径。
 *
 * 用法：
 *   node scripts/perf-gate.mjs --init                     # 首次：分析模型并写入 perf-baseline.json（锚点）
 *   node scripts/perf-gate.mjs                            # 默认：对比 baseline，任一阶段超阈值即 fail（exit 1）
 *   node scripts/perf-gate.mjs --model <path>             # 指定模型（默认 fixtures 的 ysm.json）
 *   node scripts/perf-gate.mjs --threshold-ratio 2.0      # 收紧/放宽阈值（耗时 > baseline×ratio 告警）
 *   node scripts/perf-gate.mjs --warn-only                # 超阈值仅 WARN 不阻断（供本地观察）
 *   node scripts/perf-gate.mjs --verbose                  # 打印解析明细
 * 退出码：0=通过（或 warn-only+仅 warn），1=失败（阶段回归超阈值）。
 * 依赖：node:child_process / node:fs / node:path / scripts/_lib/scan-files.mjs（零外部依赖）。
 * 设计意图：把「性能退回」从"靠感觉/靠记忆"升级为"可对比的量化门禁"。baseline 纳入
 *           git 作为性能锚点，预-push 可调用；git 层面的漂移由人工 review baseline 变更把关。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot } from './_lib/scan-files.mjs';
import { parseArgs } from './_lib/parse-args.mjs';
import { run } from './_lib/proc.ts';

const ROOT = getRoot();
const BASELINE_FILE = path.join(ROOT, 'scripts', 'baseline', 'perf-baseline.json');

// 阶段行格式（对齐 go/cli/concurrent.go printSingleModelStages、frontend perf.ts）：
//   `   ② JSON 解析            1993.66ms 🔴 瓶颈`
const STAGE_RE = /^\s+(.+?)\s+(\d+(?:\.\d+)?)ms(?:\s+(.*))?$/;
const TOTAL_RE = /⏱️\s*总耗时.*?([\d.]+)ms/;
// single-bench 的 7 个阶段名（用于统一顺序；缺省时按出现顺序）
const STAGE_ORDER = [
  '① 文件读取', '② JSON 解析', '③ 数据验证', '④ 几何数据准备',
  '⑤ 纹理数据准备', '⑥ IPC 传输模拟', '⑦ 缓存检查',
];

// ── 参数解析（共享层 _lib/parse-args.mjs）────────────────────────
// 原内联解析的未知参数 exit 2 语义由 unknown 白名单拦截保留；
// iterations/thresholdRatio 原为 parseInt/parseFloat 数字，这里显式 Number() 还原。
const parsed = parseArgs(process.argv.slice(2), {
  bools: ['init', 'warn-only', 'verbose'],
  strings: ['model', 'files-root', 'iterations', 'threshold-ratio'],
  defaults: {
    model: path.join('tests', 'fixtures', 'ysm', '01_taisho_maid', 'ysm.json'),
    'files-root': 'tests/fixtures/ysm/01_taisho_maid',
    iterations: '1',
    'threshold-ratio': '1.5',
  },
});
if (parsed.unknown.length) {
  console.error(`[FAIL] 未知参数: ${parsed.unknown.join(' ')}`);
  process.exit(2);
}
const opts = {
  model: parsed.model,
  filesRoot: parsed['files-root'],
  iterations: Number(parsed.iterations),
  thresholdRatio: Number(parsed['threshold-ratio']),
  init: parsed.init,
  warnOnly: parsed['warn-only'],
  verbose: parsed.verbose,
};

const FILES_ROOT = path.resolve(ROOT, opts.filesRoot);
const MODEL = path.resolve(ROOT, opts.model);

if (!fs.existsSync(MODEL)) {
  console.error(`[FAIL] 模型不存在: ${MODEL}（可用 --model <path> 指定现有模型）`);
  process.exit(2);
}

// ── 真跑 single-bench --json ─────────────────────────────────
let raw = '';
const bench = run(
  'go',
  ['run', '.', '--cli', '--files-root', FILES_ROOT, 'single-bench', '--model', MODEL, '--iterations', String(opts.iterations), '--json'],
  { cwd: ROOT, timeout: 120000, mergeStderr: false },
);
raw = bench.out.trim(); // 失败时 out 也仅 stdout（mergeStderr:false），JSON 不被 watcher/编译噪音污染（code review P2）
if (!raw) {
  // mergeStderr:false 后编译/运行错误在 bench.err（stderr 原文），不再混入 out——
  // 这里必须透出，否则 go run 编译失败只留一句裸提示、真实错误被吞（连环 review f050902f）
  console.error(`[FAIL] single-bench 无 stdout 输出（go run 编译/运行失败）:\n${bench.err || ''}`);
  process.exit(1);
}
if (opts.verbose) console.log('--- 解析阶段 ---');

// 解析 data.output 中的阶段耗时（取最后一次迭代/汇总；single-bench --json 的 data.output 为文本）
let output = null;
try {
  const resp = JSON.parse(raw);
  output = resp?.data?.output || '';
} catch {
  output = raw; // 非 JSON 兜底当文本
}
const stages = new Map(); // name → ms
if (output) {
  let maxStage = 0;
  for (const ln of output.split('\n')) {
    const m = ln.trimEnd().match(STAGE_RE);
    if (m) {
      const name = m[1].trim();
      if (name === '总计') continue;
      stages.set(name, parseFloat(m[2]));
      maxStage += 1;
    }
  }
}

if (stages.size === 0) {
  console.error('[FAIL] 未能从 single-bench 输出中解析出任何阶段耗时');
  console.error('  raw output 前 500 字符:', raw.slice(0, 500));
  process.exit(1);
}

const stageLines = [...stages.entries()];
if (opts.verbose) {
  for (const [name, ms] of stageLines) console.log(`  ${name} ${ms.toFixed(2)}ms`);
}

// ── --init：建立/刷新 baseline ─────────────────────────────────
if (opts.init) {
  const baseline = { model: MODEL, filesRoot: opts.filesRoot, createdAt: new Date().toISOString(), stages: Object.fromEntries(stageLines) };
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  console.log(`✅ 已写入性能锚点基线：${path.relative(ROOT, BASELINE_FILE)}`);
  console.log(`   ${stageLines.map(([n, ms]) => `${n}≈${ms.toFixed(0)}ms`).join('，')}`);
  process.exit(0);
}

// ── 默认：对比 baseline ────────────────────────────────────────
if (!fs.existsSync(BASELINE_FILE)) {
  console.error(`[FAIL] 未找到基线 ${path.relative(ROOT, BASELINE_FILE)}——请先运行 node scripts/perf-gate.mjs --init 建立锚点`);
  process.exit(1);
}
let base;
try {
  base = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
} catch {
  console.error(`[FAIL] 基线损坏（非 JSON）：${path.relative(ROOT, BASELINE_FILE)}，可删除后 --init 重建`);
  process.exit(1);
}

const regressions = [];
for (const [name, nowMs] of stageLines) {
  const baseMs = base.stages?.[name];
  if (typeof baseMs !== 'number' || baseMs <= 0) {
    if (opts.warnOnly) {
      console.log(`  ⚠️ 新阶段「${name}」无基线参考（${nowMs.toFixed(0)}ms），建议重跑 --init`);
    }
    continue;
  }
  const ratio = nowMs / baseMs;
  if (ratio > opts.thresholdRatio) {
    regressions.push(`「${name}」 ${baseMs.toFixed(0)}→${nowMs.toFixed(0)}ms（${(ratio).toFixed(2)}x 超过阈值 ${opts.thresholdRatio}x）`);
  }
}

if (regressions.length) {
  const msg = regressions.map((r) => '  - ' + r).join('\n');
  if (opts.warnOnly) {
    console.log(`⚠️ 性能回归（warn-only 不阻断）：\n${msg}`);
    process.exit(0);
  }
  console.error(`❌ perf-gate 失败：存在 ${regressions.length} 处阶段性能回归（阈值 ${opts.thresholdRatio}x）：\n${msg}`);
  console.error('   确认是真实改进还是合法变化请更新基线：node scripts/perf-gate.mjs --init --model ' + opts.model);
  process.exit(1);
}
const totalMs = stageLines.reduce((s, [, ms]) => s + ms, 0);
console.log(`✅ perf-gate 通过：${stageLines.length} 个阶段，耗时合计 ${totalMs.toFixed(0)}ms，无超阈值回归（阈值 ${opts.thresholdRatio}x）`);
process.exit(0);