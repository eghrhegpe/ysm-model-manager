#!/usr/bin/env node
// scripts/hooks/coverage-suggest-hint.mjs
//
// 覆盖率建议 · prepare-commit-msg 辅助脚本（非阻断）。
// 由 .githooks/prepare-commit-msg 薄壳调用，把"低于语句覆盖率阈值的源文件"
// 写入 commit message body，随 commit 进入 PR，供 review 参考补测方向。
//
// 设计要点：
//   - 永远 exit 0（非阻断）；任何异常仅静默跳过，绝不阻塞提交。
//   - 只读 frontend/coverage/coverage-final.json，绝不触发 vitest --coverage
//     （避开 Windows safe-delete 对 coverage/ 目录的路径格式拦截，秒级返回）。
//   - 幂等：复用 knowledge-affected-hint 的 stripBlock（自定义 🔬 标记），--amend 不重复。
//   - merge / squash 提交跳过（message 固定、diff 巨大，无追加价值）。
//   - 逃生阀：YSM_SKIP_COVERAGE_HINT=1 git commit
//
// 纯函数（stripBlock / buildBlock）导出供契约测试复用，主流程用 import.meta 守卫。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getRoot } from '../_lib/scan-files.mjs';
import { normalizeGitPath } from '../_lib/posix-gitpath.mjs';
import { stripBlock } from './knowledge-affected-hint.mjs';

export const BLOCK_START = '🔬 覆盖率建议（非阻断，frontend/vite.config.js 阈值）：';
export const BLOCK_END = '🔬 ──END──';
/** diff 覆盖率建议区块标记（check-diff-coverage --suggest 输出，幂等剥离用） */
export const DIFF_BLOCK_START = '📈 diff 覆盖率建议（非阻断，变更行阈值 60%）：';
export const DIFF_BLOCK_END = '📈 ──END──';
/** 区块内最多列出的低覆盖文件数，避免 commit message 过长（完整清单见 --suggest）。 */
export const MAX_SUGGEST_FILES = 20;

/** 构造待追加区块（低覆盖率文件 → 一行一个：百分比 + 文件 + 未覆盖行区间；超上限省略）。 */
export function buildBlock(files, start = BLOCK_START, end = BLOCK_END) {
  const shown = files.slice(0, MAX_SUGGEST_FILES);
  const lines = [
    start,
    ...shown.map((f) => {
      const range = f.uncoveredRanges ? `（未覆盖行 ${f.uncoveredRanges}）` : '';
      return `- [${f.stmts}%] ${f.file}${range}`;
    }),
  ];
  if (files.length > MAX_SUGGEST_FILES) {
    lines.push(`- …其余 ${files.length - MAX_SUGGEST_FILES} 个见 node scripts/test-coverage-report.mjs --suggest`);
  }
  lines.push(end);
  return lines.join('\n');
}

/** 调 test-coverage-report --suggest --json，取低于阈值的文件清单（永远不抛）。 */
function getLowCoverageFiles(ROOT) {
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'test-coverage-report.mjs'), '--suggest', '--json'],
      { encoding: 'utf8' },
    );
    const j = JSON.parse(out);
    return Array.isArray(j.files) ? j.files : [];
  } catch {
    return [];
  }
}

/**
 * 调 check-diff-coverage --suggest --staged，取本次暂存变更的「变更行覆盖率」建议区块。
 * 返回 📈 包裹的 Markdown 区块，或 null（无缺口/无数据，--suggest 永远 exit 0 不抛）。
 */
function getDiffCoverageBlock(ROOT) {
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'check-diff-coverage.mjs'), '--suggest', '--staged'],
      { encoding: 'utf8' },
    ).trim();
    if (!out) return null;
    return [DIFF_BLOCK_START, out, DIFF_BLOCK_END].join('\n');
  } catch {
    return null;
  }
}

function main() {
  const msgFile = process.argv[2];
  const source = process.argv[3] || '';

  if (!msgFile) return;
  if (process.env.YSM_SKIP_COVERAGE_HINT === '1') return;
  if (source === 'merge' || source === 'squash') return; // 跳过固定 message 的大 diff

  const ROOT = getRoot();
  if (!ROOT) return;

  const files = getLowCoverageFiles(ROOT);
  const diffBlock = getDiffCoverageBlock(ROOT);
  if (files.length === 0 && !diffBlock) return; // 无缺口或数据缺失：都不写区块

  const absFile = normalizeGitPath(msgFile, ROOT);
  let msg;
  try {
    msg = fs.readFileSync(absFile, 'utf8');
  } catch {
    return;
  }

  // 幂等剥离：🔬 整体建议 + 📈 diff 建议均按标记剥离，再按需重新附加（--amend 不重复）
  let stripped = stripBlock(msg, BLOCK_START, BLOCK_END);
  stripped = stripBlock(stripped, DIFF_BLOCK_START, DIFF_BLOCK_END);
  const parts = [];
  if (files.length > 0) parts.push(buildBlock(files));
  if (diffBlock) parts.push(diffBlock);
  const block = '\n' + parts.join('\n');
  const next = stripped.trimEnd() + block + '\n';
  try {
    fs.writeFileSync(absFile, next);
    // 摘要走 stderr：AI 的感知通道是终端，commit body 是给 PR review 看的（AI 是写信人不是收信人）
    const preview = files.slice(0, 3).map((f) => f.file).join('、');
    const diffCount = diffBlock ? diffBlock.split('\n').filter((l) => l.startsWith('- `')).length : 0;
    console.error(
      `[prepare-commit-msg] 🔬 ${files.length} 个源文件低于覆盖率阈值，已写入 commit body` +
        (files.length > 3 ? `（前 3：${preview}…）` : `：${preview}`) +
        (diffCount > 0 ? `；📈 ${diffCount} 个变更文件低于 diff 覆盖率阈值` : ''),
    );
  } catch {
    /* 非阻断：写失败不影响提交 */
  }
}

// 仅当作为入口直接执行时才跑主流程（被测试 import 时不触发）
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
