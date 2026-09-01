#!/usr/bin/env node
/**
 * check-diff-coverage.ts — 变更文件覆盖率门禁（diff-coverage gate，前端版）。
 *
 * 设计意图：整体覆盖率阈值只防整体回退、不保护「新代码有测试」。本脚本
 * 仅检查「本次 git 变更的非测试源码」的变更行覆盖率，低于阈值即阻断；
 * 保护 PR/commit 的新增逻辑不裸奔（源自 MikuMikuAR P8-A gate，适配本仓库）。
 *
 * 实现：git 变更收集 / rename / 建议区块等语言无关部分抽到
 *   scripts/_lib/diff-coverage-core.ts（与 check-go-diff-coverage.ts 共享）；
 *   本文件仅保留前端专属策略：isSourceFile 过滤 + Istanbul coverage-final.json
 *   读取 + statementPctForChangedLines。下方 re-export 供契约测试 import（
 *   tests/test_check_diff_coverage.mjs），签名不变。
 *
 * 用法（仓库根运行，命令统一 node scripts/<name>.mjs）：
 *   node scripts/check-diff-coverage.ts                          # base=origin/main, threshold=60
 *   node scripts/check-diff-coverage.ts --threshold 80           # 提高阈值
 *   node scripts/check-diff-coverage.ts --uncommitted            # 纳入工作区+暂存区（本地预检）
 *   node scripts/check-diff-coverage.ts --staged                 # 仅本次暂存区（prepare-commit-msg 场景）
 *   node scripts/check-diff-coverage.ts --files a.ts,b.ts        # 跳过 git，直接给文件列表（调试）
 *   node scripts/check-diff-coverage.ts --suggest                # 非阻断建议：输出 commit message 建议区块，永远 exit 0
 *   node scripts/check-diff-coverage.ts --json                   # JSON（CI / 子代理消费）
 *   node scripts/check-diff-coverage.ts --coverage <path>        # 覆盖默认 frontend/coverage/coverage-final.json
 *
 * 退出码：0 = 全部达标；1 = 存在未达标文件；2 = 配置/用法错误（缺覆盖率文件或 git 失败）。
 * rename 处理：--find-renames 检测 + 两点 blob diff 取真实最小 hunk；纯改名自然达标，
 *   rename 中新增的真实逻辑仍受覆盖约束。
 * 依赖：node:fs / node:path / node:url / _lib
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './_lib/scan-files.ts';
import { parseArgs } from './_lib/parse-args.ts';
import {
  git,
  getChangedFiles,
  addLinesFromDiff,
  parseRenameStatus,
  detectRenames,
  getChangedLines,
  buildSuggestBlock as buildSuggestBlockCore,
} from './_lib/diff-coverage-core.ts';

// ── re-export（契约测试 import 路径锁：tests/test_check_diff_coverage.mjs）──
export { addLinesFromDiff, parseRenameStatus, detectRenames, getChangedLines, getChangedFiles, git };

const USAGE_ERROR = 2;
const COVERAGE_FAILURE = 1;

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
  const norm = rel.split('/').join('/');
  const stripped = norm.replace(/^frontend\//, '');
  for (const k of covKeys) {
    const nk = k.split('/').join('/');
    if (nk === norm) return k;
    if (nk.endsWith('/' + norm)) return k;
    if (nk.endsWith('/' + stripped)) return k;
  }
  return null;
}

/** 变更行相关的语句覆盖率百分比（Istanbul coverage-final.json 条目）。 */
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

/** 前端版建议区块（标题/称谓/提示与 Go 版区分）。 */
export function buildSuggestBlock(failures, threshold) {
  return buildSuggestBlockCore(failures, threshold);
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ['uncommitted', 'json', 'suggest', 'staged'],
    strings: ['threshold', 'base', 'head', 'files', 'coverage'],
  });
  if (args.unknown.length) {
    console.error(`[diff-coverage] 未知参数: ${args.unknown.join(' ')}（支持 --threshold/--base/--head/--files/--coverage/--uncommitted/--staged/--suggest/--json）`);
    process.exit(USAGE_ERROR);
  }
  const coveragePath = args.coverage
    ? resolve(ROOT, args.coverage as string)
    : resolve(ROOT, 'frontend', 'coverage', 'coverage-final.json');
  const base = args.base ?? 'origin/main';
  const head = args.head ?? 'HEAD';
  const threshold = Number(args.threshold ?? '60');
  if (!Number.isFinite(threshold)) {
    console.error(`[diff-coverage] --threshold 需为数字，收到：${args.threshold ?? '60'}`);
    process.exit(USAGE_ERROR);
  }
  const uncommitted = Boolean(args.uncommitted);
  const staged = Boolean(args.staged);
  const json = Boolean(args.json);
  const suggest = Boolean(args.suggest);

  if (!existsSync(coveragePath)) {
    if (suggest) {
      // 非阻断建议模式：无覆盖率数据时静默跳过，不阻塞提交。
      // 提示走 stderr，保持 stdout 干净（消费方 coverage-suggest-hint 把 stdout 原样包进区块）
      console.error(`[diff-coverage] 未找到覆盖率文件：${coveragePath}（建议模式：先跑 \`vitest run --coverage\` 可生成建议）`);
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
      console.error(`[diff-coverage] ${msg}（建议模式：跳过）`);
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
    ? (args.files as string).split(',').map((s) => s.trim()).filter(Boolean)
    : getChangedFiles(base, head, uncommitted, staged);

  if (changed === null) {
    failOrWarn('git diff 执行失败（对象/索引异常），拒绝空跑放行');
  }

  const renameMap = detectRenames(base, head, staged);
  const srcFiles = changed!.filter(isSourceFile);

  if (srcFiles.length === 0) {
    // suggest 模式下提示走 stderr：消费方 coverage-suggest-hint 把 stdout 原样包进建议区块，
    // 不能让「无改动源码」提示被当成建议输出（code_review P3）
    const msg = `[diff-coverage] 本次无改动源码需要检查（阈值 ${threshold}%）。通过。`;
    if (suggest) console.error(msg);
    else console.log(msg);
    process.exit(0);
  }

  const rows: any[] = [];
  const failures: any[] = [];
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
        const lines: number[] = [];
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
