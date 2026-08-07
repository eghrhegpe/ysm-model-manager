#!/usr/bin/env node
/**
 * check-diff-coverage.mjs — 变更文件覆盖率门禁（diff-coverage gate）。
 *
 * 设计意图：整体覆盖率阈值只防整体回退、不保护「新代码有测试」。本脚本
 * 仅检查「本次 git 变更的非测试源码」的变更行覆盖率，低于阈值即阻断；
 * 保护 PR/commit 的新增逻辑不裸奔（源自 MikuMikuAR P8-A gate，适配本仓库）。
 *
 * 用法（仓库根运行，命令统一 node scripts/<name>.mjs）：
 *   node scripts/check-diff-coverage.mjs                          # base=origin/main, threshold=60
 *   node scripts/check-diff-coverage.mjs --threshold 80           # 提高阈值
 *   node scripts/check-diff-coverage.mjs --uncommitted            # 纳入工作区+暂存区（本地预检）
 *   node scripts/check-diff-coverage.mjs --staged                 # 仅本次暂存区（prepare-commit-msg 场景）
 *   node scripts/check-diff-coverage.mjs --files a.ts,b.ts        # 跳过 git，直接给文件列表（调试）
 *   node scripts/check-diff-coverage.mjs --suggest                # 非阻断建议：输出 commit message 建议区块，永远 exit 0
 *   node scripts/check-diff-coverage.mjs --json                   # JSON（CI / 子代理消费）
 *   node scripts/check-diff-coverage.mjs --coverage <path>        # 覆盖默认 frontend/coverage/coverage-final.json
 *
 * 退出码：0 = 全部达标；1 = 存在未达标文件；2 = 配置/用法错误（缺覆盖率文件或 git 失败）。
 * rename 处理：--find-renames 检测 + 两点 blob diff 取真实最小 hunk；纯改名自然达标，
 *   rename 中新增的真实逻辑仍受覆盖约束。
 * 依赖：node:child_process / node:fs / node:path / node:url / 本地模块
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './_lib/scan-files.mjs';

const USAGE_ERROR = 2;
const COVERAGE_FAILURE = 1;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (a === '--uncommitted' || a === '--json' || a === '--suggest' || a === '--staged') {
      out[a.slice(2)] = true;
    } else if (i + 1 < argv.length) {
      out[a.slice(2)] = argv[++i];
    }
  }
  return out;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** 取本次改动的非测试源码文件（repo-root 相对路径）。 */
function getChangedFiles(base, head, uncommitted, staged) {
  const out = new Set();
  // --staged：仅本次暂存区（prepare-commit-msg 场景 = 本次 commit 的文件），
  // 避免 --base origin/main 在本地领先时把历史未推送改动也纳入噪音。
  if (staged) {
    git(['diff', '--cached', '--find-renames=30', '--name-only'])
      .split('\n')
      .forEach((l) => l && out.add(l));
    return [...out];
  }
  // 三圆点：PR 分支相对 main 合并基的改动
  // --find-renames=30：强制激活 rename 检测（不依赖 git config），
  // 避免 base...head 相对合并基时把 rename 拆成 A+D，导致纯改名被当新增惩罚。
  git(['diff', '--diff-filter=ACMR', '--find-renames=30', '--name-only', `${base}...${head}`])
    .split('\n')
    .forEach((l) => l && out.add(l));
  // 兜底：直推 main 时三圆点可能为空，退化为上一提交
  if (out.size === 0) {
    git(['diff', '--diff-filter=ACMR', '--find-renames=30', '--name-only', `${head}~1...${head}`])
      .split('\n')
      .forEach((l) => l && out.add(l));
  }
  if (uncommitted) {
    git(['diff', '--find-renames=30', '--name-only'])
      .split('\n')
      .forEach((l) => l && out.add(l));
    git(['diff', '--cached', '--find-renames=30', '--name-only'])
      .split('\n')
      .forEach((l) => l && out.add(l));
  }
  return [...out];
}

/** 解析 `--unified=0` diff 输出，提取新增行号。 */
export function addLinesFromDiff(out, diff) {
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
export function parseRenameStatus(out) {
  const map = new Map();
  out.split('\n').forEach((l) => {
    const m = l.match(/^R(\d+)\t(.+?)\t(.+)$/);
    if (m) map.set(m[3], { from: m[2], sim: Number(m[1]) });
  });
  return map;
}

export function detectRenames(base, head, staged) {
  // --staged：用暂存区 name-status 检测 rename（prepare-commit-msg 场景）
  if (staged) {
    return parseRenameStatus(git(['diff', '--cached', '--name-status', '--find-renames=30']));
  }
  // 三圆点：PR 相对 main 合并基
  const map = parseRenameStatus(git(['diff', '--name-status', '--find-renames=30', `${base}...${head}`]));
  // 兜底：直推 main 时三圆点可能为空，退化为两点
  if (map.size === 0) {
    return parseRenameStatus(git(['diff', '--name-status', '--find-renames=30', base, head]));
  }
  return map;
}

/** 获取变更文件的具体行号集合（新文件行号）。 */
export function getChangedLines(file, base, head, uncommitted, renameOld, staged) {
  const out = new Set();
  // --staged：仅暂存区变更行（本次 commit 的文件）
  if (staged) {
    // [code_review P3] staged rename：pathsocope 限定单路径会把旧路径的删除项
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

/** 仅保留应纳入 diff 门禁的源码：frontend/src 下、非测试、非 index/wails 绑定产物。 */
function isSourceFile(f) {
  return (
    f.endsWith('.ts') &&
    f.includes('src/') &&
    !f.endsWith('.test.ts') &&
    !f.includes('__tests__/') &&
    !f.endsWith('/index.ts') &&
    !f.includes('/wails/') // Wails v3 绑定产物（自动生成，无测试价值）
  );
}

/** 把 repo 相对路径映射到 coverage-final.json 的绝对路径 key。 */
function matchCoverageKey(rel, covKeys) {
  const norm = rel.split(sep).join('/');
  const stripped = norm.replace(/^frontend\//, '');
  for (const k of covKeys) {
    const nk = k.split(sep).join('/');
    if (nk === norm) return k;
    if (nk.endsWith('/' + norm)) return k;
    if (nk.endsWith('/' + stripped)) return k;
  }
  return null;
}

/** 变更行相关的语句覆盖率百分比。 */
export function statementPctForChangedLines(entry, changedLines) {
  const s = entry?.s || {};
  const sm = entry?.statementMap || {};
  const ids = Object.keys(s);
  if (ids.length === 0) return 100;

  // 找出落在变更行范围内的 statement ID
  const relevantIds = ids.filter((id) => {
    const loc = sm[id];
    if (!loc) return false;
    const startLine = loc.start.line;
    const endLine = loc.end?.line ?? startLine;
    for (let line = startLine; line <= endLine; line++) {
      if (changedLines.has(line)) return true;
    }
    return false;
  });

  if (relevantIds.length === 0) return 100; // 变更行上无语句（纯注释/格式变动）

  let covered = 0;
  for (const id of relevantIds) {
    if ((s[id] || 0) > 0) covered++;
  }
  return (covered / relevantIds.length) * 100;
}

/**
 * 构造可追加进 commit message 的非阻断建议区块（幂等剥离由钩子负责）。
 * 仅在 suggest 模式、且有未达标文件时输出；返回 Markdown 字符串，首行即 BLOCK_START 标记。
 */
export function buildSuggestBlock(failures, threshold) {
  const lines = failures.map((f) => `- \`${f.file}\` — ${f.pct.toFixed(1)}%`);
  return [
    '## 覆盖率建议（非阻断）',
    '',
    `以下改动文件变更行覆盖率低于 ${threshold}%，建议后续补测试（不阻塞提交/合并）：`,
    '',
    ...lines,
    '',
    '提示：本建议基于最近一次 `vitest --coverage` 产物；新逻辑未跑测试时数据可能滞后。',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const coveragePath = args.coverage
    ? resolve(ROOT, args.coverage)
    : resolve(ROOT, 'frontend', 'coverage', 'coverage-final.json');
  const base = args.base ?? 'origin/main';
  const head = args.head ?? 'HEAD';
  const threshold = Number(args.threshold ?? '60');
  const uncommitted = Boolean(args.uncommitted);
  const staged = Boolean(args.staged);
  const json = Boolean(args.json);
  const suggest = Boolean(args.suggest);

  if (!existsSync(coveragePath)) {
    if (suggest) {
      // 非阻断建议模式：无覆盖率数据时静默跳过，不阻塞提交
      console.log(`[diff-coverage] 未找到覆盖率文件：${coveragePath}（建议模式：先跑 \`vitest run --coverage\` 可生成建议）`);
      process.exit(0);
    }
    console.error(`[diff-coverage] 未找到覆盖率文件：${coveragePath}`);
    console.error(`[diff-coverage] 请先运行 \`vitest run --coverage\` 生成 coverage-final.json。`);
    process.exit(USAGE_ERROR);
  }

  const cov = JSON.parse(readFileSync(coveragePath, 'utf8'));
  const covKeys = Object.keys(cov).filter((k) => k !== 'total');

  // 门禁前置校验：git 环境异常时绝不“空跑报通过”。
  // git() 在命令失败时返回 ''（catch 吞错），若不加校验，base 不可达/浅克隆未 fetch
  // 会使 diff 全空 → srcFiles=[] → 错误落入「本次无改动源码需要检查。通过。」分支。
  // 门禁模式（默认/json/文本）fail-closed 退出 USAGE_ERROR；--suggest 提示模式保持非阻断。
  const failOrWarn = (msg) => {
    if (suggest) {
      console.log(`[diff-coverage] ${msg}（建议模式：跳过）`);
      process.exit(0);
    }
    console.error(`[diff-coverage] ${msg}`);
    process.exit(USAGE_ERROR);
  };
  if (!args.files) {
    if (!git(['rev-parse', 'HEAD'])) {
      failOrWarn('无法解析 HEAD（git 环境异常/不在仓库内）');
    }
    if (!staged && !git(['rev-parse', '--verify', base])) {
      failOrWarn(`基准分支不可达：${base}（请先 \`git fetch\` 或改用 --base 指向本地分支）`);
    }
  }

  const changed = args.files
    ? args.files.split(',').map((s) => s.trim()).filter(Boolean)
    : getChangedFiles(base, head, uncommitted, staged);

  const renameMap = detectRenames(base, head, staged);
  const srcFiles = changed.filter(isSourceFile);

  if (srcFiles.length === 0) {
    console.log(`[diff-coverage] 本次无改动源码需要检查（阈值 ${threshold}%）。通过。`);
    process.exit(0);
  }

  const rows = [];
  const failures = [];
  const useFilesMode = Boolean(args.files); // --files 模式无 git 上下文，回退到全文件检查
  for (const f of srcFiles) {
    const key = matchCoverageKey(f, covKeys);
    let pct;
    if (!key) {
      pct = 0; // 无覆盖率条目 → 视为 0% 未覆盖
    } else if (useFilesMode) {
      pct = statementPctForChangedLines(cov[key], new Set(Object.keys(cov[key].statementMap).flatMap((id) => {
        const loc = cov[key].statementMap[id];
        if (!loc) return [];
        const lines = [];
        for (let l = loc.start.line; l <= (loc.end?.line ?? loc.start.line); l++) lines.push(l);
        return lines;
      }))); // --files 模式：视所有行均为变更行 = 全文件检查
    } else {
      const renameOld = renameMap.get(f)?.from;
      const changedLines = getChangedLines(f, base, head, uncommitted, renameOld, staged);
      pct = statementPctForChangedLines(cov[key], changedLines);
    }
    const missing = !key; // 无覆盖率条目 → 视为 0% 未覆盖
    const renamed = renameMap.has(f);
    rows.push({ file: f, pct, missing, renamed });
    if (pct < threshold) failures.push({ file: f, pct, renamed });
  }

  if (suggest) {
    // 非阻断建议模式：永远 exit 0，仅在有缺口时输出可追加进 commit message 的区块
    if (failures.length > 0) {
      console.log(buildSuggestBlock(failures, threshold));
    }
    process.exit(0);
  }

  if (json) {
    console.log(JSON.stringify({
      _summary: { threshold, files: rows.length, failed: failures.length },
      rows,
      failures,
    }, null, 2));
    process.exit(failures.length > 0 ? COVERAGE_FAILURE : 0);
  }

  console.log(`\n[diff-coverage] 变更源码 ${srcFiles.length} 个，阈值 ${threshold}%（变更行覆盖率）：`);
  console.log('  ' + '文件'.padEnd(70) + '覆盖%');
  console.log('  ' + '-'.repeat(70) + '------');
  for (const r of rows) {
    const flag = r.pct < threshold ? 'X' : 'OK';
    const tag = r.renamed ? 'R' : ' ';
    console.log(`  [${flag}] [${tag}] ${r.file.padEnd(62)} ${r.pct.toFixed(1)}`);
  }

  if (failures.length > 0) {
    const renamedFails = failures.filter((x) => x.renamed).map((x) => x.file);
    console.error(
      `\n[diff-coverage] 失败：${failures.length} 个改动文件覆盖率低于 ${threshold}%。` +
        ` 请为新增/修改逻辑补测试。` +
        (renamedFails.length
          ? ` 其中 ${renamedFails.length} 个为 rename 重构（真实改动行已评估），` +
            `若仍失败说明 rename 中新增了未覆盖的真实逻辑，需补测试。`
          : '')
    );
    process.exit(COVERAGE_FAILURE);
  }

  console.log(`\n[diff-coverage] 全部达标（>= ${threshold}%）。通过。`);
  process.exit(0);
}

// 仅当脚本被直接运行时执行 main（被单测 import 时不触发，避免误退出）
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
