#!/usr/bin/env node
/**
 * 契约测试：alias-resolve.ts 别名解析（ADR-146 闸二前置）。
 *
 * 覆盖 D4 准入硬条件——别名路径的解析必须被正确识别：
 *   - tryResolveAlias：@/dir/x → 绝对路径；#root/x → 仓库根绝对路径；相对/裸包名 → null
 *   - resolveAliasToSrcRel：@/... 落 src 内 → 相对 posix；#root... 落 src 外 → null
 *   - scan-files.resolveImport 别名分支：@/x 命中 moduleSet（含 .js 补全）、未命中 → null
 *     （治 check-circular 开闸后因 resolveImport 不识别名导致的环检测假阴性）
 *
 * 零依赖（仅 node:assert / node:path / node:url）。
 * 运行：node tests/test_alias-resolve.ts
 */
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tryResolveAlias, resolveAliasToSrcRel, loadAliases, SRC_ROOT } from '../scripts/_lib/alias-resolve.ts';
import { resolveImport } from '../scripts/_lib/scan-files.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fails: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log('✓', name);
  } catch (e) {
    fails.push(`${name}: ${(e as Error).message}`);
    console.error('✗', name, '-', (e as Error).message);
  }
}

check('loadAliases 解析 ≥13 个别名（12 个 @/dir + #root）', () => {
  const a = loadAliases();
  assert.ok(a.length >= 13, `期望 ≥13 个别名，实际 ${a.length}`);
  assert.ok(a.some((e) => e.prefix === '@/preview-3d'), '缺 @/preview-3d');
  assert.ok(a.some((e) => e.prefix === '#root'), '缺 #root');
  // 最长前缀优先：首条应为最长前缀，防 @/preview 误吞 @/preview-3d
  assert.ok(a[0]!.prefix.length >= 10, `首条应为最长前缀，实际 ${a[0]!.prefix}`);
});

check('tryResolveAlias @/preview-3d/foo → SRC_ROOT/preview-3d/foo', () => {
  assert.strictEqual(tryResolveAlias('@/preview-3d/foo'), path.join(SRC_ROOT, 'preview-3d', 'foo'));
});

check('tryResolveAlias @/preview-3d（整段无子路径）→ 目录绝对路径', () => {
  assert.strictEqual(tryResolveAlias('@/preview-3d'), path.join(SRC_ROOT, 'preview-3d'));
});

check('tryResolveAlias #root/resource_types.json → REPO_ROOT/resource_types.json', () => {
  assert.strictEqual(tryResolveAlias('#root/resource_types.json'), path.join(ROOT, 'resource_types.json'));
});

check('tryResolveAlias 相对路径 → null', () => {
  assert.strictEqual(tryResolveAlias('./x'), null);
  assert.strictEqual(tryResolveAlias('../y'), null);
});

check('tryResolveAlias 裸包名 → null', () => {
  assert.strictEqual(tryResolveAlias('@wailsio/runtime'), null);
});

check('resolveAliasToSrcRel @/core/x → core/x', () => {
  assert.strictEqual(resolveAliasToSrcRel('@/core/x'), 'core/x');
});

check('resolveAliasToSrcRel #root/x → null（落 src 外）', () => {
  assert.strictEqual(resolveAliasToSrcRel('#root/x'), null);
});

check('resolveImport 别名建边：@/preview-3d/foo 命中 moduleSet', () => {
  const target = path.join(SRC_ROOT, 'preview-3d', 'foo.ts');
  const fromFile = path.join(SRC_ROOT, 'views', 'v.ts');
  assert.strictEqual(resolveImport(fromFile, '@/preview-3d/foo', new Set([target])), target);
});

check('resolveImport 别名补 .js 扩展名命中', () => {
  const target = path.join(SRC_ROOT, 'utils', 'bar.js');
  const fromFile = path.join(SRC_ROOT, 'views', 'v.ts');
  assert.strictEqual(resolveImport(fromFile, '@/utils/bar', new Set([target])), target);
});

check('resolveImport 别名但目标不在 moduleSet → null（不假阴性）', () => {
  const fromFile = path.join(SRC_ROOT, 'views', 'v.ts');
  assert.strictEqual(resolveImport(fromFile, '@/preview-3d/nope', new Set()), null);
});

check('resolveImport 相对路径分支不受影响', () => {
  const target = path.join(SRC_ROOT, 'views', 'sibling.ts');
  const fromFile = path.join(SRC_ROOT, 'views', 'v.ts');
  assert.strictEqual(resolveImport(fromFile, './sibling', new Set([target])), target);
});

if (fails.length) {
  console.error(`\n${fails.length} 项失败`);
  process.exit(1);
}
console.log('\n✅ 全部通过');
