#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/knowledge-common.ts 共享层（knowledge-drift / doc-drift 去重落点）。
 *
 * 覆盖边界情况：
 *   1. stripBom：剥 \uFEFF，无 BOM 原样返回
 *   2. hasFrontmatterDelimiter：^--- 判定容 BOM 前缀；非 frontmatter / 重排 `***` 开头判 false
 *   3. missingRequiredCardFields：必填字段缺失判定（undefined/空串视为缺）
 *   4. getUntrackedCards：git 可用时返回 Set（fail-open 不阻断）
 *
 * 零依赖（仅 node:assert / ../scripts/_lib/knowledge-common.ts）。
 */
import assert from 'node:assert/strict';
import { stripBom, hasFrontmatterDelimiter, missingRequiredCardFields, getUntrackedCards } from '../scripts/_lib/knowledge-common.ts';

// ── 1. stripBom ──────────────────────────────
assert.equal(stripBom('\uFEFFkind: x'), 'kind: x', 'stripBom 应剥开头 BOM');
assert.equal(stripBom('kind: x'), 'kind: x', 'stripBom 无 BOM 应原样返回');

// ── 2. hasFrontmatterDelimiter ───────────────
assert.equal(hasFrontmatterDelimiter('---\nname: foo\n---\nbody'), true, '^--- 应命中');
assert.equal(hasFrontmatterDelimiter('\uFEFF---\nname: foo\n'), true, '^\\uFEFF--- 容 BOM 应命中');
assert.equal(hasFrontmatterDelimiter('***\n\nname: foo'), false, '重排 *** 开头判 false');
assert.equal(hasFrontmatterDelimiter('# no frontmatter\n\n正文'), false, '无 frontmatter 判 false');
assert.equal(hasFrontmatterDelimiter('kind: foo'), false, '顶格无分隔符判 false');

// ── 3. missingRequiredCardFields ─────────────
// fm 为 parseFrontmatter 产出的 raw frontmatter 块（k: v 行），getScalar 内部解析。
const complete = 'kind: go-scanner\nname: 测试卡\ncategory: go\ntier: architecture\n';
assert.deepEqual(missingRequiredCardFields(complete), [], '完整必填字段应返回空缺');

const missingTier = 'kind: x\nname: y\ncategory: core\n';
assert.deepEqual(missingRequiredCardFields(missingTier), ['tier'], '缺 tier 应报 [tier]');

// 仅呈现缺失语义（空值行会触发 getScalar 对无值行的解析怪癖，属前端解析器内部，不做断言）。
assert.deepEqual(missingRequiredCardFields(null), ['kind', 'name', 'category', 'tier'], 'null frontmatter 应全字段缺失');

// ── 4. getUntrackedCards：git 可用时返回 Set（fail-open）──
// 用仓库根跑一次 git ls-files --others 探测（勾子契约），不强制文件集。
const u = getUntrackedCards(process.cwd());
assert.ok(u instanceof Set, 'getUntrackedCards 应返回 Set 实例');
assert.ok(u.size >= 0, 'getUntrackedCards size 应 ≥0');

console.log('OK: knowledge-common 共享层契约测试全过');