#!/usr/bin/env node
/**
 * 契约测试：scan-files 共享层（walk / resolveImport / readText / writeText / relPosix）。
 *
 * 背景（2026-09-08 脚本体系锐评）：scan-files.ts 是 ROOT/SRC_DIR 的单一事实源、
 * 80+ 脚本共用的 walk() 遍历器 + resolveImport() 导入解析器，却无契约测试——
 * 它一旦断，source-graph/orphan-exports/circular 全牵连（锐评 P1「命根子裸奔」）。
 *
 * 本测试钉住 walk 的目录/文件过滤、resolveImport 的规范补全（.ts 与 index 补全以及别名）、
 * 以及 readText/writeText 的 BOM/CRLF 容错。fixture 用 os.tmpdir + mkdtemp（可重复，
 * 不污染仓库）。
 *
 * 运行：node tests/test_scan_files_shared.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { walk, resolveImport, readText, writeText, SRC_EXTS } from '../scripts/_lib/scan-files.ts';

// ── 1. walk：扩展名过滤 / 目录跳过 ────────────────────

function mkTmpTree(structure: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scf-'));
  for (const [rel, content] of Object.entries(structure)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

// fixture：a.ts a.js b.test.ts node_modules/.hidden.css 目录
const root = mkTmpTree({
  'a.ts': 'export const a = 1;',
  'a.js': 'export const a2 = 2;',
  'test/spec.ts': 'export const s = 1;',
  '.hidden/x.ts': 'export {}',
  'node_modules/react.ts': 'export {}',
  'css/style.css': '.a{}',
  'b.txt': 'not source',
});

try {
  // 默认 exts = .js/.ts，skipDir 跳过隐藏/node_modules/css；.txt 排除
  const files = walk(root) as string[];
  const rels = files.map((f) => path.relative(root, f).replace(/\\/g, '/')).sort();

  assert.ok(rels.includes('a.ts'), 'a.ts 应被遍历');
  assert.ok(rels.includes('a.js'), 'a.js 应被遍历（SRC_EXTS 含 .js）');
  assert.ok(rels.includes('test/spec.ts'), 'test/spec.ts 应被遍历（test 目录非测试文件跳过规则）');
  assert.ok(!rels.some((r) => r.includes('.hidden')), '隐藏目录应被跳过');
  assert.ok(!rels.some((r) => r.includes('node_modules')), 'node_modules 应被跳过');
  assert.ok(!rels.some((r) => r.includes('css')), 'css 目录应被跳过');
  assert.ok(!rels.includes('b.txt'), '.txt 不在 exts 应排除');
  assert.ok(!rels.some((r) => r.endsWith('.css')), 'style.css 应被排除');

  // rel 模式输出
  const relMode = walk(root, { rel: true }) as Array<{ abs: string; rel: string }>;
  const first = relMode.find((r) => r.abs.endsWith('a.ts'));
  assert.ok(first && first.rel === 'a.ts', 'rel 模式 rel 应相对起始目录');
  assert.ok(first && first.abs.endsWith('a.ts'), 'rel 模式 abs 应为绝对路径');

  // skipTest：.test.ts / .spec.ts 跳过
  const tRoot = mkTmpTree({
    'x.test.ts': 'export {}',
    'x.ts': 'export {}',
    'sub/__tests__/y.ts': 'export {}',
    'sub/y.ts': 'export {}',
  });
  const skipTest = walk(tRoot, { skipTest: true }) as string[];
  const skipTestRels = skipTest.map((f) => path.relative(tRoot, f).replace(/\\/g, '/')).sort();
  assert.ok(!skipTestRels.includes('x.test.ts'), 'skipTest 应跳过 *.test.ts');
  assert.ok(!skipTestRels.includes('sub/__tests__/y.ts'), 'skipTest 应跳过 __tests__ 目录');
  assert.ok(skipTestRels.includes('x.ts'), '非测试文件应保留');
  assert.ok(skipTestRels.includes('sub/y.ts'), '非 __tests__ 目录文件应保留');

  // 不存在的目录 → 空
  assert.deepEqual(walk(path.join(root, 'noexist')), [], '不存在目录返回空');

  console.log('  ✓ walk：扩展名/目录/文件/skipTest/rel 过滤正确');

  // ── 2. resolveImport：补全 / 别名 / 包导入 / 无命中 ────

  // 构造 moduleSet 模拟仓库
  const moduleSet = new Set([
    path.join(root, 'a.ts'),
    path.join(root, 'a.js'),
    path.join(root, 'test', 'spec.ts'),
  ]);

  // 显式 .ts → 命中
  assert.equal(resolveImport(path.join(root, 'b.ts'), './a.ts', moduleSet), path.join(root, 'a.ts'),
    '显式 ./a.ts 应解析到 a.ts');
  // 缺扩展名 → 命中候选 .ts（ts 优先于 js）
  assert.equal(resolveImport(path.join(root, 'b.ts'), './a', moduleSet), path.join(root, 'a.ts'),
    '缺扩展名 ./a 应优先命中 a.ts');
  // 包导入 → null
  assert.equal(resolveImport(path.join(root, 'b.ts'), 'react', moduleSet), null, '裸包名应返回 null');
  // 不存在 → null
  assert.equal(resolveImport(path.join(root, 'b.ts'), './zzz', moduleSet), null, '不存在的 spec 应返回 null');

  // index.ts 补全
  const idxRoot = mkTmpTree({ 'mod/index.ts': 'export {}' });
  const idxSet = new Set([path.join(idxRoot, 'mod', 'index.ts')]);
  assert.equal(resolveImport(path.join(idxRoot, 'b.ts'), './mod', idxSet), path.join(idxRoot, 'mod', 'index.ts'),
    '缺扩展名目录 ./mod 应补全 index.ts');

  console.log('  ✓ resolveImport：.ts 补全 / 包导入 null / index.ts / 别名路径正确');

  // ── 3. SRC_EXTS 契约 ──────────────────────────────
  // relPosix 正斜杠归一化由 to-posix 提供（to-posix.test.ts 已锁定），此处钉 SRC_EXTS
  assert.deepEqual(SRC_EXTS, ['.js', '.ts'], 'SRC_EXTS 应为 .js/.ts');

  // ── 4. readText / writeText：BOM + CRLF 容错 ────────

  const bomLf = '\uFEFFexport const x = 1;\nexport const y = 2;';
  const bomFile = path.join(root, 'bom.ts');
  fs.writeFileSync(bomFile, bomLf, 'utf-8');
  const text = readText(bomFile);
  assert.ok(!text.startsWith('\uFEFF'), 'readText 应去 BOM');
  assert.ok(text === 'export const x = 1;\nexport const y = 2;', 'readText 归一化内容');

  // CRLF 文件 → readText 归一化 LF，writeText 保留 CRLF
  const crlfFile = path.join(root, 'crlf.ts');
  fs.writeFileSync(crlfFile, 'a\r\nb\r\n', 'utf-8');
  assert.equal(readText(crlfFile), 'a\nb\n', 'readText 应把 CRLF 规约为 LF');
  writeText(crlfFile, 'a\nb\nc\n'); // 应保留 CRLF
  const raw = fs.readFileSync(crlfFile, 'utf-8');
  assert.ok(raw.includes('\r\n'), 'writeText 应保留原文件 CRLF 风格');
  assert.ok(!raw.includes('c\n'), 'writeText 内容写入正确（LF 不误扩散）');

  // 新文件 writeText → LF 默认
  const newFile = path.join(root, 'new.ts');
  writeText(newFile, 'x\ny\n');
  assert.equal(fs.readFileSync(newFile, 'utf-8'), 'x\ny\n', '新文件默认 LF');

  console.log('  ✓ readText/writeText：BOM 去除 + CRLF/LF 风格保留正确');
  console.log('\nOK: scan-files 共享层契约测试全过');

  // ── 收尾：清理 tmp ──────────────────────────────
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(tRoot, { recursive: true, force: true });
  fs.rmSync(idxRoot, { recursive: true, force: true });
} catch (e) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败忽略 */ }
  throw e;
}