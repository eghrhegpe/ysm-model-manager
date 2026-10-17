#!/usr/bin/env node
/**
 * test_commit_staged_domains.ts — pre-commit 变更域裁剪块契约测试（2026-10-17 门禁性能实测）。
 *
 * 覆盖：
 *   1. 纯判据 segmentsForFiles：各段触发域正确（frontend / tests / 混合 / 纯 go / 纯 docs）
 *   2. **零漏判红线**：凡段判据为 0，staged 集必不含该段扫描面的文件——
 *      用真实 classify 反证（裁剪只省时间，不放行）
 *   3. **硬阻断段不入裁剪清单**：三段判据恒为 css-layer/i18n/path-hygiene，且钩子里
 *      三大 exit-1 段（android/biome-lines/design-tokens）的执行行不受 SD_* 门控——
 *      防未来有人把防线裁掉（裁的是提示段的条件，不是硬闸本身）
 *   4. 输出形状契约：行数 = 段数、0/1、行序 = SEGMENTS 序（钩子按行位取用，序漂移即静默错位）
 *   5. fail-open：空清单（管道异常）→ 全 1
 *   6. 逃生阀 YSM_PRECOMMIT_FULL=1 → 全 1
 *   7. 钩子接线对账：被裁段的检查命令逐字仍在（防「删段冒充裁段」）
 *
 * 依赖：node:child_process / node:fs / node:path / node:url / _lib/commit-blocks/staged-domains.ts
 *
 * 用法：node tests/test_commit_staged_domains.ts
 *
 * 退出码：0 全过；1 有失败。
 *
 * 设计意图：把「pre-commit 按域裁剪」从一次性 shell 改动升级为可执行契约——
 * 段序、判据域、fail-open 方向、硬闸不裁、钩子对账各钉一行，改钩子的人不必通读 400 行 shell。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { segmentsForFiles } from "../scripts/_lib/commit-blocks/staged-domains.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const MOD = path.join("scripts", "_lib", "commit-blocks", "staged-domains.ts").replace(/\\/g, "/");
const SEGS = ["css-layer", "i18n", "path-hygiene"];

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
/** 跑真实 CLI（stdin 通道），返回 stdout 行数组。 */
function runCli(stdinText: string, env: Record<string, string> = {}): string[] {
  const out = execFileSync(process.execPath, [MOD], {
    cwd: ROOT,
    input: stdinText,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  return out.trim().split(/\r?\n/);
}

console.log("=== pre-commit 变更域裁剪块契约 ===");

// ── 1. 纯判据：段 → 触发域 ────────────────────────────
check("纯前端变更：三段全开", () => {
  const v = segmentsForFiles(["frontend/src/views/app-content/x.ts"]);
  assert(
    SEGS.every((s) => v[s] === 1),
    JSON.stringify(v),
  );
});
check("纯 Go 变更：三段全关（本裁剪的收益主体）", () => {
  const v = segmentsForFiles(["internal/app/app_settings_export.go", "go/cli/root.go"]);
  assert(
    SEGS.every((s) => v[s] === 0),
    JSON.stringify(v),
  );
});
check("纯文档变更：三段全关（css 段曾被 3.5s 全树扫强收的场景）", () => {
  const v = segmentsForFiles(["docs/knowledge/pre-push-gate.md", "AGENTS.md"]);
  assert(
    SEGS.every((s) => v[s] === 0),
    JSON.stringify(v),
  );
});
check("path-hygiene 亦因 tests/scripts 域而开（R6 判测试 import）", () => {
  const v = segmentsForFiles(["scripts/foo.ts"]);
  assert(v["path-hygiene"] === 1, JSON.stringify(v));
  assert(v["css-layer"] === 0 && v["i18n"] === 0, JSON.stringify(v));
});
check("data / other 域不触发任何前端段", () => {
  const v = segmentsForFiles(["resource_types.json", "Makefile"]);
  assert(
    SEGS.every((s) => v[s] === 0),
    JSON.stringify(v),
  );
});
check("判据表恰为三段——硬阻断段（android/biome-lines/tokens）永不混入", () => {
  const v = segmentsForFiles(["frontend/src/x.ts"]);
  assert(Object.keys(v).length === 3, `段数应为 3，实际 ${JSON.stringify(Object.keys(v))}`);
  assert(
    SEGS.every((s) => s in v) && !("tokens" in v) && !("android" in v) && !("biome" in v),
    `段名集合漂移：${JSON.stringify(Object.keys(v))}`,
  );
});

// ── 2. 零漏判红线：判据 0 ⇒ 无该段扫描面文件 ──────────
check("零漏判：css-layer/i18n 关闭时，staged 必无 frontend/ 文件（判据域充要）", () => {
  const anyFe = ["go/a.go", "docs/b.md", "scripts/c.ts", "tests/d.ts"];
  const v = segmentsForFiles(anyFe);
  assert(v["css-layer"] === 0 && v["i18n"] === 0, JSON.stringify(v));
  const v2 = segmentsForFiles([...anyFe, "frontend/css/components.css"]);
  assert(v2["css-layer"] === 1 && v2["i18n"] === 1, `前端 css 混入必须全开：${JSON.stringify(v2)}`);
});

// ── 4/5/6. CLI 形状与 fail-open ────────────────────────
check("CLI 输出三行 0/1 且行序 = 段序（钩子按行位取用）", () => {
  const lines = runCli("internal/app/a.go\n");
  assert(lines.length === 3, `应三行，实际 ${lines.length}: ${JSON.stringify(lines)}`);
  assert(
    lines.every((l) => l === "0" || l === "1"),
    JSON.stringify(lines),
  );
  assert(lines.join("") === "000", `纯 Go 应全 0，实际 ${lines.join("")}`);
});
check("CLI fail-open：空清单（管道异常）→ 全 1", () => {
  const lines = runCli("");
  assert(lines.join("") === "111", `空清单应全 1，实际 ${lines.join("")}`);
});
check("逃生阀 YSM_PRECOMMIT_FULL=1 → 无视裁剪全 1", () => {
  const lines = runCli("internal/app/a.go\n", { YSM_PRECOMMIT_FULL: "1" });
  assert(lines.join("") === "111", `逃生阀应全 1，实际 ${lines.join("")}`);
});

// ── 7. 钩子接线对账 ────────────────────────────────────
check("钩子以行位消费本模块输出，被裁段的检查命令逐字仍在（裁条件不裁检查）", () => {
  const hook = fs.readFileSync(path.join(ROOT, ".githooks", "pre-commit"), "utf-8");
  assert(hook.includes(MOD), "钩子未接线 staged-domains.ts");
  for (const cmd of [
    "node scripts/css-layer-check.ts",
    "node scripts/i18n-key-naming.ts",
    "node scripts/i18n-check.ts",
    "node scripts/check-path-hygiene.ts",
  ]) {
    assert(hook.includes(cmd), `钩子里检查命令消失（应为条件包裹而非删除）：${cmd}`);
  }
});
check("三大硬阻断段不受 SD_* 门控（防裁掉 --no-verify 最后防线）", () => {
  const hook = fs.readFileSync(path.join(ROOT, ".githooks", "pre-commit"), "utf-8");
  for (const [name, cmd] of [
    ["android", "node scripts/check-android-unavailable.ts --lite"],
    ["biome-lines", "node scripts/check-biome-lines.ts"],
    ["design-tokens", "node scripts/check-design-tokens.ts --staged --added-lines"],
  ] as const) {
    // 硬闸的 `if ! <cmd>` 守卫行同段内不得同时出现 SD_（门控即违规）
    const idx = hook.indexOf(cmd);
    assert(idx >= 0, `硬阻断段缺失：${name} ${cmd}`);
    const guard = hook.slice(Math.max(0, idx - 400), idx);
    assert(!guard.includes("SD_"), `硬阻断段 ${name} 被 SD_* 门控——防线被裁，红线`);
  }
});

console.log(fails.length ? `\nFAIL ${fails.length}: ${fails.join(", ")}` : "\n全部通过");
process.exit(fails.length ? 1 : 0);
