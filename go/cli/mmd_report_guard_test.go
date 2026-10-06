// mmd_report_guard_test.go — file-bench / scan-dir 报告内容与数字的特征测试。
//
// 为什么把「数字与段落」钉死而不是只断言 err==nil：这两个命令的失败模式是
// **数字算错 / 输出错位 / 报告缺段**，不是崩溃——只断言「没报错」的用例在把
// totalSize 写成 0、把大文件列表的 `break` 落进 switch、把 --output 命中的早退
// 丢掉时依然全绿。故此处逐项复算报告行与 JSON 载荷字段。
//
// 桩 mmdBenchApp：真 App 的 ReadFileBytes 受扫描根守卫（isPathInRootOrSelf）限制，
// t.TempDir() 不在任何配置根内 → 恒返回 nil → IPC 膨胀率与批量吞吐恒为零，
// 数字无从校验。本桩直接读盘，与生产语义（返回文件内容）一致且确定。
package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/internal/testutil"
)

// mmdBenchApp file-bench 测试桩：嵌入 nil AppService，仅覆盖被测命令用到的读文件方法。
type mmdBenchApp struct {
	AppService
}

func (f *mmdBenchApp) ReadFileBytes(path string) []byte {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return data
}

func (f *mmdBenchApp) ReadFileBytesBatch(paths []string) map[string][]byte {
	out := make(map[string][]byte, len(paths))
	for _, p := range paths {
		if data, err := os.ReadFile(p); err == nil {
			out[p] = data
		}
	}
	return out
}

// writeSizedFile 用 Truncate 造指定大小的文件——11MB 级大文件不做实际写入，秒级生成。
func writeSizedFile(t *testing.T, path string, size int64) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("创建 %s: %v", path, err)
	}
	if err := f.Truncate(size); err != nil {
		_ = f.Close()
		t.Fatalf("扩展 %s 到 %d 字节: %v", path, size, err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("关闭 %s: %v", path, err)
	}
}

// reportSection 截取 out 中 startMarker 之后、endMarker 之前的片段（endMarker 为空取到末尾）。
func reportSection(out, startMarker, endMarker string) string {
	i := strings.Index(out, startMarker)
	if i < 0 {
		return ""
	}
	rest := out[i+len(startMarker):]
	if endMarker == "" {
		return rest
	}
	if j := strings.Index(rest, endMarker); j >= 0 {
		return rest[:j]
	}
	return rest
}

// assertThroughputConsistent 校验报告的吞吐与平均耗时换算自洽（不依赖「耗时必须非零」——
// 本机单调时钟粒度较粗，2MB 热缓存读实测可为 0）：
// avgMs == 0 时吞吐必须为 0（有耗时才算吞吐），否则须等于 sizeMB / (avgMs/1000)。
func assertThroughputConsistent(t *testing.T, label string, avgMs, throughput, sizeMB float64) {
	t.Helper()
	if avgMs == 0 {
		if throughput != 0 {
			t.Errorf("%s: 平均耗时为 0 时吞吐必须为 0, got %v", label, throughput)
		}
		return
	}
	want := sizeMB / (avgMs / 1000)
	if math.Abs(throughput-want) > math.Abs(want)*1e-9 {
		t.Errorf("%s: 吞吐 %v 与 avgMs %v（size %.0fMB）不自洽，期望 %v", label, throughput, avgMs, sizeMB, want)
	}
}

// scanDirFixture 造一棵确定的目录树：3 个小文件（含一个子目录内的）+ 1 个超阈值大文件。
// 返回值：根目录、大文件路径、大文件大小、总大小。
func scanDirFixture(t *testing.T) (dir, bigFile string, bigSize, totalSize int64) {
	t.Helper()
	dir = t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatalf("创建子目录: %v", err)
	}
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "a.txt"), bytes.Repeat([]byte("a"), 10))
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "b.txt"), bytes.Repeat([]byte("b"), 20))
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "sub", "c.png"), bytes.Repeat([]byte("c"), 5))

	bigSize = cliScanLargeFileThreshold + 1<<20 // 刚过大文件阈值（10MB+1MB）
	bigFile = filepath.Join(dir, "big.bin")
	writeSizedFile(t, bigFile, bigSize)

	return dir, bigFile, bigSize, 10 + 20 + 5 + bigSize
}

// TestRunScanDir_JSONPayloadNumbers 锁 --output 载荷：总数、按扩展名分组、大文件清单逐项复算。
// 同时锁「--output 命中即收口」——打印落盘路径后不再打印文本报告。
func TestRunScanDir_JSONPayloadNumbers(t *testing.T) {
	dir, bigFile, bigSize, totalSize := scanDirFixture(t)
	outFile := filepath.Join(t.TempDir(), "scan.json")

	var err error
	out := captureOutput(t, func() {
		err = runScanDir(&CmdContext{Args: []string{"--dir", dir, "--output", outFile}})
	})
	if err != nil {
		t.Fatalf("runScanDir: %v", err)
	}

	raw, rerr := os.ReadFile(outFile)
	if rerr != nil {
		t.Fatalf("读取 JSON 产物: %v", rerr)
	}
	var res scanDirResult
	if uerr := json.Unmarshal(raw, &res); uerr != nil {
		t.Fatalf("JSON 载荷非法: %v\n%s", uerr, raw)
	}

	if res.Directory != dir {
		t.Errorf("Directory = %q, 期望 %q", res.Directory, dir)
	}
	if _, perr := time.Parse(time.RFC3339, res.Timestamp); perr != nil {
		t.Errorf("Timestamp 不是 RFC3339: %q (%v)", res.Timestamp, perr)
	}
	if res.TotalDirs != 2 {
		t.Errorf("TotalDirs = %d, 期望 2（根 + sub）", res.TotalDirs)
	}
	if res.TotalFiles != 4 {
		t.Errorf("TotalFiles = %d, 期望 4", res.TotalFiles)
	}
	if res.TotalSize != totalSize {
		t.Errorf("TotalSize = %d, 期望 %d", res.TotalSize, totalSize)
	}

	// 按扩展名分组：逐项复算计数与字节；顺序不断言（map 遍历序 + 同尺寸并列不稳定）
	got := make(map[string]extStatItem, len(res.ByExtension))
	for _, e := range res.ByExtension {
		got[e.Ext] = e
	}
	want := map[string]extStatItem{
		".txt": {Ext: ".txt", Count: 2, Size: 30},
		".png": {Ext: ".png", Count: 1, Size: 5},
		".bin": {Ext: ".bin", Count: 1, Size: bigSize},
	}
	if len(got) != len(want) {
		t.Errorf("ByExtension 组数 = %d, 期望 %d: %+v", len(got), len(want), res.ByExtension)
	}
	for ext, w := range want {
		if g, ok := got[ext]; !ok || g != w {
			t.Errorf("ByExtension[%s] = %+v (存在=%v), 期望 %+v", ext, g, ok, w)
		}
	}

	if len(res.Largest) != 1 {
		t.Fatalf("Largest 条数 = %d, 期望 1: %+v", len(res.Largest), res.Largest)
	}
	if res.Largest[0].Path != bigFile || res.Largest[0].Size != bigSize {
		t.Errorf("Largest[0] = %+v, 期望 {%s %d}", res.Largest[0], bigFile, bigSize)
	}

	if !strings.Contains(out, "💾 JSON 已保存到: "+outFile) {
		t.Errorf("应打印落盘路径, got:\n%s", out)
	}
	if strings.Contains(out, "📊 目录统计:") {
		t.Errorf("--output 命中后不应再打印文本报告:\n%s", out)
	}
}

// TestRunScanDir_TextReportNumbers 锁文本报告：统计行 + 扩展名分组（按大小降序）+ 大文件清单。
func TestRunScanDir_TextReportNumbers(t *testing.T) {
	dir, bigFile, bigSize, totalSize := scanDirFixture(t)

	var err error
	out := captureOutput(t, func() {
		err = runScanDir(&CmdContext{Args: []string{"--dir", dir}})
	})
	if err != nil {
		t.Fatalf("runScanDir: %v", err)
	}

	for _, want := range []string{
		"📁 扫描目录: " + dir,
		"📊 目录统计:",
		"   目录数:   2",
		"   文件数:   4",
		"   总大小:   " + fsutil.FormatSize(totalSize),
		"📋 按扩展名分组:",
		"   扩展名",
		"   数量",
		"⚠️  大文件列表 (>10MB, 共 1 个):",
		"   [1] " + strings.TrimPrefix(bigFile, dir) + " (" + fsutil.FormatSize(bigSize) + ")",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("报告缺少 %q, got:\n%s", want, out)
		}
	}

	// 扩展名分组：逐行复算「扩展名 数量 总大小」，并锁按大小降序
	extSection := reportSection(out, "📋 按扩展名分组:", "⚠️  大文件列表")
	if extSection == "" {
		t.Fatalf("未定位到扩展名分组段:\n%s", out)
	}
	rows := []struct {
		ext   string
		count int
		size  string
	}{
		{".bin", 1, fsutil.FormatSize(bigSize)},
		{".txt", 2, fsutil.FormatSize(30)},
		{".png", 1, fsutil.FormatSize(5)},
	}
	for _, r := range rows {
		re := regexp.MustCompile(`(?m)^\s+` + regexp.QuoteMeta(r.ext) + `\s+` +
			strconv.Itoa(r.count) + `\s+` + regexp.QuoteMeta(r.size) + `\s*$`)
		if !re.MatchString(extSection) {
			t.Errorf("分组段缺少 %s ×%d %s:\n%s", r.ext, r.count, r.size, extSection)
		}
	}

	var order []string
	for _, ln := range strings.Split(extSection, "\n") {
		ln = strings.TrimSpace(ln)
		if ln == "" || strings.HasPrefix(ln, "扩展名") || strings.HasPrefix(ln, "---") {
			continue
		}
		order = append(order, strings.Fields(ln)[0])
	}
	if got := strings.Join(order, ","); got != ".bin,.txt,.png" {
		t.Errorf("分组应按总大小降序 = .bin,.txt,.png, got %q", got)
	}
}

// TestRunScanDir_LargeFileListCapsAtTen 锁大文件清单的 10 条上限与尾部省略号。
// 关键：`if i >= 10 { ...; break }` 必须跳出 for 循环本体（落进 switch/case 会改语义）。
func TestRunScanDir_LargeFileListCapsAtTen(t *testing.T) {
	dir := t.TempDir()
	const n = 12
	for i := 0; i < n; i++ {
		writeSizedFile(t, filepath.Join(dir, fmt.Sprintf("f%02d.bin", i)), cliScanLargeFileThreshold+1)
	}

	var err error
	out := captureOutput(t, func() {
		err = runScanDir(&CmdContext{Args: []string{"--dir", dir}})
	})
	if err != nil {
		t.Fatalf("runScanDir: %v", err)
	}

	if !strings.Contains(out, "⚠️  大文件列表 (>10MB, 共 12 个):") {
		t.Errorf("大文件清单表头错误:\n%s", out)
	}
	for i := 1; i <= 10; i++ {
		if !strings.Contains(out, fmt.Sprintf("   [%d] ", i)) {
			t.Errorf("缺少第 %d 条编号行:\n%s", i, out)
		}
	}
	for _, absent := range []string{"   [11] ", "   [12] "} {
		if strings.Contains(out, absent) {
			t.Errorf("超过 10 条仍继续打印 %q:\n%s", absent, out)
		}
	}
	if !strings.Contains(out, "   ... 还有 2 个") {
		t.Errorf("应提示省略 2 条:\n%s", out)
	}
}

// TestRunScanDir_DetailListsFirstTwenty 锁 --detail 的「前 20 个」上限与剩余计数。
func TestRunScanDir_DetailListsFirstTwenty(t *testing.T) {
	dir := t.TempDir()
	const n = 25
	for i := 0; i < n; i++ {
		testutil.WriteTestFileBytes(t, filepath.Join(dir, fmt.Sprintf("f%02d.txt", i)), []byte("x"))
	}

	var err error
	out := captureOutput(t, func() {
		err = runScanDir(&CmdContext{Args: []string{"--dir", dir, "--detail"}})
	})
	if err != nil {
		t.Fatalf("runScanDir: %v", err)
	}

	if !strings.Contains(out, "📝 文件详情 (前 20 个):") {
		t.Fatalf("--detail 未打印详情段:\n%s", out)
	}
	if !strings.Contains(out, "   ... 还有 5 个文件") {
		t.Errorf("应提示省略 5 个文件:\n%s", out)
	}
	section := reportSection(out, "📝 文件详情 (前 20 个):", "   ... 还有 5 个文件")
	lines := 0
	for _, ln := range strings.Split(section, "\n") {
		if strings.TrimSpace(ln) != "" {
			lines++
		}
	}
	if lines != 20 {
		t.Errorf("详情行数 = %d, 期望 20:\n%s", lines, section)
	}
	// 第 21 个文件（f20）不得出现——count>=20 守卫必须生效
	if strings.Contains(out, "f20.txt") {
		t.Errorf("详情超过 20 个仍继续打印:\n%s", out)
	}
}

// TestRunScanDir_MissingDirReportedNotFatal 根目录不存在：Walk 单次回调错误即返回 nil，
// 命令应如实列出跳过路径并继续出报告（0 目录 / 0 文件），而不是致命退出。
func TestRunScanDir_MissingDirReportedNotFatal(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "no-such-dir")

	var err error
	out := captureOutput(t, func() {
		err = runScanDir(&CmdContext{Args: []string{"--dir", dir}})
	})
	if err != nil {
		t.Fatalf("根目录不存在不应致命: %v", err)
	}

	if !strings.Contains(out, "⚠️  扫描跳过 1 个异常路径:") {
		t.Errorf("应提示跳过 1 个异常路径:\n%s", out)
	}
	if !strings.Contains(out, "   - "+dir+":") {
		t.Errorf("应逐条列出异常路径 %s:\n%s", dir, out)
	}
	for _, want := range []string{"   目录数:   0", "   文件数:   0", "   总大小:   0B"} {
		if !strings.Contains(out, want) {
			t.Errorf("报告缺少 %q:\n%s", want, out)
		}
	}
}

// TestRunScanDir_RejectsUnknownFlag 覆盖 parseFlags 失败分支（应包成 *ErrParam）。
func TestRunScanDir_RejectsUnknownFlag(t *testing.T) {
	err := runScanDir(&CmdContext{Args: []string{"--dir", t.TempDir(), "--no-such-flag"}})
	if err == nil {
		t.Fatal("未知 flag 应报错")
	}
	if _, ok := err.(*ErrParam); !ok {
		t.Errorf("应为 *ErrParam, got %T: %v", err, err)
	}
}

// TestRunFileBench_JSONPayloadNumbers 锁 --output 载荷：文件清单、单读/批读汇总、IPC 度量。
func TestRunFileBench_JSONPayloadNumbers(t *testing.T) {
	dir := t.TempDir()
	const fileSize = int64(2 << 20)
	for _, n := range []string{"a.ysm", "b.ysm"} {
		testutil.WriteTestFileBytes(t, filepath.Join(dir, n), bytes.Repeat([]byte("x"), int(fileSize)))
	}
	outFile := filepath.Join(t.TempDir(), "bench.json")

	var err error
	out := captureOutput(t, func() {
		err = runFileBench(&CmdContext{App: &mmdBenchApp{}, Args: []string{
			"--dir", dir, "--iterations", "2", "--output", outFile}})
	})
	if err != nil {
		t.Fatalf("runFileBench: %v", err)
	}

	raw, rerr := os.ReadFile(outFile)
	if rerr != nil {
		t.Fatalf("读取基准 JSON: %v", rerr)
	}
	var res fileBenchResult
	if uerr := json.Unmarshal(raw, &res); uerr != nil {
		t.Fatalf("基准 JSON 非法: %v\n%s", uerr, raw)
	}

	if _, perr := time.Parse(time.RFC3339, res.Timestamp); perr != nil {
		t.Errorf("Timestamp 不是 RFC3339: %q (%v)", res.Timestamp, perr)
	}
	if len(res.Files) != 2 {
		t.Fatalf("Files 条数 = %d, 期望 2: %+v", len(res.Files), res.Files)
	}
	for _, f := range res.Files {
		if f.Size != fileSize {
			t.Errorf("%s Size = %d, 期望 %d", f.Path, f.Size, fileSize)
		}
		// 吞吐 = 大小 / 平均耗时：算式必须自洽（耗时是否为 0 由宿主机时钟粒度决定，不作正性断言）
		assertThroughputConsistent(t, f.Path, f.AvgMs, f.ThroughputMBps, float64(fileSize)/(1024*1024))
	}

	wantAvg := (res.Files[0].AvgMs + res.Files[1].AvgMs) / 2
	if math.Abs(res.SingleRead.AvgMs-wantAvg) > 1e-9 {
		t.Errorf("SingleRead.AvgMs = %v, 期望文件级均值 %v", res.SingleRead.AvgMs, wantAvg)
	}
	if res.SingleRead.MinMs > res.SingleRead.AvgMs || res.SingleRead.AvgMs > res.SingleRead.MaxMs {
		t.Errorf("SingleRead 最值与均值不自洽: %+v", res.SingleRead)
	}

	// 批量读取：>1 文件必产出汇总段，吞吐同样须与总大小/平均耗时自洽
	assertThroughputConsistent(t, "BatchRead", res.BatchRead.AvgMs, res.BatchRead.Throughput,
		float64(2*fileSize)/(1024*1024))
	if res.BatchRead.MinMs > res.BatchRead.AvgMs || res.BatchRead.AvgMs > res.BatchRead.MaxMs {
		t.Errorf("BatchRead 最值与均值不自洽: %+v", res.BatchRead)
	}

	// IPC：实测读首文件 → 原始大小即文件大小；base64+JSON 膨胀率必为正（与时钟无关的确定性算式）
	if res.IPCOverhead.OriginalSize != fileSize {
		t.Errorf("IPC OriginalSize = %d, 期望 %d", res.IPCOverhead.OriginalSize, fileSize)
	}
	if res.IPCOverhead.Base64Size <= res.IPCOverhead.OriginalSize {
		t.Errorf("base64 载荷应大于原始字节: %+v", res.IPCOverhead)
	}
	if res.IPCOverhead.InflationRatio <= 0 {
		t.Errorf("IPC 膨胀率应为正: %+v", res.IPCOverhead)
	}
	if res.IPCOverhead.SerDescOverheadMs < 0 {
		t.Errorf("IPC 序列化耗时不得为负: %+v", res.IPCOverhead)
	}

	for _, want := range []string{
		"⚡ 文件读取性能测试",
		"   文件数: 2",
		"   迭代次数: 2",
		"📁 待测试文件:",
		"   总大小: " + fsutil.FormatSize(2*fileSize),
		"📊 单文件读取测试:",
		"📊 批量读取测试 (模拟 ReadFileBytesBatch):",
		"📊 IPC 传输开销测量:",
		"💾 基准已保存到: " + outFile,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("报告缺少 %q, got:\n%s", want, out)
		}
	}
}

// writeBenchBaseline 落盘一份带测量数据的基准（--compare 用）。
func writeBenchBaseline(t *testing.T) string {
	t.Helper()
	baseline := fileBenchResult{
		Timestamp: "2020-01-01T00:00:00Z",
		Files: []fileBenchFile{
			{Path: "old-a.ysm", Size: 1, AvgMs: 1, ThroughputMBps: 1},
			{Path: "old-b.ysm", Size: 1, AvgMs: 1, ThroughputMBps: 1},
		},
		SingleRead:  benchSummary{AvgMs: 10, MinMs: 8, MaxMs: 12, Throughput: 100},
		BatchRead:   benchSummary{AvgMs: 20, MinMs: 18, MaxMs: 22, Throughput: 50},
		IPCOverhead: ipcEstimate{OriginalSize: 1000, Base64Size: 1330, InflationRatio: 0.33, SerDescOverheadMs: 1},
	}
	raw, merr := json.MarshalIndent(baseline, "", "  ")
	if merr != nil {
		t.Fatalf("构造基准 JSON: %v", merr)
	}
	path := filepath.Join(t.TempDir(), "baseline.json")
	if werr := os.WriteFile(path, raw, 0o644); werr != nil {
		t.Fatalf("写入基准 JSON: %v", werr)
	}
	return path
}

// TestLoadAndCompareBenchmark_DeltaArithmetic 直接喂定值（不经墙钟测量）锁变化率算式：
// 单读两侧都有测量 → 输出变化率；批读本次未测 → 如实标注而非编造 0 变化率。
// 为何不走 runFileBench：本机单调时钟粒度较粗，2MB 热缓存读实测可为 0ms，
// 「两侧都有测量」这一前提在端到端路径上不可保证，只有定值输入才能钉死算式。
func TestLoadAndCompareBenchmark_DeltaArithmetic(t *testing.T) {
	baselinePath := writeBenchBaseline(t)
	current := fileBenchResult{
		Timestamp:  "2026-10-07T00:00:00Z",
		Files:      []fileBenchFile{{Path: "new.ysm", Size: 1, AvgMs: 8, ThroughputMBps: 200}},
		SingleRead: benchSummary{AvgMs: 8, MinMs: 8, MaxMs: 8, Throughput: 200},
		IPCOverhead: ipcEstimate{
			OriginalSize: 2097152, Base64Size: 2796215, InflationRatio: 0.333338, SerDescOverheadMs: 2,
		},
	}

	got := loadAndCompareBenchmark(baselinePath, current)
	for _, want := range []string{
		"📊 对比基准 (2020-01-01T00:00:00Z)",
		"   文件数: 基准 2 | 本次 1",
		// 单读：delta = (8-10)/10*100 = -20.0%
		"   单读: avg 10.00 → 8.00 ms (-20.0%) | 吞吐 100.0 → 200.0 MB/s",
		// 批读：本次 AvgMs=0（未测）→ 跳过变化率，不编造数值
		"   批读: 基准 avg=20.00ms 吞吐=50.0MB/s | 本次 avg=0.00ms 吞吐=0.0MB/s (一侧未测，跳过变化率)",
		"   IPC: 基准 Base64 膨胀 33% | 本次 33%",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("对比报告缺少 %q, got:\n%s", want, got)
		}
	}
}

// TestLoadAndCompareBenchmark_EmptyShellBaseline 旧版空壳基准（两侧均无测量）应提示重新生成，
// 而不是拿 0 值算出误导性变化率。
func TestLoadAndCompareBenchmark_EmptyShellBaseline(t *testing.T) {
	baselinePath := filepath.Join(t.TempDir(), "empty.json")
	if err := os.WriteFile(baselinePath, []byte(`{"timestamp":"2019-01-01T00:00:00Z","files":[]}`), 0o644); err != nil {
		t.Fatalf("写入空壳基准: %v", err)
	}

	got := loadAndCompareBenchmark(baselinePath, fileBenchResult{})
	if !strings.Contains(got, "基准文件不含测量数据") {
		t.Errorf("空壳基准应提示重新 --output 生成, got:\n%s", got)
	}
	if strings.Contains(got, "变化率") || strings.Contains(got, "avg ") {
		t.Errorf("空壳基准不得输出对比行:\n%s", got)
	}
}

// TestRunFileBench_CompareWiring --compare 端到端接线：真实测量跑完后进对比段，
// 且单文件（无批读）时批读如实标注「一侧未测」。
//
// 单读行有两种合法形态：宿主机时钟够细 → 输出变化率；读耗时实测为 0 → 标注一侧未测。
// 两种形态的数值格式都由正则逐个钉住，避免「随便打印点什么都能过」。
func TestRunFileBench_CompareWiring(t *testing.T) {
	dir := t.TempDir()
	model := filepath.Join(dir, "a.ysm")
	testutil.WriteTestFileBytes(t, model, bytes.Repeat([]byte("x"), 2<<20))
	baselinePath := writeBenchBaseline(t)

	var err error
	out := captureOutput(t, func() {
		err = runFileBench(&CmdContext{App: &mmdBenchApp{}, Args: []string{
			"--file", model, "--iterations", "1", "--compare", baselinePath}})
	})
	if err != nil {
		t.Fatalf("runFileBench: %v", err)
	}

	for _, want := range []string{
		"📈 基准对比:",
		"📊 对比基准 (2020-01-01T00:00:00Z)",
		"   文件数: 基准 2 | 本次 1",
		// 单文件 → 批读未测：必须如实标注，不得编造变化率
		"   批读: 基准 avg=20.00ms 吞吐=50.0MB/s | 本次 avg=0.00ms 吞吐=0.0MB/s (一侧未测，跳过变化率)",
		"   IPC: 基准 Base64 膨胀 33% | 本次 33%",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("对比报告缺少 %q, got:\n%s", want, out)
		}
	}

	singleRe := regexp.MustCompile(`(?m)^   单读: (?:avg 10\.00 → [0-9.]+ ms \([+-][0-9.]+%\) \| 吞吐 100\.0 → [0-9.]+ MB/s|基准 avg=10\.00ms 吞吐=100\.0MB/s \| 本次 avg=0\.00ms 吞吐=0\.0MB/s \(一侧未测，跳过变化率\))$`)
	if !singleRe.MatchString(out) {
		t.Errorf("单读对比行形态/数值不符:\n%s", out)
	}
}

// TestRunFileBench_SmallFilesAreNotTested 目录无超阈值文件：应早退，不打印基准报告。
func TestRunFileBench_SmallFilesAreNotTested(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "small.ysm"), bytes.Repeat([]byte("x"), 1024))

	var err error
	out := captureOutput(t, func() {
		err = runFileBench(&CmdContext{App: &mmdBenchApp{}, Args: []string{"--dir", dir}})
	})
	if err != nil {
		t.Fatalf("runFileBench: %v", err)
	}
	if !strings.Contains(out, "📭 没有找到大于 "+fsutil.FormatSize(cliLargeFileThreshold)) {
		t.Errorf("应提示无大文件, got:\n%s", out)
	}
	if strings.Contains(out, "⚡ 文件读取性能测试") {
		t.Errorf("无大文件应早退，不得打印基准报告:\n%s", out)
	}
}

// TestRunFileBench_MissingPathsAreSkippedNotFatal 目录/文件不存在：异常路径计数跳过，
// 命令不出错（目录分支提示跳过数；文件分支 stat 失败静默剔除）。
func TestRunFileBench_MissingPathsAreSkippedNotFatal(t *testing.T) {
	missingDir := filepath.Join(t.TempDir(), "no-such-dir")

	var err error
	out := captureOutput(t, func() {
		err = runFileBench(&CmdContext{App: &mmdBenchApp{}, Args: []string{"--dir", missingDir}})
	})
	if err != nil {
		t.Fatalf("目录不存在不应致命: %v", err)
	}
	if !strings.Contains(out, "⚠️  扫描跳过 1 个异常路径") {
		t.Errorf("应提示跳过 1 个异常路径:\n%s", out)
	}
	if !strings.Contains(out, "📭 没有找到大于 ") {
		t.Errorf("应提示无大文件:\n%s", out)
	}

	missingFile := filepath.Join(t.TempDir(), "no-such.ysm")
	var err2 error
	out2 := captureOutput(t, func() {
		err2 = runFileBench(&CmdContext{App: &mmdBenchApp{}, Args: []string{"--file", missingFile}})
	})
	if err2 != nil {
		t.Fatalf("文件不存在不应致命（stat 失败跳过）: %v", err2)
	}
	for _, want := range []string{"📊 单文件读取测试:", "📊 IPC 传输开销测量:", "   总大小: 0B"} {
		if !strings.Contains(out2, want) {
			t.Errorf("报告缺少 %q, got:\n%s", want, out2)
		}
	}
}

// TestRunFileBench_LongFileNameIsTruncated 待测清单里 >50 字符的文件名按 47+... 截断。
func TestRunFileBench_LongFileNameIsTruncated(t *testing.T) {
	dir := t.TempDir()
	longName := strings.Repeat("n", 60) + ".ysm"
	testutil.WriteTestFileBytes(t, filepath.Join(dir, longName), bytes.Repeat([]byte("x"), 2<<20))

	var err error
	out := captureOutput(t, func() {
		err = runFileBench(&CmdContext{App: &mmdBenchApp{}, Args: []string{
			"--dir", dir, "--iterations", "1"}})
	})
	if err != nil {
		t.Fatalf("runFileBench: %v", err)
	}

	listSection := reportSection(out, "📁 待测试文件:", "📊 单文件读取测试:")
	if !strings.Contains(listSection, longName[:47]+"...") {
		t.Errorf("待测清单应截断超长文件名:\n%s", listSection)
	}
	if strings.Contains(listSection, longName) {
		t.Errorf("待测清单不应出现未截断的全名:\n%s", listSection)
	}
}

// TestRunScanDir_JSONWriteFailure 输出路径不可写（父目录不存在）→ 运行时错误，
// 且不得谎报「已保存」。
func TestRunScanDir_JSONWriteFailure(t *testing.T) {
	dir, _, _, _ := scanDirFixture(t)
	badOutput := filepath.Join(t.TempDir(), "no-such-dir", "scan.json")

	var err error
	out := captureOutput(t, func() {
		err = runScanDir(&CmdContext{Args: []string{"--dir", dir, "--output", badOutput}})
	})
	if err == nil {
		t.Fatal("输出路径不可写应报错")
	}
	if _, ok := err.(*ErrRuntime); !ok {
		t.Errorf("应为 *ErrRuntime, got %T: %v", err, err)
	}
	if !strings.Contains(err.Error(), "保存 JSON 文件失败") {
		t.Errorf("错误应指向保存失败, got %v", err)
	}
	if strings.Contains(out, "💾 JSON 已保存到") {
		t.Errorf("写盘失败不得打印「已保存」:\n%s", out)
	}
}

// TestRunFileBench_RejectsUnknownFlag 覆盖 parseFlags 失败分支（应包成 *ErrParam，
// 且早于任何测量/输出）。
func TestRunFileBench_RejectsUnknownFlag(t *testing.T) {
	var err error
	out := captureOutput(t, func() {
		err = runFileBench(&CmdContext{App: &mmdBenchApp{}, Args: []string{"--no-such-flag"}})
	})
	if err == nil {
		t.Fatal("未知 flag 应报错")
	}
	if _, ok := err.(*ErrParam); !ok {
		t.Errorf("应为 *ErrParam, got %T: %v", err, err)
	}
	if strings.Contains(out, "文件读取性能测试") {
		t.Errorf("参数错误不得进入基准流程:\n%s", out)
	}
}

// TestRunFileBench_OutputWriteFailure 基准 JSON 输出路径不可写 → 运行时错误，
// 且不得谎报「已保存」（原实现静默吞序列化/落盘失败的历史坑面）。
func TestRunFileBench_OutputWriteFailure(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "a.ysm"), bytes.Repeat([]byte("x"), 2<<20))
	badOutput := filepath.Join(t.TempDir(), "no-such-dir", "bench.json")

	var err error
	out := captureOutput(t, func() {
		err = runFileBench(&CmdContext{App: &mmdBenchApp{}, Args: []string{
			"--dir", dir, "--iterations", "1", "--output", badOutput}})
	})
	if err == nil {
		t.Fatal("输出路径不可写应报错")
	}
	if _, ok := err.(*ErrRuntime); !ok {
		t.Errorf("应为 *ErrRuntime, got %T: %v", err, err)
	}
	if !strings.Contains(err.Error(), "保存基准 JSON 失败") {
		t.Errorf("错误应指向保存失败, got %v", err)
	}
	if strings.Contains(out, "💾 基准已保存到") {
		t.Errorf("写盘失败不得打印「已保存」:\n%s", out)
	}
}
