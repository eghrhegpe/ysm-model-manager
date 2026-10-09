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
 *   tests/test_check_diff_coverage.ts），签名不变。
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
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CHANGED_NULL_REASON, checkBaselineMeaningful } from "./_lib/baseline-guard.ts";
import {
  addLinesFromDiff,
  buildSuggestBlock as buildSuggestBlockCore,
  detectRenames,
  getChangedFiles,
  getChangedLines,
  git,
  parseRenameStatus,
} from "./_lib/diff-coverage-core.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT } from "./_lib/scan-files.ts";

// ── re-export（契约测试 import 路径锁：tests/test_check_diff_coverage.ts）──
export {
  addLinesFromDiff,
  detectRenames,
  getChangedFiles,
  getChangedLines,
  git,
  parseRenameStatus,
};

const USAGE_ERROR = 2;
const COVERAGE_FAILURE = 1;

/** 仅保留应纳入 diff 门禁的源码：frontend/src 下、非测试、非 index/wails 绑定产物。 */
function isSourceFile(f: string) {
  return (
    f.endsWith(".ts") &&
    f.includes("src/") &&
    !f.endsWith(".test.ts") &&
    !f.includes("__tests__/") &&
    !f.endsWith("/index.ts") &&
    !f.includes("/wails/") // Wails v3 绑定产物（自动生成，无测试价值）
  );
}

/** vitest coverage **明文排除**的域（单一事实源 = `frontend/vitest.config.ts|coverage.exclude`）。
 *
 * 为什么必须在这里排除：这些文件被 vitest 有意排除 ⇒ Istanbul 产物里**没有它们的条目**，
 * 而下方 `!key → pct = 0` 会把「无条目」一律读成「0% 未覆盖」⇒ 结构性假红。
 * 逐条对应 vitest.config.ts 的原注释理由：
 *   - 3D 装配入口：happy-dom 无 WebGL/rAF，其覆盖改由 **e2e-web**（SwiftShader 真 WebGL）承担
 *     ——不是「没人测」，是「换了个地方测」；
 *   - vendor / molang-lib：第三方代码，不承担测试归属；
 *   - test-utils：测试辅助，非生产代码。
 * ⚠️ 与 vitest.config.ts 保持同步：那边加排除，这边必须跟（反之亦然），否则假红回流。
 * 2026-10-08 实测：不排除时 `v1.15.0..HEAD` 219 文件里 9 个假红，其中 4 个来自本表。 */
const VITEST_COVERAGE_EXCLUDE_PREFIXES = [
  "frontend/src/views/app-preview/maid-3d.ts",
  "frontend/src/views/app-preview/ysm-3d.ts",
  "frontend/src/views/app-preview/scene-3d.ts",
  "frontend/src/views/app-preview/mmd-3d.ts",
  "frontend/src/views/app-preview/vrm-3d.ts",
  "frontend/src/views/app-preview/fbx-3d.ts",
  "frontend/src/views/app-preview/empty-3d.ts",
  "frontend/src/views/app-preview/pack-3d.ts",
  "frontend/src/preview-3d/decoder/wasm-decode.ts",
  "frontend/src/preview-3d/adapters/vendor/",
  "frontend/src/utils/animation/molang-lib/",
  "frontend/src/test-utils/",
];

/** 该文件是否落在 vitest 明文排除域内（无 Istanbul 条目属预期，不该判 0%）。 */
export function isVitestExcluded(rel: string) {
  const p = rel.split("\\").join("/");
  return VITEST_COVERAGE_EXCLUDE_PREFIXES.some((x) => p === x || p.startsWith(x));
}

/** 剥掉注释与类型声明后，文件是否还剩**可覆盖的运行时语句**。
 *
 * 用途：`types.ts`（纯 interface/type 声明）与「纯再导出」（`export { x } from "y"`，ADR-217
 * 那种兼容垫层）编译后**不产生语句**，Istanbul 自然不收录 ⇒ 若按「无条目 = 0%」判，必假红。
 * 这与「有语句却零覆盖」是两回事，故必须区分（2026-10-08 实测：parse-ysm-json.ts 4 行纯再导出、
 * surface-pixels/types.ts 22 行纯类型，均属此类）。
 *
 * 判据保守：只认「剥注释/类型后无剩余代码」或「剩余代码仅由 import/export-from 组成」。
 * 读不到文件（路径漂移等）返回 false ⇒ 退回原判定（fail-loud，不静默放过）。 */
export function hasNoCoverableStatements(rel: string) {
  let src: string;
  try {
    src = readFileSync(resolve(ROOT, rel), "utf8");
  } catch {
    return false; // 读不到不豁免，保持 fail-loud
  }
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "") // 块注释
    .replace(/(^|[^:])\/\/.*$/gm, "$1") // 行注释（避让 URL 里的 //）
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    // 纯类型声明：interface / type X = ...（单行或多行起始）
    .filter((l) => !/^(export\s+)?(declare\s+)?(interface|type)\s/.test(l))
    // 纯再导出与导入：不产生可覆盖语句
    .filter((l) => !/^import\s/.test(l))
    .filter((l) => !/^export\s+(\{[^}]*\}|\*)\s+from\s/.test(l))
    .filter((l) => !/^export\s+type\s/.test(l))
    // interface/type 体的续行（字段声明、闭合括号）
    .filter((l) => !/^[}\])]?;?$/.test(l) && !/^[A-Za-z_$][\w$]*\??\s*:/.test(l));
  return stripped.length === 0;
}

/** 把 repo 相对路径映射到 coverage-final.json 的绝对路径 key。 */
function matchCoverageKey(rel: string, covKeys: string[]) {
  const norm = rel.split("/").join("/");
  const stripped = norm.replace(/^frontend\//, "");
  for (const k of covKeys) {
    const nk = k.split("/").join("/");
    if (nk === norm) return k;
    if (nk.endsWith(`/${norm}`)) return k;
    if (nk.endsWith(`/${stripped}`)) return k;
  }
  return null;
}

/** 变更行相关的语句覆盖率百分比（Istanbul coverage-final.json 条目）。 */
export function statementPctForChangedLines(entry: any, changedLines: Set<number>) {
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
export function buildSuggestBlock(failures: any[], threshold: number) {
  return buildSuggestBlockCore(failures, threshold);
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ["uncommitted", "json", "suggest", "staged"],
    strings: ["threshold", "base", "head", "files", "coverage"],
  });
  if (args.unknown.length) {
    console.error(
      `[diff-coverage] 未知参数: ${args.unknown.join(" ")}（支持 --threshold/--base/--head/--files/--coverage/--uncommitted/--staged/--suggest/--json）`,
    );
    process.exit(USAGE_ERROR);
  }
  const coveragePath = args.coverage
    ? resolve(ROOT, args.coverage as string)
    : resolve(ROOT, "frontend", "coverage", "coverage-final.json");
  const base = (args.base as string) ?? "origin/main";
  const head = (args.head as string) ?? "HEAD";
  const threshold = Number(args.threshold ?? "60");
  if (!Number.isFinite(threshold)) {
    console.error(`[diff-coverage] --threshold 需为数字，收到：${args.threshold ?? "60"}`);
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
      console.error(
        `[diff-coverage] 未找到覆盖率文件：${coveragePath}（建议模式：先跑 \`vitest run --coverage\` 可生成建议）`,
      );
      process.exit(0);
    }
    console.error(`[diff-coverage] 未找到覆盖率文件：${coveragePath}`);
    console.error(`[diff-coverage] 请先运行 \`vitest run --coverage\` 生成 coverage-final.json。`);
    process.exit(USAGE_ERROR);
  }

  const cov = JSON.parse(readFileSync(coveragePath, "utf8"));
  const covKeys = Object.keys(cov).filter((k) => k !== "total");

  // 门禁前置校验：git 环境异常时绝不“空跑报通过”。
  // git() 在命令失败时返回 ''（catch 吞错），若不加校验，base 不可达/浅克隆未 fetch
  // 会使 diff 全空 → srcFiles=[] → 错误落入「本次无改动源码需要检查。通过。」分支。
  // 门禁模式（默认/json/文本）fail-closed 退出 USAGE_ERROR；--suggest 提示模式保持非阻断。
  const failOrWarn = (msg: string) => {
    if (suggest) {
      console.error(`[diff-coverage] ${msg}（建议模式：跳过）`);
      process.exit(0);
    }
    console.error(`[diff-coverage] ${msg}`);
    process.exit(USAGE_ERROR);
  };
  if (!args.files) {
    // 基线判据已收口到 _lib/baseline-guard.ts（2026-10-09 锐评第二刀）：本脚本与 Go 版原先
    // 逐字各自持有一份 27 行守卫，第三份 diff 型门禁随时可以再漏一次。此处只负责**解析 oid**
    // （各脚本自己的 git 助手）并把结论交给本脚本的 failOrWarn（门禁 exit 2 / --suggest exit 0）。
    // 判据顺序与文案见 baseline-guard.ts 头注释；契约测试 tests/test_baseline_guard.ts 直测。
    const verdict = checkBaselineMeaningful({
      headOid: git(["rev-parse", "HEAD"])?.trim() || null,
      baseOid: staged ? null : git(["rev-parse", "--verify", `${base}^{commit}`])?.trim() || null,
      base,
      staged,
      uncommitted,
    });
    if (!verdict.ok) failOrWarn(verdict.reason);
  }

  const changed = args.files
    ? (args.files as string)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : getChangedFiles(base, head, uncommitted, staged);

  if (changed === null) {
    failOrWarn(CHANGED_NULL_REASON);
  }

  const renameMap = detectRenames(base, head, staged);
  const srcFiles = changed?.filter(isSourceFile);

  if ((srcFiles?.length ?? 0) === 0) {
    // suggest 模式下提示走 stderr：消费方 coverage-suggest-hint 把 stdout 原样包进建议区块，
    // 不能让「无改动源码」提示被当成建议输出（code_review P3）
    const msg = `[diff-coverage] 本次无改动源码需要检查（阈值 ${threshold}%）。通过。`;
    if (suggest) console.error(msg);
    else console.log(msg);
    process.exit(0);
  }

  const rows: any[] = [];
  const failures: any[] = [];
  const skipped: any[] = [];
  const useFilesMode = Boolean(args.files); // --files 模式无 git 上下文，回退到全文件检查
  for (const f of srcFiles ?? []) {
    const key = matchCoverageKey(f, covKeys);
    let pct: number;
    if (!key) {
      // 无覆盖率条目有两种截然不同的成因，必须分开处置（2026-10-08 实测消假红）：
      //   ① 文件落在 vitest 明文排除域（3D 入口/vendor/test-utils）——覆盖由 e2e-web 等
      //      别处承担，此处**跳过不算失败**，但要显式登记进 skipped 保持可见性；
      //   ② 文件有可覆盖语句却没条目——那是真「没被任何测试跑到」，仍判 0% 失败。
      // 判据 ② 用「文件是否含可覆盖语句」推导（读源码），而非按文件名硬编码。
      if (isVitestExcluded(f) || hasNoCoverableStatements(f)) {
        skipped.push({ file: f, reason: isVitestExcluded(f) ? "vitest 排除域" : "无可覆盖语句" });
        continue;
      }
      pct = 0; // 无覆盖率条目且非豁免 → 视为 0% 未覆盖
    } else if (useFilesMode) {
      pct = statementPctForChangedLines(
        cov[key],
        new Set(
          Object.keys(cov[key].statementMap).flatMap((id) => {
            const loc = cov[key].statementMap[id];
            if (!loc) return [];
            const lines: number[] = [];
            for (let l = loc.start.line; l <= (loc.end?.line ?? loc.start.line); l++) lines.push(l);
            return lines;
          }),
        ),
      ); // --files 模式：视所有行均为变更行 = 全文件检查
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
    console.log(
      JSON.stringify(
        {
          _summary: { threshold, files: rows.length, failed: failures.length, skipped: skipped.length },
          rows,
          failures,
          skipped,
        },
        null,
        2,
      ),
    );
    process.exit(failures.length > 0 ? COVERAGE_FAILURE : 0);
  }

  console.log(
    `\n[diff-coverage] 变更源码 ${srcFiles?.length ?? 0} 个，阈值 ${threshold}%（变更行覆盖率）：`,
  );
  console.log(`  ${"文件".padEnd(70)}覆盖%`);
  console.log(`  ${"-".repeat(70)}------`);
  for (const r of rows) {
    const flag = r.pct < threshold ? "X" : "OK";
    const tag = r.renamed ? "R" : " ";
    console.log(`  [${flag}] [${tag}] ${r.file.padEnd(62)} ${r.pct.toFixed(1)}`);
  }

  // 跳过项显式列出（可见性 > 静默）：它们不参与判定，但「为什么不算」必须可查，
  // 否则豁免域会变成黑洞（后人无法分辨「豁免生效」与「扫描漏了」）。
  if (skipped.length > 0) {
    console.log(`\n[diff-coverage] 跳过 ${skipped.length} 个（不参与判定，附理由）：`);
    for (const s of skipped) {
      console.log(`  [--] ${s.file.padEnd(62)} ${s.reason}`);
    }
  }

  if (failures.length > 0) {
    const renamedFails = failures.filter((x) => x.renamed).map((x) => x.file);
    console.error(
      `\n[diff-coverage] 失败：${failures.length} 个改动文件覆盖率低于 ${threshold}%。` +
        ` 请为新增/修改逻辑补测试。` +
        (renamedFails.length
          ? ` 其中 ${renamedFails.length} 个为 rename 重构（真实改动行已评估），` +
            `若仍失败说明 rename 中新增了未覆盖的真实逻辑，需补测试。`
          : ""),
    );
    process.exit(COVERAGE_FAILURE);
  }

  console.log(`\n[diff-coverage] 全部达标（>= ${threshold}%）。通过。`);
  process.exit(0);
}

// 仅当脚本被直接运行时执行 main（被单测 import 时不触发，避免误退出）
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
