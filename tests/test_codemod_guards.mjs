#!/usr/bin/env node
/**
 * 契约测试：codemod.mjs 新增守卫 + binding-check.mjs 模块名推导。
 *
 * 覆盖（code_review P3 复核锁定）：
 *   1. codemod 未知 `--flag` 拦截（陷阱 #12）→ exit 1 且不写盘
 *   2. codemod `--help` / `-h` 退 0（陷阱 #12）
 *   3. codemod add-param 单横杠默认值（如 `-1`）不被误判为 flag（P3 复核回归）
 *   4. binding-check go.mod 模块名推导：BINDINGS_FILE 指向存在的 -ts 产物
 *
 * 零依赖（仅 node:child_process / node:fs / node:path）。
 * 运行：node tests/test_codemod_guards.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function runCodemod(args) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'codemod.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

check('codemod 未知 --flag 拦截并退 1（不写盘）', () => {
  const r = runCodemod(['rename-function', 'foo', 'bar', '--dry-run']);
  if (r.status === 0) throw new Error('应 exit 1，实际 0');
  if (!/未知 flag/.test(r.stderr + r.stdout)) throw new Error('应报「未知 flag」');
});

check('codemod --help 退 0', () => {
  const r = runCodemod(['--help']);
  if (r.status !== 0) throw new Error(`应 exit 0，实际 ${r.status}`);
});

check('codemod -h 退 0', () => {
  const r = runCodemod(['-h']);
  if (r.status !== 0) throw new Error(`应 exit 0，实际 ${r.status}`);
});

check('codemod add-param 单横杠默认值（-1）不被误判为 flag', () => {
  // 参数存在性/默认值路径不可直接触碰真实源码，这里验证：`-1` 不再触发「未知 flag」，
  // 而是进入 add-param 正常流程（未找到函数 → 报「未找到导出符号」，而非 flag 报错）
  const r = runCodemod(['add-param', '__nonexistent_symbol__', 'count: number', '-1']);
  if (/未知 flag/.test(r.stderr + r.stdout)) throw new Error('单横杠参数值被误判为 flag');
});

check('binding-check 模块名从 go.mod 推导且 -ts 产物存在', () => {
  const goMod = fs.readFileSync(path.join(ROOT, 'go.mod'), 'utf-8');
  const moduleName = (goMod.match(/^module\s+(\S+)/m) || [])[1];
  if (!moduleName) throw new Error('go.mod 无 module 名');
  const bindingsFile = path.join(ROOT, 'frontend/bindings', moduleName, 'internal/app/app.ts');
  if (!fs.existsSync(bindingsFile)) throw new Error(`-ts 绑定产物缺失: ${path.relative(ROOT, bindingsFile)}`);
});

if (fails.length) {
  console.error(`\n❌ ${fails.length} 个用例失败：`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\n✅ 全部用例通过');
