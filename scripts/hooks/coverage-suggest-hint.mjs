#!/usr/bin/env node
/**
 * coverage-suggest-hint.mjs — 覆盖率建议 · prepare-commit-msg 辅助脚本（非阻断）。
 *
 * 设计意图：由 .githooks/prepare-commit-msg 薄壳调用，把"低于语句覆盖率阈值的源文件"
 * 以终端（stderr）即时提醒的方式输出，不写入 commit message body。
 *
 * 依赖：node:child_process / node:path / node:url / 本地模块
 * 用法：由 .githooks/prepare-commit-msg 薄壳调用（非直接命令行入口）
 * 退出码：恒 0（非阻断）；任何异常仅静默跳过，绝不阻塞提交。
 */
// scripts/hooks/coverage-suggest-hint.mjs
//
// 覆盖率建议 · prepare-commit-msg 辅助脚本（非阻断）。
// 由 .githooks/prepare-commit-msg 薄壳调用，把"低于语句覆盖率阈值的源文件"
// 以终端（stderr）即时提醒的方式输出，不写入 commit message body。
//
// 设计要点：
//   - 永远 exit 0（非阻断）；任何异常仅静默跳过，绝不阻塞提交。
//   - 只读 frontend/coverage/coverage-final.json，绝不触发 vitest --coverage
//     （避开 Windows safe-delete 对 coverage/ 目录的路径格式拦截，秒级返回）。
//   - 仅终端输出：coverage 数据来自 stale 的 coverage-final.json（脚本绝不重跑测试），
//     写进 body 会在发版时成为噪声且清单多半已不准；终端提醒已能即时触达 AI/提交者，
//     故不污染 commit 历史。
//   - merge / squash 提交跳过（message 固定、diff 巨大，无追加价值）。
//   - 逃生阀：YSM_SKIP_COVERAGE_HINT=1 git commit
//
// 纯函数（buildBlock）导出供契约测试复用，主流程用 import.meta 守卫。

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getRoot } from '../_lib/scan-files.mjs';
import { run } from '../_lib/proc.ts';

export const BLOCK_START = '🔬 覆盖率建议（非阻断，frontend/vitest.config.ts 阈值）：';
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
  const r = run(process.execPath, [path.join(ROOT, 'scripts', 'test-coverage-report.mjs'), '--suggest', '--json'], { cwd: ROOT });
  if (!r.ok) return [];
  try {
    const j = JSON.parse(r.out);
    return Array.isArray(j.files) ? j.files : [];
  } catch {
    return [];
  }
}

/** 调 check-diff-coverage --suggest --staged，取本次暂存变更的「变更行覆盖率」建议区块。
 * 返回 📈 包裹的 Markdown 区块，或 null（无缺口/无数据，--suggest 永远 exit 0 不抛）。 */
function getDiffCoverageBlock(ROOT) {
  const r = run(process.execPath, [path.join(ROOT, 'scripts', 'check-diff-coverage.mjs'), '--suggest', '--staged'], { cwd: ROOT });
  if (!r.ok) return null;
  const out = r.out.trim();
  if (!out) return null;
  return [DIFF_BLOCK_START, out, DIFF_BLOCK_END].join('\n');
}

/** 格式化时间为 YYYY-MM-DD HH:mm（本地时区；不用 toLocaleString，避免跨平台 locale 漂移）。 */
export function formatCovTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 构造 stale 提示：coverage-final.json 的数据时间戳 + 刷新命令。
 * 数据只读不重跑（见头注释），附时间戳让提交者/AI 判断数据新鲜度，缺产物时提示先跑。
 * @param {Date|null} mtime coverage-final.json 的 mtime；null 表示产物缺失
 * @param {string} covPath 展示用相对路径（默认 frontend/coverage/coverage-final.json）
 */
export function buildStaleHint(mtime, covPath = 'frontend/coverage/coverage-final.json') {
  if (!mtime) return `（${covPath} 无数据；先跑：cd frontend && npx vitest run --coverage）`;
  return `（coverage 数据来自 ${formatCovTime(mtime)}，${covPath}；刷新：cd frontend && npx vitest run --coverage）`;
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
  if (files.length === 0 && !diffBlock) return; // 无缺口或数据缺失：不输出

  // 仅终端提醒：不写 commit body。
  // 原设计把欠测文件清单写进 body 供 PR reviewer 参考，但 coverage 数据来自 stale 的
  // coverage-final.json（脚本绝不重跑测试），到发版时清单多半已不准；且 body 追加会污染
  // commit 历史、在 release-notes 中成为噪声。终端 stderr 摘要已能即时提醒 AI/提交者，
  // 故改为仅终端输出，commit body 保持干净。
  const preview = files.slice(0, 3).map((f) => f.file).join('、');
  const diffCount = diffBlock ? diffBlock.split('\n').filter((l) => l.startsWith('- `')).length : 0;
  // P2-2：files 为空时不再输出「0 个…：」悬空冒号（preview 为空串），只报 📈 部分
  const parts = [];
  if (files.length > 0) {
    parts.push(`🔬 ${files.length} 个源文件低于覆盖率阈值` + (files.length > 3 ? `（前 3：${preview}…）` : `：${preview}`));
  }
  if (diffCount > 0) parts.push(`📈 ${diffCount} 个变更文件低于 diff 覆盖率阈值`);
  if (parts.length === 0) return; // 无缺口（files=[] 且 diff 无缺口）→ 不输出
  // stale 提示：coverage-final.json 只读不重跑，附 mtime + 刷新命令，让提交者/AI 判断数据新鲜度。
  let covMtime = null;
  try {
    covMtime = fs.statSync(path.join(ROOT, 'frontend', 'coverage', 'coverage-final.json')).mtime;
  } catch {
    /* 无 coverage 产物 → buildStaleHint(null) 提示先跑 */
  }
  console.error(`[prepare-commit-msg] ${parts.join('；')}${buildStaleHint(covMtime)}（仅终端提醒）`);
}

// 仅当作为入口直接执行时才跑主流程（被测试 import 时不触发）
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
