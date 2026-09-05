#!/usr/bin/env node
/**
 * 契约测试：知识卡正文行号/行数/计数硬编码引用检查（P1：ADR-162 精神延伸到散文层）。
 *
 * 背景（2026-09-05 P1）：
 *   ADR-162 已把 frontmatter `symbols_with_lines` 去行号（纯符号名，行号位移不再触发
 *   重写）。但正文散文里的手写行号（`L164`、`983 行`、`8 个能力`）从未纳入治理——
 *   重构一次漂一层，无人维护。本检查把「正文禁硬编码行号/行数/计数」作为 WARN 级
 *   护栏（不阻断提交，避免历史债压垮钩子），引导改写为「文件|符号」引用。
 *
 * 验证四件事：
 *   1. 正文无行号引用 → check-knowledge-drift 无此 WARN（合法正文放行）
 *   2. 正文含 `L123` / `L100-200` / `123 行` / `8 个能力` → WARN 且带卡名 + 正文行号
 *   3. frontmatter 内 `:NN`（旧卡兼容格式）→ 不误报（ADR-162 已允许旧格式残留）
 *   4. 检查为 WARN 级 → 退出码 0（不阻断），但 warns 数组含该项
 *
 * 用法：node tests/check-knowledge-body-line-refs.ts
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ok, finish, runScript } from './_lib.mts';

const ROOT = process.cwd();

// 隔离策略同 check-knowledge-perf-tags：临时卡写系统临时目录，
// 经 --kc-dir 指向，避免生成器 glob 到它污染生成物。
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-bodyref-contract-'));
const TMP_CARD = path.join(TMP_DIR, 'zzz-body-line-refs-tmp.md');
const CARD_STEM = 'zzz-body-line-refs-tmp';

function writeTmpCard(bodyExtraLines = []) {
  const fm = [
    '---',
    `kind: ${CARD_STEM}`,
    'name: 正文行号引用契约测试临时卡',
    'tier: leaf',
    'category: utils',
    'source_files:',
    '  - frontend/src/utils/array.ts',
    'use_when:',
    '  - 临时测试',
    'symbols_with_lines:',
    '  - SomeLegacySymbol:42',
    '---',
    '',
    `# 正文行号引用契约测试临时卡`,
    '',
    '## 概览',
    '',
    '契约测试用临时卡，测完即删。',
    '',
    ...bodyExtraLines,
    '',
  ].join('\r\n');
  fs.writeFileSync(TMP_CARD, fm, 'utf8');
}

function runDrift() {
  const r = runScript('check-knowledge-drift.ts', '--json', '--kc-dir', TMP_DIR);
  let out = { errors: [], warns: [] };
  try {
    out = r.stdout ? JSON.parse(r.stdout) : out;
  } catch {
    /* 解析失败保持空 */
  }
  return { status: r.status, out };
}

console.log('=== 知识卡正文行号/行数/计数硬编码引用契约 ===');

try {
  // 1. 正文干净 → 无此 WARN
  writeTmpCard();
  let { status, out } = runDrift();
  ok(
    '干净正文无 body-line 相关 WARN',
    !out.warns.some((w) => w.includes(CARD_STEM) && w.includes('行号')),
    `不应出现正文行号 WARN: ${out.warns.join('; ').slice(0, 200)}`
  );
  ok('干净正文退出码 0', status === 0, `status=${status}`);

  // 2. frontmatter 旧 `:NN` 格式不误报（ADR-162 兼容旧卡）
  writeTmpCard(['此卡 frontmatter 带 SomeLegacySymbol:42，正文不应误报。']);
  ({ status, out } = runDrift());
  ok(
    'frontmatter :NN 不误报正文行号',
    !out.warns.some((w) => w.includes(CARD_STEM) && w.includes('行号')),
    `frontmatter :NN 不应触发正文行号 WARN: ${out.warns.join('; ').slice(0, 200)}`
  );

  // 3. 正文含 L123（单行号）
  writeTmpCard(['`mount3D` 入口（L123）捕获本次代数。']);
  ({ status, out } = runDrift());
  ok(
    '正文 L123 → WARN 且带卡名+行号',
    out.warns.some((w) => w.includes(CARD_STEM) && w.includes('L123')) ? true : false,
    `期望 WARN 含卡名与 L123: ${out.warns.join('; ').slice(0, 300)}`
  );
  ok('WARN 级不阻断 → 退出码 0', status === 0, `status=${status}`);

  // 4. 正文含行号区间 L100-200
  writeTmpCard(['函数本体 L100-200 仍超 100 行红线。']);
  ({ status, out } = runDrift());
  ok(
    '正文 L100-200 区间 → WARN',
    out.warns.some((w) => w.includes(CARD_STEM)),
    `期望 WARN: ${out.warns.join('; ').slice(0, 300)}`
  );

  // 5. 正文含行数引用「123 行」
  writeTmpCard(['mount-preview-core.ts 现 888 行，mount3D 本体 527 行。']);
  ({ status, out } = runDrift());
  ok(
    '正文「888 行」行数 → WARN',
    out.warns.some((w) => w.includes(CARD_STEM)),
    `期望 WARN: ${out.warns.join('; ').slice(0, 300)}`
  );

  // 6. 正文含计数「8 个能力」
  writeTmpCard(['`createAll()` 创建 8 个能力（天空/地面/环境/雾）。']);
  ({ status, out } = runDrift());
  ok(
    '正文「8 个能力」计数 → WARN',
    out.warns.some((w) => w.includes(CARD_STEM)),
    `期望 WARN: ${out.warns.join('; ').slice(0, 300)}`
  );

  // 6.5. 语义误报豁免：这些是描述性事实而非会漂移的导航行号
  writeTmpCard([
    '求值闭包见 ADR-100 L4 与 ADR-100 L1-L3（ADR 章节引用）。',
    '对账摘要须控制在 ≤15 行以内。',
    'bridge_windows.go 约 ~137 行的规模估算。',
    'sample 已从 1504→827 行收缩（历史变化记录）。',
    '第三方实现区间：AO 在 301–360 行、tint 在 9–30 行。',
    '新增设置项不超过 20-30 行闭包。',
  ]);
  ({ status, out } = runDrift());
  ok(
    'ADR 章节引用 / ≤上限 / ~估算 / →历史变化 / –区间 / N-M 范围 均不报',
    !out.warns.some((w) => w.includes(CARD_STEM)),
    `豁免失败: ${out.warns.filter((w) => w.includes(CARD_STEM)).join(' | ').slice(0, 300)}`
  );

  // 7. 正文含符号引用（文件|符号）→ 不误报
  writeTmpCard(['入口见 `mount-preview-core.ts|mount3D`，签名不动（回归红线）。']);
  ({ status, out } = runDrift());
  ok(
    '正文「文件|符号」引用不误报',
    !out.warns.some((w) => w.includes(CARD_STEM)),
    `文件|符号引用不应触发 WARN: ${out.warns.join('; ').slice(0, 200)}`
  );

  // 8. WARN 文案应包含改写指引（ADR-162 精神）
  writeTmpCard(['入口见 L123。']);
  ({ status, out } = runDrift());
  const hint = out.warns.find((w) => w.includes(CARD_STEM) && w.includes('L123')) || '';
  ok(
    'WARN 含改写指引（文件|符号）',
    hint.includes('文件') && hint.includes('符号'),
    `期望指引「文件|符号」: ${hint.slice(0, 300)}`
  );
} finally {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

finish('知识卡正文行号引用契约全过');