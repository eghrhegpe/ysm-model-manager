#!/usr/bin/env node
/**
 * 契约测试：浅克隆下「直推 main 兜底」不得把覆盖率门禁误判为解析失败。
 *
 * 根因（2026-09-15 CI 实证，main push 连续多笔无关红）：
 *   `.github/workflows/test.yml` 的 Go 覆盖率步骤曾跑 `git fetch origin main --depth=1`，
 *   而 checkout 是 `fetch-depth: 0` 全量克隆 —— 该 depth 抓取会把仓库**退化为浅克隆**
 *   （生成 `.git/shallow`），`HEAD~1` 随即不可解析。`_lib/diff-coverage-core.ts` 的两处
 *   「直推 main 兜底」（`getChangedFiles` 的 `${head}~1...${head}` 与 `getChangedLines`
 *   同款）在该状态下让 git 抛 `fatal: ambiguous argument 'HEAD~1...HEAD'`：
 *   `getChangedFiles` 因此返回 null → 调用方「拒绝空跑放行」→ **硬阻断**整步，
 *   与本次改动完全无关（本地因历史完整恒绿 → 典型「本地绿、CI 红」）。
 *
 * 不变量：浅历史（`HEAD~1` 不可解析）**且** `base...head` 无差异时，
 *   `getChangedFiles` 应返回**空数组**（语义 = 本次范围没改到文件），绝不返回 null
 *   （null = 解析失败 = 硬阻断）。二者必须严格区分。
 *
 * 手法：临时仓库做 `--depth=1` 浅抓取 → 把仓库自身 scripts/ 复制进去（使 ROOT 解析到
 *   该浅仓库）→ 跑探针调用**真实** getChangedFiles → 断言结果为 []（修复后）而非 null。
 *   另置「前置条件」断言 HEAD~1 确实不可解析，避免在完整历史环境下假绿。
 *
 * 运行：node tests/test_diff_coverage_shallow.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 跑 git（吞错，返回 {ok, out}）——浅历史下报错是**预期**，不是测试失败。 */
function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execFileSync("git", args, { cwd, encoding: "utf8" }).trim() };
  } catch (e: any) {
    return { ok: false, out: (e.stdout ?? "").toString().trim() };
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-shallow-"));
try {
  // ── 1. 造浅克隆：本地仓库自身当 remote，--depth=1 制造 .git/shallow ──
  git(tmp, ["init", "--quiet", "."]);
  git(tmp, ["remote", "add", "origin", ROOT]);
  const fetched = git(tmp, ["fetch", "--quiet", "origin", "main", "--depth=1"]);
  assert.ok(fetched.ok, `浅抓取失败（无法构造前置条件）：${fetched.out}`);
  git(tmp, ["checkout", "--quiet", "-B", "main", "FETCH_HEAD"]);

  // ── 2. 前置条件：必须真的退化为浅克隆，否则本测试失去意义（假绿风险）──
  assert.ok(
    fs.existsSync(path.join(tmp, ".git", "shallow")),
    "前置条件失败：未生成 .git/shallow，说明未退化为浅克隆",
  );
  const headParent = git(tmp, ["rev-parse", "--verify", "--quiet", "HEAD~1^{commit}"]);
  assert.equal(headParent.ok, false, "前置条件失败：HEAD~1 竟可解析（仓库非浅）");

  // ── 3. 铺 scripts/：diff-coverage-core 的 ROOT = scripts/_lib/../.. ，故拷贝后
  //        ROOT 即指向该浅仓库，git() 会在浅历史下执行——正是 CI 的真实条件。──
  const dstScripts = path.join(tmp, "scripts");
  fs.cpSync(path.join(ROOT, "scripts"), dstScripts, { recursive: true });

  // 探针：直接调**真实** getChangedFiles，打印 JSON 结果（null 与 [] 可区分）。
  // 用 pathToFileURL 生成 file:// URL——Windows 盘符路径不能直接当 ESM specifier。
  const { pathToFileURL } = await import("node:url");
  const coreUrl = pathToFileURL(path.join(dstScripts, "_lib", "diff-coverage-core.ts")).href;
  const probePath = path.join(tmp, "probe.ts");
  fs.writeFileSync(
    probePath,
    `import { getChangedFiles } from ${JSON.stringify(coreUrl)};\n` +
      `const r = getChangedFiles("origin/main", "HEAD", false, false);\n` +
      `process.stdout.write(JSON.stringify({ kind: r === null ? "null" : "array", value: r }));\n`,
  );

  const raw = execFileSync("node", [probePath], { cwd: tmp, encoding: "utf8" }).trim();
  const got = JSON.parse(raw) as { kind: string; value: unknown };

  // ── 4. 核心断言：浅历史 + 无差异 ⇒ 空数组，而非 null（null = 硬阻断）──
  assert.equal(
    got.kind,
    "array",
    `浅克隆下 getChangedFiles 必须返回数组（空责任集），实得 ${got.kind}` +
      `——返回 null 即复发「直推 main 恒红」缺陷`,
  );
  assert.deepEqual(got.value, [], "浅历史 + origin/main==HEAD ⇒ 责任集应为空数组");

  console.log("  ✓ 前置条件：.git/shallow 存在，HEAD~1 不可解析（真实浅克隆）");
  console.log("  ✓ 核心不变量：浅历史下 getChangedFiles 返回 [] 而非 null（不再误判解析失败）");
  console.log(
    "\nOK: 浅克隆兜底守卫（diff-coverage-core 直推 main 路径不再因 HEAD~1 不可达而硬阻断）",
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
