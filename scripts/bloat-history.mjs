#!/usr/bin/env node
/**
 * bloat-history.mjs — 文件代码膨胀轨迹分析。
 *
 * 设计意图：ADR-040 红线是"事后"判，本工具是"事前"情报——告诉你一个文件
 * 从哪次 commit 开始膨胀、哪个 commit 是跳点。对给定路径，遍历 git log（跟随
 * rename），对每次触及该文件的 commit，取"该 commit 与它的前一个版本"两份快照
 * 比对行数、导出符号数、顶层声明数，标出跳点。
 *
 * 与 audit-split 互补：
 *   - audit-split：针对单次"拆分"提交，报拆/新/改/红线/迁移（面向拆分审查）；
 *   - bloat-history：针对单个文件全生命周期，报增长曲线 + 跳点（面向膨胀追溯）。
 *
 * 依赖：scripts/_lib/{git-ref,source-graph,scan-files}.mjs + node:child_process（零外部依赖）。
 *
 * 用法：
 *   node scripts/bloat-history.mjs <path>                      # 默认最多 30 条
 *   node scripts/bloat-history.mjs <path> --limit 60           # 增加历史深度
 *   node scripts/bloat-history.mjs <path> --limit 30 --first N # 只看最近 N 条记录
 *   node scripts/bloat-history.mjs <path> --json               # JSON（供子代理/CI 消费）
 *
 * 退出码：0（无论有无跳点）。情报型工具，不阻断任何流程。
 */
import {
  logPathDetail,
  showAt,
} from './_lib/git-ref.mjs';
import { getExportedSymbolsAny } from './_lib/source-graph.mjs';
import { ROOT } from './_lib/scan-files.mjs';
import { run } from './_lib/proc.mjs';

// ── 顶层声明提取（与 audit-split 同源，供"导出 vs 非导出"区分）──
function goTopFuncs(text) {
  const out = new Set();
  const re = /\bfunc\s+(?:\(([^)]*)\)\s+)?([A-Za-z0-9_]+)\s*\(/gm;
  let m;
  while ((m = re.exec(text))) {
    const name = m[2];
    let key = name;
    if (m[1]) {
      const tm = m[1].match(/([A-Za-z0-9_]+)(?:\s*\[[^\]]*\])?\s*$/);
      const t = tm ? tm[1] : '';
      key = t ? t + '.' + name : name;
    }
    out.add(key);
  }
  return [...out];
}

function tsTopDecls(text) {
  const out = new Set();
  const re1 = /^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/gm;
  let m;
  while ((m = re1.exec(text))) out.add(m[1]);
  const re2 = /^(?:export\s+)?(?:const|let)\s+([A-Za-z0-9_]+)\s*=/gm;
  while ((m = re2.exec(text))) out.add(m[1]);
  return [...out];
}

function topDeclsAny(p, text) {
  return p.toLowerCase().endsWith('.go') ? goTopFuncs(text) : tsTopDecls(text);
}

function countLines(t) {
  if (!t) return null;
  // 末尾有换行时 split 产出尾部空串，减去——否则绝对行数系统性多算 1
  // （git show 的 blob 文本末尾通常带 \n；跳点差值不受影响，此处统一口径）
  const n = t.split('\n').length;
  return t.endsWith('\n') ? n - 1 : n;
}

function sigAny(p, text) {
  if (!text) return { lines: null, exports: 0, tops: 0 };
  return {
    lines: countLines(text),
    exports: getExportedSymbolsAny(p, text).length,
    tops: topDeclsAny(p, text).length,
  };
}

// ── 数据收集 ──
function collect(path, limit) {
  const commits = logPathDetail(path, { limit, follow: true });
  if (!commits.length) return null;
  const records = [];
  let nullSnapshotCount = 0;
  for (const c of commits) {
    const thisText = showAt(c.hash, path);
    const prevRef = c.hash + '^';
    const r = run('git', ['rev-parse', '--verify', prevRef + '^{commit}'], { cwd: ROOT });
    const prevExists = r.ok;
    const prevText = prevExists ? showAt(prevRef, path) : null;
    // --follow 下 rename 前的 commit 用当前路径读不到快照（showAt 返回 null），
    // 该段曲线会显示 `-`；统计缺失量供输出提示，避免静默吞掉（code_review P3）
    if (thisText === null || prevText === null) nullSnapshotCount++;
    records.push({
      commit: c,
      thisSig: sigAny(path, thisText),
      prevSig: sigAny(path, prevText),
    });
  }
  return { path, commits: commits.length, records, nullSnapshotCount };
}

// ── 输出 ──
function human(report, firstN) {
  const L = [];
  const records = firstN ? report.records.slice(0, firstN) : report.records;
  L.push('\u2550'.repeat(66));
  L.push(' bloat-history -- ' + report.path);
  L.push(' ' + records.length + ' 次触及（共 ' + report.commits + ' 条历史）');
  if (report.nullSnapshotCount > 0) {
    // --follow rename 前 commit 无当前路径快照，如实提示避免误导（code_review P3）
    L.push(' ⚠️  ' + report.nullSnapshotCount + ' 条 commit 快照缺失（rename 前路径不同，显示为 -）');
  }
  L.push('\u2550'.repeat(66));
  if (!records.length) { L.push('   （无记录）'); return L.join('\n'); }

  const first = records[records.length - 1];
  const last  = records[0];
  L.push('');
  L.push('① 首末快照');
  L.push('   首次出现  ' + first.commit.date + '  ' + first.commit.short + '  ' + (first.thisSig.lines || '-') + '行 ' + first.thisSig.exports + '导出/' + first.thisSig.tops + '顶层');
  L.push('   当前     ' + last.commit.date + '  ' + last.commit.short + '  ' + (last.thisSig.lines || '-') + '行 ' + last.thisSig.exports + '导出/' + last.thisSig.tops + '顶层');
  if (first.thisSig.lines && last.thisSig.lines) {
    const delta = last.thisSig.lines - first.thisSig.lines;
    L.push('   累计膨胀  ' + (delta >= 0 ? '+' : '') + delta + '行');
  }

  L.push('');
  L.push('② 跳点（单次 +30 行以上，按增量降序）');
  const jumps = [];
  for (const r of records) {
    const prevL = r.prevSig.lines;
    const thisL = r.thisSig.lines;
    if (prevL !== null && thisL !== null && (thisL - prevL) >= 30) {
      jumps.push({ inc: thisL - prevL, r });
    }
  }
  if (!jumps.length) {
    L.push('   （无显著跳点，单次增量均 <30 行）');
  } else {
    jumps.sort((a, b) => b.inc - a.inc);
    for (const j of jumps) {
      const r = j.r;
      const exInc = r.thisSig.exports - r.prevSig.exports;
      const exStr = exInc !== 0 ? ' (导出' + (exInc >= 0 ? '+' : '') + exInc + ')' : '';
      L.push('   ↗ +' + j.inc + '行' + exStr + '  ' + r.commit.date + '  ' + r.commit.short + '  ' + r.commit.author);
      L.push('       ' + r.commit.subject);
      L.push('       ' + r.prevSig.lines + '行→' + r.thisSig.lines + '行  导出 ' + r.prevSig.exports + '→' + r.thisSig.exports + '  顶层 ' + r.prevSig.tops + '→' + r.thisSig.tops);
    }
  }

  L.push('');
  // records 按 git log 顺序（新 → 旧），标题如实标注（code_review P3）
  L.push('③ 时间线（新 → 旧）');
  for (const r of records) {
    const prevL = r.prevSig.lines;
    const thisL = r.thisSig.lines;
    let deltaTag = '-';
    if (prevL !== null && thisL !== null) {
      const inc = thisL - prevL;
      deltaTag = (inc >= 0 ? '+' : '') + inc;
    }
    L.push('   ' + r.commit.date + '  ' + r.commit.short + '  ' + deltaTag.padStart(6) + '行  ' + (r.thisSig.lines || '-') + '  ' + r.commit.author);
  }
  return L.join('\n');
}

function toJ(report, firstN) {
  const records = firstN ? report.records.slice(0, firstN) : report.records;
  const out = {
    kind: 'bloat-history',
    path: report.path,
    commits: report.commits,
    first: records[records.length - 1],
    last: records[0],
    records,
    jumps: [],
  };
  for (const r of records) {
    const pL = r.prevSig.lines;
    const tL = r.thisSig.lines;
    if (pL !== null && tL !== null && (tL - pL) >= 30) {
      out.jumps.push({ inc: tL - pL, r });
    }
  }
  out.jumps.sort((a, b) => b.inc - a.inc);
  return out;
}

// ── CLI ──
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const LIMIT = Number(argv[argv.indexOf('--limit') + 1] || 30) || 30;
const FIRST_N = argv.includes('--first') ? (Number(argv[argv.indexOf('--first') + 1]) || null) : null;
// 路径解析需跳过取值选项的值（--limit N / --first N 后跟数字），
// 否则 `--limit 60 src/foo.ts` 会把 "60" 误当路径（code_review P2）
let pathArg = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--limit' || a === '--first') { i++; continue; }
  if (!a.startsWith('--')) { pathArg = a; break; }
}
if (!pathArg) {
  console.error('用法: node scripts/bloat-history.mjs <path> [--json|--limit N|--first N]');
  process.exit(2);
}
const report = collect(pathArg, LIMIT) ?? { path: pathArg, commits: 0, records: [] };
if (report.commits === 0) {
  // 情报型契约：无历史也是合法结果（空报告），不阻断、退出 0（P1 修复）
  console.error('[bloat-history] 路径无 git 历史: ' + pathArg);
}
if (JSON_OUT) {
  console.log(JSON.stringify(toJ(report, FIRST_N), null, 2));
} else {
  console.log(human(report, FIRST_N));
}
process.exit(0);
