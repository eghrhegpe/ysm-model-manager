#!/usr/bin/env node
// scripts/hooks/knowledge-affected-hint.mjs
//
// 知识卡漂移主动防御 · prepare-commit-msg 辅助脚本（非阻断）。
// 由 .githooks/prepare-commit-msg 薄壳调用，把"受本次 staged 变更影响的知识卡"
// 以终端（stderr）即时提醒的方式输出，不写入 commit message body。
//
// 设计要点：
//   - 永远 exit 0（非阻断）；任何异常仅静默跳过，绝不阻塞提交。
//   - 仅终端输出：code review 不核验文档，写进 body 无受益方；终端提醒已能即时触达
//     AI/提交者，故不污染 commit 历史。
//   - merge / squash 提交跳过（message 固定、diff 巨大，无追加价值）。
//   - 逃生阀：YSM_SKIP_KNOWLEDGE_HINT=1 git commit
//
// 纯函数（stripBlock / buildBlock）导出供契约测试复用，主流程用 import.meta 守卫。

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getRoot } from '../_lib/scan-files.mjs';

export const BLOCK_START = '📚 受影响知识卡（建议同步复核 docs/knowledge）：';
export const BLOCK_END = '📚 ──END──';

/** 幂等剥离旧区块（按首尾标记，字符串定位，避免正则转义坑）。
 *  同时吞掉 BLOCK 前的一个换行（分隔空行）与 BLOCK 后紧跟的换行，保持 message 整洁。 */
export function stripBlock(msg, start = BLOCK_START, end = BLOCK_END) {
  const i = msg.indexOf(start);
  if (i < 0) return msg;
  const j = msg.indexOf(end, i);
  if (j < 0) return msg;
  let pre = msg.slice(0, i);
  if (pre.endsWith('\n')) pre = pre.slice(0, -1);
  let post = msg.slice(j + end.length);
  if (post.startsWith('\n')) post = post.slice(1);
  return pre + post;
}

/** 构造待追加区块（卡片 stem → docs/knowledge/<stem>.md）。 */
export function buildBlock(cards, start = BLOCK_START, end = BLOCK_END) {
  return [BLOCK_START, ...cards.map((c) => `- docs/knowledge/${c}.md`), end].join('\n');
}

function getStagedChanged() {
  try {
    return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function getAffectedCards(ROOT, changed) {
  // 用 process.execPath（当前 node 的 Windows 绝对路径），避免 Git Bash msys 路径
  // 在 Windows 版 node 的 execFileSync 中无法被 CreateProcess 解析的陷阱。
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'check-knowledge-drift.mjs'), '--affected', '--quiet', ...changed],
      { encoding: 'utf8' },
    );
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function main() {
  const msgFile = process.argv[2];
  const source = process.argv[3] || '';

  if (!msgFile) return;
  if (process.env.YSM_SKIP_KNOWLEDGE_HINT === '1') return;
  if (source === 'merge' || source === 'squash') return; // 跳过固定 message 的大 diff

  const ROOT = getRoot();
  if (!ROOT) return;

  const changed = getStagedChanged();
  if (changed.length === 0) return;

  const cards = getAffectedCards(ROOT, changed);
  if (cards.length === 0) return;

  // 仅终端提醒：不写 commit body。
  // 原设计把受影响知识卡写进 body 供 PR reviewer 复核文档，但 code review 不核验文档，
  // body 追加无受益方；终端 stderr 摘要已能即时提醒提交者/AI，故改为仅终端输出。
  console.error(
    `[prepare-commit-msg] 📚 ${cards.length} 张知识卡受影响，建议复核：` +
      cards.map((c) => `docs/knowledge/${c}.md`).join('、') +
      `（仅终端提醒，未写入 commit body）`,
  );
}

// 仅当作为入口直接执行时才跑主流程（被测试 import 时不触发）
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
