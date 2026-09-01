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
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tryResolveAlias, resolveAliasToSrcRel, loadAliases, classifyImport, SRC_ROOT } from '../scripts/_lib/alias-resolve.ts';
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

check('classifyImport 别名内部 @/utils/x → 解析、isAlias、不越界（R4 不计）', () => {
  const fromFile = path.join(SRC_ROOT, 'views', 'app-content', 'v.ts');
  const c = classifyImport('@/utils/types-re-export', fromFile);
  assert.ok(c.resolved && c.isAlias, '应解析且为别名');
  assert.strictEqual(c.escapesSrc, false, '落 src 内不应越界');
  assert.strictEqual(c.isBindings, false);
});

check('classifyImport #root/resource_types.json → 解析、isAlias、越界（R4 仍计）', () => {
  const fromFile = path.join(SRC_ROOT, 'views', 'v.ts');
  const c = classifyImport('#root/resource_types.json', fromFile);
  assert.ok(c.resolved && c.isAlias, '应解析且为别名');
  assert.strictEqual(c.escapesSrc, true, '#root 落 src 外应越界，R4 必须计');
});

check('classifyImport 相对深路径 ../../../utils/x（4 层目录文件）→ 字面 ../ 层数=3、不越界', () => {
  const fromFile = path.join(SRC_ROOT, 'views', 'app-content', 'diagnostics', 'conflicts.ts');
  const c = classifyImport('../../../utils/x', fromFile);
  assert.ok(c.resolved && !c.isAlias, '相对路径非别名');
  assert.strictEqual(c.upLevels, 3, '字面 ../ 层数应为 3');
  assert.strictEqual(c.escapesSrc, false, 'src 内引用不越界');
});

check('classifyImport 相对 ../../../../resource_types.json → 越界（R4 计）', () => {
  const fromFile = path.join(SRC_ROOT, 'utils', 'resource', 'v.ts');
  const c = classifyImport('../../../../resource_types.json', fromFile);
  assert.ok(c.resolved && !c.isAlias);
  assert.strictEqual(c.escapesSrc, true, '根 JSON 落 src 外应越界');
});

check('classifyImport 未登记别名 @/nope/x → resolved:false（catch-all 已禁，双写一致性兜底）', () => {
  const fromFile = path.join(SRC_ROOT, 'views', 'v.ts');
  const c = classifyImport('@/nope/x', fromFile);
  assert.strictEqual(c.resolved, false, '未登记目录级别名应跳过，不误判');
});

check('classifyImport 裸包名 @wailsio/runtime → resolved:false', () => {
  const fromFile = path.join(SRC_ROOT, 'views', 'v.ts');
  const c = classifyImport('@wailsio/runtime', fromFile);
  assert.strictEqual(c.resolved, false);
  assert.strictEqual(c.isAlias, false);
});

check('classifyImport e2e/mock-data.ts 真实引用形状（3 层 ../ → frontend/e2e）→ isMockData:true 且越界', () => {
  const fromFile = path.join(SRC_ROOT, 'core', 'handlers', 'sync.test.ts');
  const c = classifyImport('../../../e2e/mock-data.ts', fromFile);
  assert.ok(c.resolved && c.isMockData, '应标记 mock-data（真实位置 frontend/e2e），R4 内定入基线');
  assert.strictEqual(c.escapesSrc, true, '物理在 src 外，同时越界');
});

check('classifyImport bindings 路径 → isBindings:true（R3/R4 豁免）', () => {
  const fromFile = path.join(SRC_ROOT, 'views', 'v.ts');
  const c = classifyImport('#root/bindings/wails.ts', fromFile);
  assert.ok(c.resolved && c.isBindings, '路径段含 bindings 应豁免，不计 R3/R4');
});

check('gate 集成：check-path-hygiene --json 的 r4Count === 冻结基线（防漂移静默）', () => {
  const script = path.join(ROOT, 'scripts', 'check-path-hygiene.ts');
  const r = spawnSync(process.execPath, [script, '--json'], { encoding: 'utf-8' });
  assert.strictEqual(r.status, 0, `门禁应 PASS，stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out._summary.ok, true, 'summary.ok 应为 true');
  const baseline = JSON.parse(readFileSync(path.join(ROOT, 'docs', '.path-hygiene-baseline.json'), 'utf-8')).crossBoundaryNonBindings;
  assert.strictEqual(out._summary.r4_cross_boundary.count, baseline, '实时计数必须等于冻结基线');
  assert.strictEqual(out._summary.r4_cross_boundary.baseline, baseline, '脚本侧 baseline 读取应与文件一致');
});

if (fails.length) {
  console.error(`\n${fails.length} 项失败`);
  process.exit(1);
}
console.log('\n✅ 全部通过');
