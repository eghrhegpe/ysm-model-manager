#!/usr/bin/env node
/**
 * 契约测试：知识卡 perf 性能画像标签（受控词表 + 索引渲染 + 漂移校验）。
 *
 * 验证三件事：
 *   1. 词表内标签 → check-knowledge-drift 无 ERROR（合法标注放行）
 *   2. 词表外标签 → check-knowledge-drift ERROR 且提示词表（fail-closed）
 *   3. gen-knowledge-index 渲染「性能」列 + 「性能画像」汇总段（含已知标注卡）
 *
 * 用法：node tests/check-knowledge-perf-tags.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, 'scripts');
const KC_DIR = path.join(ROOT, 'docs', 'knowledge');
const NODE = process.execPath;
const errors = [];

function run(script, ...args) {
  return spawnSync(NODE, [path.join(SCRIPTS, script), ...args], {
    encoding: 'utf-8',
    timeout: 60000,
  });
}

function ok(label, cond, detail = '') {
  if (cond) console.log(`   ✓ ${label}`);
  else errors.push(`[${label}] ${detail}`);
}

const TMP_CARD = path.join(KC_DIR, 'zzz-perf-contract-tmp.md');

/** 生成临时测试卡 frontmatter（perf 行由调用方注入）。 */
function writeTmpCard(perfBlock) {
  const fm = [
    '---',
    'kind: zzz-perf-contract-tmp',
    'name: perf 契约测试临时卡',
    'tier: leaf',
    'category: utils',
    ...(perfBlock ? perfBlock : []),
    'source_files:',
    '  - frontend/src/utils/array.ts',
    'use_when:',
    '  - 临时测试',
    '---',
    '',
    '# perf 契约测试临时卡',
    '',
    '## 概览',
    '',
    '契约测试用临时卡，测完即删。',
    '',
  ].join('\r\n');
  fs.writeFileSync(TMP_CARD, fm, 'utf8');
}

console.log('=== 知识卡 perf 性能画像契约 ===');

let r;

try {
  // 1. 词表内标签 → 放行
  writeTmpCard(['perf:', '  - cpu-bound', '  - concurrent']);
  r = run('check-knowledge-drift.ts', '--json');
  const legalOut = r.stdout ? JSON.parse(r.stdout) : { errors: [] };
  ok(
    '词表内标签无 ERROR',
    !legalOut.errors.some((e) => e.includes('zzz-perf-contract-tmp') && e.includes('perf')),
    `不应出现 perf 相关 ERROR: ${legalOut.errors.filter((e) => e.includes('zzz-perf-contract-tmp')).join('; ').slice(0, 200)}`
  );

  // 2. 词表外标签 → ERROR 提示词表
  writeTmpCard(['perf:', '  - warp-speed']);
  r = run('check-knowledge-drift.ts', '--json');
  ok('非法标签退出码 1', r.status === 1, `status=${r.status}`);
  const badOut = r.stdout ? JSON.parse(r.stdout) : { errors: [] };
  ok(
    '非法标签报 ERROR 含词表提示',
    badOut.errors.some((e) => e.includes('zzz-perf-contract-tmp') && e.includes('perf') && e.includes('cpu-bound')),
    `期望 ERROR 含卡名+perf+词表首项: ${badOut.errors.join('; ').slice(0, 300)}`
  );
} finally {
  if (fs.existsSync(TMP_CARD)) fs.unlinkSync(TMP_CARD);
}

// 3. 索引渲染：性能画像汇总段 + 已知标注卡
// 先确保索引与卡同步（幂等重生成，等价 pre-commit GEN_CMDS 行为）
r = run('gen-knowledge-index.ts');
ok('gen-knowledge-index 退出码 0', r.status === 0, `stderr=${r.stderr?.slice(0, 150)}`);

const indexText = fs.readFileSync(path.join(KC_DIR, 'index.md'), 'utf8');
ok('索引含性能画像段', indexText.includes('## 性能画像'), '缺 "## 性能画像" 汇总段');
ok('索引含性能列', /\|\s*标识\s*\|\s*名称\s*\|\s*tier\s*\|\s*性能\s*\|/.test(indexText), '表头缺「性能」列');
ok('汇总段含 rustbridge（concurrent）', /concurrent[^\n]*rustbridge|rustbridge[^\n]*\n/.test(indexText) && indexText.includes('rustbridge'), '性能画像未收录 rustbridge');

// 已知标注卡抽查：optimization_log 应带 gpu-bound（KTX2/GPU 内存主题）
const optRow = indexText.split('\n').find((l) => l.includes('optimization_log'));
ok('optimization_log 行含 gpu-bound', Boolean(optRow && optRow.includes('gpu-bound')), `行内容: ${optRow?.slice(0, 160)}`);

// 4. 索引自校验（--check 幂等：生成后应已同步）
r = run('gen-knowledge-index.ts', '--check');
ok('index --check 同步', r.status === 0, `stderr=${r.stderr?.slice(0, 150)}`);

if (errors.length) {
  console.log(`FAILED: ${errors.length} issue(s)`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}
console.log('OK: 知识卡 perf 性能画像契约全过');
