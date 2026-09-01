#!/usr/bin/env node
/**
 * diff-coverage-core.ts — 变更行覆盖率门禁共享核。
 *
 * 统一 check-diff-coverage.ts（前端 Istanbul）与 check-go-diff-coverage.ts
 * （Go coverprofile）的「git 变更收集 + 变更行提取 + rename 处理 + 建议区块」。
 * 两入口各自保留语言专属策略（isSource 过滤 / 覆盖率数据源 / 包分组循环）。
 *
 * 背景（scripts 审核 2026-09）：两脚本此前逐行复制 git()/addLinesFromDiff/
 * parseRenameStatus/detectRenames/getChangedLines/getChangedFiles，出现「同一
 * staged-rename 修复改两遍」的历史痕迹（两处都带 HEAD blob 两点 diff 注释）；
 * 抽核后单点修 bug。与 _lib/scan-files.ts 注释「删除各脚本内联样板」同向演进。
 *
 * 零依赖（仅 node:fs / node:path / node:url / _lib）。
 */
import { ROOT } from './scan-files.ts';
import { run } from './proc.ts';

/** 跑 git（失败返回 null，区别于“成功但无输出”的 ''）：调用方 fail-closed，拒绝空跑放行。 */
export function git(args: string[]): string | null {
  const r = run('git', args, { cwd: ROOT });
  return r.ok ? r.out.trim() : null;
}

/**
 * 取本次改动的文件列表（repo-root 相对路径）。
 * 不做语言过滤——由入口按自身 isSource 裁剪（前端 .ts / Go 非测试 .go）。
 * @returns {string[]|null} git 失败返回 null（调用方 fail-closed）。
 */
export function getChangedFiles(base: string, head: string, uncommitted: boolean, staged: boolean) {
  const out = new Set<string>();
  // --staged：仅本次暂存区（prepare-commit-msg 场景 = 本次 commit 的文件），
  // 避免 --base origin/main 在本地领先时把历史未推送改动也纳入噪音。
  if (staged) {
    const g = git(['diff', '--cached', '--find-renames=30', '--name-only']);
    if (g === null) return null;
    g.split('\n').forEach((l) => l && out.add(l));
    return [...out];
  }
  // 三圆点：PR 分支相对 main 合并基的改动
  // --find-renames=30：强制激活 rename 检测（不依赖 git config），
  // 避免 base...head 相对合并基时把 rename 拆成 A+D，导致纯改名被当新增惩罚。
  const g1 = git(['diff', '--diff-filter=ACMR', '--find-renames=30', '--name-only', `${base}...${head}`]);
  if (g1 === null) return null;
  g1.split('\n').forEach((l) => l && out.add(l));
  // 兜底：直推 main 时三圆点可能为空，退化为上一提交
  if (out.size === 0) {
    const g2 = git(['diff', '--diff-filter=ACMR', '--find-renames=30', '--name-only', `${head}~1...${head}`]);
    if (g2 === null) return null;
    g2.split('\n').forEach((l) => l && out.add(l));
  }
  if (uncommitted) {
    const g3 = git(['diff', '--find-renames=30', '--name-only']);
    if (g3 === null) return null;
    g3.split('\n').forEach((l) => l && out.add(l));
    const g4 = git(['diff', '--cached', '--find-renames=30', '--name-only']);
    if (g4 === null) return null;
    g4.split('\n').forEach((l) => l && out.add(l));
  }
  return [...out];
}

/** 解析 `--unified=0` diff 输出，提取新增行号。 */
export function addLinesFromDiff(out: Set<number>, diff: string | null): void {
  if (!diff) return;
  const lines = diff.split('\n');
  let currentLine = 0;
  for (const line of lines) {
    const hdr = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (hdr) {
      currentLine = parseInt(hdr[1], 10);
      continue;
    }
    if (currentLine === 0) continue;
    if (line.startsWith('+')) {
      out.add(currentLine);
      currentLine++;
    } else if (line.startsWith(' ')) {
      // 上下文行（未变更），仍计入行号
      currentLine++;
    }
    // '-' 行在新文件中不存在，不递增行号
  }
}

/** 解析 `git diff --name-status` 的 R 行（R<sim>\t<from>\t<to>）→ Map<to, {from, sim}>。 */
export function parseRenameStatus(out: string) {
  const map = new Map();
  out.split('\n').forEach((l) => {
    const m = l.match(/^R(\d+)\t(.+?)\t(.+)$/);
    if (m) map.set(m[3], { from: m[2], sim: Number(m[1]) });
  });
  return map;
}

export function detectRenames(base: string, head: string, staged: boolean) {
  // --staged：用暂存区 name-status 检测 rename（prepare-commit-msg 场景）
  if (staged) {
    return parseRenameStatus(git(['diff', '--cached', '--name-status', '--find-renames=30'])!);
  }
  // 三圆点：PR 相对 main 合并基
  const map = parseRenameStatus(git(['diff', '--name-status', '--find-renames=30', `${base}...${head}`])!);
  // 兜底：直推 main 时三圆点可能为空，退化为两点
  if (map.size === 0) {
    return parseRenameStatus(git(['diff', '--name-status', '--find-renames=30', base, head])!);
  }
  return map;
}

/** 获取变更文件的具体行号集合（新文件行号）。 */
export function getChangedLines(file: string, base: string, head: string, uncommitted: boolean, renameOld: string | undefined, staged: boolean) {
  const out = new Set<number>();
  // --staged：仅暂存区变更行（本次 commit 的文件）
  if (staged) {
    // [code_review P3] staged rename：pathspec 限定单路径会把旧路径的删除项
    // 从 diff 队列滤掉，rename 对无法配对 → 整文件被判为新增（覆盖率误判）。
    // 与下方非 staged 的 rename 分支同思路：renameOld 存在时用「HEAD 旧 blob ↔
    // 索引新 blob」两点 diff 取真实最小 hunk，否则回退 --cached 常规 diff。
    if (renameOld) {
      addLinesFromDiff(out, git(['diff', '--unified=0', `HEAD:${renameOld}`, `:${file}`]));
      return out;
    }
    addLinesFromDiff(out, git(['diff', '--cached', '--unified=0', '--find-renames=30', '--', file]));
    return out;
  }
  // rename 重构：用两点 blob diff 取「旧路径→新路径」的真实最小 hunk，
  // 避免 base...head 三圆点把 rename 当 add 时整文件被判为新增行。
  if (renameOld) {
    addLinesFromDiff(out, git(['diff', '--unified=0', `${base}:${renameOld}`, `${head}:${file}`]));
    if (out.size > 0) return out;
  }
  addLinesFromDiff(out, git(['diff', '--unified=0', '--find-renames=30', `${base}...${head}`, '--', file]));
  // 兜底：直推 main 时三圆点可能为空
  if (out.size === 0) {
    addLinesFromDiff(out, git(['diff', '--unified=0', '--find-renames=30', `${head}~1...${head}`, '--', file]));
  }
  if (uncommitted) {
    addLinesFromDiff(out, git(['diff', '--unified=0', '--find-renames=30', '--', file]));
    addLinesFromDiff(out, git(['diff', '--cached', '--unified=0', '--find-renames=30', '--', file]));
  }
  return out;
}

/**
 * 构造可追加进 commit message 的非阻断建议区块（幂等剥离由钩子负责）。
 * 仅在 suggest 模式、且有未达标文件时输出；返回 Markdown 字符串，首行即 BLOCK_START 标记。
 * @param {{file:string,pct:number}[]} failures
 * @param {number} threshold
 * @param {object} [opts]
 *   - title {string}  区块标题（默认前端版「## 覆盖率建议（非阻断）」；Go 版传「## Go 覆盖率建议（非阻断）」）
 *   - noun  {string}  文件称谓（默认「文件」；Go 版传「Go 文件」）
 *   - hint  {string}  数据来源提示行（默认前端 vitest 文案；Go 版传 go test -coverprofile 文案）
 */
export function buildSuggestBlock(failures: { file: string; pct: number }[], threshold: number, { title = '## 覆盖率建议（非阻断）', noun = '文件', hint = '本建议基于最近一次 `vitest --coverage` 产物；新逻辑未跑测试时数据可能滞后。' }: { title?: string; noun?: string; hint?: string } = {}) {
  const lines = failures.map((f) => `- \`${f.file}\` — ${f.pct.toFixed(1)}%`);
  return [
    title,
    '',
    `以下改动${noun}变更行覆盖率低于 ${threshold}%，建议后续补测试（不阻塞提交/合并）：`,
    '',
    ...lines,
    '',
    `提示：${hint}`,
  ].join('\n');
}
