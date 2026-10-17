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
check(
  "path-hygiene 扫描域恒为 frontend/src（锐评 P2-4 收窄后：scripts/tests 变更不再点亮）",
  () => {
    // 判据收窄的正当性 = 脚本现实：walk(SRC_ROOT)，R6 判的也是 src 内 *.test.ts——
    // 根 tests/ 与 scripts/ 的变更点亮该段后判定必空，属纯多跑。收窄不引入漏判。
    const v = segmentsForFiles(["scripts/foo.ts"]);
    assert(v["path-hygiene"] === 0, `scripts 变更不应点亮 path-hygiene：${JSON.stringify(v)}`);
    const v2 = segmentsForFiles(["tests/x.ts"]);
    assert(v2["path-hygiene"] === 0, JSON.stringify(v2));
    const v3 = segmentsForFiles(["frontend/src/foo.test.ts"]);
    assert(v3["path-hygiene"] === 1, `src 内测试文件必须点亮（R6 射程）：${JSON.stringify(v3)}`);
  },
);
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
/**
 * 从 lines[i]（cmd 所在行）向上找最近的非注释 `if` 头，再向下收集该 if 块的**全部代码行**
 * （至首个 `^fi` 行止；注释行剔除）。返回 null = 找不到块头（调用方按缺失处理）。
 * 为什么不是固定字节窗口（锐评 P2-3）：注释变长即漂出窗口——假绿的经典形态。
 * ⚠️ 非注释 if 头必须 ≤8 行内可及：仓内守卫惯例是「注释紧贴 if」，注释墙后的块头
 *   说明 cmd 不在任何 if 块里，本身即异常，测试红比静默放行好。
 */
function ifBlockAround(lines: string[], cmd: string): string[] | null {
  // 首个**非注释**含 cmd 行（cmd 串可能先出现在文档注释里——那不算执行点）
  const i = lines.findIndex((l) => !/^\s*#/.test(l) && l.includes(cmd));
  if (i < 0) return null;
  let head = -1;
  for (let j = i; j >= Math.max(0, i - 8); j--) {
    const l = lines[j]!;
    if (/^\s*#/.test(l)) continue; // 注释不参与块头判定（cmd 常紧贴 if 同一行）
    if (/^\s*if\s/.test(l)) {
      head = j;
      break;
    }
  }
  if (head < 0) return null;
  const block: string[] = [];
  for (let j = head; j < lines.length; j++) {
    const l = lines[j]!;
    if (/^\s*fi\b/.test(l)) break;
    if (/^\s*#/.test(l)) continue;
    block.push(l);
  }
  return block;
}

check("被裁段确实被 SD_* 门控（锐评 P2-3 反向锁定：删门控即测试红）", () => {
  const hook = fs.readFileSync(path.join(ROOT, ".githooks", "pre-commit"), "utf-8");
  const lines = hook.split(/\r?\n/);
  for (const [cmd, sd] of [
    ["node scripts/css-layer-check.ts", "SD_CSS"],
    ["node scripts/i18n-key-naming.ts", "SD_I18N"],
    ["node scripts/i18n-check.ts", "SD_I18N"],
    ["node scripts/check-path-hygiene.ts", "SD_PATH"],
  ] as const) {
    const blk = ifBlockAround(lines, cmd);
    assert(blk !== null, `钩子里找不到 ${cmd} 的 if 块（门控结构被拆？）`);
    const head = blk![0]!;
    assert(head.includes(sd), `${cmd} 的 if 头未含 ${sd}——门控被删，裁剪失效：${head}`);
  }
});

check("钩子门控为白名单口径 + 形状校验双保险（锐评 P1-1）", () => {
  const hook = fs.readFileSync(path.join(ROOT, ".githooks", "pre-commit"), "utf-8");
  for (const sd of ["SD_CSS", "SD_I18N", "SD_PATH"]) {
    assert(
      hook.includes(`"$${sd}" != "0"`),
      `门控应为 != "0" 白名单口径（脏值默认跑），找不到：${sd}`,
    );
    assert(!hook.includes(`"$${sd}" = "1"`), `残留 "= 1" 判定（脏输出会静默跳段）：${sd}`);
  }
  // 形状校验：恰好三行且每行 0/1，否则置全 1——防「脏行挤占正确位」使白名单失效
  assert(
    /SD_N=.*awk/.test(hook) && /SD_BAD=.*awk/.test(hook),
    "缺少 awk 形状校验（行数/脏行计数）",
  );
  assert(hook.includes("SD_RAW=\"$(printf '1\\n1\\n1')\""), "验形失败分支应显式置全 1");
});

check("三大硬阻断段守卫链不受 SD_* 引用（突变 A 实证版）", () => {
  const hook = fs.readFileSync(path.join(ROOT, ".githooks", "pre-commit"), "utf-8");
  const lines = hook.split(/\r?\n/);
  for (const [name, cmd] of [
    ["android", "node scripts/check-android-unavailable.ts --lite"],
    ["biome-lines", "node scripts/check-biome-lines.ts"],
    ["design-tokens", "node scripts/check-design-tokens.ts --staged --added-lines"],
  ] as const) {
    // 判据 = 自 cmd 执行行**向上回溯守卫链**（连续 if 行，容忍 if 与 cmd 同步行间嵌套，
    // 遇 fi/赋值/空行即停）。为什么不是 if 块向下（突变 A 实证）：硬闸是「外层守卫 if +
    // 内层 if ! cmd」嵌套，回溯停在内层就漏掉外层被接 SD_ 的形态；向上收全链才封死。
    // （段窗按空行分隔也试过——会连坐无关的留痕 if 块产生假阳性，弃用。）
    const i = lines.findIndex((l) => !/^\s*#/.test(l) && l.includes(cmd));
    assert(i >= 0, `硬阻断段执行行缺失：${name} ${cmd}`);
    const chain: string[] = [];
    let j = i;
    // if ! cmd 同步行直接算链头；否则 cmd 在块体里，从上一行开始收 if 行
    if (!/^\s*if\s/.test(lines[i]!)) j = i - 1;
    for (; j >= 0; j--) {
      const l = lines[j]!;
      if (/^\s*if\s/.test(l)) {
        chain.push(l);
        continue;
      }
      // 链中断条件：非注释、非 if 的任意行（fi / 赋值 / 空行 / echo）
      if (!/^\s*#/.test(l)) break;
    }
    assert(chain.length >= 1, `${name} 找不到守卫 if 链——阻断结构被拆？cmd 行：${lines[i]}`);
    const bad = chain.filter((l) => l.includes("SD_"));
    assert(
      bad.length === 0,
      `硬阻断段 ${name} 守卫链含 SD_*（防线被裁，红线）：\n${bad.join("\n")}`,
    );
  }
});

console.log(fails.length ? `\nFAIL ${fails.length}: ${fails.join(", ")}` : "\n全部通过");
process.exit(fails.length ? 1 : 0);
