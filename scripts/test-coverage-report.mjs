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
 *   node scripts/test-coverage-report.mjs --suggest # 非阻断建议（提交期钩子用，永远 exit 0）
 *     # 只列低于阈值文件；缺失数据 graceful degrade；--threshold N 可覆盖阈值
 *     # 阈值默认读 frontend/vite.config.js coverage.thresholds.statements
 *
 * 依赖：frontend/coverage/coverage-final.json（先跑 npm run test:coverage）
 * 设计意图：test-coverage-report 工具脚本
 * 退出码：默认 1（数据缺失）；--suggest 永远 0（非阻断）
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot, toPosix, relPosix } from './_lib/scan-files.mjs';

const ROOT = getRoot();
const DEFAULT_INPUT = path.join(ROOT, 'frontend/coverage/coverage-final.json');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const suggestMode = args.includes('--suggest');
const topIdx = args.indexOf('--top');
const topN = topIdx !== -1 ? parseInt(args[topIdx + 1], 10) : 15;
const inputIdx = args.indexOf('--input');
const inputPath = inputIdx !== -1 ? args[inputIdx + 1] : DEFAULT_INPUT;
const thIdx = args.indexOf('--threshold');
const thresholdArg = thIdx !== -1 ? parseInt(args[thIdx + 1], 10) : NaN;

/** 语句覆盖率阈值：优先从 frontend/vitest.config.ts coverage.thresholds.statements
 *  提取（单一事实源，2026-08-04 校准为 45；vitest.config.ts:17-24 定义 thresholds——
 *  vite.config.js 无阈值，code_review P3 复核后切换来源），提取失败回退 45，--threshold 可覆盖。 */
function resolveThreshold() {
  if (Number.isFinite(thresholdArg)) return thresholdArg;
  try {
    const cfgPath = path.join(ROOT, 'frontend', 'vitest.config.ts');
    const cfg = fs.readFileSync(cfgPath, 'utf8');
    const m = cfg.match(/statements\s*:\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
  } catch {
    /* 读不到配置则用默认值 */
  }
  return 45;
}
const THRESHOLD = resolveThreshold();

if (!fs.existsSync(inputPath)) {
  process.stderr.write(
    `未找到覆盖率产物 ${inputPath}\n请先运行 cd frontend && npm run test:coverage\n`
  );
  // --suggest 为提交期非阻断模式：数据缺失 graceful degrade，绝不卡提交
  if (suggestMode) process.exit(0);
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

/** 从 coverage key（生成机绝对路径）提取仓库相对路径，跨平台免疫。
 *  coverage-final.json 的 key 是生成时机的绝对路径（Windows: C:\...；Linux: /home/...），
 *  若换机解析，path.relative(ROOT, key) 会因平台路径风格不一致而错乱。
 *  策略：同平台场景 relPosix 结果恒正确且以仓库顶层段开头，优先采用；
 *  跨平台场景（非 frontend/go/internal 前缀）定位顶层段，取【最后一次】出现，
 *  避免仓库父路径含同名段（如 /home/u/go/ysm/...）时误命中祖先段。 */
function repoRel(p) {
  const rel = relPosix(p);
  if (rel.startsWith('frontend/') || rel.startsWith('go/') || rel.startsWith('internal/')) return rel;
  const posix = toPosix(p);
  const matches = [...posix.matchAll(/\/(frontend|go|internal)\//g)];
  const m = matches[matches.length - 1];
  if (m) return posix.slice(m.index + 1);
  return rel;
}

/** 读覆盖率产物；损坏（JSON 解析失败）时优雅报错，--suggest 非阻断模式 graceful degrade。 */
function loadCoverage() {
  try {
    return JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  } catch (e) {
    process.stderr.write(
      `覆盖率产物损坏（JSON 解析失败）: ${inputPath}\n${e.message}\n请重新运行 cd frontend && npm run test:coverage\n`
    );
    if (suggestMode) process.exit(0); // 提交期非阻断：绝不卡提交
    process.exit(1);
  }
}

const raw = loadCoverage();

const rows = [];
for (const [absPath, entry] of Object.entries(raw)) {
  // 损坏条目守卫：entry 非对象或缺 s 统计（statementMap）时跳过，不抛 TypeError
  if (!entry || typeof entry !== 'object' || !entry.s) continue;
  // 注：不再按 path.sep 拼装目录段过滤（该写法在 Windows 上找 \js\、Linux 上找 /js/，
  // 对绝对路径 key 恒为 false，曾把全部文件滤掉导致"假全绿"）。
  const rel = repoRel(absPath);
  if (!rel.startsWith('frontend/') && !rel.startsWith('go/') && !rel.startsWith('internal/')) continue;
  if (/\.(test|spec)\.(js|ts)$/.test(rel)) continue;

  const stmts = Object.values(entry.s);
  const total = stmts.length;
  const covered = stmts.filter((c) => c > 0).length;
  const stmtPct = total ? (covered / total) * 100 : 100;

  const uncoveredLines = [];
  for (const [id, count] of Object.entries(entry.s)) {
    if (count > 0) continue;
    const loc = entry.statementMap?.[id];
    if (loc?.start?.line) uncoveredLines.push(loc.start.line);
  }

  const uncoveredFns = [];
  for (const [id, count] of Object.entries(entry.f ?? {})) {
    if (count > 0) continue;
    const fn = entry.fnMap?.[id];
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

const belowThreshold = rows.filter((r) => r.stmts < THRESHOLD);

if (suggestMode) {
  // ── 非阻断建议模式（prepare-commit-msg 钩子消费；永远 exit 0）──
  if (jsonMode) {
    process.stdout.write(
      JSON.stringify(
        {
          _summary: {
            files: totalFiles,
            overallStmts: overall,
            belowThreshold: belowThreshold.length,
            thresholdStmts: THRESHOLD,
            source: inputPath,
          },
          files: belowThreshold.map((r) => ({
            file: r.file,
            stmts: r.stmts,
            uncoveredRanges: r.uncoveredLines.length ? compactRanges(r.uncoveredLines) : '',
            uncoveredFns: r.uncoveredFns,
          })),
        },
        null,
        2
      ) + '\n'
    );
  } else if (belowThreshold.length === 0) {
    process.stdout.write(
      `✅ 覆盖率全达标：整体 ${overall}%，无文件低于 ${THRESHOLD}% 阈值（frontend/vite.config.js coverage.thresholds.statements）\n`
    );
  } else {
    process.stdout.write(`## 🔧 覆盖率建议（非阻断）\n`);
    process.stdout.write(
      `以下 ${belowThreshold.length} 个源文件语句覆盖率低于阈值 ${THRESHOLD}%（frontend/vite.config.js coverage.thresholds.statements）：\n`
    );
    for (const r of belowThreshold) {
      const lineDesc = r.uncoveredLines.length ? compactRanges(r.uncoveredLines) : '(无)';
      process.stdout.write(`  [${r.stmts}%] ${r.file}  未覆盖行: ${lineDesc}\n`);
    }
    process.stdout.write(`补测参考: node scripts/test-coverage-report.mjs\n`);
  }
  process.exit(0);
}

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
