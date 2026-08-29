#!/usr/bin/env node
/**
 * go-coverage-hint.mjs — Go 函数覆盖率建议 · prepare-commit-msg 辅助脚本（非阻断）。
 *
 * 设计意图：前端已有 coverage-suggest-hint（vitest），但 Go 重构（最近大量抽出纯函数）
 * 没有覆盖率提醒——pre-push 只跑 `go test -race`（验"测试通过"，不验"新逻辑有测试"）。
 * 本脚本在每次 commit 时，仅对**本次 staged 改动的 Go 文件所在包**跑一次
 * `go test -coverprofile`，用 `go tool cover -func` 找出低于阈值的函数，终端提醒提交者/AI。
 *
 * 关键取舍：
 *   - 只跑受影响包（非全量），单包 ~0.5s，避免拖慢每次提交。
 *   - 相对前端"读 stale coverage 产物"，Go 版每次现跑，数据新鲜（代价是稍慢，可接受）。
 *   - 永远 exit 0，绝不阻断提交；任何异常静默跳过（go 缺失/编译失败/包过大等）。
 *   - 只终端(stderr)输出，不写 commit body（与前端 coverage 提示同口径）。
 *   - 逃生阀：YSM_SKIP_GO_COVERAGE_HINT=1 git commit
 *
 * 依赖：node:path / node:os / node:url / 本地模块 getRoot / _lib/proc.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRoot } from '../_lib/scan-files.mjs';
import { run } from '../_lib/proc.mjs';

/** 低于该百分比的函数进入提醒（与仓库"拆函数 ≤ 80 行"的量产纪律对齐的覆盖阈值）。 */
export const GO_FUNC_COVERAGE_THRESHOLD = 80;

/** 单个受影响包跑 coverprofile 的最长容忍时间（秒），超时视为包太重而跳过。 */
const GO_TEST_TIMEOUT_MS = 20000;

/**
 * 取本次暂存区改动的 Go 源码文件（repo-root 相对路径，如 go/scanner/scanner.go）。
 * @param {string} root
 * @returns {string[]} 相对路径列表；git 失败返回 []。
 */
export function getChangedGoFiles(root) {
  const r = run('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: root,
  });
  if (!r.ok) return [];
  const out = r.out.trim();
  if (!out) return [];
  return out.split('\n')
    .filter((l) => l.endsWith('.go'))
    .filter((l) => !l.endsWith('_test.go')) // 只盯源码，不盯测试自身
    .filter((l) => l !== 'go-cover'); // 排除仓库根的覆盖产物
}

/**
 * 把改动文件映射到 go test 包模式（模块根相对路径，如 go/scanner → ./go/scanner/...）。
 * 根下 main.go / embed.go 属根包 → 返回 "."。
 * @param {string} file repo-root 相对路径
 * @returns {string} go 包模式
 */
export function packagePatternFor(file) {
  const dir = path.posix.dirname(file);
  if (dir === '.') return '.';
  return `./${dir}/...`;
}

/**
 * 对单个包模式跑 go test -coverprofile，返回函数覆盖率 Map：
 *   key = "相对源码路径:函数名"，value = 覆盖率百分比（0-100）。
 * 解析 `go tool cover -func` 输出（行形如 `ysm-model-manager/go/x/a.go:12:\t\tFoo\t100.0%`）。
 * 任何失败返回空 Map（静默跳过，绝不抛）。
 * @param {string} root
 * @param {string} pattern 如 "./go/download/..."
 * @param {string} tmp 临时 coverprofile 路径
 * @returns {Map<string, number>}
 */
export function coverFuncsForPackage(root, pattern, tmp) {
  const r1 = run('go', ['test', '-coverprofile=' + tmp, pattern, '-count=1'], {
    cwd: root,
    timeout: GO_TEST_TIMEOUT_MS,
  });
  if (!r1.ok) {
    return new Map(); // 编译失败/测试失败/超时 → 无数据（非阻断）
  }
  const r2 = run('go', ['tool', 'cover', '-func=' + tmp], {
    cwd: root,
  });
  if (!r2.ok) return new Map();
  return parseCoverFuncs(r2.out);
}

/** 解析 `go tool cover -func` 文本 → Map<"相对路径:函数名", 百分比>。导出供单测。 */
export function parseCoverFuncs(out) {
  const map = new Map();
  for (const line of out.split('\n')) {
    const m = line.match(/^(.+?):\d+:\s*(.+?)\s+(\d+(?:\.\d+)?)%$/);
    if (!m) continue;
    const fullPath = m[1].trim();
    const fn = m[2].trim();
    const pct = Number(m[3]);
    if (fn === 'total:') continue;
    // 去掉模块根前缀（如 "ysm-model-manager/"），得到 repo-root 相对路径
    const rel = stripModulePrefix(fullPath);
    if (!rel) continue;
    map.set(`${rel}:${fn}`, pct);
  }
  return map;
}

/** 去掉 "module/" 前缀（如 ysm-model-manager/go/x/a.go → go/x/a.go）。 */
export function stripModulePrefix(fullPath) {
  const idx = fullPath.indexOf('/go/');
  if (idx >= 0) return fullPath.slice(idx + 1); // .../go/... 保留 go/
  const i2 = fullPath.indexOf('/internal/');
  if (i2 >= 0) return fullPath.slice(i2 + 1);
  const i3 = fullPath.indexOf('/main.go');
  if (i3 >= 0) return fullPath.slice(i3 + 1); // 根 main.go
  return fullPath; // 无法识别 → 原样
}

/**
 * 汇总本次改动的低覆盖函数清单。
 * @param {string} root
 * @param {string[]} changedFiles repo-root 相对路径
 * @param {number} threshold
 * @returns {Array<{file:string, fn:string, pct:number}>}
 */
export function collectLowCoverage(root, changedFiles, threshold = GO_FUNC_COVERAGE_THRESHOLD) {
  const affected = new Map(); // 包模式 → [文件...]
  for (const f of changedFiles) {
    const pat = packagePatternFor(f);
    if (!affected.has(pat)) affected.set(pat, []);
    affected.get(pat).push(f);
  }

  const tmp = path.join(os.tmpdir(), `go-cov-${process.pid}-${Date.now()}.out`);
  const out = [];
  try {
    for (const [pattern, files] of affected) {
      const covers = coverFuncsForPackage(root, pattern, tmp);
      if (covers.size === 0) continue;
      for (const f of files) {
        // 只看本文件内的低覆盖函数
        for (const [key, pct] of covers) {
          if (!key.startsWith(f + ':')) continue;
          if (pct < threshold) {
            out.push({ file: f, fn: key.slice(f.length + 1), pct });
          }
        }
      }
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* 忽略 */ }
  }
  return out;
}

/** 调 check-go-diff-coverage --suggest --staged，取本次暂存 Go 变更行覆盖率建议的函数数（非阻断）。 */
function getDiffCoverageFuncCount(ROOT) {
  const r = run(
    process.execPath,
    [path.join(ROOT, 'scripts', 'check-go-diff-coverage.mjs'), '--suggest', '--staged', '--threshold', String(GO_FUNC_COVERAGE_THRESHOLD)],
    { cwd: ROOT },
  );
  if (!r.ok) return 0;
  return (r.out.split('\n').filter((l) => l.startsWith('- `')).length);
}

function main() {
  if (process.env.YSM_SKIP_GO_COVERAGE_HINT === '1') return;
  const source = process.argv[3] || '';
  if (source === 'merge' || source === 'squash') return;

  const ROOT = getRoot();
  if (!ROOT) return;

  const changed = getChangedGoFiles(ROOT);
  if (changed.length === 0) return; // 本次无 Go 改动 → 不输出

  const low = collectLowCoverage(ROOT, changed);
  const diffCount = getDiffCoverageFuncCount(ROOT);

  // 只终端提醒，不写 commit body（同前端 coverage 提示口径）
  const parts = [];
  if (low.length > 0) {
    const preview = low.slice(0, 3)
      .map((x) => `${x.file} ${x.fn} ${x.pct.toFixed(1)}%`)
      .join('；');
    parts.push(`🧪 Go ${low.length} 个本次改动函数低于 ${GO_FUNC_COVERAGE_THRESHOLD}%${low.length > 3 ? `（前 3：${preview}…）` : `：${preview}`}`);
  }
  if (diffCount > 0) {
    parts.push(`📈 ${diffCount} 个改动 Go 文件低于变更行覆盖率阈值`);
  }
  if (parts.length === 0) return;
  console.error(
    `[prepare-commit-msg] ${parts.join('；')}` +
      '（跑 go test -coverprofile 实测，仅终端提醒；刷新阈值见 scripts/hooks/go-coverage-hint.mjs）',
  );
}

// 仅当作为入口直接执行时才跑主流程（被测试 import 时不触发）
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
