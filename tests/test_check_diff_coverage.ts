#!/usr/bin/env node
/**
 * 契约测试：check-diff-coverage.mjs 纯函数单元测试。
 *
 * 覆盖边界情况（源自 MikuMikuAR __tests__/check-diff-coverage.test.mjs，适配本仓库）：
 *   1. addLinesFromDiff：仅取 + 行号、上下文行递增、- 行不递增、多 hunk 独立起始
 *   2. parseRenameStatus：R 行解析（相似度/来源/目标），忽略 M/A/D
 *   3. statementPctForChangedLines：无语句 100 / 纯改名 100 / 部分覆盖按比例 / 空 statementMap 100
 *   4. buildSuggestBlock：commit message 建议区块格式与幂等对位
 *
 * 零依赖（仅 node:assert）。运行：node tests/test_check_diff_coverage.mjs
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../scripts/_lib/scan-files.ts";
import {
  addLinesFromDiff,
  buildSuggestBlock,
  hasNoCoverableStatements,
  isVitestExcluded,
  parseRenameStatus,
  statementPctForChangedLines,
} from "../scripts/check-diff-coverage.ts";

const fails = [];
function check(name, fn) {
  try {
    fn();
    console.log("✓", name);
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
    console.error("✗", name, "-", e.message);
  }
}

check("addLinesFromDiff 仅取 + 行号，上下文行递增，- 行不递增", () => {
  const diff = [
    "diff --git a/old b/new",
    "--- a/old",
    "+++ b/new",
    "@@ -10,3 +10,3 @@",
    " context",
    "-removed",
    "+added",
    " context2",
  ].join("\n");
  const out = new Set();
  addLinesFromDiff(out, diff);
  // 行号推演：@@ +10 → 10；" context"( )→11；"-removed" 不递增(11)；
  // "+added"(+)→add(11)→12；" context2"( )→13
  assert.deepEqual([...out], [11]);
});

check("addLinesFromDiff 多 hunk 各自独立起始", () => {
  const diff = ["@@ -1,1 +1,1 @@", "+only", "@@ -50,1 +50,1 @@", "+fifty"].join("\n");
  const out = new Set();
  addLinesFromDiff(out, diff);
  assert.deepEqual(
    [...out].sort((a, b) => a - b),
    [1, 50],
  );
});

check("parseRenameStatus 解析 R 行，忽略 M/A/D", () => {
  const out = [
    "R098\tfrontend/src/views/app-content/site/edit.ts\tfrontend/src/views/app-content/site/editor.ts",
    "R100\ta/b.ts\ta/c.ts",
    "M\tx/y.ts",
    "A\tz/new.ts",
  ].join("\n");
  const map = parseRenameStatus(out);
  assert.equal(map.size, 2);
  assert.deepEqual(map.get("frontend/src/views/app-content/site/editor.ts"), {
    from: "frontend/src/views/app-content/site/edit.ts",
    sim: 98,
  });
  assert.deepEqual(map.get("a/c.ts"), { from: "a/b.ts", sim: 100 });
  assert.equal(map.has("x/y.ts"), false);
  assert.equal(map.has("z/new.ts"), false);
});

check("statementPctForChangedLines 变更行上无语句 → 100", () => {
  const entry = {
    s: { 0: 0 },
    statementMap: { 0: { start: { line: 5 }, end: { line: 5 } } },
  };
  // 变更行 7 上无 statement
  assert.equal(statementPctForChangedLines(entry, new Set([7])), 100);
});

check("statementPctForChangedLines 纯改名（仅 import 行无语句）→ 100", () => {
  // 模拟 rename 重构：改动行 20/30/40/50 均为 import 改写，无 statement
  const entry = {
    s: { 0: 1, 1: 1 },
    statementMap: {
      0: { start: { line: 10 }, end: { line: 12 } },
      1: { start: { line: 60 }, end: { line: 65 } },
    },
  };
  assert.equal(statementPctForChangedLines(entry, new Set([20, 30, 40, 50])), 100);
});

check("statementPctForChangedLines 部分覆盖按比例", () => {
  const entry = {
    s: { 0: 1, 1: 0 },
    statementMap: {
      0: { start: { line: 5 }, end: { line: 5 } },
      1: { start: { line: 10 }, end: { line: 10 } },
    },
  };
  assert.equal(statementPctForChangedLines(entry, new Set([5, 10])), 50);
  assert.equal(statementPctForChangedLines(entry, new Set([5])), 100);
  assert.equal(statementPctForChangedLines(entry, new Set([10])), 0);
});

check("statementPctForChangedLines 空 statementMap → 100", () => {
  assert.equal(statementPctForChangedLines({ s: {}, statementMap: {} }, new Set([1])), 100);
});

check("buildSuggestBlock 输出可追加进 commit message 的 Markdown 区块", () => {
  const block = buildSuggestBlock(
    [
      { file: "frontend/src/views/app-content/site/edit.ts", pct: 25.0 },
      { file: "frontend/src/views/app-preview/loader.ts", pct: 8.3 },
    ],
    60,
  );
  const lines = block.split("\n");
  // 首行即钩子 stripBlock 的 BLOCK_START 标记，保证幂等剥离可对位
  assert.equal(lines[0], "## 覆盖率建议（非阻断）");
  assert.match(block, /低于 60%/);
  assert.match(block, /`frontend\/src\/views\/app-content\/site\/edit.ts` — 25\.0%/);
  assert.match(block, /`frontend\/src\/views\/app-preview\/loader.ts` — 8\.3%/);
  assert.match(block, /不阻塞提交\/合并/);
  // 不含阈值以外的多余信息，保持 message 整洁
  assert.doesNotMatch(block, /\[X\]/);
});

check("buildSuggestBlock 单文件亦生成合法区块", () => {
  const block = buildSuggestBlock([{ file: "frontend/src/preview-3d/mesh/model3d.ts", pct: 0 }], 60);
  assert.match(block, /`frontend\/src\/preview-3d\/mesh\/model3d.ts` — 0\.0%/);
});

// ── 5. 消假红：无 Istanbul 条目 ≠ 0% 未覆盖（2026-10-08 实测驱动）──────────────
// 病根：vitest coverage.exclude 排除的文件（3D 装配入口/vendor/test-utils）与
// 「编译后无语句」的纯类型/再导出文件，在 coverage-final.json 里都没有条目，
// 而旧逻辑一律 pct=0 ⇒ 结构性假红（实测 v1.15.0..HEAD 219 文件里 9 个假红）。
check("isVitestExcluded：3D 装配入口在排除域", () => {
  assert.equal(isVitestExcluded("frontend/src/views/app-preview/ysm-3d.ts"), true);
  assert.equal(isVitestExcluded("frontend/src/views/app-preview/maid-3d.ts"), true);
});
check("isVitestExcluded：wasm-decode / test-utils / vendor 在排除域", () => {
  assert.equal(isVitestExcluded("frontend/src/preview-3d/decoder/wasm-decode.ts"), true);
  assert.equal(isVitestExcluded("frontend/src/test-utils/fetch.ts"), true);
  assert.equal(isVitestExcluded("frontend/src/preview-3d/adapters/vendor/babylon-mmd/x.ts"), true);
});
check("isVitestExcluded：普通生产文件不在排除域（防豁免域扩张）", () => {
  assert.equal(isVitestExcluded("frontend/src/preview-3d/caps/env-hdr-cache.ts"), false);
  assert.equal(isVitestExcluded("frontend/src/views/app-tree/loader.ts"), false);
  // 前缀匹配不得误伤同名前缀的兄弟文件
  assert.equal(isVitestExcluded("frontend/src/views/app-preview/ysm-3d-extra.ts"), false);
});
// 反向锚：豁免域必须与 vitest.config.ts 的 coverage.exclude 真对齐（防「这边加了那边没加」）。
// 用真实文件断言，不用硬编码字符串——vitest 侧删了排除项而此处未跟 ⇒ 本测试仍绿但 CI 假红，
// 故同时钉「本表每个 3D 入口在 vitest.config.ts 里确有对应行」。
check("isVitestExcluded：豁免项在 vitest.config.ts 有对应排除声明", () => {
  const cfg = readFileSync(resolve(ROOT, "frontend/vitest.config.ts"), "utf8");
  for (const f of [
    "src/views/app-preview/ysm-3d.ts",
    "src/views/app-preview/maid-3d.ts",
    "src/preview-3d/decoder/wasm-decode.ts",
    "src/test-utils/**",
  ]) {
    assert.ok(cfg.includes(f), `vitest.config.ts 应含 coverage.exclude 项 ${f}（两处口径须同步）`);
  }
});
check("hasNoCoverableStatements：纯类型文件（surface-pixels/types.ts）", () => {
  assert.equal(hasNoCoverableStatements("frontend/src/preview-3d/caps/surface-pixels/types.ts"), true);
});
check("hasNoCoverableStatements：纯再导出垫层（parse-ysm-json.ts）", () => {
  assert.equal(hasNoCoverableStatements("frontend/src/preview-3d/decoder/parse-ysm-json.ts"), true);
});
check("hasNoCoverableStatements：有真实逻辑的文件为 false（防豁免域扩张）", () => {
  assert.equal(hasNoCoverableStatements("frontend/src/views/app-tree/loader.ts"), false);
  assert.equal(hasNoCoverableStatements("frontend/src/preview-3d/caps/env-hdr-cache.ts"), false);
});
check("hasNoCoverableStatements：读不到文件时 fail-loud（返回 false）", () => {
  assert.equal(hasNoCoverableStatements("frontend/src/__nonexistent__.ts"), false);
});

if (fails.length) {
  console.error(`\n❌ ${fails.length} 个用例失败：`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✅ 全部用例通过");
