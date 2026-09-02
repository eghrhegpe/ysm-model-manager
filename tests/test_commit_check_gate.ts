#!/usr/bin/env node
/**
 * 契约测试：runCommitChecks 决策矩阵（block/allow 判定）。
 *
 * 背景（code_review 2026-09-02 P1/P3）：commit-with-check 重构为独立轻量提交校验时，
 * 红线门禁判定写成 `ok || scanHealthy`（OR），导致「扫描健康 + 变更文件含新增违规」
 * 这一核心拦截场景被静默放行并自动提交——布尔逻辑反转（fail-open）。
 * 另：drift summary 缺 ok/errors 双键时默认放行，未来工具改名 key 会静默漏检。
 *
 * 本测试用桩注入（run / runTests）锁死决策矩阵，不真跑子进程：
 *   1. 红线：扫描健康 + 零新增违规        → allow
 *   2. 红线：扫描健康 + 有新增违规        → ❌ block（P1 回归用例）
 *   3. 红线：扫描不健康（rg 缺失）        → ❌ block（fail-closed）
 *   4. 红线：输出非 JSON                 → ❌ block
 *   5. drift：errors>0                   → ❌ block
 *   6. drift：缺 ok/errors 双键          → ❌ block（契约缺失 fail-closed）
 *   7. drift：输出非 JSON                → ❌ block
 *   8. 契约测试失败                       → ❌ block
 *   9. 全绿（红线 + drift + 契约空）      → allow
 *
 * 零依赖（仅 node:assert）。运行：node tests/test_commit_check_gate.ts
 */
import assert from 'node:assert';

import { runCommitChecks } from '../scripts/_lib/commit-check.ts';
import type { ProcResult } from '../scripts/_lib/proc.ts';

const fails: string[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails.push(`${name}: ${(e as Error).message}`);
    console.error('✗', name, '-', (e as Error).message);
  }
}

/** 按子进程 argv 中出现的工具名分发 canned stdout（桩 run）。 */
function fakeRun(canned: Record<string, { out: string; ok?: boolean; rc?: number }>) {
  return (_bin: string, args: string[]): ProcResult => {
    const hit = Object.keys(canned).find((k) => args.some((a) => a.includes(k)));
    const c = hit ? canned[hit]! : { out: '{}' };
    const r: ProcResult = { ok: c.ok ?? true, rc: c.rc ?? 0, out: c.out };
    if (c.ok === false) r.err = `fake rc=${c.rc ?? 1}`;
    return r;
  };
}

/** 契约测试执行器桩：默认空结果（不 spawn）。 */
const noTests = async () => [];

const redline = (summary: object) =>
  JSON.stringify({ _summary: { ok: true, scanHealthy: true, newViolations: 0, baselineViolations: 5, ...summary } });
const driftJson = (summary: object) => JSON.stringify({ _summary: { errors: 0, warns: 0, ...summary } });

// 工具名 → canned 输出（fakeRun 按 argv 匹配）
const green = {
  'check-redlines.ts': { out: redline({}) },
  'check-doc-drift.ts': { out: driftJson({}) },
  'check-knowledge-drift.ts': { out: driftJson({}) },
};

function resultByName(r: Awaited<ReturnType<typeof runCommitChecks>>, label: string) {
  const it = r.results.find((x) => x.label === label);
  assert.ok(it, `应有检查项 ${label}，实际: ${r.results.map((x) => x.label).join(', ')}`);
  return it!;
}

const main = async () => {
  // 1. 红线：健康 + 零新增 → allow
  await check('红线健康零违规 → allow', async () => {
    const r = await runCommitChecks(['docs/knowledge/x.md'], { run: fakeRun(green), runTests: noTests });
    assert.equal(resultByName(r, '红线合规').ok, true);
    assert.equal(r.ok, true);
  });

  // 2. 红线：健康 + 有新增违规 → block（P1 回归：ok || scanHealthy 曾放行）
  await check('红线健康含新增违规 → block', async () => {
    const canned = {
      ...green,
      'check-redlines.ts': { out: redline({ ok: false, scanHealthy: true, newViolations: 2 }) },
    };
    const r = await runCommitChecks(['go/x.go'], { run: fakeRun(canned), runTests: noTests });
    assert.equal(resultByName(r, '红线合规').ok, false, '新增违规必须记录为 ❌');
    assert.equal(r.ok, false, '整体必须阻断（此前 OR 逻辑会放行）');
  });

  // 3. 红线：扫描不健康（rg 缺失）→ block（fail-closed）
  await check('红线扫描不健康 → block', async () => {
    const canned = {
      ...green,
      'check-redlines.ts': { out: redline({ ok: false, scanHealthy: false, newViolations: 0 }) },
    };
    const r = await runCommitChecks(['go/x.go'], { run: fakeRun(canned), runTests: noTests });
    const it = resultByName(r, '红线合规');
    assert.equal(it.ok, false);
    assert.equal(it.failClosed, true, '扫描不可用应标 failClosed');
    assert.equal(r.ok, false);
  });

  // 4. 红线：输出非 JSON → block
  await check('红线输出非 JSON → block', async () => {
    const canned = { 'check-redlines.ts': { out: 'not json', ok: false, rc: 1 } };
    const r = await runCommitChecks(['go/x.go'], { run: fakeRun(canned), runTests: noTests });
    const it = resultByName(r, '红线合规');
    assert.equal(it.ok, false);
    assert.equal(it.note?.includes('解析失败'), true, `note 应说明解析失败: ${it.note}`);
    assert.equal(r.ok, false);
  });

  // 5. drift：errors>0 → block
  await check('drift errors>0 → block', async () => {
    const canned = {
      ...green,
      'check-knowledge-drift.ts': { out: driftJson({ errors: 2 }) },
    };
    const r = await runCommitChecks(['docs/knowledge/x.md'], { run: fakeRun(canned), runTests: noTests });
    assert.equal(resultByName(r, 'check-knowledge-drift.ts').ok, false);
    assert.equal(r.ok, false);
  });

  // 6. drift：缺 ok/errors 双键 → block（契约缺失不得默认放行）
  await check('drift 缺 ok/errors 双键 → block', async () => {
    const canned = {
      ...green,
      'check-doc-drift.ts': { out: JSON.stringify({ _summary: { warns: 1 } }) },
    };
    const r = await runCommitChecks(['docs/knowledge/x.md'], { run: fakeRun(canned), runTests: noTests });
    assert.equal(resultByName(r, 'check-doc-drift.ts').ok, false, 'summary 契约缺失应 fail-closed');
    assert.equal(r.ok, false);
  });

  // 7. drift：输出非 JSON → block
  await check('drift 输出非 JSON → block', async () => {
    const canned = { 'check-doc-drift.ts': { out: 'boom', ok: false, rc: 1 } };
    const r = await runCommitChecks(['docs/knowledge/x.md'], { run: fakeRun(canned), runTests: noTests });
    const it = resultByName(r, 'check-doc-drift.ts');
    assert.equal(it.ok, false);
    assert.equal(it.note?.includes('解析失败'), true, `note 应说明解析失败: ${it.note}`);
    assert.equal(r.ok, false);
  });

  // 8. 契约测试失败 → block
  await check('契约测试失败 → block', async () => {
    const canned = { ...green, 'check-redlines.ts': { out: redline({}) } };
    const r = await runCommitChecks(['scripts/_lib/commit-check.ts'], {
      run: fakeRun(canned),
      runTests: async () => [{ name: 'test_scripts_json.ts', ok: false, out: 'boom' }],
    });
    const it = resultByName(r, '契约测试（1）');
    assert.equal(it.ok, false);
    assert.equal(r.ok, false);
  });

  // 9. 全绿（红线 + drift + 契约空）→ allow
  await check('全绿 → allow', async () => {
    const r = await runCommitChecks(['docs/knowledge/x.md'], { run: fakeRun(green), runTests: noTests });
    assert.equal(r.ok, true);
    assert.equal(r.results.every((x) => x.ok), true);
  });

  if (fails.length) {
    console.error(`\n❌ ${fails.length} 项失败:`);
    for (const f of fails) console.error('  -', f);
    process.exit(1);
  }
  console.log('\n✅ test_commit_check_gate 全部通过');
};

main().catch((e) => {
  console.error('❌ test_commit_check_gate 执行异常:', e);
  process.exit(1);
});
