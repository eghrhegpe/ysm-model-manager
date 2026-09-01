#!/usr/bin/env node
/**
 * 契约测试：auto-import.mjs 拆分后各层行为锁（2026-08-31 大脚本拆分基线）。
 *
 * 覆盖：
 *   1. tokenize：剥离注释/字符串/模板/正则，收集代码标识符
 *   2. extractExports：export const/function/type/block 提取
 *   3. extractDefined：const/解构/函数/参数/方法 定义收集
 *   4. extractImported：命名导入（含别名）/默认/命名空间
 *   5. checkFile：缺 import 的符号被检出、已 import/定义/全局/属性访问不误报
 *   6. run 全量扫描当前仓库：0 缺失（rc=0）——与拆分前 parity 基线一致
 *
 * 零依赖（仅 node:fs / node:path / node:child_process + 拆分模块）。
 * 运行：node tests/test_auto_import.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize } from '../scripts/auto-import-lexer.ts';
import { extractExports, extractDefined, extractImported, splitBlockEntries } from '../scripts/auto-import-symbols.ts';
import { checkFile } from '../scripts/auto-import-detect.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
function check(name, fn) {
  try {
    fn();
    console.log('✓', name);
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
    console.error('✗', name, '-', e.message);
  }
}

// ── tokenize ─────────────────────────────────────────

check('tokenize 剥离注释/字符串并收集标识符', () => {
  const { stripped, tokens } = tokenize('const a = "hello"; // note\nconst b = a;');
  assert.ok(!stripped.includes('hello'), '字符串应被剥离');
  assert.ok(!stripped.includes('note'), '注释应被剥离');
  const names = tokens.map((t) => t.name);
  assert.ok(names.includes('const') && names.includes('a') && names.includes('b'), `标识符应收集: ${names}`);
});

check('tokenize 剥离模板字面量（含插值不分析）', () => {
  const { stripped, tokens } = tokenize('const s = `hello ${world}`;');
  assert.ok(!stripped.includes('hello'), '模板字面量应被剥离');
  assert.ok(!tokens.some((t) => t.name === 'world'), '插值符号不检测（已知局限）');
});

check('tokenize 剥离正则字面量（含字符类 /）', () => {
  const { stripped, tokens } = tokenize('const re = /[\\/:*?"<>|]/;');
  assert.ok(!stripped.includes('//'), '正则字符类内 / 不应被当注释剥离');
  assert.ok(tokens.some((t) => t.name === 're'), 're 标识符应收集');
});

check('tokenize 行号定位（emoji 不破坏坐标）', () => {
  const { tokens } = tokenize('// 📦 emoji 注释\nconst x = y;');
  const yTok = tokens.find((t) => t.name === 'y');
  assert.equal(yTok.line, 2, `y 应在第 2 行，实际第 ${yTok.line} 行（UTF-16 坐标）`);
});

// ── extractExports ───────────────────────────────────

check('extractExports 提取 export const/function/type/block', () => {
  const src = [
    'export const A = 1;',
    'export function B() {}',
    'export type T = string;',
    'export interface I {}',
    'const C = 1; export { C };',
  ].join('\n');
  const syms = extractExports(src);
  const names = syms.map((s) => s.name);
  for (const n of ['A', 'B', 'T', 'I', 'C']) {
    assert.ok(names.includes(n), `应提取 ${n}，实际 ${names}`);
  }
  assert.ok(syms.find((s) => s.name === 'T').isType, 'T 应为 typeOnly');
  assert.ok(!syms.find((s) => s.name === 'A').isType, 'A 应为值导出');
});

check('extractExports 排除 re-export（export { X } from）', () => {
  const syms = extractExports('export { Foo } from "./x";');
  assert.ok(!syms.some((s) => s.name === 'Foo'), 're-export 符号不应算本文件导出');
});

check('splitBlockEntries 解析别名与 type 修饰符', () => {
  assert.deepEqual(splitBlockEntries('A, B as C, type D'), [
    { name: 'A', isType: false },
    { name: 'C', isType: false },
    { name: 'D', isType: true },
  ]);
});

// ── extractDefined ───────────────────────────────────

check('extractDefined 收集 const/解构/函数/参数/方法', () => {
  const src = [
    'const a = 1;',
    'const { b, c = 2 } = obj;',
    'function d(p1) {}',
    'const e = (f, g) => f + g;',
    'const obj = { method(h) { return h; } };',
    'type Q = string;',
  ].join('\n');
  const defs = extractDefined(src);
  for (const n of ['a', 'b', 'c', 'd', 'p1', 'e', 'f', 'g', 'method', 'h', 'Q']) {
    assert.ok(defs.has(n), `应收集定义 ${n}，实际 ${[...defs]}`);
  }
});

check('extractDefined 不收集字符串/注释内的标识符（剥离后）', () => {
  // 契约：extractDefined 消费 tokenize 剥离后的源码（checkFile 同口径）
  const { stripped } = tokenize('// const fake = 1;\nconst real = 2;');
  const defs = extractDefined(stripped);
  assert.ok(defs.has('real'), 'real 应收集');
  assert.ok(!defs.has('fake'), '注释内 fake 不应收集');
});

// ── extractImported ──────────────────────────────────

check('extractImported 收集命名/别名/默认/命名空间导入', () => {
  const src = [
    'import { A, B as BB } from "./x";',
    'import Def from "./y";',
    'import * as NS from "./z";',
  ].join('\n');
  const imp = extractImported(src);
  for (const n of ['A', 'B', 'BB', 'Def', 'NS']) {
    assert.ok(imp.has(n), `应收集导入 ${n}，实际 ${[...imp]}`);
  }
});

// ── checkFile（用构造 symbolMap）─────────────────────

/** 构造符号表：把一个符号指向一个虚拟源文件。 */
function mkSymbolMap(entries) {
  const map = new Map();
  for (const [name, { file, isType = false }] of entries) {
    map.set(name, [{ file, isType }]);
  }
  return map;
}

check('checkFile 检出缺失 import 的符号', () => {
  const dir = path.join(ROOT, 'frontend/src');
  const file = path.join(dir, 'views/app-preview/detail.ts'); // 真实存在的 .ts，仅借用路径
  const src = 'export const x = SOME_MISSING_SYMBOL;';
  // 直接喂 tokenize 结果：构造一个真实临时文件更稳
  const tmp = path.join(ROOT, 'tmp-auto-import-checkfile.ts');
  fs.writeFileSync(tmp, src);
  const map = mkSymbolMap([['SOME_MISSING_SYMBOL', { file: path.join(dir, 'utils/x.ts') }]]);
  const found = checkFile(tmp, map);
  fs.unlinkSync(tmp);
  assert.ok(found.some((f) => f.symbol === 'SOME_MISSING_SYMBOL'), `应检出 SOME_MISSING_SYMBOL，实际 ${JSON.stringify(found)}`);
  assert.ok(found[0].candidates.length === 1, '单一候选应给出 import 路径');
  assert.equal(found[0].line, 1, '行号应为 1');
});

check('checkFile 不误报：已定义/已导入/全局/属性访问', () => {
  const tmp = path.join(ROOT, 'tmp-auto-import-neg.ts');
  fs.writeFileSync(
    tmp,
    'import { ALREADY } from "./a";\nconst local = 1;\nconst r = ALREADY + local + Math.PI + obj.prop;\n'
  );
  const map = mkSymbolMap([
    ['ALREADY', { file: path.join(ROOT, 'frontend/src/a.ts') }],
    ['PROP', { file: path.join(ROOT, 'frontend/src/b.ts') }],
  ]);
  const found = checkFile(tmp, map);
  fs.unlinkSync(tmp);
  assert.deepEqual(found, [], `不应误报（已导入/定义/全局/属性访问），实际 ${JSON.stringify(found)}`);
});

// ── run 全量 parity ──────────────────────────────────

check('run 全量扫描当前仓库 0 缺失（与拆分前基线一致）', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'auto-import.ts'), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const data = JSON.parse(out);
  assert.equal(data._summary.missing, 0, `预期 0 缺失，实际 ${data._summary.missing}`);
  assert.ok(data._summary.scanned > 700, `预期扫描 >700 文件，实际 ${data._summary.scanned}`);
});

if (fails.length) {
  console.error(`\n${fails.length} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
