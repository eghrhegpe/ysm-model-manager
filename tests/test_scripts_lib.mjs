#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/scan-files.mjs 共享层单元测试。
 *
 * 覆盖边界情况：
 *   1. walk：.js/.ts 双扩展名收集、css/ 与 node_modules/ 排除、隐藏文件排除、
 *      skipTest 选项排除 *.test.* / *.spec.*
 *   2. resolveImport：无扩展名补 .ts/.js、显式扩展名、目录 index.ts/index.js、
 *      包导入返回 null、上级 ../ 路径
 *   3. toPosix / relPosix：Windows 反斜杠 → 正斜杠、相对仓库根
 *   4. readText：BOM 去除 + CRLF → LF 容错
 *
 * 零依赖（仅 node:fs / node:path / node:os）。fixture 用临时目录，不污染仓库。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { walk, resolveImport, toPosix, relPosix, readText, ROOT } from '../scripts/_lib/scan-files.mjs';

const errors = [];

function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

// ── 1. walk：临时目录树 ─────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-scan-test-'));
try {
  fs.mkdirSync(path.join(tmp, 'sub'));
  fs.mkdirSync(path.join(tmp, 'css'));
  fs.mkdirSync(path.join(tmp, 'node_modules'));
  const fixtures = [
    'a.ts', 'a.js', 'b.test.js', 'c.spec.ts', '.hidden.js',
    'sub/d.ts', 'sub/e.js', 'css/style.css', 'node_modules/x.js',
  ];
  for (const f of fixtures) {
    const fp = path.join(tmp, f);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, '');
  }

  const all = walk(tmp).map((p) => path.relative(tmp, p).replace(/\\/g, '/')).sort();
  assert(all.includes('a.ts'), `walk 应收集 .ts（实际缺 a.ts: ${all.join(',')}）`);
  assert(all.includes('a.js'), `walk 应收集 .js（实际缺 a.js）`);
  assert(all.includes('sub/d.ts'), `walk 应递归子目录（实际缺 sub/d.ts）`);
  assert(!all.includes('css/style.css'), `walk 应排除 css/（实际含 ${all.filter((f) => f.includes('css')).join(',')}）`);
  assert(!all.includes('node_modules/x.js'), 'walk 应排除 node_modules/');
  assert(!all.includes('.hidden.js'), 'walk 应排除隐藏文件');
  assert(all.includes('b.test.js'), `walk 默认应收集 .test.js（不跳过）`);
  assert(all.includes('c.spec.ts'), 'walk 默认应收集 .spec.ts');

  const noTest = walk(tmp, { skipTest: true }).map((p) => path.relative(tmp, p).replace(/\\/g, '/'));
  assert(!noTest.includes('b.test.js'), 'skipTest:true 应排除 *.test.js');
  assert(!noTest.includes('c.spec.ts'), 'skipTest:true 应排除 *.spec.ts');
  assert(noTest.includes('a.ts'), 'skipTest:true 不应误伤正常 .ts');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 2. resolveImport：扩展名补全边界（不依赖磁盘，仅 moduleSet）─────
{
  const base = path.join(tmp, 'src');
  const m = (p) => path.join(base, p);
  const mods = new Set([m('a.ts'), m('a.js'), m('dir/index.ts'), m('dir/index.js'), m('only-js.js')]);
  const from = m('mod.ts');

  assert(resolveImport(from, './a', mods) === m('a.ts'), '无扩展名 ./a 应优先补 .ts');
  assert(resolveImport(from, './a.ts', mods) === m('a.ts'), '显式 ./a.ts 应命中');
  assert(resolveImport(from, './a.js', mods) === m('a.js'), '显式 ./a.js 应命中');
  assert(resolveImport(from, './only-js', mods) === m('only-js.js'), '仅 .js 存在时应补 .js');
  assert(resolveImport(from, './dir', mods) === m('dir/index.ts'), './dir 应补 index.ts（优先 ts）');
  assert(resolveImport(from, './nope', mods) === null, '不存在时应返回 null');
  assert(resolveImport(from, 'three', mods) === null, '包导入（非相对）应返回 null');
  assert(resolveImport(from, 'three/addons/controls/OrbitControls.js', mods) === null, '带路径的包导入应返回 null');

  // 上级 ../ 解析
  const upBase = path.join(tmp, 'root');
  const upMods = new Set([path.join(upBase, 'top.ts')]);
  assert(
    resolveImport(path.join(upBase, 'src', 'mod.ts'), '../top', upMods) === path.join(upBase, 'top.ts'),
    '../ 上级路径应正确解析'
  );
}

// ── 3. toPosix / relPosix ────────────────────────────
assert(toPosix('a\\b\\c.ts') === 'a/b/c.ts', `toPosix 应转反斜杠（got: ${toPosix('a\\b\\c.ts')}）`);
assert(toPosix('a/b/c.ts') === 'a/b/c.ts', 'toPosix 已正斜杠应不变');
assert(relPosix(path.join(ROOT, 'scripts', 'x.mjs')) === 'scripts/x.mjs', `relPosix 应相对 ROOT 且正斜杠（got: ${relPosix(path.join(ROOT, 'scripts', 'x.mjs'))}）`);

// ── 4. readText：BOM + CRLF 容错 ─────────────────────
{
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-readtest-'));
  try {
    const fp = path.join(tmp2, 'sample.ts');
    fs.writeFileSync(fp, '\uFEFFline1\r\nline2\r\nline3');
    const t = readText(fp);
    assert(!t.includes('\uFEFF'), 'readText 应去除 BOM');
    assert(!t.includes('\r'), 'readText 应统一 CRLF → LF');
    assert(t === 'line1\nline2\nline3', `readText 内容应保真（got: ${JSON.stringify(t)}）`);

    const plain = path.join(tmp2, 'plain.js');
    fs.writeFileSync(plain, 'const a = 1;\n');
    assert(readText(plain) === 'const a = 1;\n', 'readText 对纯 LF 文件应原样返回');
  } finally {
    fs.rmSync(tmp2, { recursive: true, force: true });
  }
}

// ── 输出 ─────────────────────────────────────────────
if (errors.length) {
  console.log(`FAILED: ${errors.length} issue(s)`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}
console.log('OK: scan-files 共享层边界测试全过');
console.log(`   ROOT=${ROOT}`);
console.log(`   SRC_DIR=${rel(path.join(ROOT, 'frontend/js'))}`);
