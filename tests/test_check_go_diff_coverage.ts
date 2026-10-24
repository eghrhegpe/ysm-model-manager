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
  diffBareAssertDebt,
  findBareFatalAddedLines,
  isBareFatalAssertLine,
  isExemptAssert,
  isExemptEntry,
  isExemptLifecycle,
  isGoTestSource,
  isRewriteLine,
  isRewriteOnlyDiff,
  isTestutilTree,
  packagePatternFor,
  parseGoCover,
  scanBareAssertDebt,
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
  // app.go 已入生命周期豁免表（2026-10-24：ServiceStartup watcher 装配段 headless 不可达），
  // 反例换 config.go（普通声明+逻辑文件，不在豁免表）
  assert.equal(isExemptLifecycle("go/types/config.go"), false);
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
  assert.equal(isExemptAssert("internal/testutil/testutil.go"), true); // 根桥包实现（单源翻转）
});

check("isExemptAssert 普通文件不豁免", () => {
  assert.equal(isExemptAssert("go/internal/testutil/testutil.go"), false);
  assert.equal(isExemptAssert("go/internal/testutil/assert_test.go"), false);
  assert.equal(isExemptAssert("go/download/download.go"), false);
});

// ── 8.6 isTestutilTree（断言器实现树前缀豁免）──
check("isTestutilTree 命中两棵断言器实现树", () => {
  assert.equal(isTestutilTree("go/internal/testutil/assert.go"), true);
  assert.equal(isTestutilTree("go/internal/testutil/assert_test.go"), true);
  assert.equal(isTestutilTree("internal/testutil/testutil.go"), true);
  assert.equal(isTestutilTree("internal/testutil/testutil_test.go"), true);
});

check("isTestutilTree 非两棵树不命中", () => {
  assert.equal(isTestutilTree("go/tags/tags_commit_order_test.go"), false);
  assert.equal(isTestutilTree("internal/app/app_config_preserve_test.go"), false);
  assert.equal(isTestutilTree("internal/test.go"), false); // 根 internal 非 testutil 子目录
  assert.equal(isTestutilTree("testutil.go"), false); // 裸名不吃前缀豁免
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
  // 结构体字段 / 多行签名参数行（2026-10-24 补：纯声明文件死局，见 isRewriteLine 注释）
  assert.equal(isRewriteLine('SchemaVersion int `json:"schemaVersion,omitempty"`'), true);
  assert.equal(isRewriteLine("Format        string            `json:\"format\"`"), true);
  assert.equal(isRewriteLine("LocalStorage  map[string]string"), true);
  assert.equal(isRewriteLine("BackupPath string"), true);
  assert.equal(isRewriteLine("\tsubpath string,"), true); // 多行签名参数（带尾逗号）
  assert.equal(isRewriteLine('BackupPath string `json:"backupPath"` // 导入前备份路径（空=无需备份）'), true); // 尾注释含 = 不连坐
  assert.equal(isRewriteLine("}"), true); // 收括号行：纯标点
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
  // 字段形态伪装的逻辑行不得豁免（含 = ( { 语句特征）
  assert.equal(isRewriteLine("root := filepath.Join(dir, name)"), false);
  assert.equal(isRewriteLine("testutil.NoError(t, err)"), false);
  assert.equal(isRewriteLine("entries := a.ScanModelEntriesForBrowse(a.ysmRoot())"), false);
  assert.equal(isRewriteLine("return err"), false); // 语句关键字开头不得豁免
  assert.equal(isRewriteLine("return nil, err"), false);
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

check("diffBareAssertDebt 超出基线 → over=true + overFiles 列出该收未收的文件", () => {
  const scan = { count: 5, files: { "go/a/a_test.go": 3, "go/b/b_test.go": 2 } };
  const baseline = { count: 3, files: { "go/a/a_test.go": 1, "go/b/b_test.go": 2 } };
  const d = diffBareAssertDebt(scan, baseline);
  assert.equal(d.over, true);
  assert.equal(d.current, 5);
  assert.equal(d.baseline, 3);
  // 只列真正「超出」的文件，且按条数降序
  assert.deepEqual(
    d.overFiles.map((o) => o.file),
    ["go/a/a_test.go"],
  );
  assert.deepEqual(d.overFiles[0], { file: "go/a/a_test.go", current: 3, baseline: 1 });
});

check("diffBareAssertDebt 等于基线 → over=false + 无 overFiles（账本收缩后不误报）", () => {
  const scan = { count: 3, files: { "go/a/a_test.go": 3 } };
  const baseline = { count: 3, files: { "go/a/a_test.go": 3 } };
  const d = diffBareAssertDebt(scan, baseline);
  assert.equal(d.over, false);
  assert.deepEqual(d.overFiles, []);
});

check("diffBareAssertDebt 低于基线（已收缩）→ over=false", () => {
  const scan = { count: 1, files: { "go/a/a_test.go": 1 } };
  const baseline = { count: 4, files: { "go/a/a_test.go": 4 } };
  const d = diffBareAssertDebt(scan, baseline);
  assert.equal(d.over, false);
  assert.deepEqual(d.overFiles, []);
});

check("diffBareAssertDebt 空账本（新文件引入裸断言）→ 立即超基线", () => {
  const scan = { count: 2, files: { "go/new/new_test.go": 2 } };
  const baseline = { count: 0, files: {} };
  const d = diffBareAssertDebt(scan, baseline);
  assert.equal(d.over, true);
  assert.deepEqual(d.overFiles.map((o) => o.file), ["go/new/new_test.go"]);
});

// 全库扫描只断言结构健康，不锚定具体条数（债数随代码演化，锚数即腐）
check("scanBareAssertDebt 结构健康（count 数字 + files 正整数值）", () => {
  const s = scanBareAssertDebt();
  assert.equal(typeof s.count, "number");
  assert.ok(s.count >= 0);
  assert.equal(typeof s.files, "object");
  for (const [rel, n] of Object.entries(s.files)) {
    assert.ok(rel.endsWith("_test.go"), `${rel} 应为 _test.go`);
    assert.ok(Number.isInteger(n) && n > 0, `${rel} 条数应为正整数，实为 ${n}`);
  }
});

if (errors.length) {
  console.error(`\ntest_check_go_diff_coverage.mjs: ${errors.length} 项失败`);
  process.exit(1);
} else {
  console.log("test_check_go_diff_coverage.mjs: 全部通过 ✅");
}
