#!/usr/bin/env node
/**
 * commit-blocks/version-defense.ts — pre-commit「版本防御」块（ADR-323 阶段 1）。
 *
 * 下沉自 `.githooks/pre-commit` 的同名段（88daf2a2 `$tmp` 教训）。原为内联 shell，
 * 无任何测试守护；现拆为**纯判定函数 + 渲染函数**，由 pre-commit 薄壳调用。
 *
 * 三查（全部**非阻断**，只提示；阻断留给 pre-push --strict）：
 *   a) staged 文件名以 `$` 开头 → shell 变量漏展开产物（实证 88daf2a2 的 `$tmp`）
 *   b) staged 文件首行为 `mode: set|count|atomic` → Go 覆盖率 profile 误入库
 *   c) 同 commit 同时含 frontend/ 与 go/ 改动 → 跨层夹带信号（合法联调可忽略）
 *
 * 设计：判定与渲染分离——`detectVersionDefense()` 是纯函数（可单测，注入文件内容读取器），
 * `renderVersionDefense()` 负责文案。钩子只做「取值 → 渲染 → echo」。
 *
 * 行为等价约束（ADR-323 硬约束）：文案与判定口径须与旧 shell 段逐字等价；
 * 发现真 bug 另立项，不在搬迁中夹带（见 ADR-323 §2 硬约束 + §4 `.d.ts` 遗留）。
 *
 * 用法（钩子内）：
 *   node scripts/_lib/commit-blocks/version-defense.ts   # 自取 git diff --cached 并输出
 * CLI 供契约测试与人工排查直接调用。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { toPosix } from "../to-posix.ts";

/** 三查结果（全部为「待提示」清单，空 = 无此项发现）。 */
export interface VersionDefenseFindings {
  /** a) `$` 开头文件名（含路径中以 `/` 分隔的段）。 */
  dollarFiles: string[];
  /** b) 首行为 Go 覆盖率 profile 标记的文件。 */
  coverageProfiles: string[];
  /** c) 跨层夹带计数（frontend/ 与 go/ 各命中数）。 */
  frontendCount: number;
  goCount: number;
}

/** 单个 staged 文件内容读取器（注入缝：契约测试无需真实文件）。 */
export type FirstLineReader = (file: string) => string | null;

/** a) `$` 开头文件名判定：行首或 `/` 之后的段以 `$` 起始。 */
export function isDollarLeadingPath(file: string): boolean {
  return /(^|\/)\$/.test(file);
}

/** b) Go 覆盖率 profile 判定：首行恰为 `mode: set|count|atomic`。 */
export function isGoCoverageProfileFirstLine(firstLine: string | null): boolean {
  return firstLine !== null && /^mode: (set|count|atomic)$/.test(firstLine);
}

/**
 * 三查纯判定。`readFirstLine` 缺省时**不执行 b)**（等价旧 shell 里 `[ -f "$f" ] || continue`
 * 的文件不存在跳过；调用方按需注入）。
 */
export function detectVersionDefense(
  stagedFiles: string[],
  readFirstLine?: FirstLineReader,
): VersionDefenseFindings {
  const dollarFiles = stagedFiles.filter(isDollarLeadingPath);
  const coverageProfiles = readFirstLine
    ? stagedFiles.filter((f) => isGoCoverageProfileFirstLine(readFirstLine(f)))
    : [];
  return {
    dollarFiles,
    coverageProfiles,
    frontendCount: stagedFiles.filter((f) => f.startsWith("frontend/")).length,
    goCount: stagedFiles.filter((f) => f.startsWith("go/")).length,
  };
}

/** 是否需要输出任何提示（全空则钩子跳过渲染，等价旧 shell 的 `[ -n "$STAGED_ALL" ]` 空判）。 */
export function hasFindings(f: VersionDefenseFindings): boolean {
  return (
    f.dollarFiles.length > 0 || f.coverageProfiles.length > 0 || (f.frontendCount > 0 && f.goCount > 0)
  );
}

/** 渲染为逐行文案（与旧 shell 段逐字等价；不含前导段落标题）。 */
export function renderVersionDefense(f: VersionDefenseFindings): string[] {
  const out: string[] = [];
  if (f.dollarFiles.length > 0) {
    out.push("  ⚠️  $ 开头文件名（疑似 shell 变量漏展开产物，如 88daf2a2 的 $tmp）：");
    for (const p of f.dollarFiles) out.push(`    ${p}`);
  }
  if (f.coverageProfiles.length > 0) {
    out.push("  ⚠️  疑似 Go 覆盖率 profile 入库：");
    for (const p of f.coverageProfiles) out.push(`    ${p}`);
  }
  if (f.frontendCount > 0 && f.goCount > 0) {
    out.push(
      `  ⚠️  本次 commit 同时含 frontend/(+${f.frontendCount}) 与 go/(+${f.goCount}) 改动——跨层夹带信号（合法联调可忽略）`,
    );
  }
  return out;
}

/** 自取 staged 文件（ACM 过滤，与旧 shell 同口径）。 */
export function readStagedFiles(cwd?: string): string[] {
  const r = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
    { cwd, encoding: "utf8" },
  );
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout.split("\n").filter((l) => l.length > 0);
}

/**
 * 读文件首行；不存在/不可读返回 null（等价旧 shell 的 `[ -f "$f" ] || continue`）。
 *
 * 用 node 原生读而非 spawnSync("head")：`head` 在 Windows Git Bash 外不可靠，
 * 且每文件一次进程冷启会拖慢提交（ADR-323「不增加 commit 时延」硬约束）。
 * 只读首块 4KB 再切行，避免为大文件读入全量。
 */
function readFirstLineFromDisk(file: string): string | null {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      if (n <= 0) return "";
      const nl = buf.subarray(0, n).indexOf(0x0a);
      const lineBuf = nl >= 0 ? buf.subarray(0, nl) : buf.subarray(0, n);
      return lineBuf.toString("utf8").replace(/\r$/, "");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function main(): number {
  const staged = readStagedFiles();
  if (staged.length === 0) return 0;
  const findings = detectVersionDefense(staged, (f) => readFirstLineFromDisk(f));
  if (!hasFindings(findings)) return 0;
  for (const line of renderVersionDefense(findings)) console.log(line);
  return 0; // 非阻断：恒 0
}

// 仅直接执行时跑 main（被 import 时不产生副作用）；入口判定同 _lib/gen-stage.ts 惯例
if (process.argv[1] && toPosix(process.argv[1]).endsWith("_lib/commit-blocks/version-defense.ts")) {
  process.exit(main());
}
