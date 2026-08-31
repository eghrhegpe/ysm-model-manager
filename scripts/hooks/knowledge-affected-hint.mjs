#!/usr/bin/env node
/**
 * knowledge-affected-hint.mjs — 知识卡漂移主动防御 · prepare-commit-msg 辅助脚本（非阻断）。
 *
 * 设计意图：由 .githooks/prepare-commit-msg 薄壳调用，把"受本次 staged 变更影响的知识卡"
 * 以终端（stderr）即时提醒的方式输出，不写入 commit message body。
 *
 * 依赖：node:child_process / node:path / node:url / 本地模块
 * 用法：由 .githooks/prepare-commit-msg 薄壳调用（非直接命令行入口）
 * 退出码：恒 0（非阻断）；任何异常仅静默跳过，绝不阻塞提交。
 */
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
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getRoot } from '../_lib/scan-files.ts';
import { run } from '../_lib/proc.ts';

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

/**
 * 旧→新关键词迁移对（ADR-047 Pointer Events 迁移 + 历史平台演进）。
 * 卡内容仍含 old（正则，`i` 大小写不敏感：`MouseDown`/`mouseDown` 均命中）而本次
 * staged diff 的新增行引入了 new → 疑似过时句。oldWord 为纯词展示用（避免暴露正则源码）。
 * 词边界 \b：避免 mousedown 命中 mousemove 的误判（JS 中 CJK 属 \W，与 \w 构成边界）。
 */
export const STALE_KEYWORD_PAIRS = [
  // 裸词 mouse：泛指「鼠标监听/鼠标事件」的卡描述（如「移除 mouse 监听」），
  // 迁移后源码已 pointer 系列——精确词（mousedown 等）覆盖不到，故单列（真实命中：model3d.md）
  { old: /\bmouse\b/i, new: 'pointer', oldWord: 'mouse' },
  { old: /\bmousedown\b/i, new: 'pointerdown', oldWord: 'mousedown' },
  { old: /\bmousemove\b/i, new: 'pointermove', oldWord: 'mousemove' },
  { old: /\bmouseup\b/i, new: 'pointerup', oldWord: 'mouseup' },
  { old: /\bmouseenter\b/i, new: 'pointerenter', oldWord: 'mouseenter' },
  { old: /\bmouseleave\b/i, new: 'pointerleave', oldWord: 'mouseleave' },
  // hover 变体（防御性：社区 tooltip 等若迁 pointerover 需要覆盖）
  { old: /\bmouseover\b/i, new: 'pointerover', oldWord: 'mouseover' },
  { old: /\bmouseout\b/i, new: 'pointerout', oldWord: 'mouseout' },
];

/** 提取 diff 的新增行（`+` 开头且非 `+++` 文件头），删除行/上下文行不计。 */
export function addedLinesOf(diffText) {
  return diffText.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
}

/** 检测 diff 新增行是否引入任一 new 关键词（命中返回 true）。 */
export function diffIntroducesNew(diffText, pairs = STALE_KEYWORD_PAIRS) {
  const added = addedLinesOf(diffText);
  return pairs.some((p) => added.some((l) => l.toLowerCase().includes(p.new)));
}

/** 行内是否含某关键词（大小写不敏感）。 */
function hasWord(line, word) {
  return line.toLowerCase().includes(word.toLowerCase());
}

/**
 * 扫描卡文本（正文，不含 frontmatter），找出「本次 diff 已引入 new、卡里仍写过时 old」
 * 的疑似过时句。
 * 跳过对照/警示语境：行内已含对应新词（如「替代 mouseenter/mouseleave」）、
 * 或含禁止/迁移类警示词（如「不得出现 mousedown」）——这些是刻意提及而非过时。
 * @param lineOffset 正文在完整文件中的起始行号（frontmatter 行数），输出 line 为全文行号
 * @returns Array<{ line: number; text: string; pair: {old,new,oldWord} }>
 */
export function findStaleSnippets(cardText, diffText, pairs = STALE_KEYWORD_PAIRS, lineOffset = 0) {
  const added = addedLinesOf(diffText);
  const introduced = new Set(
    pairs.filter((p) => added.some((l) => hasWord(l, p.new))).map((p) => p.new),
  );
  if (introduced.size === 0) return [];
  // 警示/对照语境词：行内含其一即视为刻意提及（对照说明、禁止条款、迁移描述）。
  // 中文词无词边界（CJK），英文词加 \b 防子串误伤（如 MUST NOT 不命中 MUST NOTICE）；
  // /i 统一大小写（Deprecated / MUST NOT / don't 变体均识别）
  const CONTEXTUAL = /(替代|替换|取代|迁移|不再|禁止|不得|避免|仍用|旧写法|废弃|\bdeprecated\b|\bDON'T\b|\bMUST NOT\b)/i;
  const out = [];
  const lines = cardText.split('\n');
  lines.forEach((line, idx) => {
    for (const p of pairs) {
      if (!introduced.has(p.new)) continue;
      if (!p.old.test(line)) continue;
      if (CONTEXTUAL.test(line) || hasWord(line, p.new)) break; // 对照/警示语境不报
      out.push({ line: idx + 1 + lineOffset, text: line.trim(), pair: p });
      break; // 同一行多个旧词只报一次
    }
  });
  return out;
}

/**
 * 解析知识卡文件文本 → { body, offset }。
 * body 为剥离 frontmatter（--- ... ---，含 \r?\n 容错）后的正文；offset 为正文起始
 * 行号（frontmatter 占行数），供 findStaleSnippets 输出全文行号而非 body 相对行号。
 */
export function parseCardText(text) {
  // 允许 UTF-8 BOM（\uFEFF）——Windows 编辑器可能写入，`^---` 锚定会失配
  const m = text.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!m) return { body: text, offset: 0 };
  // offset = frontmatter 块内换行数（`---\n...\n---\n` 共 N 个 \n → 正文第一行为 N+1 行）
  let offset = (m[0].match(/\n/g) || []).length;
  let body = text.slice(m[0].length);
  // 剥离 frontmatter 与正文之间的分隔空行（若有），offset 同步 +1 保持行号准确
  if (body.startsWith('\n')) {
    body = body.slice(1);
    offset += 1;
  }
  return { body, offset };
}

function getStagedChanged() {
  // --diff-filter=ACMRD 含删除(D)/重命名(R)：卡 source_files 引用的源码文件被删/重命名时
  // 同样需要提示复核（此前仅 ACM 漏掉 D/R）；quotePath=false 保证非 ASCII 路径不被
  // 引号/八进制转义破坏与 check-knowledge-drift 的匹配。
  // 注意：被删/重命名的「卡文件本身」不在此覆盖（--affected 只匹配磁盘上现存卡的
  // source_files，删除的卡不在索引中），那是另一类场景（code_review P3 注释校准）。
  const r = run('git', ['-c', 'core.quotePath=false', 'diff', '--cached', '--name-only', '--diff-filter=ACMRD'], {});
  if (!r.ok) return [];
  return r.out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function getAffectedCards(ROOT, changed) {
  // 用 process.execPath（当前 node 的 Windows 绝对路径），避免 Git Bash msys 路径
  // 在 Windows 版 node 的 execFileSync 中无法被 CreateProcess 解析的陷阱。
  const r = run(
    process.execPath,
    [path.join(ROOT, 'scripts', 'check-knowledge-drift.mjs'), '--affected', '--quiet', ...changed],
    {},
  );
  if (!r.ok) return [];
  return r.out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** 获取 staged 变更的 diff 内容（供疑似过时句检测）。失败返回空串。 */
function getStagedDiff() {
  const r = run('git', ['diff', '--cached'], { maxBuffer: 10 * 1024 * 1024 });
  if (!r.ok) return '';
  return r.out;
}

/** 读取知识卡正文（跳过 frontmatter），失败返回空串。返回 { body, offset }。 */
function readCardBody(ROOT, card) {
  try {
    const text = fs.readFileSync(path.join(ROOT, 'docs', 'knowledge', `${card}.md`), 'utf8');
    // 剥离 frontmatter（--- ... ---，_lib 容错 \r?\n），只扫正文——frontmatter 的
    // use_when 关键词不算过时；offset 补偿正文相对行号 → 全文行号（P2 修复）
    return parseCardText(text);
  } catch {
    return { body: '', offset: 0 };
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

  // 疑似过时句检测：diff 新增行引入了新关键词（如 pointerdown）而卡正文仍写旧词（如 mousedown）
  const diffText = getStagedDiff();
  const staleByCard = new Map();
  for (const card of cards) {
    const { body, offset } = readCardBody(ROOT, card);
    if (!body) continue;
    const hits = findStaleSnippets(body, diffText, STALE_KEYWORD_PAIRS, offset);
    if (hits.length) staleByCard.set(card, hits);
  }

  // 仅终端提醒：不写 commit body。
  // 原设计把受影响知识卡写进 body 供 PR reviewer 复核文档，但 code review 不核验文档，
  // body 追加无受益方；终端 stderr 摘要已能即时提醒提交者/AI，故改为仅终端输出。
  const lines = [`[prepare-commit-msg] 📚 ${cards.length} 张知识卡受影响，建议复核：`];
  for (const card of cards) {
    const stale = staleByCard.get(card);
    if (stale?.length) {
      // 有疑似过时句：精确指行（全文行号），收件人可直接改（ADR-047 增强）
      lines.push(`  - docs/knowledge/${card}.md ⚠️ 疑似过时（本次 diff 已引入新写法）:`);
      for (const s of stale) {
        lines.push(`      L${s.line} ${s.text.slice(0, 60)}（仍用 ${s.pair.oldWord}，建议 ${s.pair.new}）`);
      }
    } else {
      lines.push(`  - docs/knowledge/${card}.md`);
    }
  }
  lines.push('（仅终端提醒）');
  console.error(lines.join('\n'));
}

// 仅当作为入口直接执行时才跑主流程（被测试 import 时不触发）
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
