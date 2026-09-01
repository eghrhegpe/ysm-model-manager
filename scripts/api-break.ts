#!/usr/bin/env node
/**
 * api-break.ts — 任意两 ref 之间的破坏性变更检测（audit-split 的通用化）。
 *
 * 设计意图：audit-split 只比 `commit^` vs `commit`；本工具把比对泛化为
 * **任意两点**（分支间 / 标签间 / 任意两 commit 间）。对给定 ref 对，输出：
 *   1. 文件变更概览（新增/删除/修改/重命名）；
 *   2. 破坏性变更：older 有但在 newer 消失的**导出符号** → 在 newer 下扫调用方；
 *   3. 新增导出符号清单（情报，供下游参考）；
 *   4. 红线提醒：newer 下任何文件 > 400 行（ADR-040）。
 *
 * 典型用法：
 *   node scripts/api-break.ts main HEAD                    # 分支合并前检查
 *   node scripts/api-break.ts v1.11 v1.12                  # 版本发布间检查
 *   node scripts/api-break.ts abc123 def456 --scope go/    # 限定扫描范围
 *
 * 依赖：scripts/_lib/{git-ref,source-graph,scan-files}.ts（零外部依赖）。
 *
 * 退出码：0 成功；`--redline` 且存在 >400 行文件 → 1；缺参/ref 无效 → 2。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  showAt, existsAt, renamePairs, gitMaybe, lsTree,
} from './_lib/git-ref.ts';
import { getExportedSymbolsAny, topDeclsAny, searchName, countLines } from './_lib/source-graph.ts';
import { walk, ROOT, toPosix } from './_lib/scan-files.ts';
import { parseArgs } from './_lib/parse-args.ts';

const REDLINE = 400; // ADR-040：单文件 ≤400 行

/** compare() 的返回形状（human/toJ 消费）。 */
interface BreakReport {
  older: string;
  newer: string;
  renames: Array<{ oldPath: string; newPath: string; similarity: number }>;
  mods: any[];
  removedTraces: any[];
  addedFiles: string[];
  removedFiles: string[];
  modifiedCount: number;
  redlineFiles: any[];
}

// ── 核心比对 ──
// 优化：只用 git diff --name-only 拿变更文件清单（而非 diffTree 全量遍历），
// 大幅减少 showAt 调用次数。对大 diff（如 merge base → HEAD）可快 10x+。
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.go']);
function isSourceFile(p: string) {
  const ext = path.extname(p).toLowerCase();
  return SOURCE_EXTS.has(ext);
}

function gitDiffNames(older: string, newer: string) {
  // git diff --name-only older newer：只列变更路径，O(1) 次调用
  const out = gitMaybe(['diff', '--name-only', older, newer]);
  if (!out) return [];
  return out.trim().split('\n').filter(Boolean);
}

function compare(older: string, newer: string, scope: string | undefined): BreakReport {
  // 1. 变更文件清单（git diff --name-only，只列实际变化的文件）
  const allChanged = gitDiffNames(older, newer);
  // 2. rename 配对（用于从"删除"和"新增"中排除 rename 产生的假象）
  const renames = renamePairs(older, newer, 50);
  const renameFromSet = new Set(renames.map((r) => r.oldPath));
  const renameToSet = new Set(renames.map((r) => r.newPath));

  // 3. 分类
  const addedFiles: string[] = [];
  const removedFiles: string[] = [];
  const modifiedFiles: string[] = [];
  for (const p of allChanged) {
    if (renameFromSet.has(p)) continue; // rename 的 from 侧，后续用 renames 处理
    const inOlder = existsAt(older, p);
    const inNewer = existsAt(newer, p);
    if (!inOlder && inNewer) addedFiles.push(p);
    else if (inOlder && !inNewer) removedFiles.push(p);
    else if (inOlder && inNewer) modifiedFiles.push(p);
  }
  // 排除 rename 到处的"新增"（from 已在上面跳过，to 侧如果也在 allChanged 里会进 addedFiles，需要排除）
  const finalAdded = addedFiles.filter((p) => !renameToSet.has(p));
  const finalRemoved = removedFiles.filter((p) => !renameFromSet.has(p));

  // 4. 对 modified 文件提取新旧顶层声明（仅分析源码文件）
  const mods: any[] = [];
  for (const p of modifiedFiles) {
    if (!isSourceFile(p)) continue;
    const oldText = showAt(older, p);
    const newText = showAt(newer, p);
    if (oldText === null && newText === null) continue;
    const oldAll = new Set(oldText ? topDeclsAny(p, oldText) : []);
    const newAll = new Set(newText ? topDeclsAny(p, newText) : []);
    const oldExp = new Set(oldText ? getExportedSymbolsAny(p, oldText) : []);
    const newExp = new Set(newText ? getExportedSymbolsAny(p, newText) : []);
    const deleted = [...oldAll].filter((s) => !newAll.has(s));
    const added = [...newAll].filter((s) => !oldAll.has(s));
    const deletedExp = deleted.filter((s) => oldExp.has(s));
    const addedExp = added.filter((s) => newExp.has(s));
    const newLines = countLines(newText);
    if (deleted.length || added.length) {
      mods.push({
        path: p,
        deleted, added, deletedExp, addedExp,
        oldLines: countLines(oldText),
        newLines,
        redline: newLines !== null && newLines > REDLINE,
      });
    }
  }

  // 4.5 redline 集合：modified 超红线（mods 内） + added 超红线（新增文件也查，
  // 否则 6d05f12c 新增的 web-fs.ts 447 行这类超红线新文件会漏报）
  const redlineFiles: any[] = [];
  for (const m of mods) {
    if (m.redline) redlineFiles.push({ path: m.path, lines: m.newLines });
  }
  for (const p of finalAdded) {
    if (!isSourceFile(p)) continue;
    const newText = showAt(newer, p);
    const lines = countLines(newText);
    if (lines !== null && lines > REDLINE) redlineFiles.push({ path: p, lines });
  }

  // 5. 对 removed 文件整体视为"全部符号消失"（仅源码文件）
  const removedTraces: any[] = [];
  for (const p of finalRemoved) {
    if (!isSourceFile(p)) continue;
    const oldText = showAt(older, p);
    if (oldText === null) continue;
    const oldAll = topDeclsAny(p, oldText);
    const oldExp = new Set(getExportedSymbolsAny(p, oldText));
    removedTraces.push({ path: p, syms: oldAll, exp: oldExp, lines: countLines(oldText) });
  }

  return {
    older, newer,
    renames,
    mods, removedTraces,
    addedFiles: finalAdded, removedFiles: finalRemoved,
    modifiedCount: modifiedFiles.length,
    redlineFiles,
  };
}

// ── 调用方扫描（基于 newer ref 的文本）──
// 只对 go/ + frontend/src 扫描：源码目录才有导出符号，docs/novel 等目录
// 即使路径存在也不含顶层声明，盲目全仓扫描会触发大量 git show 噪音并超时。
function scanCallersInRef(terms: string[], newer: string, scope: string | undefined) {
  if (!terms.length) return new Map();
  const callers = new Map();
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.go'];
  const skipFileRe = /\.(test|spec)\.[jt]sx?$/;
  const scanRoots: string[] = [];
  if (scope) {
    const abs = scope.startsWith('/') || scope.startsWith('C:\\') ? scope : path.join(ROOT, scope);
    if (fs.existsSync(abs)) scanRoots.push(abs);
  } else {
    // 只扫源码目录（和 rollback-impact 默认口径一致）
    const goDir = ROOT + '/go';
    const srcDir = ROOT + '/frontend/src';
    if (fs.existsSync(goDir)) scanRoots.push(goDir);
    if (fs.existsSync(srcDir)) scanRoots.push(srcDir);
  }
  // 性能（审核 P3）：逐文件 existsAt 是 477 次 cat-file -e spawn（33-36s）；
  // 改用 lsTree 一次性取 newer ref 下 go/+frontend/src 的存在集合，1 次 spawn 替代逐文件探测
  const refFiles = new Set();
  for (const root of scanRoots) {
    for (const p of lsTree(newer, toPosix(path.relative(ROOT, root)))) refFiles.add(p);
  }
  for (const dir of scanRoots) {
    try {
      const files = walk(dir, { exts, skipFile: (n) => skipFileRe.test(n) });
      for (const f of files) {
        if (typeof f !== 'string') continue;
        const rel = toPosix(path.relative(ROOT, f));
        // 跳过二进制 / 不存在于 newer 的文件（避免 git show 噪声）
        if (rel.endsWith('.png') || rel.endsWith('.gif') || rel.endsWith('.jpg')) continue;
        // R5 修复：showAt 的 toGitPath 假设绝对路径（path.relative(ROOT, p)），
        // 传相对路径 rel 在 cwd≠ROOT 时解析错位 → 漏报断链调用方；walk 返回绝对路径 f
        if (!refFiles.has(rel)) continue; // 磁盘有但 newer ref 无（并行拆分的在建文件）→ 跳过，否则 git show 报 fatal 噪声
        const text = showAt(newer, f);
        if (!text) continue;
        for (const sym of terms) {
          const nm = searchName(sym);
          const escaped = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp('\\b' + escaped + '\\b', 'g');
          if (re.test(text)) {
            let arr = callers.get(sym);
            if (!arr) { arr = []; callers.set(sym, arr); }
            arr.push(rel);
          }
        }
      }
    } catch (e) {
      console.error(`[api-break] 扫描失败 ${dir}: ${(e as Error).message}`);
    }
  }
  return callers;
}

// ── 输出 ──
function human(report: BreakReport, callers: Map<string, string[]>, compact: boolean) {
  const L: string[] = [];
  L.push('\u2550'.repeat(66));
  L.push(` api-break —— ${report.older} ←→ ${report.newer}`);
  L.push('\u2550'.repeat(66));
  L.push('');
  L.push('① 文件变更概览');
  L.push(`   新增: ${report.addedFiles.length} · 删除: ${report.removedFiles.length} · 修改: ${report.mods.length} · 重命名: ${report.renames.length} 对`);
  if (report.renames.length && !compact) {
    for (const r of report.renames.slice(0, 10)) {
      L.push(`   ▸ ${r.oldPath}  →  ${r.newPath}`);
    }
    if (report.renames.length > 10) L.push(`   … 以及 ${report.renames.length - 10} 对（--json 全量）`);
  }

  const allDeletedExp = report.mods.flatMap((m) => m.deletedExp).concat(
    report.removedTraces.flatMap((r) => [...r.exp].map((s) => s))
  );
  if (allDeletedExp.length) {
    L.push('');
    L.push('② 破坏性变更（导出符号消失）');
    let totalCalls = 0;
    for (const m of report.mods) {
      if (!m.deletedExp.length) continue;
      L.push(`   ▸ ${m.path}  删除 ${m.deletedExp.length} 个导出`);
      for (const sym of m.deletedExp) {
        const list = callers.get(sym) || [];
        if (list.length) {
          totalCalls += list.length;
          L.push(`       ✗ ${sym}  （${list.length} 处引用）`);
          for (const c of list.slice(0, 5)) L.push(`           ↳ ${c}`);
          if (list.length > 5) L.push(`           … 以及 ${list.length - 5} 处`);
        } else {
          L.push(`       ✓ ${sym}  （当前无引用）`);
        }
      }
    }
    for (const r of report.removedTraces) {
      if (!r.exp.size) continue;
      L.push(`   ▸ ${r.path}  （整文件删除，导出 ${r.exp.size} 个）`);
      for (const sym of [...r.exp].sort()) {
        const list = callers.get(sym) || [];
        if (list.length) {
          totalCalls += list.length;
          L.push(`       ✗ ${sym}  （${list.length} 处引用）`);
          for (const c of list.slice(0, 5)) L.push(`           ↳ ${c}`);
        } else {
          L.push(`       ✓ ${sym}  （当前无引用）`);
        }
      }
    }
    L.push('');
    L.push('   共 ' + allDeletedExp.length + ' 个导出符号消失' + (totalCalls ? ` · ${totalCalls} 处潜在断链` : ' · 当前无断链'));
  } else {
    if (!compact) L.push('');
    L.push('② 破坏性变更：✅ 无导出符号消失');
  }

  const allAddedExp = report.mods.flatMap((m) => m.addedExp);
  if (allAddedExp.length) {
    L.push('');
    L.push('③ 新增导出符号（' + allAddedExp.length + ' 个）');
    for (const m of report.mods) {
      if (!m.addedExp.length) continue;
      L.push(`   ▸ ${m.path}`);
      for (const sym of m.addedExp) L.push(`       ✓ ${sym}`);
    }
  }

  const redlineFiles = report.redlineFiles;
  if (redlineFiles.length) {
    L.push('');
    L.push('④ 红线 ADR-040（单文件 > ' + REDLINE + ' 行）');
    for (const m of redlineFiles) {
      L.push(`   ✗ ${m.path}  ${m.newLines} 行 > ${REDLINE}`);
    }
  }

  L.push('');
  L.push('⑤ 综合结论');
  const broken = allDeletedExp.length;
  const newExports = allAddedExp.length;
  const overRedline = redlineFiles.length;
  if (!broken && !newExports && !overRedline) L.push('   ✅ 无破坏性变更，两条 ref 兼容');
  else {
    const parts: string[] = [];
    if (broken) parts.push(broken + ' 个导出消失');
    if (allDeletedExp.length && callers) {
      const totalC = allDeletedExp.reduce((s, sym) => s + (callers.get(sym) || []).length, 0);
      if (totalC) parts.push(totalC + ' 处潜在断链');
    }
    if (newExports) parts.push(newExports + ' 个新增导出');
    if (overRedline) parts.push(overRedline + ' 个超红线文件');
    L.push('   ⚠️  ' + parts.join(' · '));
  }
  return L.join('\n');
}

function toJ(report: BreakReport, callers: Map<string, string[]>) {
  const allDeletedExp = report.mods.flatMap((m) => m.deletedExp).concat(
    report.removedTraces.flatMap((r) => [...r.exp])
  );
  const allAddedExp = report.mods.flatMap((m) => m.addedExp);
  const redlineFiles = report.redlineFiles;
  let totalCalls = 0;
  for (const sym of allDeletedExp) totalCalls += (callers.get(sym) || []).length;
  return {
    kind: 'api-break',
    older: report.older,
    newer: report.newer,
    fileSummary: {
      added: report.addedFiles.length,
      removed: report.removedFiles.length,
      modified: report.mods.length,
      renamed: report.renames.length,
    },
    renames: report.renames,
    breakingChanges: allDeletedExp.length,
    callers: Object.fromEntries(
      allDeletedExp.map((sym) => [sym, callers.get(sym) || []])
    ),
    totalCallers: totalCalls,
    newExports: allAddedExp.length,
    newExportDetails: report.mods.map((m) => ({
      path: m.path,
      symbols: m.addedExp,
      oldLines: m.oldLines,
      newLines: m.newLines,
    })),
    redline: {
      limit: REDLINE,
      over: redlineFiles.length,
      files: redlineFiles,
    },
    safe: allDeletedExp.length === 0 && totalCalls === 0,
  };
}

// ── CLI ──
// 位置参数 <older> <newer>，走 parse-args（unknown 白名单拦截，防 --jso 拼错静默放行）

const args = parseArgs(process.argv.slice(2), {
  bools: ['json', 'quiet', 'redline', 'compact'],
  strings: ['scope'],
});
if (args.help) {
  console.log('用法: node scripts/api-break.ts <older> <newer> [--scope <dir>] [--json] [--quiet] [--redline] [--compact]');
  process.exit(0);
}
if (args.unknown.length) {
  console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
  process.exit(2);
}
const JSON_OUT = args.json;
const QUIET = args.quiet;
const REDLINE_ONLY = args.redline;
const SCOPE = args.scope as string | undefined;
const COMPACT = args.compact;
const nonOpts = args._;
if (nonOpts.length < 2) {
  console.error('用法: node scripts/api-break.ts <older> <newer> [--scope <dir>] [--json] [--quiet] [--redline] [--compact]');
  process.exit(2);
}
const older = nonOpts[0]!, newer = nonOpts[1]!;

// ref 有效性校验：git diff 失败会被 gitMaybe 吞成空清单 → 无效 ref 会得到
// 静默的「兼容」假结论（门禁工具危险信号）；先 rev-parse 验证两个 ref，无效退出 2
for (const ref of [older, newer]) {
  if (!gitMaybe(['rev-parse', '--verify', '--quiet', ref + '^{commit}'])) {
    console.error(`无效 ref: ${ref}`);
    process.exit(2);
  }
}

const report = compare(older, newer, SCOPE);
const allDeletedExp = report.mods.flatMap((m) => m.deletedExp).concat(
  report.removedTraces.flatMap((r) => [...r.exp])
);
const callers = allDeletedExp.length
  ? scanCallersInRef(allDeletedExp, newer, SCOPE)
  : new Map();

if (JSON_OUT) {
  console.log(JSON.stringify(toJ(report, callers), null, 2));
} else if (QUIET && allDeletedExp.length === 0 && report.redlineFiles.length === 0) {
  // 静默模式（--quiet）：无破坏性变更且无红线文件时只输出一行结论（Q1 实现；
  // 与 --redline 退出码一致——有红线时走下方 ⚠️ 行并 exit 1）
  console.log('✅ 无破坏性变更');
} else if (QUIET && allDeletedExp.length === 0) {
  console.log(`⚠️ ${report.redlineFiles.length} 个超红线文件（ADR-040）`);
} else {
  console.log(human(report, callers, COMPACT as boolean));
}
if (REDLINE_ONLY && report.redlineFiles.length > 0) process.exit(1);
process.exit(0);
