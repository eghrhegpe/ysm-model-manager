#!/usr/bin/env node
/**
 * commit-blocks/clean-staged-filter.ts — pre-commit「未暂存编辑守卫」块（ADR-323 阶段 3）。
 *
 * 下沉自 `.githooks/pre-commit` 中**重复内联两次**的同款守卫（gofmt 段 + biome 段）。
 * 两处语义相同（「含未暂存编辑的文件跳过自动格式化，防混拼半成品」）却各写一遍，
 * 且 biome 那处以 heredoc + 空格拼串传列表（路径含空格即断）。
 *
 * 本模块把它收敛为单一事实源：判定 + 列表过滤。
 *
 * 语义：`git diff --quiet -- <file>` 为空 = 工作树与索引一致 = 可安全自动格式化；
 *       非空 = 该文件同时有未暂存编辑，自动格式化会卷进半成品 → 跳过并告警。
 *
 * 用法（钩子内，取「干净子集」）：
 *   node scripts/_lib/commit-blocks/clean-staged-filter.ts <file>...
 *   输出：干净文件逐行（stdout）；被跳过者告警（stderr）；恒 exit 0（非阻断）
 *
 * CLI 亦供契约测试与人工排查直接调用。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { toPosix } from "../to-posix.ts";

/**
 * 判定单个文件是否「工作树与索引一致」（无未暂存编辑 = 可安全自动格式化）。
 *
 * ⚠️ 前置存在性检查不可省（2026-10-06 实证）：`git diff --quiet -- <未跟踪文件>`
 * **返回 0**（索引与工作树都「没有」它即视为无差异）——若只靠 git 退出码，
 * 不存在的文件会被误判为 clean 而进入格式化列表。旧 shell 段另有
 * `[ -f "$f" ]`/`case` 前置，本模块以显式 existsSync 复刻该语义。
 *
 * `cwd` 注入缝：契约测试可在临时 git 仓中断言，无需污染主仓索引。
 * git 不可用/非仓等异常 → 保守返回 false（不自动格式化），宁可漏修不可误卷半成品。
 */
export function isCleanAgainstIndex(file: string, cwd?: string): boolean {
  const abs = cwd ? path.join(cwd, file) : file;
  if (!fs.existsSync(abs)) return false;
  const r = spawnSync("git", ["diff", "--quiet", "--", file], { cwd, stdio: "ignore" });
  return r.status === 0;
}

/** 过滤出干净子集；返回 { clean, dirty } 两组（保持输入序）。 */
export function partitionByIndexCleanliness(
  files: string[],
  isClean: (file: string) => boolean,
): { clean: string[]; dirty: string[] } {
  const clean: string[] = [];
  const dirty: string[] = [];
  for (const f of files) {
    if (!f) continue;
    if (isClean(f)) clean.push(f);
    else dirty.push(f);
  }
  return { clean, dirty };
}

/** 渲染跳过告警（文案按调用方语境定制；与旧 shell 逐字等价由调用方传 hint）。 */
export function renderDirtySkips(dirty: string[], hint: string): string[] {
  return dirty.map((f) => `  ⚠️ ${f} 含未暂存编辑，${hint}`);
}

/**
 * 从 stdin 读取文件列表（换行/空白分隔，忽略空行）。
 *
 * 钩子以 `printf '%s\n' "$LIST" | node ...` 形式调用，故 **stdin 是主通道**；
 * argv 仅作人工单测便利（两者合并，去重保序）。
 */
function readInputFiles(): string[] {
  const fromArgv = process.argv.slice(2);
  if (process.stdin.isTTY && fromArgv.length > 0) return fromArgv;
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    raw = "";
  }
  const fromStdin = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of [...fromArgv, ...fromStdin]) {
    if (seen.has(f)) continue;
    seen.add(f);
    out.push(f);
  }
  return out;
}

function main(): number {
  const files = readInputFiles();
  if (files.length === 0) return 0;
  const { clean, dirty } = partitionByIndexCleanliness(files, (f) => isCleanAgainstIndex(f));
  for (const line of renderDirtySkips(dirty, "跳过自动格式化（请手动格式化后提交）")) {
    console.error(line);
  }
  for (const f of clean) console.log(f);
  return 0; // 非阻断
}

// 仅直接执行时跑 main；入口判定同 _lib/gen-stage.ts 惯例
if (process.argv[1] && toPosix(process.argv[1]).endsWith("_lib/commit-blocks/clean-staged-filter.ts")) {
  process.exit(main());
}
