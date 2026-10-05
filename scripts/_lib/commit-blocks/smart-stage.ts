#!/usr/bin/env node
/**
 * commit-blocks/smart-stage.ts — pre-commit「智能 stage」块（ADR-323 阶段 2）。
 *
 * 下沉自 `.githooks/pre-commit` 的同名段（ADR-087 Take巧 #1）。原为内联 shell，
 * 无法单测；现拆为**纯推导函数 + 执行器**。
 *
 * 职责：本次 staged 了 `.ts`/`.js` 源码 → 自动 stage 同名 `.test.ts` / `.test.js`。
 * 防误 stage：① 自身是测试/规格文件不套娃；② 对应测试文件必须存在（磁盘）。
 *
 * ⚠️ 已知缺陷（**本刀刻意保留、行为等价**，见 ADR-323 §2 硬约束 + §4）：
 *   旧 shell `base="${f%.ts}"; base="${base%.js}"` 用**最短后缀匹配**，故
 *   `foo.d.ts` → base `foo.d` → 探测 `foo.d.test.ts`（而非 `foo.test.ts`）。
 *   仓内有真实 `*.d.ts`（three-glsl.d.ts 等），该边界是活的。
 *   本模块以 `stripSourceSuffix()` 复刻该行为并由测试**锁死**；修复另立项
 *   （搬迁与行为修复不得耦合成难审查的 diff）。
 *
 * 用法（钩子内）：
 *   node scripts/_lib/commit-blocks/smart-stage.ts   # 自取 staged 并 git add 命中的测试文件
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { toPosix } from "../to-posix.ts";

/**
 * 复刻旧 shell 的后缀剥离：`${f%.ts}` 再 `${b%.js}`（**最短匹配**，非后缀整体判定）。
 *
 * 等价性锚点（测试锁死）：
 *   foo.ts      → foo
 *   foo.d.ts    → foo.d     ← 已知缺陷：应为 foo
 *   a.b.ts      → a.b
 *   plain.js    → plain
 *   mod.mts     → mod.mts   ← .mts/.tsx 不在剥离集，原样保留（旧 shell 同）
 */
export function stripSourceSuffix(file: string): string {
  let base = file.endsWith(".ts") ? file.slice(0, -".ts".length) : file;
  base = base.endsWith(".js") ? base.slice(0, -".js".length) : base;
  return base;
}

/** 自身是测试/规格文件（不套娃）。旧 shell：`case "$f" in *.test.*|*.spec.*) continue`。 */
export function isTestOrSpecFile(file: string): boolean {
  return /\.(test|spec)\./.test(file);
}

/**
 * 推导「应被 stage 的测试文件」清单（纯函数）。
 *
 * @param stagedSourceFiles 本次 staged 的 .ts/.js 文件（调用方已按 ACM + 后缀过滤）
 * @param exists 文件存在性判定（注入缝：契约测试无需真实文件）
 *
 * 顺序与去重：保持输入序；同一测试文件被多个源推导出时只保留首次（等价旧 shell
 * 的逐文件 `git add`——重复 add 无副作用，但清单去重后更可读且便于断言）。
 */
export function deriveTestTargets(
  stagedSourceFiles: string[],
  exists: (path: string) => boolean,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of stagedSourceFiles) {
    if (!f) continue;
    if (isTestOrSpecFile(f)) continue;
    const base = stripSourceSuffix(f);
    for (const ext of [".test.ts", ".test.js"]) {
      const candidate = `${base}${ext}`;
      if (!exists(candidate)) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out;
}

/** 自取本次 staged 的 .ts/.js（ACM 过滤，与旧 shell 的 pathspec 同口径）。 */
export function readStagedSourceFiles(cwd?: string): string[] {
  const r = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACM", "--", "*.ts", "*.js"],
    { cwd, encoding: "utf8" },
  );
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout.split("\n").filter((l) => l.length > 0);
}

/** 逐个 `git add`（与旧 shell 同：失败仅提示不阻断，返回失败清单供外层播报）。 */
export function stageFiles(files: string[], cwd?: string): string[] {
  const failed: string[] = [];
  for (const f of files) {
    const r = spawnSync("git", ["add", "--", f], { cwd, stdio: "ignore" });
    if (r.status !== 0) failed.push(f);
  }
  return failed;
}

function main(): number {
  const staged = readStagedSourceFiles();
  if (staged.length === 0) return 0;
  const targets = deriveTestTargets(staged, (p) => fs.existsSync(p));
  if (targets.length === 0) return 0;
  const failed = stageFiles(targets);
  for (const t of targets) {
    if (failed.includes(t)) console.log(`⚠️  智能 stage 失败（不阻断）: ${t}`);
    else console.log(`[pre-commit] 智能 stage: ${t}`);
  }
  return 0; // 非阻断：恒 0
}

// 仅直接执行时跑 main；入口判定同 _lib/gen-stage.ts 惯例
if (process.argv[1] && toPosix(process.argv[1]).endsWith("_lib/commit-blocks/smart-stage.ts")) {
  process.exit(main());
}
