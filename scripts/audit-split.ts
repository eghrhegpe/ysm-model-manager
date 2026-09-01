#!/usr/bin/env node
/**
 * audit-split.ts — 拆分/重构提交审计工具（主动情报型）。
 *
 * 设计意图：把「AI 手打 40+ 条 pwsh 指令审计 refactor 提交」的固定套路固化为一条口令：
 *   提交概览（文件/±行数）→ 文件分类（被拆主文件/新子文件/边角修改）→ 行数统计 +
 *   ADR-040 ≤400 红线 → 函数级迁移（旧导出符号去哪了：保留/搬家/真删）→ 新文件入口
 *   导出清单 → 受影响文件历史提交。与防御型 check-*（fail-closed 门禁）不同，这是
 *   情报型（proactive audit）：输出洞察供 AI/人直接消费，不阻断任何流程。
 *
 * 依赖：scripts/_lib/{source-graph,git-ref,parse-args}.ts（零外部依赖）
 * 用法：
 *   node scripts/audit-split.ts <commit>            # 审计单次提交（人读文本）
 *   node scripts/audit-split.ts <commit> --json     # 机读 JSON（供子代理/CI 消费）
 *   node scripts/audit-split.ts <commit> --redline  # 仅红线 ≤400 校验（违反退出码 1）
 *   node scripts/audit-split.ts <commit> --compact  # 摘要模式：迁移/新文件明细折叠为计数 + 头部若干条
 * 退出码：0 审计成功；--redline 且存在 >400 行文件 → 1；缺参/commit 无效 → 2（其余 0）。
 */
import { getExportedSymbolsAny, topDeclsAny, countLines } from './_lib/source-graph.ts';
import { gitMaybe, showAt as gitShowAt, existsAt as gitExistsAt } from './_lib/git-ref.ts';
import { parseArgs } from './_lib/parse-args.ts';

// ADR-040：拆分后每文件 ≤400 行
const REDLINE = 400;

// ── git 访问（共享层 _lib/git-ref；此处只加结果缓存）──
// funcMigration / removedFileTrace / 主循环会对同一 (ref,path) 重复 showAt
// （N 个主文件 × M 个路径次 spawn），缓存后每 (ref,path) 只 git show 一次。
const showCache = new Map();
const existsCache = new Map();
function showAt(ref: string, path: string) {
  const k = `${ref}\u0000${path}`;
  if (!showCache.has(k)) showCache.set(k, gitShowAt(ref, path));
  return showCache.get(k);
}
function existsAt(ref: string, path: string) {
  const k = `${ref}\u0000${path}`;
  if (!existsCache.has(k)) existsCache.set(k, gitExistsAt(ref, path));
  return existsCache.get(k);
}

// ── 提交信息 ──

function commitMeta(ref: string) {
  const fmt = '%H%x09%h%x09%an%x09%ad%x09%s';
  const line = (gitMaybe(['show', '-s', `--format=${fmt}`, '--date=short', ref]) || '').trim();
  if (!line) return null;
  const [hash, short, author, date, ...rest] = line.split('\t');
  return { hash, short, author, date, subject: rest.join('\t') };
}

/** numstat 解析文件清单：adds	dels	path（--no-renames 防 rename 花括号污染）。 */
function fileList(commit: string) {
  const out = (gitMaybe(['show', '--numstat', '--format=', '--no-renames', commit]) || '').trim();
  if (!out) return [];
  return out.split('\n').map((l) => {
    const [adds, dels, ...rest] = l.split('\t');
    const path = rest.join('\t').trim();
    if (!path) return null;
    return {
      path,
      insertions: adds === '-' ? null : Number(adds),
      deletions: dels === '-' ? null : Number(dels),
      binary: adds === '-',
    };
  }).filter(Boolean);
}

// ── 分类：被拆主文件 / 新子文件 / 被移文件 / 边角修改 ──

/** 重命名检测：--find-renames 输出形如 `0\t0\tfrontend/src/{wails => backend}/app.ts`。 */
function detectRenames(commit: string) {
  const out = gitMaybe(['show', '--numstat', '--format=', '--find-renames', commit]) || '';
  const renames: { from: string; to: string }[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\d+\t\d+\t(.+)$/);
    if (!m) continue;
    const rm = m[1]!.match(/\{(.+?) => (.+?)\}/);
    if (rm) renames.push({ from: rm[1]!, to: rm[2]! });
  }
  return renames;
}

function classify(files: any[], commit: string, renameFroms: Set<string>) {
  const mainThreshold = 80; // 删除 ≥80 行才视为「被拆主文件」
  for (const f of files) {
    if (f.binary) { f.kind = 'binary'; continue; }
    const after = existsAt(commit, f.path);
    if (!after && f.deletions > 0) {
      // 提交后不存在：纯删除文件；若同时在 rename from 侧则是改名（0 0 纯改名
      // 不会进 removed——insertions/deletions 均 0，但 --no-renames 下可能列出，用 from 集排除）
      f.kind = renameFroms.has(f.path) ? 'renamed-away' : 'removed';
      continue;
    }
    const before = existsAt(`${commit}^`, f.path);
    if (!before) { f.kind = 'new'; continue; }
    f.kind = (f.deletions >= mainThreshold && f.deletions > f.insertions) ? 'split-main' : 'modified';
  }
  return files;
}

/** 被移除文件的符号去向追踪：旧顶层声明 → 合入哪个文件 / 彻底删除。 */
function removedFileTrace(commit: string, rmPath: string, allPaths: string[]) {
  const oldText = showAt(`${commit}^`, rmPath);
  if (oldText === null) return { syms: [], merged: {}, gone: [] };
  const oldAll = topDeclsAny(rmPath, oldText) as string[];
  const fileSyms = new Map();
  for (const p of allPaths) {
    const t = showAt(commit, p);
    fileSyms.set(p, t === null ? new Set() : new Set(topDeclsAny(p, t)));
  }
  const merged: Record<string, any> = {}, gone: any[] = [];
  for (const sym of oldAll) {
    let where = null;
    for (const [p, s] of fileSyms) if (s.has(sym)) { where = p; break; }
    if (where) merged[sym] = where;
    else gone.push(sym);
  }
  return { syms: oldAll, merged, gone };
}

// ── 函数级迁移：旧导出符号 → 保留/搬家/真删 ──
// 顶层声明提取（导出+私有）统一走 _lib/source-graph.ts 的 topDeclsAny：
// Go 拆分通常把私有实现搬去子文件、导出符号留壳，
// 只追导出符号会漏掉真正去向，故迁移追踪用全量顶层声明口径。

/** 单文件真删洞察：旧顶层声明 - 新顶层声明（死代码清理/改名收敛场景），无被拆主文件也可用。 */
function deletedSyms(commit: string, path: string) {
  const oldText = showAt(`${commit}^`, path);
  const newText = showAt(commit, path);
  if (oldText === null || newText === null) return [];
  const oldAll = new Set(topDeclsAny(path, oldText));
  const newAll = new Set(topDeclsAny(path, newText));
  const oldExp = getExportedSymbolsAny(path, oldText);
  return [...oldAll].filter((s) => !newAll.has(s))
    .map((s) => ({ name: s, wasExport: oldExp.includes(s) }));
}

function funcMigration(commit: string, mainPath: string, allPaths: string[]) {
  const oldText = showAt(`${commit}^`, mainPath);
  const oldAll: string[] = oldText ? (topDeclsAny(mainPath, oldText) as string[]) : [];
  const oldExp: string[] = oldText ? (getExportedSymbolsAny(mainPath, oldText) as string[]) : [];
  const fileAll = new Map(); // path -> Set(顶层声明)
  const fileExp = new Map(); // path -> Set(导出符号)
  for (const p of allPaths) {
    const t = showAt(commit, p);
    const empty = new Set();
    if (t === null) { fileAll.set(p, empty); fileExp.set(p, empty); continue; }
    fileAll.set(p, new Set(topDeclsAny(p, t)));
    fileExp.set(p, new Set(getExportedSymbolsAny(p, t)));
  }
  const mainNew = fileAll.get(mainPath) ?? new Set();
  const kept: string[] = [], moved: Record<string, any> = {}, deleted: any[] = [];
  for (const sym of oldAll) {
    if (mainNew.has(sym)) { kept.push(sym); continue; } // 留在主文件（壳）
    let where = null, exported = false;
    for (const [p, s] of fileAll) {
      if (p === mainPath) continue; // 已确认不在主文件，只看子文件
      if (s.has(sym)) { where = p; exported = fileExp.get(p)?.has(sym) ?? false; break; }
    }
    if (where) moved[sym] = { to: where, exported, wasExport: oldExp.includes(sym) };
    else deleted.push({ name: sym, wasExport: oldExp.includes(sym) });
  }
  return { kept, moved, deleted, oldAll: oldAll.length, oldExports: oldExp.length };
}

// ── 输出──

/** audit() 成功分支的返回形状（human 消费）。 */
interface AuditReport {
  kind: string;
  commit: { hash: string; short: string; author: string; date: string; subject: string };
  files: any[];
  totalIns: number;
  totalDel: number;
  renames: Array<{ from: string; to: string }>;
  migrations: Record<string, any>;
  cleans: Record<string, Array<{ name: string; wasExport: boolean }>>;
  removals: Record<string, any>;
  newExports: Record<string, any>;
  redline: { limit: number; max: number; over: any[] };
  history: Record<string, any>;
}

function human(report: AuditReport, compact = false) {
  const c = report.commit;
  const L: string[] = [];
  L.push('═'.repeat(66));
  L.push(` audit-split —— ${c.short} ${c.subject}`);
  L.push(` (${c.author} · ${c.date})  ${report.files.length} 文件, +${report.totalIns}/-${report.totalDel}`);
  L.push('═'.repeat(66));

  L.push('');
  L.push('① 文件清单与分类');
  for (const f of report.files) {
    const ins = f.insertions ?? 'Bin', del = f.deletions ?? 'Bin';
    const tag = f.kind === 'split-main' ? '拆' : f.kind === 'new' ? '新' : f.kind === 'removed' ? '删' : f.kind === 'renamed-away' ? '名' : f.kind === 'binary' ? '二' : '改';
    const lines = f.linesAtCommit ?? '-';
    const col = f.path.length > 45 ? f.path : f.path.padEnd(45);
    L.push(`   [${tag}] ${col}  ${String(ins).padStart(4)}+/${String(del).padStart(4)}-  ${String(lines).padStart(4)}行`);
  }

  L.push('');
  L.push('② 函数级迁移（旧导出符号去向）');
  const mains = report.files.filter((f) => f.kind === 'split-main');
  if (!mains.length) {
    L.push('   （无被拆主文件，跳过）');
  }
  for (const m of mains) {
    const mg = report.migrations[m.path];
    const mv = Object.entries(mg.moved as Record<string, any>);
    L.push(`   ▸ ${m.path}  顶层声明 ${mg.oldAll}（导出 ${mg.oldExports}）→ 保留 ${mg.kept.length} · 搬家 ${mv.length} · 真删 ${mg.deleted.length}`);
    const mvShown = compact ? mv.slice(0, 5) : mv;
    for (const [sym, info] of mvShown) {
      const tag = info.exported ? '导出' : '私有';
      L.push(`       ↳ [${tag}] ${sym}  →  ${info.to}`);
    }
    if (compact && mv.length > 5) L.push(`       …其余 ${mv.length - 5} 条去向（--json 全量）`);
    for (const d of mg.deleted) {
      const tag = d.wasExport ? '导出' : '私有';
      L.push(`       ✗ [${tag}] ${d.name}  （彻底删除）`);
    }
  }
  const cleans = Object.entries(report.cleans);
  if (cleans.length) {
    L.push('');
    L.push('②b 修改文件清理洞察（本文件内真删的顶层声明）');
    for (const [p, list] of cleans) {
      if (compact) {
        L.push(`   ▸ ${p}  真删 ${list.length} 个（--json 全量）`);
      } else {
        const tags = list.map((d) => `[${d.wasExport ? '导出' : '私有'}] ${d.name}`);
        L.push(`   ▸ ${p}  真删 ${list.length} 个 — ${tags.join(', ')}`);
      }
    }
  }

  const newFiles = report.files.filter((f) => f.kind === 'new');
  if (newFiles.length) {
    L.push('');
    L.push('③ 新文件入口（导出符号）');
    for (const n of newFiles) {
      const ex = report.newExports[n.path] || [];
      const detail = compact ? `导出 ${ex.length} 个` : (ex.length ? ex.join(', ') : '—');
      L.push(`   ▸ ${n.path}  (${n.linesAtCommit}行) ${detail}`);
    }
  }

  const removedEntries = Object.entries(report.removals as Record<string, any>);
  if (removedEntries.length) {
    L.push('');
    L.push('②c 删除文件追踪（本次移除的文件 — 符号合入去向）');
    for (const [p, tr] of removedEntries) {
      const mergedN = Object.keys(tr.merged).length;
      L.push(`   ▸ ${p}  顶层声明 ${tr.syms.length} → 合入 ${mergedN} · 彻底删除 ${tr.gone.length}`);
      if (!compact) {
        for (const [sym, to] of Object.entries(tr.merged)) L.push(`       ↳ ${sym}  →  ${to}`);
        for (const sym of tr.gone) L.push(`       ✗ ${sym}  （彻底删除）`);
      }
    }
  }
  if (report.renames.length) {
    L.push('');
    L.push(`②d 重命名检测（${report.renames.length} 对）`);
    const shown = compact ? report.renames.slice(0, 10) : report.renames;
    for (const r of shown) L.push(`   ▸ ${r.from}  →  ${r.to}`);
    if (compact && report.renames.length > 10) L.push(`   …其余 ${report.renames.length - 10} 对（--json 全量）`);
  }

  L.push('');
  L.push('④ 红线 ADR-040（拆分后 ≤400 行）');
  if (report.redline.over.length) {
    for (const o of report.redline.over) {
      const note = o.kind === 'split-main' ? '（[拆]主文件残留，ADR-040 目标为拆分后新文件 ≤400，残留属下一轮瘦身待办）' : '';
      L.push(`   ✗ ${o.path}  ${o.lines} 行 > 400 ${note}`);
    }
  } else {
    L.push(`   ✅ 全部合规（本提交涉及文件最大 ${report.redline.max} 行）`);
  }

  L.push('');
  L.push('⑤ 受影响文件历史提交（拆/新/移除文件，各至多 5 条）');
  const auditFiles = [...mains, ...newFiles, ...report.files.filter((f) => f.kind === 'removed' || f.kind === 'renamed-away')];
  for (const f of auditFiles) {
    const h = report.history[f.path] || [];
    L.push(`   ▸ ${f.path}`);
    for (const line of h) L.push(`       ${line}`);
  }
  return L.join('\n');
}

// ── 主流程 ──

function audit(commit: string): any {
  const meta = commitMeta(commit);
  if (!meta) return { error: `commit 无效: ${commit}` };
  const renames = detectRenames(commit);
  const renameFroms = new Set(renames.map((r) => r.from));
  const files = classify(fileList(commit), commit, renameFroms);
  const totalIns = files.reduce((s, f) => s + (f.insertions ?? 0), 0);
  const totalDel = files.reduce((s, f) => s + (f.deletions ?? 0), 0);
  const paths = files.map((f) => f.path);

  const migrations: Record<string, any> = {};
  const cleans: Record<string, any> = {};
  const removals: Record<string, any> = {};
  const newExports: Record<string, any> = {};
  const history: Record<string, any> = {};
  const over: any[] = [];
  let max = 0;
  for (const f of files) {
    f.linesAtCommit = f.binary ? null : countLines(showAt(commit, f.path));
    if (!f.binary && f.linesAtCommit !== null) {
      max = Math.max(max, f.linesAtCommit);
      if (f.linesAtCommit > REDLINE) over.push({ path: f.path, lines: f.linesAtCommit, kind: f.kind });
    }
    if (f.kind === 'split-main') migrations[f.path] = funcMigration(commit, f.path, paths);
    else if (f.kind === 'modified') {
      const d = deletedSyms(commit, f.path);
      if (d.length) cleans[f.path] = d;
    }
    if (f.kind === 'removed') removals[f.path] = removedFileTrace(commit, f.path, paths);
    if (f.kind === 'new') {
      const t = showAt(commit, f.path);
      newExports[f.path] = t ? getExportedSymbolsAny(f.path, t) : [];
    }
    if (f.kind === 'split-main' || f.kind === 'new') {
      const log = gitMaybe(['log', '--oneline', '-5', '--', f.path]);
      history[f.path] = log ? log.trim().split('\n').filter(Boolean) : [];
    }
  }

  return {
    kind: 'audit-split',
    commit: meta,
    files,
    totalIns,
    totalDel,
    renames,
    migrations,
    cleans,
    removals,
    newExports,
    redline: { limit: REDLINE, max, over },
    history,
  };
}

// ── CLI ──

const args = parseArgs(process.argv.slice(2), { bools: ['json', 'redline', 'compact'] });
if (args.help) {
  console.log('用法: node scripts/audit-split.ts <commit> [--json|--redline|--compact]');
  process.exit(0);
}
if (args.unknown.length) {
  console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
  process.exit(2);
}
const { json, redlineOnly, compact, commitArg } = {
  json: args.json,
  redlineOnly: args.redline,
  compact: args.compact as boolean,
  // 位置参数：沿用旧口径排除 `..`/`..` 开头（commit range `a..b` 走 --redline 等场景外的裸参误判防御）
  commitArg: args._.find((a) => !a.endsWith('..') && !a.startsWith('..')),
};

if (!commitArg) {
  console.error('用法: node scripts/audit-split.ts <commit> [--json|--redline]（--help 查看用法）');
  process.exit(2);
}

const report = audit(commitArg);
if (report.error) {
  console.error(report.error);
  process.exit(2);
}

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(human(report, compact));
}
if (redlineOnly && report.redline!.over.length) process.exit(1);
process.exit(0);
