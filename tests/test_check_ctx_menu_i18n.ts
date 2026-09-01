#!/usr/bin/env node
/**
 * 契约测试：check-ctx-menu-i18n.ts — 右键菜单 i18n key 存在性门禁。
 *
 * 覆盖：
 *   1. findMissingKeys 纯函数：在用的 key 缺失于 zh-CN 基准包 → 检出违规（含来源文件）。
 *   2. findMissingKeys 纯函数：key 全部存在 → 0 违规。
 *   3. 全量扫描当前仓库（menu-defs.ts + context-menu*-handlers.ts）应 0 违规（rc=0）。
 *
 * 零依赖（仅 node:fs / node:path / node:child_process）。
 * 运行：node tests/test_check_ctx_menu_i18n.ts
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMissingKeys } from '../scripts/check-ctx-menu-i18n.ts';

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

function runCheck(args) {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-ctx-menu-i18n.ts'), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return { rc: 0, out };
  } catch (e) {
    return { rc: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

check('findMissingKeys：在用的 key 缺失于 zh-CN → 检出违规（含来源文件）', () => {
  const used = new Map([
    ['menu.ok', 'frontend/src/core/menu-defs.ts'],
    ['ctx.missing', 'frontend/src/core/context-menu-handlers.ts'],
  ]);
  const base = new Set(['menu.ok']); // ctx.missing 不在基准包
  const missing = findMissingKeys(used, base);
  assert.equal(missing.length, 1, '应检出 1 个缺失');
  assert.equal(missing[0].key, 'ctx.missing');
  assert.equal(missing[0].file, 'frontend/src/core/context-menu-handlers.ts', '应带出来源文件便于定位');
});

check('findMissingKeys：key 全部存在 → 0 违规', () => {
  const used = new Map([
    ['menu.ok', 'frontend/src/core/menu-defs.ts'],
    ['ctx.ok', 'frontend/src/core/context-menu-handlers.ts'],
  ]);
  const base = new Set(['menu.ok', 'ctx.ok', 'other.unrelated']);
  const missing = findMissingKeys(used, base);
  assert.equal(missing.length, 0, '全部存在应为 0 违规');
});

check('findMissingKeys：注释里的伪 key（menu.xxx）不应被算作在用（由扫描端 strip 保证）', () => {
  // 该用例验证契约期望：扫描端已剥离注释，故 findMissingKeys 收到的 used 不含 menu.xxx。
  // 此处断言「若某 key 不在 used 则不会误报」，即函数只针对传入的 used 判缺失。
  const used = new Map([['menu.real', 'frontend/src/core/menu-defs.ts']]);
  const base = new Set(['menu.real']);
  assert.equal(findMissingKeys(used, base).length, 0, '真实 key 存在 → 不误报');
});

check('全量扫描当前仓库应 0 违规（rc=0）', () => {
  const { rc, out } = runCheck(['--json']);
  let data;
  try {
    data = JSON.parse(out);
  } catch {
    assert.fail(`输出非 JSON：${out.slice(0, 500)}`);
  }
  assert.equal(rc, 0, `预期 rc=0，实际 ${rc}；输出：${out.slice(0, 500)}`);
  assert.equal(data._summary.violations, 0, `预期 0 违规，实际 ${data._summary.violations}：${JSON.stringify(data._summary.missing)}`);
});

if (fails.length) {
  console.error(`\n${fails.length} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
