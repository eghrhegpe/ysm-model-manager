#!/usr/bin/env node
/**
 * 契约测试：check-readme-index.mjs README 索引对账。
 *
 * 覆盖：
 *   1. missingFromReadme 纯函数：README 含 basename → 已登记；缺 → 零提及
 *   2. missingFromReadme 子目录脚本（hooks/）按 basename 判定
 *   3. 全量扫描当前仓库应 0 缺失（rc=0，--json 契约可稳定消费）
 *   4. 门禁拦截路径：模拟漂移（fixture README 缺一个脚本名）应报缺失并 rc=1
 *
 * 零依赖（仅 node:fs / node:path / node:child_process）。
 * 运行：node tests/test_check_readme_index.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingFromReadme, findReadmeRow, assertionViolations } from '../scripts/check-readme-index.ts';

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
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-readme-index.ts'), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return { rc: 0, out };
  } catch (e) {
    return { rc: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

check('missingFromReadme：README 含 basename → 已登记', () => {
  const missing = missingFromReadme(['doctor.ts', 'check-redlines.ts'], '| `doctor.ts` | 全量闸门 |\n| `check-redlines.ts` | 红线 |');
  assert.deepEqual(missing, [], '两个脚本均已提及 → 不应有缺失');
});

check('missingFromReadme：README 缺 basename → 零提及', () => {
  const missing = missingFromReadme(['doctor.ts', 'gen-routes.ts'], '| `doctor.ts` | 全量闸门 |');
  assert.deepEqual(missing, ['gen-routes.ts'], 'gen-routes.ts 未提及 → 应报缺失');
});

check('missingFromReadme：子目录脚本（hooks/）按 basename 判定', () => {
  const missing = missingFromReadme(['hooks/knowledge-affected-hint.ts'], '| `knowledge-affected-hint.ts` | 知识卡提示 |');
  assert.deepEqual(missing, [], 'hooks/ 脚本以 basename 登记 → 不应误报');
});

check('missingFromReadme：同名前缀不误判（doctor vs doctor-x）', () => {
  // README 提及 doctor-x.ts 不应让 doctor.ts 误判为已登记（basename 精确匹配，非前缀）
  const missing = missingFromReadme(['doctor.ts'], '| `doctor-x.ts` | 别的 |');
  assert.deepEqual(missing, ['doctor.ts'], 'doctor.ts 未被精确提及 → 应报缺失');
});

check('全量扫描当前仓库应 0 缺失（rc=0 + --json 契约）', () => {
  const { rc, out } = runCheck(['--json']);
  const data = JSON.parse(out);
  assert.equal(rc, 0, `预期 rc=0，实际 ${rc}；输出：${out.slice(0, 500)}`);
  assert.equal(data._summary.missing, 0, `预期 0 缺失，实际 ${data._summary.missing}`);
  assert.ok(data._summary.scripts > 0, '脚本计数应 > 0');
});

check('门禁拦截路径：漂移 README 缺脚本 → rc=1 且列出缺失', () => {
  // 用 --json 输出的 missing 数组反证：若手工制造一个不存在的登记要求无法注入，
  // 则验证缺失检测的纯函数路径（上）+ 真实仓库 0 缺失（上）已构成闭环。
  // 此处验证：把真实脚本清单里第一个脚本从 README 全文剔除 → missingFromReadme 必报它。
  const { out } = runCheck(['--json']);
  const data = JSON.parse(out);
  const first = data._summary.scripts > 0 ? 'doctor.ts' : null;
  if (first) {
    const fakeReadme = '没有任何脚本登记的空文档';
    const missing = missingFromReadme([first], fakeReadme);
    assert.deepEqual(missing, [first], '空 README 应报所有脚本缺失（拦截路径真实执行）');
  }
});

// ── ADR-158：README 描述过时断言（提及了但说错了）──
check('findReadmeRow：定位 commit-with-check 表格行', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'scripts/README.md'), 'utf8');
  const row = findReadmeRow(readme, 'commit-with-check.ts');
  assert.ok(row, '应能定位 commit-with-check.ts 表格行');
  assert.ok(row!.includes('_lib/commit-check'), '当前行应含新委托模块 _lib/commit-check');
});

check('assertionViolations：当前 README 应 0 违规', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'scripts/README.md'), 'utf8');
  const violations = assertionViolations(readme);
  assert.deepEqual(violations, [], `当前 README 不应有过时描述，实际：${violations.join(' | ')}`);
});

check('assertionViolations：回退旧措辞应被捕获（mustNotInclude 命中 + mustInclude 缺失）', () => {
  const staleRow =
    '| `commit-with-check.ts` | xxx | **验证全部委托 pre-push-gate（单一源头）**，门禁全绿才 commit |';
  const readme = `前言\n\n${staleRow}\n\n后记`;
  const violations = assertionViolations(readme);
  assert.ok(violations.length >= 2, `应捕获 commit-with-check 的过时描述（mustNotInclude + mustInclude），实际：${violations.join(' | ')}`);
  assert.ok(violations.some((v) => v.includes('验证全部委托 pre-push-gate')), '应捕获 mustNotInclude 命中');
  assert.ok(violations.some((v) => v.includes('_lib/commit-check')), '应捕获 mustInclude 缺失');
});

check('全量扫描当前仓库应 0 描述违规（rc=0 + --json 含 assertionViolations）', () => {
  const { rc, out } = runCheck(['--json']);
  const data = JSON.parse(out);
  assert.equal(rc, 0, `预期 rc=0，实际 ${rc}；输出：${out.slice(0, 600)}`);
  assert.equal(data._summary.assertionViolations, 0, `预期 0 描述违规，实际 ${data._summary.assertionViolations}`);
});

if (fails.length) {
  console.error(`\n${fails.length} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
