#!/usr/bin/env node
/**
 * 契约测试：契约测试按域裁剪（_lib/contract-tests.ts 的 selectContractTests / CONTRACT_TEST_DOMAINS）。
 *
 * 背景（2026-09，任务 #2）：pre-push-gate 契约测试此前是粗粒度布尔开关——改 tests/scripts 全量 45 个、
 * 改 go/frontend/data/docs 一个不跑。本次落地按域裁剪：变更域 → 只跑相关契约测试（映射表 + 规则），
 * pre-push-gate 与 doctor 共用 selectContractTests。本测试锁定裁剪规则，防止未来改分类规则导致
 * 「改 go 漏跑 go 契约」或「改前端误拉全量」之类的回归。
 *
 * 覆盖：
 *   1. selectContractTests：纯 go / 纯前端 / 纯 data / 纯 docs / 纯 tests(scripts) / 空
 *   2. mixed 跨端契约（go+frontend）：任一端变更都触发
 *   3. 子集严格小于全量（非 tests 域不拉全量）、命中域正确
 *   4. 全量模式（--all，不传域）仍返回 collectContractTests 全部
 *   5. CONTRACT_TEST_DOMAINS 键与 collectContractTests 全量一致（新增测试必须登记映射）
 *
 * 用法：node tests/test_contract_domain_select.ts
 * 退出码：0 = 通过；1 = 失败。
 */
import assert from 'node:assert';
import { collectContractTests, selectContractTests, CONTRACT_TEST_DOMAINS } from '../scripts/_lib/contract-tests.ts';

const failures = [];
let assertCount = 0;

function check(cond, msg) {
  assertCount++;
  if (!cond) failures.push(msg);
}

const all = collectContractTests();
const has = (arr, f) => arr.includes(f);

// ---- 1. 各纯域子集：命中域正确、严格小于全量 ----
const goSet = selectContractTests(['go']);
check(goSet.length > 0 && goSet.length < all.length, `纯 go：子集应 >0 且 < 全量（${all.length}），实为 ${goSet.length}`);
for (const f of goSet) {
  const doms = CONTRACT_TEST_DOMAINS[f] || [];
  check(doms.includes('go'), `${f} 应属 go/mixed 域（映射 ${JSON.stringify(doms)}），却进 go 子集`);
}
// go 域代表：CLI parity / config / rust bridge
check(has(goSet, 'test_cli_completion_parity.ts'), 'go 子集应含 test_cli_completion_parity');
check(has(goSet, 'test_rust_bridge_tags.ts'), 'go 子集应含 test_rust_bridge_tags');
// 不应含纯前端/data/docs/tests
check(!has(goSet, 'test_bus_contract.ts'), 'go 子集不应含纯前端 test_bus_contract');
check(!has(goSet, 'test_resource_schema.ts'), 'go 子集不应含纯 data test_resource_schema');

const frontSet = selectContractTests(['frontend']);
check(frontSet.length > 0 && frontSet.length < all.length, `纯前端：子集应 >0 且 < 全量，实为 ${frontSet.length}`);
for (const f of frontSet) {
  const doms = CONTRACT_TEST_DOMAINS[f] || [];
  check(doms.includes('frontend'), `${f} 应属 frontend/mixed 域，却进前端子集`);
}
check(has(frontSet, 'test_bus_contract.ts'), '前端子集应含 test_bus_contract');
check(!has(frontSet, 'test_cli_completion_parity.ts'), '前端子集不应含纯 go test_cli_completion_parity');

const dataSet = selectContractTests(['data']);
check(dataSet.length === 3, `纯 data：应恰 3 个 schema 测试，实为 ${dataSet.length}`);
check(has(dataSet, 'test_resource_schema.ts') && has(dataSet, 'test_creators_schema.ts') && has(dataSet, 'test_workshop_schema.ts'), 'data 子集应含 3 个 schema 测试');

const docsSet = selectContractTests(['docs']);
check(docsSet.length > 0 && docsSet.length < all.length, `纯 docs：子集应 >0 且 < 全量，实为 ${docsSet.length}`);
check(has(docsSet, 'check-knowledge-drift-affected.ts'), 'docs 子集应含 check-knowledge-drift-affected');
check(!has(docsSet, 'test_bus_contract.ts'), 'docs 子集不应含前端测试');

// ---- 2. 纯 tests（scripts/tools/_lib 自身）→ 全量 ----
const testsSet = selectContractTests(['tests']);
check(testsSet.length === all.length, `纯 tests：应全量（${all.length}），实为 ${testsSet.length}`);
const scriptsSet = selectContractTests(['tests', 'go']);
check(scriptsSet.length === all.length, 'tests+go：应仍全量（工具自身改动影响面大）');

// ---- 3. mixed 跨端契约：任一端变更都触发 ----
const MIXED = ['test_android_bridge_contract.ts', 'test_cli_gui_flow_contract.ts', 'test_config_syntax.ts', 'test_cube_uv_quad_vertex.ts'];
for (const m of MIXED) {
  check(has(goSet, m), `${m} 在 go 变更时应触发`);
  check(has(frontSet, m), `${m} 在 frontend 变更时应触发`);
}

// ---- 4. 空变更域 → 空集（不跑）；全量模式（undefined → 不传域）→ collectContractTests ----
check(selectContractTests([]).length === 0, '空变更域应返回空集');
check(selectContractTests(['other']).length === 0, '纯 other 域不应触发契约测试');

// ---- 5. 映射表完整性：collectContractTests 全部文件必须登记 CONTRACT_TEST_DOMAINS ----
for (const f of all) {
  check(Array.isArray(CONTRACT_TEST_DOMAINS[f]) && CONTRACT_TEST_DOMAINS[f].length > 0,
    `${f} 未登记 CONTRACT_TEST_DOMAINS（新增契约测试必须标注验证域）`);
}

// ---- 6. 反向校验：CONTRACT_TEST_DOMAINS 的每个 key 必须真实存在于 tests/ 目录 ----
const allBasename = new Set(all);
for (const f of Object.keys(CONTRACT_TEST_DOMAINS)) {
  check(allBasename.has(f),
    `${f} 在 CONTRACT_TEST_DOMAINS 但 tests/ 目录不存在（僵尸条目）`);
}

// ---- 汇总 ----
if (failures.length === 0) {
  console.log(`✅ test_contract_domain_select 全部通过（${assertCount} 组断言；全量 ${all.length}，go ${goSet.length} / frontend ${frontSet.length} / data ${dataSet.length} / docs ${docsSet.length}）`);
  process.exit(0);
} else {
  console.log('❌ test_contract_domain_select 失败:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
