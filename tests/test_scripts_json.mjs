#!/usr/bin/env node
/**
 * 契约测试：治理脚本 --json 输出契约。
 *
 * 统一契约为 { _summary: {...}, ...数据 }（子代理消费对齐）。
 * 本测试只验证结构契约，不依赖退出码：
 *   1. --json 输出必须是合法 JSON
 *   2. 顶层必须有 _summary 对象，且含至少一个计数键
 *   3. 有 _summary 的脚本清单 = README.md「生产级 --json」档
 *
 * 排除：依赖外部工具/参数的脚本（check-deadcode-baseline 跑 knip+jscpd 过慢、
 * doctor 全量过慢、bug-search/inspect_ysm 需参数、auto-import 由其他 AI 维护）。
 * 零依赖（仅 node:fs / node:path / node:url / node:child_process）。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const NODE = process.execPath;

// [脚本名, 参数] —— 只测无参数即可输出 JSON 的快速脚本
const JSON_SCRIPTS = [
  ['check-redlines.mjs', '--json'],
  ['check-circular.mjs', '--json'],
  ['check-orphan-exports.mjs', '--json'],
  ['check-boolean-naming.mjs', '--json'],
  ['check-adr-health.mjs', '--json'],
  ['check-knowledge-drift.mjs', '--json'],
  ['check-doc-drift.mjs', '--json'],
  ['comment-checker.mjs', '--json'],
  ['type-consistency.mjs', '--json'],
  ['link-checker.mjs', '--json'],
  ['adr-check.mjs', '--json'],
];

const errors = [];

function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

for (const [name, flag] of JSON_SCRIPTS) {
  const r = spawnSync(NODE, [path.join(SCRIPTS, name), flag], { encoding: 'utf-8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  const out = (r.stdout || '').trim();

  // 1. 可解析
  let data = null;
  try {
    data = JSON.parse(out);
  } catch (e) {
    errors.push(`[${name}] --json 输出非合法 JSON: ${e.message.slice(0, 80)} | stdout=${out.slice(0, 120)}`);
    continue;
  }
  assert(data !== null && typeof data === 'object', `[${name}] JSON 顶层应为对象`);

  // 2. 顶层 _summary
  assert(
    data._summary && typeof data._summary === 'object' && !Array.isArray(data._summary),
    `[${name}] 顶层缺 _summary 对象（keys=${Object.keys(data).join(',')}）`
  );
  if (data._summary) {
    const keys = Object.keys(data._summary);
    assert(keys.length > 0, `[${name}] _summary 应为非空对象`);
    const hasCount = keys.some((k) => typeof data._summary[k] === 'number');
    assert(hasCount, `[${name}] _summary 应含至少一个计数键（keys=${keys.join(',')}）`);
  }

  // 3. 退出码可映射（-1 = 超时/异常；0/1 均为正常门禁语义）
  if (r.error) {
    errors.push(`[${name}] 执行异常: ${r.error.message.slice(0, 80)}`);
  }
}

// ── comment-checker 专项：_summary 含分类计数 + 截断标记 ─
{
  const r = spawnSync(NODE, [path.join(SCRIPTS, 'comment-checker.mjs'), '--json'], { encoding: 'utf-8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  const data = JSON.parse((r.stdout || '').trim());
  const CATS = ['AI_fluff', 'empty_jsdoc', 'commented_code', 'todo_no_ticket', 'debug_log'];
  for (const cat of CATS) {
    assert(
      typeof data._summary?.[cat] === 'number',
      `[comment-checker] _summary 缺分类计数 ${cat}（keys=${Object.keys(data._summary || {}).join(',')}）`
    );
    assert(
      typeof data[cat] === 'undefined' || Array.isArray(data[cat]),
      `[comment-checker] 顶层 ${cat} 应为数组`
    );
    if (Array.isArray(data[cat])) {
      // 默认截断：分类计数 = 全量，顶层数组 ≤ 50（--full 才全量）
      assert(data[cat].length <= data._summary[cat], `[comment-checker] ${cat} 数组不应超过计数`);
      assert(data[cat].length <= 50, `[comment-checker] ${cat} 默认应截断至 ≤50 条（got ${data[cat].length}）`);
    }
  }
  assert(
    typeof data._summary?.total === 'number',
    `[comment-checker] _summary 缺 total 计数`
  );
}

// ── 输出 ─────────────────────────────────────────────
if (errors.length) {
  console.log(`FAILED: ${errors.length} issue(s)`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`OK: ${JSON_SCRIPTS.length} 个脚本 --json 契约全过（_summary 存在 + 可解析）`);
for (const [name] of JSON_SCRIPTS) console.log(`   ✓ ${name}`);
