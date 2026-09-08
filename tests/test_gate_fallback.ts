#!/usr/bin/env node
/**
 * 契约测试：pre-push-gate 的 fallback 远端分支候选单一事实源。
 *
 * 背景（2026-09-08 脚本体系锐评 R4）：resolveChanges 与 resolveBaseRev 原本各维护一份
 * `origin/<branch> → origin/HEAD → origin/main → origin/master` 手动同步链，改一处忘一处
 * 就会「lint 漏检 / 门禁误拦」漂移。现收敛为 fallbackBranchRevs() 单一事实源，两处共用。
 *
 * 本测试钉住：
 *   1. fallbackBranchRevs 的候选顺序就是预期优先级（防被重排漏掉某层）
 *   2. 分支 ref 带首项 origin/<branch>；非分支/空 ref 无首项
 *   3. resolveBaseRev 对有效 remoteOid（≠localOid）直接返回 remoteOid（权威基线优先）
 *   4. 新仓库（remoteOid 全 0）→ 走 fallback 链取 merge-base 基线
 *
 * 运行：node tests/test_gate_fallback.ts
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
// 从 _lib/gate-resolve import（纯模块，无 pre-push-gate 顶层 main() 副作用）——
// pre-push-gate 顶层会 main() 读 stdin，import 它会污染契约测试。
import { resolveBaseRev, fallbackBranchRevs } from '../scripts/_lib/gate-resolve.ts';

function sh(cmd: string): string {
  return execFileSync('git', cmd.split(' '), { encoding: 'utf-8' }).trim();
}

// ── 1. 候选序列单一事实源 ──────────────────────────

assert.deepEqual(fallbackBranchRevs('refs/heads/feat/gate'),
  ['origin/feat/gate', 'origin/HEAD', 'origin/main', 'origin/master'],
  '分支候选顺序应为 origin/<branch> → HEAD → main → master');

assert.deepEqual(fallbackBranchRevs('HEAD'),
  ['origin/HEAD', 'origin/main', 'origin/master'],
  '非分支 ref 应跳过 origin/<branch>，保留 3 层 fallback');

assert.deepEqual(fallbackBranchRevs(''),
  ['origin/HEAD', 'origin/main', 'origin/master'],
  '空 ref 无首项');

console.log('  ✓ fallbackBranchRevs：候选顺序 = origin/<branch> → HEAD → main → master（单一事实源）');

// ── 2. resolveBaseRev 语义 ──────────────────────────

// 有效 remoteOid ≠ localOid → 直接返回 remoteOid（权威基线优先，不进 fallback）
assert.equal(resolveBaseRev('aaa111', 'bbb222', 'refs/heads/main'), 'bbb222',
  '有效 remoteOid ≠ localOid 应直接返回 remoteOid');

// 新仓库（remoteOid 全 0）→ 走 fallback 链；本仓库应能解析到基线（或孤儿仓库返回空）
const branch = sh('branch --show-current');
const localOid = sh('rev-parse HEAD');
const base = resolveBaseRev(localOid, '0000000000000000000000000000000000000000', `refs/heads/${branch}`);
if (base !== '') {
  assert.ok(/^[0-9a-f]{40}$/i.test(base), `fallback 命中应返回完整 oid（got "${base}"）`);
  // 基线应是 localOid 的可 merge-base 祖先（同点或历史）
  assert.equal(sh(`merge-base ${base} ${localOid}`), base,
    'fallback 基线应等于其与 localOid 的 merge-base');
}
console.log(`  ✓ resolveBaseRev：remoteOid 权威优先 + 新分支走 fallback 链（base=${base.slice(0, 7) || '(空/孤儿)'}）`);

console.log('\nOK: gate fallback 单一事实源契约测试全过');