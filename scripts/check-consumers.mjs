#!/usr/bin/env node
/**
 * check-consumers.mjs — 符号消费者审计（孤儿导出检测）。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 扫描 frontend/js/ 下所有 .js：
 *   1. 提取每个模块的导出符号（export const/function/class/export { a, b }）
 *   2. 解析跨文件 import 消费（import { a } from / import a from）
 *   3. 统计每个导出符号的消费者数量
 *   4. 输出孤儿导出（0 消费者，WARN）+ 高频消费者 TOP
 *
 * 排除：export default（匿名单例惯用）、export ... from（re-export）、
 * 命名空间导入 import * as（无法对齐符号）。
 *
 * 用法：
 *   node scripts/check-consumers.mjs                     # 文本报告
 *   node scripts/check-consumers.mjs --json              # JSON（CI 用）
 *   node scripts/check-consumers.mjs --min-consumers 3   # 只报消费者 ≤3 的符号
 *
 * 退出码：孤儿导出 > 0 → 1；否则 0（--min-consumers 过滤后同规则）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'frontend/js');

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has('--json');
const STRICT = ARGS.has('--strict');
const minIdx = [...ARGS].indexOf('--min-consumers');
const MIN_CONSUMERS = minIdx >= 0 ? parseInt([...ARGS][minIdx + 1], 10) || 0 : 0;

// ── 模块收集 ──────────────────────────────────────────

function walk(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.') || d.name === 'node_modules') continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (d.name === 'css') continue;
      walk(p, out);
    } else if (d.name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

// ── 导出/导入解析 ─────────────────────────────────────

const EXPORT_NAMED_RE = /export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_BLOCK_RE = /export\s*\{([^}]*)\}(?!\s*from)/g;
const IMPORT_RE = /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;

function resolveImport(fromFile, spec, moduleSet) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  const base = path.dirname(fromFile);
  const candidates = [path.join(base, spec)];
  if (!path.extname(spec)) {
    candidates.push(path.join(base, `${spec}.js`), path.join(base, spec, 'index.js'));
  }
  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (moduleSet.has(resolved)) return resolved;
  }
  return null;
}

/** 提取模块导出符号（含行号）。 */
function extractExports(file, text) {
  const out = [];
  for (const m of text.matchAll(EXPORT_NAMED_RE)) {
    const line = text.slice(0, m.index).split('\n').length;
    out.push({ name: m[1], line });
  }
  for (const m of text.matchAll(EXPORT_BLOCK_RE)) {
    const line = text.slice(0, m.index).split('\n').length;
    for (const raw of m[1].split(',')) {
      const n = raw.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (n) out.push({ name: n[1], line });
    }
  }
  return out;
}

/** 提取模块消费的符号（跨文件，返回 [目标模块, 符号名] 列表）。 */
function extractImports(file, text, moduleSet) {
  const out = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const target = resolveImport(file, m[3], moduleSet);
    if (!target || target === file) continue;
    if (m[2]) {
      for (const raw of m[2].split(',')) {
        const spec = raw.trim();
        if (!spec) continue;
        const sym = spec.match(/^([A-Za-z_$][\w$]*)/);
        if (sym) out.push([target, sym[1]]);
      }
    }
  }
  // 命名空间导入 import * as ns：扫描 ns.<symbol> 用法对齐具体符号
  for (const m of text.matchAll(/\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = resolveImport(file, m[2], moduleSet);
    if (!target || target === file) continue;
    const ns = m[1];
    const useRe = new RegExp(`\\b${ns}\\.([A-Za-z_$][\\w$]*)\\b`, 'g');
    for (const u of text.matchAll(useRe)) {
      if (u[1] === 'default') continue;
      out.push([target, u[1]]);
    }
  }
  return out;
}

// ── 主流程 ────────────────────────────────────────────

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.log(JSON_OUT ? JSON.stringify({ orphan: [], error: 'frontend/js 不存在' }) : 'frontend/js 目录不存在');
    process.exit(1);
  }

  const files = walk(SRC_DIR);
  const moduleSet = new Set(files);

  // 符号 → 导出文件映射
  const symbolOwners = new Map(); // symbol → [{file, line}]
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf-8');
    for (const exp of extractExports(f, text)) {
      if (!symbolOwners.has(exp.name)) symbolOwners.set(exp.name, []);
      symbolOwners.get(exp.name).push({ file: f, line: exp.line });
    }
  }

  // 消费者计数
  const consumed = new Map(); // `${symbol}@${file}` → 消费次数
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf-8');
    for (const [target, sym] of extractImports(f, text, moduleSet)) {
      const key = `${sym}@${target}`;
      consumed.set(key, (consumed.get(key) || 0) + 1);
    }
  }

  // 汇总：每符号（按导出文件维度）消费者数
  const report = [];
  for (const [sym, owners] of symbolOwners) {
    for (const { file, line } of owners) {
      const consumers = consumed.get(`${sym}@${file}`) || 0;
      report.push({
        symbol: sym,
        file: path.relative(ROOT, file).replace(/\\/g, '/'),
        line,
        consumers,
      });
    }
  }
  const orphan = report.filter((r) => r.consumers === 0);
  const threshold = report.filter((r) => r.consumers <= MIN_CONSUMERS);
  const top = [...report].sort((a, b) => b.consumers - a.consumers).slice(0, 10);
  const flagged = MIN_CONSUMERS > 0 ? threshold : orphan;
  const fail = STRICT && flagged.length > 0;

  if (JSON_OUT) {
    console.log(JSON.stringify({ symbols: report.length, orphan, top, minConsumers: MIN_CONSUMERS, flagged, strict: STRICT }, null, 2));
    process.exit(fail ? 1 : 0);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' 符号消费者审计 (check-consumers)');
  console.log('══════════════════════════════════════');
  console.log(`模块数   : ${files.length}`);
  console.log(`导出符号 : ${report.length}（含多文件同名导出）`);
  console.log(`孤儿导出 : ${orphan.length}`);
  console.log(`模式     : ${STRICT ? 'STRICT（孤儿阻断）' : '审计（孤儿仅报告，加 --strict 阻断）'}`);
  console.log('──────────────────────────────────────');

  if (orphan.length) {
    console.log('\n【孤儿导出（0 消费者）】');
    for (const r of orphan.slice(0, 40)) {
      console.log(`  ⚠ ${r.file}:${r.line}  ${r.symbol}`);
    }
    if (orphan.length > 40) console.log(`  … 其余 ${orphan.length - 40} 条（--json 全量）`);
  }

  if (top.length) {
    console.log('\n【TOP 消费者】');
    for (const r of top) {
      console.log(`  ${String(r.consumers).padStart(3)}  ${r.symbol}  ← ${r.file}`);
    }
  }

  if (fail) {
    console.log(`\n退出码 1（${flagged.length} 个符号消费者 ${MIN_CONSUMERS > 0 ? `≤ ${MIN_CONSUMERS}` : '= 0'}，--strict 阻断）。`);
    process.exit(1);
  }
  console.log(flagged.length ? `\n（审计模式不阻断，--strict 可升级为 ERROR）` : '\n✅ 无孤儿导出。');
}

main();
