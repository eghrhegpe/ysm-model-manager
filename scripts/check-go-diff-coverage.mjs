#!/usr/bin/env node
/**
 * check-go-diff-coverage.mjs — Go 变更文件覆盖率门禁（diff-coverage gate，Go 版）。
 *
 * 设计意图：前端已有 check-diff-coverage.mjs（只认 frontend/src/*.ts），Go 重构
 * （最近大量抽出纯函数）落在盲区——pre-push 只跑 `go test -race` 验"测试通过"，
 * 不验"新代码有测试"。本脚本仅检查「本次 git 变更的 Go 非测试源码」的变更行覆盖率，
 * 低于阈值即阻断；保护新增/重构逻辑不裸奔。
 *
 * 豁免：平台/标签专属文件（如 `//go:build <os> && rust_backend` 的跨平台桥接文件）在
 *   当前宿主裸 `go test`（不带对应 build tags）下不被编译，coverprofile 无数据属「环境
 *   不匹配」而非「裸奔」，按 `go list` 编译集自动豁免，避免跨平台改一次桥接误报 0%。
 *
 * 实现：git 变更收集 / rename / 建议区块等语言无关部分抽到
 *   scripts/_lib/diff-coverage-core.mjs（与 check-diff-coverage.mjs 共享）；
 *   本文件仅保留 Go 专属策略：isGoSource 过滤 + 包分组 + `go test -coverprofile` +
 *   `go list` 编译集 oracle 豁免。下方 re-export 供契约测试 import（
 *   tests/test_check_go_diff_coverage.mjs），签名不变。
 *
 * 用法（仓库根运行，命令统一 node scripts/<name>.mjs）：
 *   node scripts/check-go-diff-coverage.mjs                          # base=origin/main, threshold=60
 *   node scripts/check-go-diff-coverage.mjs --threshold 70           # 提高阈值
 *   阈值语义（2026-08-27 文档化）：60% = 硬门禁（pre-push-gate GO_STATIC_TOOLS /
 *   commit-with-check --files 默认）；80% = 软建议（go-coverage-hint 显式
 *   --threshold 80，prepare-commit-msg 非阻断提示）。两档分工有意为之：门禁宽松、
 *   建议从严，避免「新逻辑必测 80%」的硬性门槛在 push 时误伤重构型变更。
 *   node scripts/check-go-diff-coverage.mjs --staged                 # 仅本次暂存区（commit-with-check / prepare-commit-msg 场景）
 *   node scripts/check-go-diff-coverage.mjs --uncommitted            # 纳入工作区+暂存区（本地预检）
 *   node scripts/check-go-diff-coverage.mjs --files a.go,b.go        # 跳过 git，直接给文件列表（调试）
 *   node scripts/check-go-diff-coverage.mjs --suggest                # 非阻断建议（输出 commit message 建议区块，永远 exit 0）
 *   node scripts/check-go-diff-coverage.mjs --json                   # JSON（CI / 子代理消费）
 *
 * 退出码：0 = 全部达标；1 = 存在未达标文件；2 = 配置/用法错误（git 失败或 go 不可用）。
 * 说明：Go 无持久覆盖率产物，本脚本对受影响包现跑 `go test -coverprofile`（单包 ~0.5s），
 *   数据新鲜但比前端慢——故默认只对「变更文件所在包」跑，不跑全量。
 * 依赖：node:child_process / node:fs / node:os / node:path / node:url / 本地模块
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './_lib/scan-files.mjs';
import { parseArgs } from './_lib/parse-args.mjs';
import { run } from './_lib/proc.mjs';
import {
  git,
  getChangedFiles,
  addLinesFromDiff,
  parseRenameStatus,
  detectRenames,
  getChangedLines,
  buildSuggestBlock as buildSuggestBlockCore,
} from './_lib/diff-coverage-core.mjs';

// ── re-export（契约测试 import 路径锁：tests/test_check_go_diff_coverage.mjs）──
export { addLinesFromDiff, parseRenameStatus, detectRenames, getChangedLines, getChangedFiles, git };

const USAGE_ERROR = 2;
const COVERAGE_FAILURE = 1;

/** 仅保留应纳入 Go diff 门禁的源码：.go 且非 _test.go、非根覆盖产物 go-cover。 */
export function isGoSource(f) {
  return (
    f.endsWith('.go') &&
    !f.endsWith('_test.go') &&
    f !== 'go-cover' &&
    !f.includes('/testdata/')
  );
}

/** 本次改动的非测试 Go 源码文件（repo-root 相对路径）。 */
export function getChangedGoFiles(base, head, uncommitted, staged) {
  const out = getChangedFiles(base, head, uncommitted, staged);
  if (out === null) return null;
  return out.filter(isGoSource);
}

/** 把改动文件映射到 go test 包模式（模块根相对，如 go/scanner → ./go/scanner/...）。 */
export function packagePatternFor(file) {
  const dir = path.posix.dirname(file);
  if (dir === '.') return '.';
  return `./${dir}/...`;
}

/** 跑 `go test -coverprofile` 解析出的文件→语句块映射。 */
export function runCoverProfile(packagePattern, tmp) {
  const r1 = run('go', ['test', '-coverprofile=' + tmp, packagePattern, '-count=1'], {
    cwd: ROOT, stdio: 'ignore', timeout: 120000,
    // 2026-08-29 超时 30s→120s：冷缓存下 internal/app 全包（Wails app 层）覆盖插桩
    // 编译可远超 30s，而 pre-push 预跑的 go test -race 是独立构建缓存、不预热普通
    // coverprofile 构建 → 冷 push 首跑超时返回 null → 误报 missing/pct=0 阻断。
  });
  if (!r1.ok) {
    // 2026-08-31 瞬态失败重试一次：go/importer 等包存在低频插桩态测试抖动
    // （实测 `go test -cover` 92.9% 包覆盖、连续 11 次复跑全过，但整包 -coverprofile
    // 偶发 1 次 TestDetectZipTypeFromBase64Tail 失败）——单次失败即 null 会让整包
    // 误报 0% 阻断推送（假 0）。重试后仍失败 = 真缺陷，照旧拦截。
    const r2 = run('go', ['test', '-coverprofile=' + tmp, packagePattern, '-count=1'], {
      cwd: ROOT, stdio: 'ignore', timeout: 120000,
    });
    if (!r2.ok) {
      return null; // 编译失败/测试失败 → 该包无数据
    }
  }
  try {
    return fs.readFileSync(tmp, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 当前测试编译环境（裸 `go test`，不带额外 build tags，与 runCoverProfile 同 context）
 * 会编译进该包的 Go 源文件名集合（basename）。
 *
 * 用途：区分「平台/标签专属文件不被编译」（环境不匹配，应豁免，非真裸奔）与
 *       「被编译但变更行 0 覆盖」（真裸奔，应拦截）。直接问 Go 工具链，不手写解析
 *       build constraint，避免 `&&/||/!` 语法误判。
 * 失败返回 null（保守：不豁免，沿用旧 0% 行为）。
 */
export function goListGoFiles(packagePattern) {
  const r = run('go', ['list', '-f', '{{.GoFiles}}', packagePattern], {
    cwd: ROOT, timeout: 30000,
  });
  if (!r.ok) return null;
  const names = new Set();
  for (const m of r.out.matchAll(/([^\/\s]+\.go)/g)) names.add(m[1]);
  return names;
}

/** 解析 Go coverprofile 文本 → Map<repoRootRelPath, Array<{sl,el,n,count}>>。导出供单测。 */
export function parseGoCover(profileText) {
  const byFile = new Map();
  for (const line of profileText.split('\n')) {
    if (line.startsWith('mode:')) continue;
    if (!line.trim()) continue;
    const m = line.match(/^(.+?):(\d+)\.(\d+),(\d+)\.(\d+)\s+(\d+)\s+(\d+)$/);
    if (!m) continue;
    const rel = stripModulePrefix(m[1]);
    if (!rel) continue;
    const block = {
      sl: Number(m[2]),
      el: Number(m[4]),
      n: Number(m[6]),
      count: Number(m[7]),
    };
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push(block);
  }
  return byFile;
}

/** 去掉模块根前缀（ysm-model-manager/... → repo-root 相对）。 */
export function stripModulePrefix(fullPath) {
  const idx = fullPath.indexOf('/go/');
  if (idx >= 0) return fullPath.slice(idx + 1);
  const i2 = fullPath.indexOf('/internal/');
  if (i2 >= 0) return fullPath.slice(i2 + 1);
  const i3 = fullPath.indexOf('/main.go');
  if (i3 >= 0) return fullPath.slice(i3 + 1);
  return fullPath;
}

/** 变更行相关的语句覆盖率百分比（按语句块数加权，count>0 记覆盖）。 */
export function stmtPctForChangedLines(blocks, changedLines) {
  if (!blocks || blocks.length === 0) return 100;
  const relevant = blocks.filter((b) => {
    for (let line = b.sl; line <= b.el; line++) {
      if (changedLines.has(line)) return true;
    }
    return false;
  });
  if (relevant.length === 0) return 100; // 变更行上无语句（纯注释/格式）
  let total = 0;
  let covered = 0;
  for (const b of relevant) {
    total += b.n;
    if (b.count > 0) covered += b.n;
  }
  return total === 0 ? 100 : (covered / total) * 100;
}

/** Go 版建议区块（标题/称谓/提示与前端版区分，契约测试锁定文案）。 */
export function buildSuggestBlock(failures, threshold) {
  return buildSuggestBlockCore(failures, threshold, {
    title: '## Go 覆盖率建议（非阻断）',
    noun: 'Go 文件',
    hint: '本建议基于本次改动包 `go test -coverprofile` 实跑结果。',
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ['uncommitted', 'json', 'suggest', 'staged'],
    strings: ['threshold', 'base', 'head', 'files'],
  });
  if (args.unknown.length) {
    console.error(`[check-go-diff-coverage] 未知参数: ${args.unknown.join(' ')}（支持 --threshold/--base/--head/--files/--uncommitted/--staged/--suggest/--json）`);
    process.exit(USAGE_ERROR);
  }
  const base = args.base ?? 'origin/main';
  const head = args.head ?? 'HEAD';
  const threshold = Number(args.threshold ?? '60');
  const uncommitted = Boolean(args.uncommitted);
  const staged = Boolean(args.staged);
  const json = Boolean(args.json);
  const suggest = Boolean(args.suggest);
  const hostGOOS = (() => {
    const r = run('go', ['env', 'GOOS'], { cwd: ROOT });
    return r.ok ? r.out.trim() : os.platform();
  })();

  if (!Number.isFinite(threshold)) {
    console.error(`[check-go-diff-coverage] --threshold 需为数字，收到：${args.threshold ?? '60'}`);
    process.exit(USAGE_ERROR);
  }

  const failOrWarn = (msg) => {
    if (suggest) {
      console.error(`[check-go-diff-coverage] ${msg}（建议模式：跳过）`);
      process.exit(0);
    }
    console.error(`[check-go-diff-coverage] ${msg}`);
    process.exit(USAGE_ERROR);
  };
  if (!args.files) {
    if (!git(['rev-parse', 'HEAD'])) failOrWarn('无法解析 HEAD（git 环境异常）');
    if (!staged && !git(['rev-parse', '--verify', base])) {
      failOrWarn(`基准分支不可达：${base}（请先 git fetch 或 --base 指向本地分支）`);
    }
  }

  const changed = args.files
    ? args.files.split(',').map((s) => s.trim()).filter(Boolean).filter(isGoSource)
    : getChangedGoFiles(base, head, uncommitted, staged);

  if (changed === null) failOrWarn('git diff 执行失败，拒绝空跑放行');

  const renameMap = detectRenames(base, head, staged);
  if (changed.length === 0) {
    const msg = `[check-go-diff-coverage] 本次无改动 Go 源码需要检查（阈值 ${threshold}%）。通过。`;
    if (suggest) console.error(msg);
    else console.log(msg);
    process.exit(0);
  }

  // 按包分组，一次 coverprofile 覆盖包内所有变更文件
  const pkgFiles = new Map();
  for (const f of changed) {
    const pat = packagePatternFor(f);
    if (!pkgFiles.has(pat)) pkgFiles.set(pat, []);
    pkgFiles.get(pat).push(f);
  }

  const tmp = path.join(os.tmpdir(), `go-diffcov-${process.pid}-${Date.now()}.out`);
  const rows = [];
  const failures = [];
  try {
    for (const [pat, files] of pkgFiles) {
      const profileText = runCoverProfile(pat, tmp);
      const blocksByFile = profileText ? parseGoCover(profileText) : new Map();
      // 编译集 oracle：仅当测试编译成功时才查询；编译失败则不豁免（保守沿用旧行为）。
      const compiled = profileText ? goListGoFiles(pat) : null;
      for (const f of files) {
        const fname = path.posix.basename(f);
        let pct;
        let envMismatch = false;
        if (!profileText || !blocksByFile.has(f)) {
          // 当前测试环境未编出该文件：区分「平台/标签专属文件不编译」(豁免) 与「真 0 覆盖」(拦截)。
          if (compiled && !compiled.has(fname)) {
            pct = 100; // 环境不匹配，豁免（非真裸奔）
            envMismatch = true;
          } else {
            pct = 0; // 真未覆盖
          }
        } else {
          const renameOld = renameMap.get(f)?.from;
          const changedLines = getChangedLines(f, base, head, uncommitted, renameOld, staged);
          pct = stmtPctForChangedLines(blocksByFile.get(f), changedLines);
        }
        const missing = !profileText || !blocksByFile.has(f);
        const renamed = renameMap.has(f);
        rows.push({ file: f, pct, missing, renamed, envMismatch });
        if (!envMismatch && pct < threshold) failures.push({ file: f, pct, renamed });
      }
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* 忽略 */ }
  }

  if (suggest) {
    if (failures.length > 0) console.log(buildSuggestBlock(failures, threshold));
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

  console.log(`\n[check-go-diff-coverage] 变更 Go 源码 ${rows.length} 个，阈值 ${threshold}%（变更行覆盖率）：`);
  console.log('  ' + '文件'.padEnd(68) + '覆盖%');
  console.log('  ' + '-'.repeat(68) + '------');
  for (const r of rows) {
    const flag = r.envMismatch ? 'SKIP' : (r.pct < threshold ? 'X' : 'OK');
    const tag = (r.renamed ? 'R' : ' ') + (r.envMismatch ? '~' : ' ');
    console.log(`  [${flag}] [${tag.trim()}] ${r.file.padEnd(60)} ${r.pct.toFixed(1)}`);
  }
  // 平台/标签专属文件豁免说明（非真裸奔，当前 GOOS=<x> 裸 go test 不带 rust_backend 不编译）
  const skipped = rows.filter((r) => r.envMismatch);
  if (skipped.length > 0) {
    console.log(`\n[check-go-diff-coverage] 跳过 ${skipped.length} 个平台/标签专属文件（GOOS=${hostGOOS} 裸测试不编译，非覆盖率缺口）：`);
    for (const s of skipped) console.log(`  ~ ${s.file}`);
  }
  if (failures.length > 0) {
    console.error(`\n[check-go-diff-coverage] 失败：${failures.length} 个改动 Go 文件覆盖率低于 ${threshold}%。请为新增/重构逻辑补测试。`);
    process.exit(COVERAGE_FAILURE);
  }
  console.log(`\n[check-go-diff-coverage] 全部达标（>= ${threshold}%）。通过。`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
