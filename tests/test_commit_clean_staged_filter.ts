#!/usr/bin/env node
/**
 * test_commit_clean_staged_filter.ts — pre-commit「未暂存编辑守卫」块契约测试（ADR-323 阶段 3）。
 *
 * 覆盖：
 *   1. 纯函数 partitionByIndexCleanliness（注入判定，含空串过滤与顺序保持）
 *   2. 渲染文案按语境定制
 *   3. **真实 git 仓集成**：isCleanAgainstIndex 对「索引==工作树」与
 *      「有未暂存编辑」两种状态给出正确判定——这是下沉前无法做到的硬证据
 *      （旧形态是内联 shell，只能靠人工提交时观察）
 *
 * 集成测试在临时目录建独立 git 仓（git init + 用户配置本地化），不触碰主仓索引。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isCleanAgainstIndex,
  partitionByIndexCleanliness,
  renderDirtySkips,
} from "../scripts/_lib/commit-blocks/clean-staged-filter.ts";

const fails: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fails.push(name);
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

console.log("=== pre-commit 未暂存编辑守卫块契约 ===");

// ── 1. 纯函数 ─────────────────────────────────────────
check("partitionByIndexCleanliness：按注入判定分组", () => {
  const { clean, dirty } = partitionByIndexCleanliness(
    ["a.ts", "b.ts", "c.ts"],
    (f) => f !== "b.ts",
  );
  assert(JSON.stringify(clean) === JSON.stringify(["a.ts", "c.ts"]), JSON.stringify(clean));
  assert(JSON.stringify(dirty) === JSON.stringify(["b.ts"]), JSON.stringify(dirty));
});
check("partitionByIndexCleanliness：过滤空串并保持顺序", () => {
  const { clean, dirty } = partitionByIndexCleanliness(["", "z.ts", "a.ts"], () => true);
  assert(JSON.stringify(clean) === JSON.stringify(["z.ts", "a.ts"]), JSON.stringify(clean));
  assert(dirty.length === 0, "不应有 dirty");
});
check("partitionByIndexCleanliness：全脏时 clean 为空", () => {
  const { clean, dirty } = partitionByIndexCleanliness(["a.ts"], () => false);
  assert(clean.length === 0 && dirty.length === 1, `应全脏，实际 ${JSON.stringify({ clean, dirty })}`);
});

// ── 2. 渲染 ───────────────────────────────────────────
check("renderDirtySkips：文案含文件名与语境提示", () => {
  const lines = renderDirtySkips(["x.ts"], "跳过 biome 自动修复（请手动格式化后提交）");
  assert(lines.length === 1, "应一行");
  assert(lines[0].includes("x.ts"), "应含文件名");
  assert(lines[0].includes("未暂存编辑"), "应含原因");
  assert(lines[0].includes("biome"), "应含调用方语境");
});

// ── 3. 真实 git 仓集成 ────────────────────────────────
check("集成：索引==工作树 → clean；有未暂存编辑 → dirty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-clean-filter-"));
  try {
    const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    git(["init", "-q"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "t"]);

    // clean.ts：写入 → add（索引==工作树）
    fs.writeFileSync(path.join(dir, "clean.ts"), "export const a = 1;\n");
    git(["add", "--", "clean.ts"]);

    // dirty.ts：写入 → add → 再改（索引 != 工作树）
    fs.writeFileSync(path.join(dir, "dirty.ts"), "export const b = 1;\n");
    git(["add", "--", "dirty.ts"]);
    fs.writeFileSync(path.join(dir, "dirty.ts"), "export const b = 2;\n");

    assert(isCleanAgainstIndex("clean.ts", dir), "索引==工作树应为 clean");
    assert(!isCleanAgainstIndex("dirty.ts", dir), "有未暂存编辑应为 dirty");

    const { clean, dirty } = partitionByIndexCleanliness(["clean.ts", "dirty.ts"], (f) =>
      isCleanAgainstIndex(f, dir),
    );
    assert(JSON.stringify(clean) === JSON.stringify(["clean.ts"]), JSON.stringify(clean));
    assert(JSON.stringify(dirty) === JSON.stringify(["dirty.ts"]), JSON.stringify(dirty));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
check("集成：不存在的文件保守判 dirty（宁可漏修不可误卷）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-clean-filter2-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "pipe" });
    // 未跟踪/不存在 → git diff --quiet 退出非 0 → false
    assert(!isCleanAgainstIndex("nope.ts", dir), "不存在文件应保守判 dirty");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 4. CLI stdin 通道（钩子实际调用形态）──────────────
check("CLI：stdin 逐行传入的干净文件被输出", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-clean-filter3-"));
  try {
    const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    git(["init", "-q"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "t"]);
    fs.writeFileSync(path.join(dir, "ok.ts"), "export const a = 1;\n");
    git(["add", "--", "ok.ts"]);

    // 以钩子同款形态调用：stdin 传列表
    const modPath = path.resolve("scripts/_lib/commit-blocks/clean-staged-filter.ts");
    const out = execFileSync(process.execPath, ["--experimental-strip-types", modPath], {
      cwd: dir,
      input: "ok.ts\n",
      encoding: "utf8",
    });
    assert(out.includes("ok.ts"), `stdin 文件应被输出，实际 ${JSON.stringify(out)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(fails.length === 0 ? "\n✅ 全部通过" : `\n❌ ${fails.length} 组失败`);
if (fails.length > 0) process.exit(1);
