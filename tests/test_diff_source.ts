#!/usr/bin/env node
/**
 * test_diff_source.ts — 变更 diff 来源与提交侧内容契约测试（scripts/_lib/diff-source.ts）。
 *
 * 为什么需要这组测试：行级门禁（ADR-256）的全部正确性都压在两个问题上——
 *   ① 「哪些行是本次新增的」（git diff 归属，含 rename 配对）
 *   ② 「这些行在**提交侧**长什么样」（index blob / HEAD blob，**不是磁盘**）
 * ② 若退化成读磁盘，「已 staged 又续改」「并行会话改同一文件」就会让判定对象 ≠ 提交对象：
 * 行号位移被判成新增（误伤）、内容差异又可能漏判。本测试用**临时仓库**把这两点钉死，
 * 不复用主仓库（并行会话共享 checkout，测试不得扰动它）。
 *
 * 用临时仓库 + 独立 `GIT_INDEX_FILE` 的原因：这正是 pre-commit 的真实形态
 * （`git commit` 把裁剪后的索引经该变量交给钩子），可同时验证「索引 vs 磁盘分叉」。
 *
 * 运行：node tests/test_diff_source.ts（失败 exit 1；契约 runner 收集）。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addedLines,
  changedFiles,
  content,
  contentRev,
  diffArgs,
  renameMap,
  type DiffSource,
} from "../scripts/_lib/diff-source.ts";

function git(args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
  }).trim();
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-diff-src-"));
process.on("exit", () => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 清理失败忽略（临时目录） */
  }
});
git(["init", "-q"], dir);
git(["config", "user.email", "t@t"], dir);
git(["config", "user.name", "t"], dir);
const A = path.join(dir, "a.ts");
fs.writeFileSync(A, "line1\nline2\nline3\n", "utf8");
git(["add", "."], dir);
git(["commit", "-q", "-m", "base"], dir);

// ─── 1) 纯函数：diffArgs / contentRev（判定 argv 的唯一事实源）────────────
{
  const idx: DiffSource = { kind: "index" };
  const rng: DiffSource = { kind: "range", base: "BASE", head: "HEAD" };
  assert.deepEqual(
    diffArgs(idx, "a.ts"),
    ["diff", "--cached", "--unified=0", "-M", "--", "a.ts"],
    "index 源：暂存区 vs HEAD",
  );
  assert.deepEqual(
    diffArgs(rng, "b.ts", "a.ts"),
    ["diff", "--unified=0", "-M", "BASE", "HEAD", "--", "b.ts", "a.ts"],
    "range 源：base..head，rename 时新旧路径都要进 pathspec（否则 git 无法配对）",
  );
  assert.equal(contentRev(idx, "a.ts"), ":a.ts", "index 源内容取暂存 blob");
  assert.equal(contentRev(rng, "a.ts"), "HEAD:a.ts", "range 源内容取 head blob");
}

// ─── 2) index 源：内容取**暂存 blob**，磁盘再改也不影响判定对象 ────────────
// 场景 = 真实世界最常见的错位：staged 之后又续改（git status 的 MM）。
{
  const idx = path.join(dir, ".git", "index.probe");
  const env = { GIT_INDEX_FILE: idx };
  // 关键：GIT_INDEX_FILE 要设在**本进程**上——这正是 pre-commit 的真实形态（git 把裁剪后的
  // 索引经该变量交给钩子，钩子内一切 git 子进程继承它）。diff-source 内部不显式传 env，
  // 故测试若只在本地 git() helper 里传 env，就测不到真实语义（实测踩过：于是读到 HEAD 版本）。
  const prevIdx = process.env.GIT_INDEX_FILE;
  process.env.GIT_INDEX_FILE = idx;
  try {
    git(["read-tree", "HEAD"], dir, env);
    fs.writeFileSync(A, "STAGED\nline2\nline3\n", "utf8");
    git(["add", "a.ts"], dir, env);
    fs.writeFileSync(A, "DISK\nline2\nline3\n", "utf8"); // 磁盘再改（不进索引）

    const src: DiffSource = { kind: "index" };
    assert.equal(
      content(src, "a.ts", { cwd: dir }),
      "STAGED\nline2\nline3\n",
      "内容必须等于暂存 blob（含尾换行），不是磁盘的 DISK",
    );
    assert.deepEqual(
      [...(addedLines(src, "a.ts", undefined, { cwd: dir }) ?? [])],
      [1],
      "新增行 = 暂存 blob 相对 HEAD 的第 1 行（与磁盘无关）",
    );
    assert.deepEqual(changedFiles(src, ["*.ts"], { cwd: dir }), ["a.ts"], "变更清单来自索引");
    assert.equal(renameMap(src, ["*.ts"], { cwd: dir })?.size, 0, "无 rename → 空映射（非 null）");
    assert.equal(content(src, "no-such.ts", { cwd: dir }), null, "该 revision 无此文件 → null");
    fs.rmSync(idx, { force: true });

    // 索引与 HEAD 一致时：空集是**合法**结果（不是失败）——三态语义的核心
    git(["read-tree", "HEAD"], dir, env);
    assert.deepEqual(
      [...(addedLines(src, "a.ts", undefined, { cwd: dir }) ?? [])],
      [],
      "无新增行 → 空集（调用方不得当 null/fail-closed）",
    );
    assert.deepEqual(changedFiles(src, ["*.ts"], { cwd: dir }), [], "无变更 → 空清单");
    fs.rmSync(idx, { force: true });
  } finally {
    if (prevIdx === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = prevIdx;
  }
  fs.writeFileSync(A, "line1\nline2\nline3\n", "utf8"); // 磁盘复原
}

// ─── 3) range 源：提交侧内容 + 新增行（pre-push / CI 形态）────────────────
{
  fs.writeFileSync(A, "line1\nCHANGED\nline3\n", "utf8");
  git(["add", "a.ts"], dir);
  git(["commit", "-q", "-m", "c2"], dir);
  const base = git(["rev-parse", "HEAD~1"], dir);
  const src: DiffSource = { kind: "range", base, head: "HEAD" };
  assert.equal(content(src, "a.ts", { cwd: dir }), "line1\nCHANGED\nline3\n", "内容取 head blob");
  assert.deepEqual([...(addedLines(src, "a.ts", undefined, { cwd: dir }) ?? [])], [2], "第 2 行是新增");
  assert.deepEqual(changedFiles(src, ["*.ts"], { cwd: dir }), ["a.ts"], "range 变更清单");
}

// ─── 4) rename 配对：不给旧路径 → 整文件被当「全新文件」（全量新增行）───────
// 这是 check-biome-lines 踩过的坑（pathspec 同时约束两侧），行级闸不配对就会把
// 一次纯改名判成「整文件新增」，批量迁移类提交直接假阻断。
{
  git(["mv", "a.ts", "b.ts"], dir);
  git(["commit", "-q", "-m", "rename"], dir);
  const base = git(["rev-parse", "HEAD~1"], dir);
  const src: DiffSource = { kind: "range", base, head: "HEAD" };

  assert.equal(renameMap(src, ["*.ts"], { cwd: dir })?.get("b.ts"), "a.ts", "rename 映射新→旧");
  const withoutOld = addedLines(src, "b.ts", undefined, { cwd: dir });
  const withOld = addedLines(src, "b.ts", "a.ts", { cwd: dir });
  assert.ok((withoutOld?.size ?? 0) >= 3, `不给旧路径 → 整文件算新增（实测 ${withoutOld?.size} 行）`);
  assert.equal(withOld?.size, 0, "给了旧路径 → 纯改名新增 0 行（不误判为整文件新增）");
}

console.log("✅ test_diff_source.ts 全部通过（4 组契约断言）");
