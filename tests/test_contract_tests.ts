#!/usr/bin/env node
/**
 * 契约测试：contract-tests 共享层（collectContractTests / 域映射 / 目标映射完整性）。
 *
 * 背景（2026-09-08 脚本体系锐评）：contract-tests.ts 是「契约测试并行执行 + 按域裁剪」
 * 共享层，pre-push-gate/doctor 都消费它。它若 CONTRACT_TEST_DOMAINS 缺登记、或
 * CONTRACT_TEST_TARGETS 与 DOMAINS 不同步，会导致「新增契约测试静默漏检」或
 * 「精确裁剪下测试永不触发」（锐评 P1 命根子）。
 *
 * 本测试钉住三处完整性不变量：
 *   1. collectContractTests 返回非空、按名排序、不含 _ 前缀
 *   2. CONTRACT_TEST_DOMAINS 每个 key 对应的测试文件必须真实存在
 *   3. CONTRACT_TEST_TARGETS 每个 key 都出现在 CONTRACT_TEST_DOMAINS（防一侧登记一侧漏）
 *     且其值（保护源）相对仓库根存在（文件或目录）
 *   4. 域值都来自合法 Domain 集合
 *
 * 运行：node tests/test_contract_tests.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../scripts/_lib/scan-files.ts';
import {
  collectContractTests,
  CONTRACT_TEST_DOMAINS,
  CONTRACT_TEST_TARGETS,
} from '../scripts/_lib/contract-tests.ts';

// ── 1. collectContractTests ──────────────────────────

const tests = collectContractTests();
assert.ok(Array.isArray(tests) && tests.length >= 40, `应收集 ≥40 个契约测试（got ${tests.length}）`);
assert.ok(tests.every((t) => t.endsWith('.ts')), '全部应以 .ts 结尾');
assert.ok(tests.every((t) => !t.startsWith('_')), '不应含 _ 前缀（_lib.mts 被排除）');
const sorted = [...tests].sort();
assert.deepEqual(tests, sorted, '应按文件名排序');

console.log(`  ✓ collectContractTests：${tests.length} 个测试，排序去 _ 前缀正确`);

// ── 2. CONTRACT_TEST_DOMAINS：key 须真实存在 ────────

const keys = Object.keys(CONTRACT_TEST_DOMAINS);
assert.ok(keys.length > 0, 'CONTACT_TEST_DOMAINS 应非空');
// 去重后应等于 tests（DOMAINS 应与 collect 全覆盖）
const testSet = new Set(tests);
const domainSet = new Set(keys);
for (const t of tests) {
  assert.ok(domainSet.has(t) || t.startsWith('check-knowledge-'),
    `契约测试 "${t}" 未登记 CONTRACT_TEST_DOMAINS（新增契约测试必须标注验证域）`);
}

// 逆断言：DOMAINS 里的 key 都应存在对应文件
const missingKeys = keys.filter((k) => !testSet.has(k));
assert.deepEqual(missingKeys, [], `CONTRACT_TEST_DOMAINS 的 key 应存在对应测试文件，缺: ${missingKeys.join(', ')}`);

console.log(`  ✓ CONTRACT_TEST_DOMAINS：${keys.length} 项全部有对应测试文件（无孤儿登记）`);

// ── 3. CONTRACT_TEST_TARGETS：与 DOMAINS 同步 ────────

const tgtKeys = Object.keys(CONTRACT_TEST_TARGETS);
const orphansInTargets = tgtKeys.filter((k) => !domainSet.has(k));
assert.deepEqual(orphansInTargets, [],
  `CONTRACT_TEST_TARGETS 的 key 应都在 CONTRACT_TEST_DOMAINS（防一侧登记一侧漏），孤儿: ${orphansInTargets.join(', ')}`);

// 保护的源文件/目录相对仓库根须存在
const brokenTargets: string[] = [];
for (const [testName, targets] of Object.entries(CONTRACT_TEST_TARGETS)) {
  for (const t of targets) {
    const isDir = t.endsWith('/');
    const abs = path.join(ROOT, isDir ? t.slice(0, -1) : t);
    if (!fs.existsSync(abs)) brokenTargets.push(`${testName} → ${t}`);
  }
}
assert.deepEqual(brokenTargets, [],
  `CONTRACT_TEST_TARGETS 的源路径应存在，失效: ${brokenTargets.join('; ')}`);

console.log(`  ✓ CONTRACT_TEST_TARGETS：${Object.keys(CONTRACT_TEST_TARGETS).length} 项与 DOMAINS 同步、源路径均存在`);

// ── 4. 域值合法 ────────────────────────────────────

const VALID_DOMAINS = new Set(['go', 'frontend', 'data', 'docs', 'tests', 'other']);
for (const [k, domains] of Object.entries(CONTRACT_TEST_DOMAINS)) {
  for (const d of domains) {
    assert.ok(VALID_DOMAINS.has(d),
      `"${k}" 的域值 "${d}" 不在合法域集合 ${[...VALID_DOMAINS].join(', ')} 内`);
  }
}
console.log('  ✓ 域值均在合法 Domain 集合内');

console.log('\nOK: contract-tests 契约测试全过');