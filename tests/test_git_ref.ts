#!/usr/bin/env node
/**
 * 契约测试：git-ref 共享层（基于真实 git 仓库的集成契约）。
 *
 * 背景（2026-09-08 脚本体系锐评）：git-ref.ts 是「跨 ref 快照读取」命根子（audit-split /
 * rollback-impact / bloat-history / api-break 全走它），却无契约测试。它若 git 参数
 * 回归（如 lsTree 目录前缀、diffTree 增减语义、renamePairs 的 R 行解析），这些工具
 * 全牵连（锐评 P1）。
 *
 * 本测试用当前仓库（git 根）做确定性断言：HEAD 自比应全空、docs/ 递归应限定前缀、
 * renamePairs 自比应无 rename。这些都与仓库当前状态无关，可重复。
 *
 * 运行：node tests/test_git_ref.ts
 */
import assert from 'node:assert';
import { ROOT } from '../scripts/_lib/scan-files.ts';
import {
  gitMaybe, showAt, existsAt, lineCountAt,
  lsTree, diffTree, renamePairs, logPath, showAllAt,
} from '../scripts/_lib/git-ref.ts';

// 前置：必须在 git 仓库根运行（hooks 场景满足；独立跑需在仓库内）
{
  const probe = gitMaybe(['rev-parse', '--show-toplevel']);
  assert.ok(probe !== null && probe.trim() !== '', '当前目录应在 git 仓库内');
}

// ── 1. lsTree：目录递归 + 限定前缀 ──────────────────

const rootFiles = lsTree('HEAD');
assert.ok(Array.isArray(rootFiles) && rootFiles.length > 50, 'lsTree(HEAD) 应返回大量文件');

// 限定目录：全部以 docs/ 开头
const docsFiles = lsTree('HEAD', 'docs');
assert.ok(Array.isArray(docsFiles) && docsFiles.length > 0, 'docs/ 应有文件');
for (const f of docsFiles) {
  assert.ok(f.startsWith('docs/'), `lsTree(HEAD, docs) 的文件应以 docs/ 开头（got "${f}"）`);
}
console.log('  ✓ lsTree：递归返回 + 目录限定前缀正确');

// ── 2. showAt / existsAt：存在与内容 ────────────────

// 仓库根必有 AGENTS.md
assert.equal(existsAt('HEAD', 'AGENTS.md'), true, 'AGENTS.md 应在 HEAD 存在');
const agents = showAt('HEAD', 'AGENTS.md');
assert.ok(agents !== null && agents.includes('YSM'), 'showAt(HEAD, AGENTS.md) 应返回含 "YSM" 的文本');

// 不存在的路径 → showAt null / existsAt false
assert.equal(existsAt('HEAD', 'no/such/path.x'), false, '不存在路径 existsAt 应为 false');
assert.equal(showAt('HEAD', 'no/such/path.x'), null, '不存在路径 showAt 应为 null');

console.log('  ✓ showAt/existsAt：存在判定 + 内容读取正确');

// ── 3. diffTree：HEAD 自比全空 ───────────────────────

const selfDiff = diffTree('HEAD', 'HEAD');
assert.deepEqual(selfDiff.added, [], 'HEAD 自比 added 应为空');
assert.deepEqual(selfDiff.removed, [], 'HEAD 自比 removed 应为空');
assert.ok(selfDiff.common.length === selfDiff.all.length, 'HEAD 自比 all === common');
assert.ok(selfDiff.common.length > 50, 'HEAD 自比 common 应含全部文件');

console.log('  ✓ diffTree：自比交付空增量、common 全量');

// ── 4. renamePairs：HEAD 自比无 rename ──────────────

const selfRename = renamePairs('HEAD', 'HEAD');
assert.deepEqual(selfRename, [], 'HEAD 自比 renamePairs 应为空');

console.log('  ✓ renamePairs：自比无 rename（R 行解析无回归）');

// ── 5. lineCountAt / logPath / showAllAt 冒烟 ───────

const lines = lineCountAt('HEAD', 'AGENTS.md');
assert.ok(typeof lines === 'number' && lines > 0, 'lineCountAt(HEAD, AGENTS.md) 应返回行数');

const logs = logPath('AGENTS.md', { limit: 2 });
assert.ok(Array.isArray(logs) && logs.length >= 1, 'logPath 应返回至少 1 条历史');

const allAt = showAllAt('HEAD', ['AGENTS.md', 'no/such']);
assert.equal(allAt.get('AGENTS.md'), agents, 'showAllAt 单路径应同 showAt');
assert.equal(allAt.get('no/such'), null, 'showAllAt 缺失路径应 null');

console.log('  ✓ lineCountAt/logPath/showAllAt 冒烟通过');

// ── 收尾 ──────────────────────────────────────────

console.log('\nOK: git-ref 契约测试全过');