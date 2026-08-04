#!/usr/bin/env node
/**
 * check-orphan-exports.mjs — 孤儿导出检测（零消费者符号审计）。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 扫描 frontend/js/ 下所有 .js/.ts（ADR-014 后 TS 与 JS 并存）：
 *   1. 提取每个模块的导出符号（export const/function/class/export { a, b }）
 *   2. 解析跨文件 import 消费（import { a } from / import a from）
 *   3. 统计每个导出符号的消费者数量
 *   4. 输出孤儿导出（0 消费者，WARN）+ 高频消费者 TOP
 *
 * 排除：export default（匿名单例惯用）、export ... from（re-export）、
 * 命名空间导入 import * as（无法对齐符号）。
 *
 * 注：与联邦 MikuMikuAR 的 check-consumers（符号反向查询 / 重构影响面）同名异实，
 * 故独立命名为 check-orphan-exports 以消除歧义（ADR-241 §Phase 2）。
 *
 * 用法：
 *   node scripts/check-orphan-exports.mjs                     # 文本报告
 *   node scripts/check-orphan-exports.mjs --json              # JSON（CI 用）
 *   node scripts/check-orphan-exports.mjs --min-consumers 3   # 只报消费者 ≤3 的符号
 *
 * 退出码：孤儿导出 > 0 → 1；否则 0（--min-consumers 过滤后同规则）。
 * 设计意图：孤儿导出检测（0 消费者的导出符号）
 */
import fs from 'node:fs';
import { SRC_DIR, walk, resolveImport, relPosix } from './_lib/scan-files.mjs';

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has('--json');
const STRICT = ARGS.has('--strict');
const minIdx = [...ARGS].indexOf('--min-consumers');
const MIN_CONSUMERS = minIdx >= 0 ? parseInt([...ARGS][minIdx + 1], 10) || 0 : 0;

// ── 导出/导入解析 ─────────────────────────────────────

const EXPORT_NAMED_RE = /export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_BLOCK_RE = /export\s*\{([^}]*)\}(?!\s*from)/g;
const IMPORT_RE = /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;

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

// 动态导入：await import("...") 的两种命名解构形式
const DYN_DESTRUCT_RE = /(?:const|let|var)\s*\{\s*([^}]*?)\s*\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g;
const THEN_DESTRUCT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)\.then\(\s*\(\s*\{\s*([^}]*?)\s*\}\s*\)/g;

/**
 * 解析动态导入规格（同 resolveImport，多一次 .js → .ts 回退）。
 * TS 源文件常被 `import("./x.js")` 引用（binding 的 .js 风格），磁盘是 .ts。
 */
function resolveDynImport(file, spec, moduleSet) {
  let target = resolveImport(file, spec, moduleSet);
  if (!target && spec.endsWith('.js')) {
    target = resolveImport(file, spec.slice(0, -3) + '.ts', moduleSet);
  }
  return target;
}

/** 提取模块消费的符号（跨文件，返回 [目标模块, 符号名] 列表）。 */
function extractImports(file, text, moduleSet) {
  const out = [];
  const pushNamed = (target, rawList) => {
    for (const raw of rawList.split(',')) {
      const sym = raw.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (sym) out.push([target, sym[1]]);
    }
  };
  for (const m of text.matchAll(IMPORT_RE)) {
    const target = resolveImport(file, m[3], moduleSet);
    if (!target || target === file) continue;
    if (m[2]) pushNamed(target, m[2]);
  }
  // 动态导入：const { a, b } = await import("spec")
  for (const m of text.matchAll(DYN_DESTRUCT_RE)) {
    const target = resolveDynImport(file, m[2], moduleSet);
    if (!target || target === file) continue;
    pushNamed(target, m[1]);
  }
  // 动态导入：import("spec").then(({ a, b }) => ...)
  for (const m of text.matchAll(THEN_DESTRUCT_RE)) {
    const target = resolveDynImport(file, m[1], moduleSet);
    if (!target || target === file) continue;
    pushNamed(target, m[2]);
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
        file: relPosix(file),
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
    console.log(JSON.stringify({ _summary: { symbols: report.length, orphan: orphan.length, flagged: flagged.length }, symbols: report.length, orphan, top, minConsumers: MIN_CONSUMERS, flagged, strict: STRICT }, null, 2));
    process.exit(fail ? 1 : 0);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' 孤儿导出检测 (check-orphan-exports)');
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
