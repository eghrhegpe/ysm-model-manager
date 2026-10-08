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
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

// ── 6. 假绿防线：基线 == HEAD 必须 fail-loud（2026-10-08 实测驱动，见 ci-tuning §8e）──
// 病灶：CI 在 push 之后跑，checkout 的 HEAD 与 fetch 到的 origin/main 同提交 ⇒ diff 为空 ⇒
// 旧行为输出「本次无改动源码需要检查。通过。」exit 0——**与真通过不可区分**。
// 契约：门禁模式（默认/--json）必须 exit 2；--suggest 提示模式保持非阻断 exit 0。
// 直接 spawn 脚本进程断言退出码（纯函数测不到 exit 语义）。
//
// ⚠️ 环境无关（2026-10-08 CI 实证教训）：脚本在**读 coverage 之前**就会因缺文件 exit 2，
// 若依赖 `frontend/coverage/coverage-final.json` 存在，则局部（跑过 vitest）绿、CI 红——
// `contracts` job 刻意不跑 vitest，故该文件**恒不存在**。修法：自造最小 Istanbul 夹具到
// 临时目录，一律 `--coverage <tmp>`，测试不依赖任何本地产物。
{
  const tmpDir = mkdtempSync(join(tmpdir(), "ysm-diffcov-test-"));
  const covPath = join(tmpDir, "coverage-final.json");
  // 最小合法 Istanbul 形态：一条已覆盖的语句（判定链要能走到底，不因空对象提前返回）
  writeFileSync(
    covPath,
    JSON.stringify({
      [join(ROOT, "frontend/src/views/app-tree/loader.ts")]: {
        s: { "0": 1 },
        statementMap: { "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } } },
      },
    }),
  );
  const runScript = (argv: string[]) =>
    spawnSync(process.execPath, ["scripts/check-diff-coverage.ts", ...argv], {
      cwd: ROOT,
      encoding: "utf8",
    });
  // 前置：HEAD 必须可解析（否则测的是另一条错误路径，假绿）
  const headOk = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  if (headOk.status !== 0) {
    console.log("⚠ 跳过基线守卫用例：本环境无 git HEAD");
  } else {
    check("基线 == HEAD 时门禁 fail-loud（exit 2，不假绿）", () => {
      const r = runScript(["--base", "HEAD", "--coverage", covPath]);
      assert.equal(r.status, 2, `应 exit 2，实为 ${r.status}；stderr=${r.stderr}`);
      assert.match(r.stderr, /基线无意义/);
    });
    check("基线 == HEAD 时报错文案指向真实成因（同一提交/变更集必为空）", () => {
      const r = runScript(["--base", "HEAD", "--coverage", covPath]);
      assert.match(r.stderr, /与 HEAD 是同一提交/);
      assert.match(r.stderr, /变更集必为空/);
    });
    check("--suggest 模式遇无意义基线仍非阻断（exit 0，提示模式不得阻断）", () => {
      const r = runScript(["--base", "HEAD", "--suggest", "--coverage", covPath]);
      assert.equal(r.status, 0, `建议模式应 exit 0，实为 ${r.status}`);
    });
    check("守卫不误伤 --files 模式（无 git 上下文，本身合法）", () => {
      const r = runScript([
        "--files",
        "frontend/src/views/app-tree/loader.ts",
        "--coverage",
        covPath,
      ]);
      // 断言的是**守卫的契约**：--files 模式不该被「基线无意义」拦下。
      // ⚠️ 不能断言 exit 0——--files 模式视所有行为变更行，覆盖率是否达标取决于夹具与
      // 源文件规模（实测夹具只覆盖 1 行时 loader.ts 判 1<60 ⇒ exit 1，那是**覆盖率判定**
      // 生效，不是守卫误伤）。故只锚「未因基线原因失败」：非 exit 2，且 stderr 无基线文案。
      assert.notEqual(r.status, 2, `--files 模式不应因基线问题 exit 2；stderr=${r.stderr}`);
      assert.doesNotMatch(r.stderr, /基线无意义/, `--files 模式无 git 上下文，不应报基线无意义`);
      assert.doesNotMatch(r.stderr, /基准分支不可达/, `--files 模式不查基线可达性`);
    });
    // 反向锚：正常基线（HEAD~1）不得被守卫误伤——否则守卫会把「有变更」也拦下
    if (spawnSync("git", ["rev-parse", "-q", "--verify", "HEAD~1"], { cwd: ROOT }).status === 0) {
      check("守卫不误伤正常基线（--base HEAD~1 不报『基线无意义』）", () => {
        const r = runScript(["--base", "HEAD~1", "--coverage", covPath]);
        assert.doesNotMatch(r.stderr, /基线无意义/, `HEAD~1 是合法基线，不应报无意义；stderr=${r.stderr}`);
      });
    }
  }
  // 反向锚：Go 版必须有同款守卫（两门禁同病，只修一处 = 假绿回流）
  check("Go 版 check-go-diff-coverage 有同款基线守卫（防只修一处）", () => {
    const goSrc = readFileSync(resolve(ROOT, "scripts/check-go-diff-coverage.ts"), "utf8");
    assert.match(goSrc, /基线无意义/);
    assert.match(goSrc, /与 HEAD 是同一提交/);
  });
}

if (fails.length) {
  console.error(`\n❌ ${fails.length} 个用例失败：`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✅ 全部用例通过");
