#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/contract-tests.ts 双表一致性（缺陷#2，2026-09-13）。
 *
 * 锁定语义（结构断言）：
 *   1. CONTRACT_TEST_TARGETS 的每个键都必须 ∈ CONTRACT_TEST_DOMAINS——
 *      TARGETS 表只用于「精确裁剪」，若键在 DOMAINS 表不存在，selectContractTests
 *      的 byDomain 永不命中它 → 该测试在精确模式下静默漏检。
 *   2. 每个含 'tests' 域的测试都必须在 TARGETS 表登记——精确裁剪模式下，
 *      未登记的 tests 域测试 targetsHit 恒 true（保守保留，不漏检但削弱轻量化），
 *      而本测试把它升成「必须登记」的可执行契约，把「人自觉」固化为 fail-closed。
 *
 * 边界：本测试只做结构校验（键集合关系），不断言表内容本身——内容漂移仍由
 * 对应测试的源模块守护（test_contract_domain_select 锁算法、各功能测试锁行为）。
 *
 * 依赖：node:assert / 被测模块（_lib/contract-tests.ts 的两张表 + 算法）。
 * 用法：node tests/test_contract_tables_consistency.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败（node:assert 抛错）。
 */
import assert from "node:assert";
import { CONTRACT_TEST_DOMAINS, CONTRACT_TEST_TARGETS } from "../scripts/_lib/contract-tests.ts";

const domainKeys = new Set(Object.keys(CONTRACT_TEST_DOMAINS));
const targetKeys = new Set(Object.keys(CONTRACT_TEST_TARGETS));

// 1. TARGETS 的每个键必须 ∈ DOMAINS
const orphanTargets = [...targetKeys].filter((k) => !domainKeys.has(k));
assert.deepStrictEqual(
  orphanTargets,
  [],
  `CONTRACT_TEST_TARGETS 存在未登记进 CONTRACT_TEST_DOMAINS 的键（精确裁剪永不命中，静默漏检）: ${orphanTargets.join(", ")}`,
);

// 2. 每个含 'tests' 域的测试都必须登记 TARGETS
const testsDomainTests = [...domainKeys].filter((k) =>
  (CONTRACT_TEST_DOMAINS[k] || []).includes("tests"),
);
const unregisteredTests = testsDomainTests.filter((k) => !targetKeys.has(k));
assert.deepStrictEqual(
  unregisteredTests,
  [],
  `含 tests 域但未登记 CONTRACT_TEST_TARGETS 的测试（精确模式保守保留但应显式登记）: ${unregisteredTests.join(", ")}`,
);

console.log(
  `[OK] test_contract_tables_consistency.ts 全部断言通过（DOMAINS ${domainKeys.size} / TARGETS ${targetKeys.size} / tests 域 ${testsDomainTests.length}）`,
);
