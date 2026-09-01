#!/usr/bin/env node
/**
 * 契约测试：变更域分类与检查计划推导（_lib/domain-classify.ts）。
 *
 * 背景（2026-08-17）：pre-push-gate 推送门禁按改动面分流——纯 docs 走轻量、
 * 纯前端跳过 Go 域、纯 Go 跳过前端域、混合全量。classify/planFromFiles 是
 * 分流决策核心，本次补测试锁定其行为，防止未来改分类规则导致「纯文档改动
 * 被拉去跑全量 go test」或「Go 改动漏跑前端域」之类的回归。
 *
 * 覆盖：
 *   1. classify：go/frontend/data/docs/tests/other 六域
 *   2. planFromFiles：纯 docs / 纯前端 / 纯 Go / 混合 / 纯测试 / 纯 data
 *   3. redlines 触发规则：仅 go/frontend 触发，docs/tests/data 不触发
 *   4. adr 域：docs/adr/ 与 docs/architecture/adr/ 前缀触发
 *
 * 用法：node tests/test_domain_classify.mjs
 * 退出码：0 = 通过；1 = 失败。
 */
import { classify, planFromFiles, DATA_FILES } from '../scripts/_lib/domain-classify.ts';

const failures = [];
let assertCount = 0;

function assert(cond, msg) {
  assertCount++;
  if (!cond) failures.push(msg);
}

// ---- 1. classify 六域 ----
assert(classify('go/ysm/ysm.go') === 'go', 'go/*.go 应归 go');
assert(classify('go.mod') === 'go', 'go.mod 应归 go');
assert(classify('go.sum') === 'go', 'go.sum 应归 go');
assert(classify('frontend/src/views/app-preview/index.ts') === 'frontend', 'frontend/ 应归 frontend');
assert(classify('wails.json') === 'frontend', 'wails.json 应归 frontend');
assert(classify('resource_types.json') === 'data', 'resource_types.json 应归 data');
assert(classify('creators.json') === 'data', 'creators.json 应归 data');
assert(classify('docs/adr/ADR-085-menu-single-source.md') === 'docs', 'docs/ 应归 docs');
assert(classify('README.md') === 'docs', '根 .md 应归 docs');
assert(classify('tests/test_api_break.mjs') === 'tests', 'tests/ 应归 tests');
assert(classify('scripts/pre-push-gate.ts') === 'tests', 'scripts/ 应归 tests');
assert(classify('build.ps1') === 'other', '未知根文件应归 other');

// ---- 2. planFromFiles 四类场景 ----
const pDocs = planFromFiles(['docs/adr/ADR-085-menu-single-source.md']);
assert(pDocs.go === false && pDocs.frontend === false && pDocs.docs === true, '纯 docs：应只跑 docs 域，go/frontend 关闭');
assert(pDocs.redlines === false, '纯 docs：不应触发 redlines');

const pFront = planFromFiles(['frontend/src/features/import-executor.ts']);
assert(pFront.go === false && pFront.frontend === true, '纯前端：应跳过 Go 域、跑前端域');
assert(pFront.redlines === true, '纯前端：应触发 redlines');

const pGo = planFromFiles(['go/scanner/scanner.go']);
assert(pGo.go === true && pGo.frontend === false, '纯 Go：应跑 Go 域、跳过前端域');
assert(pGo.redlines === true, '纯 Go：应触发 redlines');

const pMix = planFromFiles(['go/scanner/scanner.go', 'frontend/src/views/app-preview/index.ts']);
assert(pMix.go === true && pMix.frontend === true, '混合：go/frontend 都应跑');
assert(pMix.redlines === true, '混合：应触发 redlines');

// ---- 3. tests/data 域 ----
const pTests = planFromFiles(['tests/test_api_break.mjs']);
assert(pTests.contractTests === true, '纯测试：应跑契约测试');
assert(pTests.redlines === false, '纯测试：不应触发 redlines');

const pScripts = planFromFiles(['scripts/check-menu-health.ts']);
assert(pScripts.contractTests === true, 'scripts 改动：应跑契约测试（脚本本身也要验）');
assert(pScripts.redlines === false, 'scripts 改动：不应触发 redlines');

const pData = planFromFiles(['resource_types.json']);
assert(pData.data === true && pData.go === false && pData.frontend === false, '纯 data：应跑 data 域，不跑 go/frontend');
assert(pData.redlines === false, '纯 data：不应触发 redlines');

// ---- 4. adr 域 ----
const pAdr = planFromFiles(['docs/adr/ADR-085-menu-single-source.md']);
assert(pAdr.adr === true, 'docs/adr/ 应触发 adr 域');
const pArchAdr = planFromFiles(['docs/architecture/adr/ADR-001.md']);
assert(pArchAdr.adr === true, 'docs/architecture/adr/ 应触发 adr 域');
const pPlainDoc = planFromFiles(['docs/Design.md']);
assert(pPlainDoc.adr === false, '非 adr 文档不应触发 adr 域');

// ---- DATA_FILES 完整性 ----
for (const f of DATA_FILES) {
  assert(classify(f) === 'data', `${f} 应在 DATA_FILES 中且归 data`);
}

// ---- 汇总 ----
if (failures.length === 0) {
  console.log(`✅ test_domain_classify.mjs 全部通过（${DATA_FILES.size} 个 data 文件 + ${assertCount} 组断言）`);
  process.exit(0);
} else {
  console.log('❌ test_domain_classify.mjs 失败:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
