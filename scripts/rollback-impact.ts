#!/usr/bin/env node
/**
 * rollback-impact.ts — revert 影响面分析（audit-split 的逆向镜像）。
 *
 * 设计意图：audit-split 告诉你"这次拆分把函数搬到了哪里"（前瞻）；本工具
 * 告诉你"revert 这个 commit 之后，当前 HEAD 还有哪些调用方会断链"（逆向）。
 * 对给定 commit，逆向跑一遍 funcMigration：
 *   1. 找出在该 commit 被"删除"的顶层声明（文件整体消失 或 符号被移除）；
 *   2. 扫描当前 HEAD 的源码，找出仍在引用这些被删符号的调用方；
 *   3. 输出：revert 之后会炸什么。
 *
 * 与 audit-split 共用一套"顶层声明提取"逻辑（goTopFuncs / tsTopDecls），
 * 保持"保留/搬家/真删"口径一致（详见 audit-split.ts:140-171 注释）。
 *
 * 依赖：scripts/_lib/{git-ref,source-graph,scan-files}.mjs（零外部依赖）。
 *
 * 用法：
 *   node scripts/rollback-impact.ts <commit>                    # 默认扫描 go/ + frontend/src/
 *   node scripts/rollback-impact.ts <commit> --scope frontend/  # 限定扫描范围
 *   node scripts/rollback-impact.ts <commit> --json             # JSON（供子代理/CI 消费）
 *   node scripts/rollback-impact.ts <commit> --quiet            # 无调用方时静默（不报"无影响"）
 *
 * 退出码：0（无论有无影响）。情报型工具，不阻断任何流程。
 */
import fs from 'node:fs';
import path from 'node:path';
import { showAt, gitMaybe } from './_lib/git-ref.ts';
import { getExportedSymbolsAny, topDeclsAny, searchName } from './_lib/source-graph.ts';
import { walk, ROOT, toPosix } from './_lib/scan-files.ts';
import { parseArgs } from './_lib/parse-args.ts';

function analyze(commit: string) {
  const parent = commit + '^';
  // 注意：`git diff --name-only parent commit` 不带 `--` 在 ref 前，
  // 否则 parent/commit 会被当成路径 spec 处理，返回空。
  const modified = (gitMaybe(['diff', '--name-only', parent, commit]) || '').trim().split('\n').filter(Boolean);
  const parents: Record<string, any> = {}, news: Record<string, any> = {}, parentExps: Record<string, any> = {};
  for (const p of modified) {
    const pt = showAt(parent, p);
    const nt = showAt(commit, p);
    if (pt !== null) { parents[p] = new Set(topDeclsAny(p, pt)); parentExps[p] = new Set(getExportedSymbolsAny(p, pt)); }
    if (nt !== null) news[p] = new Set(topDeclsAny(p, nt));
  }
  const removed: { sym: any; file: string; wasExport: any }[] = [];
  for (const p of modified) {
    const old = parents[p]; if (!old) continue;
    const nw = news[p];
    for (const sym of old) {
      if (!nw || !nw.has(sym)) removed.push({ sym, file: p, wasExport: parentExps[p] && parentExps[p].has(sym) });
    }
  }
  return { commit, removed };
}

function scanCallers(searchTerms: string[], scope: string) {
  const callers = new Map();
  const scanDirs: string[] = [];
  if (scope) {
    const abs = fs.existsSync(scope) ? scope : ROOT + '/' + scope;
    if (fs.existsSync(abs)) scanDirs.push(abs);
  } else { scanDirs.push(ROOT + '/go'); scanDirs.push(ROOT + '/frontend/src'); }
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.go'];
  // 跳过 test/spec 文件；正则用 \b 边界匹配（避免 partial-match）
  const skipFileRe = /\.(test|spec)\.[jt]sx?$/;
  for (const sd of scanDirs) {
    if (!fs.existsSync(sd)) continue;
    for (const f of walk(sd, { exts, skipFile: (n) => skipFileRe.test(n) })) {
      if (typeof f !== 'string') continue;
      let text;
      try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      for (const sym of searchTerms) {
        const nm = searchName(sym);
        const escaped = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('\\b' + escaped + '\\b', 'g');
        if (re.test(text)) {
          let arr = callers.get(sym);
          if (!arr) { arr = []; callers.set(sym, arr); }
          arr.push(toPosix(path.relative(ROOT, f)));
        }
      }
    }
  }
  return callers;
}

function human(result: any, quiet: boolean) {
  const L: string[] = [];
  L.push('\u2550'.repeat(66));
  L.push(' rollback-impact -- ' + result.commit);
  L.push(' revert 该 commit 会移除 ' + result.removed.length + ' 个顶层声明');
  L.push('\u2550'.repeat(66));
  if (!result.removed.length) {
    if (!quiet) L.push('   ✅ 无删除符号，revert 安全');
    return L.join('\n');
  }
  L.push('');
  L.push('① 被删符号清单');
  for (const r of result.removed) {
    const tag = r.wasExport ? '导出' : '私有';
    L.push('   ✗ [' + tag + '] ' + r.sym + '  （来自 ' + r.file + '）');
  }
  L.push('');
  L.push('② 当前 HEAD 中的潜在断链调用方');
  let total = 0;
  for (const r of result.removed) {
    const list = result.callers.get(r.sym) || [];
    if (!list.length) { L.push('   ✓ ' + r.sym + '  （当前无引用）'); continue; }
    total += list.length;
    L.push('   ✗ ' + r.sym + '  （' + list.length + ' 处引用）');
    for (const c of list.slice(0, 8)) L.push('       ↳ ' + c);
    if (list.length > 8) L.push('       ... 以及 ' + (list.length - 8) + ' 处');
  }
  L.push('');
  L.push('③ 综合结论');
  if (total === 0) L.push('   ✅ 当前无调用方引用被删符号，revert 安全');
  else L.push('   ⚠️  共 ' + total + ' 处调用方可能断链；revert 前请先更新这些调用方');
  return L.join('\n');
}

function toJ(result: any) {
  const callersMap: Record<string, string[]> = {};
  for (const r of result.removed) callersMap[r.sym] = result.callers.get(r.sym) || [];
  let total = 0;
  for (const v of Object.values(callersMap)) total += v.length;
  return { kind: 'rollback-impact', commit: result.commit, removed: result.removed, callers: callersMap, totalCallers: total, safe: total === 0 };
}

const args = parseArgs(process.argv.slice(2), { bools: ['json', 'quiet'], strings: ['scope'] });
if (args.unknown.length) {
  console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
  process.exit(2);
}
const JSON_OUT = args.json;
const QUIET = args.quiet;
const SCOPE = args.scope;
const commitArg = args._[0];
if (!commitArg) {
  console.error('用法: node scripts/rollback-impact.ts <commit> [--scope <dir>] [--json|--quiet]');
  process.exit(2);
}
const result = analyze(commitArg) as { commit: string; removed: { sym: any; file: string; wasExport: any }[]; callers: Map<string, string[]> };
if (result.removed.length) result.callers = scanCallers(result.removed.map((r) => r.sym), SCOPE as string);
else result.callers = new Map();
if (JSON_OUT) console.log(JSON.stringify(toJ(result), null, 2));
else console.log(human(result, QUIET as boolean));
process.exit(0);
