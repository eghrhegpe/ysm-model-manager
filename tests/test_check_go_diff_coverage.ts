// tests/test_check_go_diff_coverage.mjs — check-go-diff-coverage.mjs 纯函数契约测试。
//
// 覆盖（不触发真实 go test，快速确定）：
//   1. parseGoCover：解析 go coverprofile 文本 → 文件→语句块映射
//   2. stripModulePrefix：模块根前缀剥离
//   3. stmtPctForChangedLines：变更行覆盖率加权计算（含空/纯注释边界）
//   4. packagePatternFor：改动文件 → go 包模式
//   5. addLinesFromDiff：`--unified=0` diff 新增行号提取
import assert from "node:assert/strict";
import {
  addedLinesFromDiffText,
  addLinesFromDiff,
  buildBareAssertBlock,
  buildSuggestBlock,
  findBareFatalAddedLines,
  isBareFatalAssertLine,
  isExemptAssert,
  isExemptEntry,
  isExemptLifecycle,
  isGoTestSource,
  isRewriteLine,
  isRewriteOnlyDiff,
  packagePatternFor,
  parseGoCover,
  stmtPctForChangedLines,
  stripModulePrefix,
} from "../scripts/check-go-diff-coverage.ts";

const errors = [];
function check(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (e) {
    errors.push(`${name}: ${e.message}`);
    console.error(`  FAIL - ${name}\n    ${e.message}`);
  }
}

// ── 1. parseGoCover ──
check("parseGoCover 解析语句块", () => {
  const txt = [
    "mode: set",
    "ysm-model-manager/go/download/download.go:37.29,37.44 1 1",
    "ysm-model-manager/go/download/download.go:90.3,92.2 3 0",
    "ysm-model-manager/go/scanner/scanner.go:352.13,352.30 2 1",
    "",
  ].join("\n");
  const m = parseGoCover(txt);
  assert.equal(m.get("go/download/download.go").length, 2);
  assert.deepEqual(m.get("go/download/download.go")[1], { sl: 90, el: 92, n: 3, count: 0 });
  assert.equal(m.get("go/scanner/scanner.go")[0].count, 1);
});

check("parseGoCover 空文本 → 空 Map", () => {
  assert.equal(parseGoCover("").size, 0);
});

// ── 2. stripModulePrefix ──
check("stripModulePrefix 剥离模块根", () => {
  assert.equal(stripModulePrefix("ysm-model-manager/go/x/a.go"), "go/x/a.go");
  assert.equal(stripModulePrefix("ysm-model-manager/internal/app/app.go"), "internal/app/app.go");
  assert.equal(stripModulePrefix("ysm-model-manager/main.go"), "main.go");
});

// ── 3. stmtPctForChangedLines ──
check("覆盖统计：变更行命中已覆盖块 → 100%", () => {
  const blocks = [{ sl: 37, el: 37, n: 1, count: 1 }];
  assert.equal(stmtPctForChangedLines(blocks, new Set([37])), 100);
});

check("覆盖统计：变更行命中未覆盖块 → 0%", () => {
  const blocks = [{ sl: 90, el: 92, n: 3, count: 0 }];
  assert.equal(stmtPctForChangedLines(blocks, new Set([91])), 0);
});

check("覆盖统计：部分覆盖按语句数加权", () => {
  const blocks = [
    { sl: 10, el: 12, n: 3, count: 1 }, // 覆盖 3 条
    { sl: 20, el: 22, n: 1, count: 0 }, // 未覆盖 1 条
  ];
  // 变更行同时命中两段 → 3/4 = 75%
  const pct = stmtPctForChangedLines(blocks, new Set([10, 11, 20, 21]));
  assert.ok(Math.abs(pct - 75) < 1e-9, `pct=${pct}`);
});

check("覆盖统计：变更行无语句（纯注释）→ 100% 放行", () => {
  const blocks = [{ sl: 50, el: 50, n: 1, count: 0 }];
  assert.equal(stmtPctForChangedLines(blocks, new Set([99])), 100);
});

check("覆盖统计：无块 → 100%", () => {
  assert.equal(stmtPctForChangedLines([], new Set([1])), 100);
});

// ── 4. packagePatternFor ──
check("packagePatternFor 包模式", () => {
  assert.equal(packagePatternFor("go/scanner/scanner.go"), "./go/scanner/...");
  assert.equal(packagePatternFor("internal/app/app.go"), "./internal/app/...");
  assert.equal(packagePatternFor("main.go"), ".");
});

// ── 5. addLinesFromDiff ──
check("addLinesFromDiff 提取新增行号", () => {
  const diff = [
    "@@ -10,6 +10,8 @@",
    " aaa",
    "+newline1",
    "+newline2",
    " bbb",
    " ccc",
    "-removed",
    "+newline3",
  ].join("\n");
  const out = new Set();
  addLinesFromDiff(out, diff);
  // 新增块从第 10 行开始：newline1=11, newline2=12, 上下文 bbb=13, ccc=14, 删除行不算, newline3=15
  assert.deepEqual(
    [...out].sort((a, b) => a - b),
    [11, 12, 15],
  );
});

// ── 6. buildSuggestBlock ──
check("buildSuggestBlock 生成 Markdown 区块", () => {
  const block = buildSuggestBlock([{ file: "go/x/a.go", pct: 30.5 }], 60);
  assert.ok(block.includes("## Go 覆盖率建议（非阻断）"));
  assert.ok(block.includes("- `go/x/a.go` — 30.5%"));
});

// ── 7. isExemptLifecycle ──
check("isExemptLifecycle 命中窗口事件豁免名单", () => {
  assert.equal(isExemptLifecycle("internal/app/plaza_window.go"), true);
});

check("isExemptLifecycle 普通文件不豁免", () => {
  assert.equal(isExemptLifecycle("internal/app/app.go"), false);
  assert.equal(isExemptLifecycle("go/scanner/scanner.go"), false);
});

// ── 8. isExemptEntry（入口文件豁免）──
check("isExemptEntry main.go 豁免", () => {
  assert.equal(isExemptEntry("main.go"), true);
});

check("isExemptEntry 普通文件不豁免", () => {
  assert.equal(isExemptEntry("go/cli/cli.go"), false);
  assert.equal(isExemptEntry("internal/app/app.go"), false);
});

// ── 8.5 isExemptAssert（断言器实现文件豁免）──
check("isExemptAssert 断言器文件豁免", () => {
  assert.equal(isExemptAssert("go/internal/testutil/assert.go"), true);
});

check("isExemptAssert 普通文件不豁免", () => {
  assert.equal(isExemptAssert("go/internal/testutil/testutil.go"), false);
  assert.equal(isExemptAssert("go/download/download.go"), false);
});

// ── 9. isRewriteLine（纯结构行识别）──
check("isRewriteLine 识别签名/引用/注释/断言行", () => {
  assert.equal(
    isRewriteLine("func benchSerialAnalyze(a AppService, models []string) concurrentBenchResult {"),
    true,
  );
  assert.equal(
    isRewriteLine("func (a *App) EnqueueDownloads(tasks []types.DownloadTask) error {"),
    true,
  );
  assert.equal(isRewriteLine("import ("), true);
  assert.equal(isRewriteLine('\t"ysm-model-manager/go/types"'), true);
  assert.equal(isRewriteLine("// 注释"), true);
  assert.equal(isRewriteLine(""), true);
  assert.equal(isRewriteLine("var _ cli.AppService = appStruct"), true);
  assert.equal(isRewriteLine("type DownloadTask struct {"), true);
  assert.equal(isRewriteLine("const MaxImportSize = 500"), true);
});

check("isRewriteLine 逻辑行不豁免", () => {
  assert.equal(
    isRewriteLine("tasks := []types.DownloadTask{{URL: *url, SaveDir: *saveDir}}"),
    false,
  );
  assert.equal(
    isRewriteLine(
      "return types.QueueStatusInfo{Remaining: len(a.queue.tasks), Running: a.queue.running}",
    ),
    false,
  );
  assert.equal(
    isRewriteLine("if err := cli.RunCLI(app.NewApp(), os.Args[2:]); err != nil {"),
    false,
  );
  assert.equal(isRewriteLine("var count = 0"), false); // 普通 var 是逻辑
});

// ── 10. isRewriteOnlyDiff（纯重构变更判定）──
check("isRewriteOnlyDiff 全结构行 → 豁免", () => {
  const diff = [
    "@@ -152 +151 @@",
    "-func benchSerialAnalyze(a *app.App, models []string) concurrentBenchResult {",
    "+func benchSerialAnalyze(a AppService, models []string) concurrentBenchResult {",
  ].join("\n");
  assert.equal(isRewriteOnlyDiff(diff), true);
});

check("isRewriteOnlyDiff 含逻辑行 → 不豁免", () => {
  const diff = [
    "@@ -76 +76 @@",
    "-tasks := []app.DownloadTask{{URL: *url, SaveDir: *saveDir}}",
    "+tasks := []types.DownloadTask{{URL: *url, SaveDir: *saveDir}}",
  ].join("\n");
  assert.equal(isRewriteOnlyDiff(diff), false);
});

check("isRewriteOnlyDiff 空/null → false", () => {
  assert.equal(isRewriteOnlyDiff(null), false);
  assert.equal(isRewriteOnlyDiff(""), false);
});

// ── 11. 测试断言增量红线（ADR-202 刀5）──
check("isGoTestSource 只认 *_test.go", () => {
  assert.equal(isGoTestSource("go/scanner/scanner_test.go"), true);
  assert.equal(isGoTestSource("go/scanner/scanner.go"), false);
  assert.equal(isGoTestSource("go/scanner/testdata/fix.go"), false); // 夹具目录排除
  assert.equal(isGoTestSource("go/scanner/scan_test.go"), true);
});

check("isBareFatalAssertLine 命中裸 t.Fatal/t.Fatalf", () => {
  assert.equal(isBareFatalAssertLine('\t\tt.Fatalf("want %d got %d", want, got)'), true);
  assert.equal(isBareFatalAssertLine("\tt.Fatal(err)"), true);
  assert.equal(isBareFatalAssertLine('t.Fatalf("boom: %v", err)'), true);
});

check("isBareFatalAssertLine 放行非裸形态", () => {
  // testutil 调用不命中
  assert.equal(isBareFatalAssertLine("testutil.NoError(t, err)"), false);
  assert.equal(isBareFatalAssertLine("testutil.Equal(t, got, want)"), false);
  // benchmark 的 b.Fatalf 不命中
  assert.equal(isBareFatalAssertLine('b.Fatalf("ScanEntries returned %d", n)'), false);
  // t.Error/t.Errorf 有意不拦（循环/goroutine 收集多失败是惯用法）
  assert.equal(isBareFatalAssertLine('t.Errorf("goroutine %d failed: %v", i, err)'), false);
  assert.equal(isBareFatalAssertLine('t.Error("no tags expected")'), false);
  // 自定义函数、非断言调用不命中
  assert.equal(isBareFatalAssertLine("fatal(code)"), false);
  assert.equal(isBareFatalAssertLine("t.Helper()"), false);
  assert.equal(isBareFatalAssertLine("t.Parallel()"), false);
  assert.equal(isBareFatalAssertLine('t.Logf("ok: %v", err)'), false);
  // 纯注释/空行放行（说明文字不得当代码罚）
  assert.equal(isBareFatalAssertLine("// 此处用 t.Fatalf 判定"), false);
  assert.equal(isBareFatalAssertLine(""), false);
  // 非 t 前缀的 t.Fatal 文本（字符串字面量里的提及）
  assert.equal(isBareFatalAssertLine('msg := "t.Fatalf("'), false);
});

check("addedLinesFromDiffText 提取新增行内容与行号", () => {
  const diff = [
    "@@ -10,6 +10,8 @@",
    " aaa",
    "+testutil.NoError(t, err)",
    '+t.Fatalf("boom")',
    " bbb",
    " ccc",
    "-removed",
    '+t.Error("collect")',
  ].join("\n");
  const out = addedLinesFromDiffText(diff);
  // 新增块第 10 行起：第 11 行 NoError、第 12 行 Fatalf、第 15 行 Error
  assert.deepEqual(out, [
    { line: 11, text: "testutil.NoError(t, err)" },
    { line: 12, text: 't.Fatalf("boom")' },
    { line: 15, text: 't.Error("collect")' },
  ]);
});

check("findBareFatalAddedLines 只筛出裸 t.Fatal 新增行", () => {
  const diff = [
    "@@ -1,3 +1,5 @@",
    " package x",
    '+import "testing"',
    "+func TestX(t *testing.T) {",
    "+testutil.NoError(t, nil)",
    '+t.Fatalf("boom")',
    "+}",
  ].join("\n");
  const hits = findBareFatalAddedLines(diff);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 5);
  assert.ok(hits[0].text.includes('t.Fatalf("boom")'));
});

check("findBareFatalAddedLines 空/null diff → 空", () => {
  assert.deepEqual(findBareFatalAddedLines(null), []);
  assert.deepEqual(findBareFatalAddedLines(""), []);
});

check("buildBareAssertBlock 生成建议区块", () => {
  const block = buildBareAssertBlock([
    { file: "go/x/x_test.go", items: [{ line: 12, text: 't.Fatalf("boom")' }] },
  ]);
  assert.ok(block.includes("## Go 裸断言建议（非阻断）"));
  assert.ok(block.includes("go/x/x_test.go:12"));
  assert.ok(block.includes("testutil.Equal(t, got, want)"));
});

if (errors.length) {
  console.error(`\ntest_check_go_diff_coverage.mjs: ${errors.length} 项失败`);
  process.exit(1);
} else {
  console.log("test_check_go_diff_coverage.mjs: 全部通过 ✅");
}
