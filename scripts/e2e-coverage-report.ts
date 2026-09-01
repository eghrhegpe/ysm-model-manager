#!/usr/bin/env node
/**
 * e2e-coverage-report.ts — 端到端广度报告（ADR-035 G-4）。
 *
 * 读取 Playwright `page.coverage.stopJSCoverage()` 产物（V8 precise coverage，
 * 由 frontend/e2e/coverage-breadth.spec.ts 采集，输出到 frontend/e2e-coverage/），
 * 输出「哪些源文件被真实交互走到」的广度报告——只问「是否被走到」与函数级
 * 覆盖比例，不做行级精确统计（浏览器按帧采样易抖动，见 ADR-035 G-4 边界）。
 *
 * 用法：
 *   node scripts/e2e-coverage-report.ts                    # 广度报告（默认 top 20）
 *   node scripts/e2e-coverage-report.ts --input <path>     # 指定 V8 coverage JSON
 *   node scripts/e2e-coverage-report.ts --all              # 列出全部文件
 *   node scripts/e2e-coverage-report.ts --json             # 结构化输出（子代理消费）
 *
 * 边界（ADR-035 G-4 原文）：
 *   - 不并入 vitest 覆盖率门禁、不做 CI 红线——仅人工观察面；
 *   - vitest.config.ts 的阈值与 exclude 不变；
 *   - 依赖：先跑 `npx playwright test coverage-breadth` 采集产物。
 *
 * 退出码：0（正常）；1（产物缺失）。
 * 设计意图：端到端广度覆盖率报告，读取 Playwright V8 coverage 产物，输出「哪些源文件被真实交互走到」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot, toPosix, relPosix } from './_lib/scan-files.ts';

const ROOT = getRoot();
const DEFAULT_INPUT = path.join(ROOT, 'frontend/e2e-coverage/coverage.json');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const allMode = args.includes('--all');
const inputIdx = args.indexOf('--input');
const inputPath = inputIdx !== -1 ? args[inputIdx + 1]! : DEFAULT_INPUT;

if (!fs.existsSync(inputPath)) {
  console.error(`[e2e-coverage] 未找到采集产物 ${inputPath}`);
  console.error('  请先运行: cd frontend && npx playwright test coverage-breadth');
  process.exit(1);
}

/** V8 precise coverage 条目：{ url, functions: [{ ranges: [{start,end}], ... }], source? } */
const entries = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

/** 按 url 聚合（同一源文件可能被多次采到）：函数级「被走到」比例 */
function aggregate(entriesList: any[]) {
  const byUrl = new Map();
  for (const e of entriesList) {
    if (!e || typeof e.url !== 'string' || !e.functions) continue;
    const url = e.url;
    if (!byUrl.has(url)) {
      byUrl.set(url, { hit: 0, total: 0, ranges: 0 });
    }
    const agg = byUrl.get(url);
    for (const fn of e.functions) {
      agg.total++;
      // V8 precise：ranges 是「已覆盖区间」列表，count>0 的段才算执行过。
      // 不能只看 ranges.length——未执行函数也可能带 count=0 的区间（块级覆盖），
      // `length > 0` 恒真 → 全部判为已走到（假绿，批次4 P1）。以 count>0 为准。
      const executed = Array.isArray(fn.ranges) && fn.ranges.some((r: any) => r && r.count > 0);
      if (executed) agg.hit++;
    }
  }
  return byUrl;
}

const byUrl = aggregate(entries);
const rows: any[] = [];
for (const [url, agg] of byUrl) {
  // Playwright coverage 的 url 形如 http://localhost:5173/src/app-modules.ts：
  // 提取路径段（去掉协议/主机/端口），再映射到 frontend/src/ 相对路径
  let pathPart = url;
  try {
    const u = new URL(url);
    pathPart = u.pathname;
  } catch {
    // 非 URL（直接文件路径的产物）保留原样
  }
  // 仅关注 src 下源文件（跳过 wasm/绑定/第三方）
  const srcRel = toPosix(pathPart.replace(/^\/+/, ''));
  if (!srcRel.startsWith('src/') || !srcRel.endsWith('.ts')) continue;
  rows.push({
    file: srcRel,
    hit: agg.hit,
    total: agg.total,
    pct: agg.total > 0 ? Math.round((agg.hit / agg.total) * 100) : 0,
    touched: agg.hit > 0,
  });
}

rows.sort((a, b) => a.pct - b.pct || a.file.localeCompare(b.file));

if (jsonMode) {
  console.log(JSON.stringify({ total: rows.length, touched: rows.filter(r => r.touched).length, rows }, null, 2));
  process.exit(0);
}

const touched = rows.filter(r => r.touched).length;
const untoched = rows.length - touched;
console.log(`\n📡 端到端广度报告（ADR-035 G-4）— ${rows.length} 个 src 源文件`);
console.log(`   被真实交互走到: ${touched}  |  未走到: ${untoched}\n`);
console.log('未走到（覆盖空白，人工核对是否应有交互）:');
for (const r of rows.filter(r => !r.touched)) {
  console.log(`  ⬜ ${r.file}`);
}
if (allMode || rows.filter(r => !r.touched).length === 0) {
  console.log('\n全部文件（按函数覆盖比例升序）:');
  for (const r of rows.slice(0, 20)) {
    const mark = r.touched ? '✅' : '⬜';
    console.log(`  ${mark} ${r.pct}%  ${r.file} (${r.hit}/${r.total})`);
  }
  if (rows.length > 20) console.log(`  … 共 ${rows.length} 个，--all 查看全部`);
}
console.log('\n[边界] 此报告仅人工观察面，不并入 vitest 门禁、不做 CI 红线（ADR-035 G-4）。');
process.exit(0);
