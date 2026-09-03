#!/usr/bin/env node
/**
 * 契约测试：知识卡 frontmatter 分隔符显式校验（fail-closed 兜底）。
 *
 * 背景：*** / ~~~ 等非 `---` 开头 = 疑似「整卡 Markdown 重排事故」——frontmatter 被当
 * 正文序列化（---→*** 水平线改写、\_ 转义、列表空行平铺+嵌套错乱）。历史上两次受害：
 * frontend_repo_audit.md（bd86a916 修复）、context-menu.md（cabb0e8b 回滚）。*** 开头会
 * 令 parseFrontmatter（^--- 匹配）返回 null → gen 静默跳过 → 索引漏登。旧文案只报泛化
 * 「幽灵卡」，看不出是重排事故。本测试锁定新文案给出可操作指引。
 *
 * 验证：
 *   1. `---` 正常卡 → 无分隔符 ERROR（放行）
 *   2. `***` 开头畸形卡 → ERROR 且含「分隔符异常」+ 卡名 + 「重排」指引（fail-closed）
 *
 * 用法：node tests/check-knowledge-fm-delimiter.ts
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, 'scripts');
const KC_DIR = path.join(ROOT, 'docs', 'knowledge');
const NODE = process.execPath;
const errors = [];

const TMP_CARD = path.join(KC_DIR, 'zzz-fm-delimiter-tmp.md');

function runDriftJson() {
  return spawnSync(NODE, [path.join(SCRIPTS, 'check-knowledge-drift.ts'), '--json'], {
    encoding: 'utf-8',
    timeout: 60000,
  });
}

function ok(label, cond, detail = '') {
  if (cond) console.log(`   ✓ ${label}`);
  else errors.push(`[${label}] ${detail}`);
}

/** 写临时卡：delimiter 为 frontmatter 首行（--- 正常 / *** 畸形重排），restLines 为后续行。 */
function writeTmpCard(delimiter, restLines) {
  fs.writeFileSync(TMP_CARD, [delimiter, ...restLines, '---', '', '# zzz-fm-delimiter-tmp', ''].join('\r\n'), 'utf8');
}

console.log('=== 知识卡 frontmatter 分隔符显式校验 ===');

try {
  // 1. 正常 `---` 卡 → 放行
  writeTmpCard('---', [
    'kind: zzz-fm-delimiter-tmp',
    'name: frontmatter 分隔符测试临时卡',
    'tier: leaf',
    'category: utils',
    'source_files:',
    '  - frontend/src/utils/array.ts',
    'use_when:',
    '  - 临时测试',
  ]);
  let r = runDriftJson();
  const legal = r.stdout ? JSON.parse(r.stdout) : { errors: [] };
  ok(
    '`---` 正常卡无 ERROR',
    !legal.errors.some((e) => e.includes('zzz-fm-delimiter-tmp')),
    `不应出现针对临时卡的 ERROR: ${legal.errors.filter((e) => e.includes('zzz-fm-delimiter-tmp')).join('; ').slice(0, 200)}`
  );

  // 2. `***` 开头畸形卡（重排事故指纹）→ ERROR 且指引可操作
  writeTmpCard('***', [
    'kind: zzz-fm-delimiter-tmp',
    'name: 重排事故模拟卡',
    'source_files:',
    '  - frontend/src/utils/array.ts',
  ]);
  r = runDriftJson();
  ok('畸形卡退出码 1', r.status === 1, `status=${r.status}`);
  const bad = r.stdout ? JSON.parse(r.stdout) : { errors: [] };
  const hit = bad.errors.find((e) => e.includes('zzz-fm-delimiter-tmp'));
  ok('畸形卡报 ERROR 且含卡名', Boolean(hit), `期望含卡名: ${bad.errors.join('; ').slice(0, 300)}`);
  ok(
    'ERROR 标注「分隔符异常」',
    Boolean(hit && hit.includes('分隔符异常')),
    `期望含「分隔符异常」: ${(hit || '').slice(0, 200)}`
  );
  ok(
    'ERROR 含「重排」事故指引',
    Boolean(hit && hit.includes('重排')),
    `期望含重排指引: ${(hit || '').slice(0, 200)}`
  );
} finally {
  if (fs.existsSync(TMP_CARD)) fs.unlinkSync(TMP_CARD);
}

if (errors.length) {
  console.log(`FAILED: ${errors.length} issue(s)`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}
console.log('OK: frontmatter 分隔符显式校验契约全过');
