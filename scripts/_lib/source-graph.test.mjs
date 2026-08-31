import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  goTopFuncs,
  tsTopDecls,
  topDeclsAny,
  getGoExportedSymbols,
  getExportedSymbols,
  getExportedSymbolsAny,
  parseSourceImports,
  searchName,
  countLines,
} from './source-graph.ts';

// ── Go 顶层声明：goTopFuncs（导出+私有全量）──

test('goTopFuncs 提取 func / 方法 / type / const / var', () => {
  const src = [
    'package x',
    'type Foo struct{ A int }',
    'const Bar = 1',
    'var Baz = 2',
    'func DoThing() {}',
    'func (f *Foo) Method() {}',
    '',
  ].join('\n');
  assert.deepEqual(goTopFuncs(src), ['Bar', 'Baz', 'DoThing', 'Foo', 'Foo.Method']);
});

test('goTopFuncs 提取分组声明块成员（const/var/type 括号块）', () => {
  const src = [
    'package x',
    'const (',
    '\tAlpha = 1',
    '\tbeta  = 2',
    ')',
    'var (',
    '\tGamma string',
    '\tdelta int',
    ')',
    'type (',
    '\tEpsilon struct{}',
    '\tzetaAlias = int',
    ')',
    '',
  ].join('\n');
  const got = goTopFuncs(src);
  assert.deepEqual(got, ['Alpha', 'Epsilon', 'Gamma', 'beta', 'delta', 'zetaAlias']);
});

test('goTopFuncs 不提取注释里的 func / 块注释里的 func', () => {
  const src = [
    'package x',
    '// func Ghost( 已废弃',
    '/*',
    'func Phantom(',
    '*/',
    'func Real() {}',
    '',
  ].join('\n');
  assert.deepEqual(goTopFuncs(src), ['Real']);
});

test('goTopFuncs 私有符号也保留（与 getGoExportedSymbols 的导出口径区分）', () => {
  const src = 'package x\nfunc privateFn() {}\ntype privateT struct{}\n';
  assert.deepEqual(goTopFuncs(src), ['privateFn', 'privateT']);
});

test('goTopFuncs 泛型接收者回退裸方法名', () => {
  const src = 'package x\nfunc (r *Foo[T]) Do() {}\n';
  assert.deepEqual(goTopFuncs(src), ['Foo.Do']);
});

// ── Go 导出符号：getGoExportedSymbols ──

test('getGoExportedSymbols 仅保留首字母大写的导出符号', () => {
  const src = 'package x\nfunc Exported() {}\nfunc unexported() {}\ntype PubT struct{}\ntype privT struct{}\n';
  assert.deepEqual(getGoExportedSymbols('x.go', src), ['Exported', 'PubT']);
});

test('getGoExportedSymbols 不提取注释里的 func', () => {
  const src = 'package x\n// func Ghost( 已废弃\nfunc Real() {}\n';
  assert.deepEqual(getGoExportedSymbols('x.go', src), ['Real']);
});

// ── TS 顶层声明：tsTopDecls（导出+私有全量）──

test('tsTopDecls 提取 function/class/interface/type/enum + const/let', () => {
  const src = [
    'export const zeta = 1;',
    'export function alpha() {}',
    'const mid = 2;',
    'function beta() {}',
    'class Klass {}',
    'interface Iface { a: number }',
    'type Alias = string;',
    'enum Color { R }',
    '',
  ].join('\n');
  assert.deepEqual(tsTopDecls(src), ['Alias', 'Color', 'Iface', 'Klass', 'alpha', 'beta', 'mid', 'zeta']);
});

test('tsTopDecls 支持 export default class / async function', () => {
  const src = [
    'export default class Widget {}',
    'export default async function daf() {}',
    '',
  ].join('\n');
  assert.deepEqual(tsTopDecls(src), ['Widget', 'daf']);
});

test('tsTopDecls 支持 declare 声明', () => {
  const src = [
    'export declare function declFn(): void;',
    'declare const gVar: number;',
    '',
  ].join('\n');
  assert.deepEqual(tsTopDecls(src), ['declFn', 'gVar']);
});

test('tsTopDecls：const enum 取 enum 后的名字，不把 enum 当符号', () => {
  const src = 'export const enum E { A }\n';
  assert.deepEqual(tsTopDecls(src), ['E']);
});

test('tsTopDecls 支持解构声明 const { a, b } = obj', () => {
  const src = 'export const { p1, p2 } = obj;\n';
  assert.deepEqual(tsTopDecls(src), ['p1', 'p2']);
});

test('tsTopDecls 支持 export { a, b as c } 重新导出', () => {
  const src = 'const a = 1;\nconst b = 2;\nexport { a, b as c };\n';
  assert.deepEqual(tsTopDecls(src), ['a', 'b', 'c']);
});

// ── TS 导出符号：getExportedSymbols ──

test('getExportedSymbols：const enum 不把 enum 误当符号名', () => {
  const src = 'export const enum E { A }\n';
  assert.deepEqual(getExportedSymbols('x.ts', src), ['E']);
});

test('getExportedSymbols 覆盖 export default function/class', () => {
  const src = 'export default class Widget {}\nexport default async function daf() {}\n';
  assert.deepEqual(getExportedSymbols('x.ts', src), ['Widget', 'daf']);
});

test('getExportedSymbols 覆盖 export { a as b }', () => {
  const src = 'const a = 1;\nexport { a as b };\n';
  assert.deepEqual(getExportedSymbols('x.ts', src), ['b']);
});

// ── 分派与排序稳定性 ──

test('topDeclsAny 按扩展名分派：.go → goTopFuncs，其余 → tsTopDecls', () => {
  assert.deepEqual(topDeclsAny('a.go', 'package x\nfunc A() {}\n'), ['A']);
  assert.deepEqual(topDeclsAny('a.ts', 'function A() {}\n'), ['A']);
});

test('getExportedSymbolsAny 按扩展名分派', () => {
  assert.deepEqual(getExportedSymbolsAny('a.go', 'package x\nfunc A() {}\nfunc b() {}\n'), ['A']);
  assert.deepEqual(getExportedSymbolsAny('a.ts', 'export const A = 1;\nconst b = 2;\n'), ['A']);
});

test('顶层声明提取结果排序稳定（不依赖正则分组拼接顺序）', () => {
  const src = 'export const zeta = 1;\nexport function alpha() {}\nconst mid = 2;\nfunction beta() {}\n';
  const first = tsTopDecls(src);
  const second = tsTopDecls(src.split('\n').reverse().join('\n'));
  assert.deepEqual(first, ['alpha', 'beta', 'mid', 'zeta']);
  assert.deepEqual(second, ['alpha', 'beta', 'mid', 'zeta']);
});

// ── parseSourceImports ──

/** 建临时源码目录，返回 { dir, cleanup }。 */
function tmpSrc(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-test-'));
  for (const [name, content] of Object.entries(files)) {
    const fp = path.join(dir, name);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('parseSourceImports 识别 from 导入与 side-effect 导入', () => {
  const { dir, cleanup } = tmpSrc({
    'a.ts': 'export const a = 1;\n',
    'b.ts': 'export const b = 1;\n',
    'main.ts': "import './a';\nimport { b } from './b';\nconsole.log(b);\n",
  });
  try {
    const got = parseSourceImports(path.join(dir, 'main.ts'), dir).map((i) => i.path).sort();
    assert.deepEqual(got, ['a.ts', 'b.ts']);
  } finally {
    cleanup();
  }
});

test('parseSourceImports：import type 标记为 isTypeOnly', () => {
  const { dir, cleanup } = tmpSrc({
    'b.ts': 'export const b = 1;\n',
    'main.ts': "import type { b } from './b';\nexport type T = typeof b;\n",
  });
  try {
    const got = parseSourceImports(path.join(dir, 'main.ts'), dir);
    assert.equal(got.length, 1);
    assert.equal(got[0].path, 'b.ts');
    assert.equal(got[0].isTypeOnly, true);
  } finally {
    cleanup();
  }
});

test('parseSourceImports：普通导入 isTypeOnly 为 false', () => {
  const { dir, cleanup } = tmpSrc({
    'b.ts': 'export const b = 1;\n',
    'main.ts': "import { b } from './b';\n",
  });
  try {
    const got = parseSourceImports(path.join(dir, 'main.ts'), dir);
    assert.deepEqual(got, [{ path: 'b.ts', isTypeOnly: false }]);
  } finally {
    cleanup();
  }
});

test('parseSourceImports：side-effect import 不跨语句抢下一条 from', () => {
  const { dir, cleanup } = tmpSrc({
    'a.ts': 'export const a = 1;\n',
    'zzz.ts': 'export const z = 1;\n',
    'main.ts': "import './a';\nconst msg = \"select * from './zzz'\";\n",
  });
  try {
    // 字符串里的 './zzz' 不是真实导入语句，不应被解析为依赖
    const got = parseSourceImports(path.join(dir, 'main.ts'), dir).map((i) => i.path);
    assert.deepEqual(got, ['a.ts']);
  } finally {
    cleanup();
  }
});

test('parseSourceImports：跨行 import 仍可解析', () => {
  const { dir, cleanup } = tmpSrc({
    'b.ts': 'export const b = 1;\n',
    'main.ts': "import {\n  b,\n} from './b';\n",
  });
  try {
    const got = parseSourceImports(path.join(dir, 'main.ts'), dir).map((i) => i.path);
    assert.deepEqual(got, ['b.ts']);
  } finally {
    cleanup();
  }
});

// ── searchName / countLines ──

test('searchName：Type.Method 取裸方法名，普通符号原样返回', () => {
  assert.equal(searchName('Foo.Method'), 'Method');
  assert.equal(searchName('Plain'), 'Plain');
});

test('countLines：换行数 + 末行无换行补 1', () => {
  assert.equal(countLines('a\nb'), 2);
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(countLines(''), 0);
  assert.equal(countLines(null), null);
});
