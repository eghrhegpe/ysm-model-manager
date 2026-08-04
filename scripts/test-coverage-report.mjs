#!/usr/bin/env node
/**
 * test-coverage-report.mjs — 补测建议清单生成器。
 *
 * 读取 vitest v8 coverage 产物（frontend/coverage/coverage-final.json，
 * 由 `npm run test:coverage` 生成，istanbul 兼容格式），输出按语句覆盖率
 * 升序排列的未覆盖清单（文件 + 未覆盖行区间 + 未覆盖函数），供 AI/人工
 * 决定下一步补测对象。覆盖率阈值防回退见 frontend/vite.config.js。
 *
 * 用法：
 *   node scripts/test-coverage-report.mjs            # 文本报告（默认 top 15）
 *   node scripts/test-coverage-report.mjs --top 5    # 只列最差 5 个
 *   node scripts/test-coverage-report.mjs --json     # 结构化输出（子代理消费）
 *   node scripts/test-coverage-report.mjs --input <path>  # 指定 coverage 文件
 *
 * 依赖：frontend/coverage/coverage-final.json（先跑 npm run test:coverage）
 * 设计意图：test-coverage-report 工具脚本
 * 退出码：1（失败）
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot, toPosix, relPosix } from './_lib/scan-files.mjs';

const ROOT = getRoot();
const DEFAULT_INPUT = path.join(ROOT, 'frontend/coverage/coverage-final.json');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const topIdx = args.indexOf('--top');
const topN = topIdx !== -1 ? parseInt(args[topIdx + 1], 10) : 15;
const inputIdx = args.indexOf('--input');
const inputPath = inputIdx !== -1 ? args[inputIdx + 1] : DEFAULT_INPUT;

if (!fs.existsSync(inputPath)) {
  process.stderr.write(
    `未找到覆盖率产物 ${inputPath}\n请先运行 cd frontend && npm run test:coverage\n`
  );
  process.exit(1);
}

/** 语句区间并集 → 紧凑的行号列表（如 "34, 56-58, 101"）。 */
function compactRanges(lines) {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j === i ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return out.join(', ');
}

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

const rows = [];
for (const [absPath, entry] of Object.entries(raw)) {
  if (!absPath.includes(`${path.sep}js${path.sep}`)) continue;
  const rel = relPosix(absPath);
  if (/\.(test|spec)\.(js|ts)$/.test(rel)) continue;

  const stmts = Object.values(entry.s);
  const total = stmts.length;
  const covered = stmts.filter((c) => c > 0).length;
  const stmtPct = total ? (covered / total) * 100 : 100;

  const uncoveredLines = [];
  for (const [id, count] of Object.entries(entry.s)) {
    if (count > 0) continue;
    const loc = entry.statementMap[id];
    if (loc?.start?.line) uncoveredLines.push(loc.start.line);
  }

  const uncoveredFns = [];
  for (const [id, count] of Object.entries(entry.f)) {
    if (count > 0) continue;
    const fn = entry.fnMap[id];
    if (fn?.name) uncoveredFns.push(`${fn.name} (${fn.line})`);
  }

  rows.push({
    file: toPosix(rel),
    stmts: total ? Number(stmtPct.toFixed(2)) : 100,
    uncoveredLines: uncoveredLines.sort((a, b) => a - b),
    uncoveredFns,
  });
}

rows.sort((a, b) => a.stmts - b.stmts);

const totalFiles = rows.length;
const sumStmts = rows.reduce((acc, r) => acc + r.stmts, 0);
const overall = totalFiles ? Number((sumStmts / totalFiles).toFixed(2)) : 100;

if (jsonMode) {
  process.stdout.write(
    JSON.stringify(
      {
        _summary: {
          files: totalFiles,
          overallStmts: overall,
          source: inputPath,
          hint: '低于阈值的文件会让 npm run test:coverage 失败（见 frontend/vite.config.js coverage.thresholds）',
        },
        files: rows.slice(0, topN),
      },
      null,
      2
    ) + '\n'
  );
} else {
  process.stdout.write(`# 补测建议清单（未覆盖代码，语句覆盖率升序）\n`);
  process.stdout.write(`来源: ${toPosix(relPosix(inputPath))} · 共 ${totalFiles} 个源文件 · 平均语句覆盖率 ${overall}%\n\n`);
  const shown = rows.slice(0, topN);
  for (const r of shown) {
    const lineDesc = r.uncoveredLines.length ? compactRanges(r.uncoveredLines) : '(无)';
    const fnDesc = r.uncoveredFns.length ? r.uncoveredFns.join(', ') : '(无)';
    process.stdout.write(`[${r.stmts}%] ${r.file}\n`);
    process.stdout.write(`  未覆盖行:   ${lineDesc}\n`);
    process.stdout.write(`  未覆盖函数: ${fnDesc}\n`);
  }
  if (rows.length > shown.length) {
    process.stdout.write(`\n（仅显示最差 ${shown.length} 个，共 ${rows.length} 个；--top N 可调整）\n`);
  }
}
