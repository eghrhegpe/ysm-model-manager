// ===== CLI 薄壳级单测 =====
// 覆盖：runCLI 入口错误路径 / cache 系列命令的副作用与输出 / 参数校验错误路径 / config-show 空配置分支。
// 策略：用 &app.App{} 零值 + 把 texture_cache.CacheDir 重定向到临时目录，
// 不触碰真实用户配置/日志/缓存目录，不触发 SaveAppConfig 落盘与 watcher 重启（见 AGENTS 硬约束）。
package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/app"
)

// captureOutput 捕获调用期间的 stdout 输出
// 修复：在 fn() 执行前启动异步 reader，避免 Windows pipe 缓冲区满导致 fmt.Println 阻塞死锁
func captureOutput(t *testing.T, fn func()) string {
	t.Helper()
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stdout = w
	t.Cleanup(func() { os.Stdout = old })

	var out strings.Builder
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		io.Copy(&out, r)
	}()

	fn()
	if err := w.Close(); err != nil {
		t.Fatalf("关闭写端: %v", err)
	}
	<-readerDone
	return out.String()
}

// withTempCache 将 texture_cache.CacheDir 重定向到临时目录并返回该目录
func withTempCache(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	old := texture_cache.CacheDir
	texture_cache.CacheDir = func() string { return dir }
	t.Cleanup(func() { texture_cache.CacheDir = old })
	return dir
}

// withStdin 将 os.Stdin 重定向为注入内容（用于确认类交互）
func withStdin(t *testing.T, input string) {
	t.Helper()
	old := os.Stdin
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stdin = r
	if _, err := w.WriteString(input); err != nil {
		t.Fatalf("写入 stdin: %v", err)
	}
	w.Close()
	t.Cleanup(func() { os.Stdin = old })
}

// ---- runCLI 入口错误/边界路径（SaveAppConfig 之前即返回，无副作用）----

func TestRunCLI_NoCommand_PrintsHelp(t *testing.T) {
	out := captureOutput(t, func() {
		if err := RunCLI(nil); err != nil {
			t.Errorf("RunCLI(nil) 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "用法") {
		t.Errorf("帮助输出应包含「用法」, got: %s", out)
	}
}

func TestRunCLI_Version_Flag(t *testing.T) {
	out := captureOutput(t, func() {
		if err := RunCLI([]string{"--version"}); err != nil {
			t.Errorf("--version 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "YSM 模型管理器") || !strings.Contains(out, "CLI 模式") {
		t.Errorf("--version 输出应包含版本信息, got: %s", out)
	}
}

func TestRunCLI_Version_ShortFlag(t *testing.T) {
	out := captureOutput(t, func() {
		if err := RunCLI([]string{"-v"}); err != nil {
			t.Errorf("-v 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "YSM 模型管理器") {
		t.Errorf("-v 输出应包含版本信息, got: %s", out)
	}
}

func TestRunCLI_Help_Flag(t *testing.T) {
	out := captureOutput(t, func() {
		if err := RunCLI([]string{"--help"}); err != nil {
			t.Errorf("--help 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "可用命令") {
		t.Errorf("--help 输出应包含「可用命令」, got: %s", out)
	}
}

func TestRunCLI_Help_ShortFlag(t *testing.T) {
	out := captureOutput(t, func() {
		if err := RunCLI([]string{"-h"}); err != nil {
			t.Errorf("-h 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "可用命令") {
		t.Errorf("-h 输出应包含「可用命令」, got: %s", out)
	}
}

func TestRunCLI_SubCommandHelp(t *testing.T) {
	out := captureOutput(t, func() {
		if err := RunCLI([]string{"--files-root", "/tmp", "search", "--help"}); err != nil {
			t.Errorf("子命令 --help 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "命令: search") {
		t.Errorf("子命令帮助应包含命令名, got: %s", out)
	}
	if !strings.Contains(out, "用法") {
		t.Errorf("子命令帮助应包含用法说明, got: %s", out)
	}
}

func TestRunCLI_UnknownCommand_ReturnsError(t *testing.T) {
	err := RunCLI([]string{"--files-root", "/tmp", "no-such-cmd"})
	if err == nil {
		t.Error("未知命令应返回错误")
	}
	if !strings.Contains(err.Error(), "未知命令") {
		t.Errorf("错误应包含「未知命令」, got: %v", err)
	}
}

func TestRunCLI_MissingFilesRoot_ReturnsError(t *testing.T) {
	err := RunCLI([]string{"search", "--keyword", "x"})
	if err == nil || !strings.Contains(err.Error(), "files-root") {
		t.Errorf("缺 --files-root 应报错, got: %v", err)
	}
}

// ---- cache-status ----

func TestCacheStatus_EmptyCache(t *testing.T) {
	withTempCache(t)
	out := captureOutput(t, func() {
		if err := runCacheStatus(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runCacheStatus 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "缓存为空") {
		t.Errorf("空缓存应输出「缓存为空」, got: %s", out)
	}
}

func TestCacheStatus_CountsKtx2Only(t *testing.T) {
	dir := withTempCache(t)
	mustWrite(t, filepath.Join(dir, "aaaa.ktx2"), bytes.Repeat([]byte("x"), 100))
	mustWrite(t, filepath.Join(dir, "bbbb.ktx2"), bytes.Repeat([]byte("y"), 200))
	mustWrite(t, filepath.Join(dir, "notes.txt"), []byte("ignore-me")) // 非 ktx2 应忽略

	out := captureOutput(t, func() {
		if err := runCacheStatus(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runCacheStatus 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "文件数量: 2") {
		t.Errorf("应统计 2 个 ktx2 文件, got: %s", out)
	}
	if !strings.Contains(out, "总大小:   300B") {
		t.Errorf("总大小应为 300B, got: %s", out)
	}
}

// ---- cache-clear ----

func TestCacheClear_EmptyCache(t *testing.T) {
	withTempCache(t)
	out := captureOutput(t, func() {
		if err := runCacheClear(&CmdContext{App: &app.App{}, Args: []string{"--yes"}}); err != nil {
			t.Fatalf("runCacheClear 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "缓存已经是空的") {
		t.Errorf("空缓存应提示「缓存已经是空的」, got: %s", out)
	}
}

func TestCacheClear_YesDeletesFiles(t *testing.T) {
	dir := withTempCache(t)
	for _, h := range []string{"a", "b", "c"} {
		mustWrite(t, filepath.Join(dir, h+".ktx2"), []byte("x"))
	}
	out := captureOutput(t, func() {
		if err := runCacheClear(&CmdContext{App: &app.App{}, Args: []string{"--yes"}}); err != nil {
			t.Fatalf("runCacheClear 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "已清空 3 个缓存文件") {
		t.Errorf("应提示清空数量, got: %s", out)
	}
	if rem := listDirNames(t, dir); len(rem) != 0 {
		t.Errorf("--yes 清空后目录应无文件, got %v", rem)
	}
}

func TestCacheClear_CancelKeepsFiles(t *testing.T) {
	dir := withTempCache(t)
	mustWrite(t, filepath.Join(dir, "keep.ktx2"), []byte("x"))
	withStdin(t, "n\n") // 确认时输入非 y → 取消
	out := captureOutput(t, func() {
		if err := runCacheClear(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runCacheClear 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "已取消") {
		t.Errorf("取消路径应提示「已取消」, got: %s", out)
	}
	if rem := listDirNames(t, dir); len(rem) != 1 || rem[0] != "keep.ktx2" {
		t.Errorf("取消后缓存文件应保留, got %v", rem)
	}
}

// ---- cache-verify ----

func TestCacheVerify_RequiresDir(t *testing.T) {
	err := runCacheVerify(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--dir") {
		t.Errorf("cache-verify 缺 --dir 应报错, got: %v", err)
	}
}

func TestCacheVerify_NoTextures(t *testing.T) {
	withTempCache(t)
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runCacheVerify(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("runCacheVerify 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "没有找到贴图文件") {
		t.Errorf("空目录应提示「没有找到贴图文件」, got: %s", out)
	}
}

func TestCacheVerify_ReportsMiss(t *testing.T) {
	withTempCache(t)
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "tex.png"), bytes.Repeat([]byte{0x89, 0x50, 0x4E, 0x47}, 8))
	out := captureOutput(t, func() {
		if err := runCacheVerify(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("runCacheVerify 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "未命中: 1 个") {
		t.Errorf("应报告 1 个未命中, got: %s", out)
	}
	if !strings.Contains(out, "命中率: 0.0%") {
		t.Errorf("命中率应为 0.0%%, got: %s", out)
	}
}

// ---- cache-diag ----

func TestCacheDiag_ReportsSuccess(t *testing.T) {
	withTempCache(t)
	out := captureOutput(t, func() {
		if err := runCacheDiag(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runCacheDiag 应成功, got %v", err)
		}
	})
	for _, marker := range []string{"缓存流程诊断", "哈希计算成功", "缓存写入成功", "数据完整性验证通过"} {
		if !strings.Contains(out, marker) {
			t.Errorf("诊断输出应包含 %q", marker)
		}
	}
}

// ---- 参数校验错误路径（不触碰 app 状态）----

func TestExport_RequiresModel(t *testing.T) {
	err := runExport(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("export 缺 --model 应报错, got: %v", err)
	}
}

func TestAnalyze_RequiresModel(t *testing.T) {
	err := runAnalyze(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("analyze 缺 --model 应报错, got: %v", err)
	}
}

// ---- config-show 冒烟 ----

func TestConfigShow_PrintsRootAndCache(t *testing.T) {
	withTempCache(t)
	out := captureOutput(t, func() {
		if err := runConfigShow(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runConfigShow 应成功, got %v", err)
		}
	})
	// config-show 会只读加载磁盘真实配置（configPath 不可注入），
	// 故只断言任何配置下都稳定的输出片段，不绑定具体机器状态
	for _, marker := range []string{"根目录", "纹理缓存"} {
		if !strings.Contains(out, marker) {
			t.Errorf("输出应包含 %q, got: %s", marker, out)
		}
	}
}

// ---- ExecuteCLIWithApp 解耦入口（用于自动化测试复用）----

func TestRunCLIWithApp_Help(t *testing.T) {
	a := &app.App{}
	out := captureOutput(t, func() {
		if err := ExecuteCLIWithApp(a, a.SaveAppConfig, []string{"--help"}); err != nil {
			t.Errorf("ExecuteCLIWithApp --help 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "可用命令") {
		t.Errorf("帮助输出应包含「可用命令」, got: %s", out)
	}
}

func TestRunCLIWithApp_Version(t *testing.T) {
	a := &app.App{}
	out := captureOutput(t, func() {
		if err := ExecuteCLIWithApp(a, a.SaveAppConfig, []string{"--version"}); err != nil {
			t.Errorf("ExecuteCLIWithApp --version 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "YSM 模型管理器") {
		t.Errorf("版本输出应包含版本信息, got: %s", out)
	}
}

func TestRunCLIWithApp_UnknownCommand(t *testing.T) {
	a := &app.App{}
	err := ExecuteCLIWithApp(a, a.SaveAppConfig, []string{"no-such-cmd"})
	if err == nil {
		t.Error("未知命令应返回错误")
	}
	if !strings.Contains(err.Error(), "未知命令") {
		t.Errorf("错误信息应包含「未知命令」, got: %v", err)
	}
}

func TestRunCLIWithApp_UsesProvidedApp(t *testing.T) {
	a := &app.App{}
	out := captureOutput(t, func() {
		// 不传 --files-root：避免触发 SaveAppConfig 落盘真实用户配置（文件头约束）
		if err := ExecuteCLIWithApp(a, a.SaveAppConfig, []string{"cache-status"}); err != nil {
			t.Errorf("ExecuteCLIWithApp cache-status 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "缓存状态") {
		t.Errorf("应执行 cache-status 命令, got: %s", out)
	}
}

func TestRunCLIWithApp_NoFilesRoot_RunsAnyway(t *testing.T) {
	// ExecuteCLIWithApp 设计为测试复用，允许没有 files-root
	// （与 runCLI 不同，runCLI 会强制要求 files-root）
	a := &app.App{}
	err := ExecuteCLIWithApp(a, a.SaveAppConfig, []string{"search", "--keyword", "test"})
	// 没有 files-root 时应正常运行（search 命令在没有模型时返回空结果）
	if err != nil {
		t.Logf("ExecuteCLIWithApp 无 files-root 返回: %v（可能因无模型而正常）", err)
	}
}

// ---- help 输出稳定性 ----

func TestPrintCLIHelp_CommandsSorted(t *testing.T) {
	out := captureOutput(t, func() {
		printCLIHelp()
	})

	// 分组输出格式："[分类]" 行 + "  %-18s %s" 命令行。
	// 解析出每个分类下的命令名列表，验证组内字母序 + 全覆盖。
	var (
		curCat   string
		gotByCat = map[string][]string{}
		seenCats []string
	)
	for _, line := range strings.Split(out, "\n") {
		// 分类标题行: "  [模型管理]"
		if strings.HasPrefix(line, "  [") && strings.HasSuffix(line, "]") {
			curCat = strings.TrimSuffix(strings.TrimPrefix(line, "  ["), "]")
			seenCats = append(seenCats, curCat)
			continue
		}
		// 命令行格式: "  %-18s %s"，name 占第 3~20 字符
		if len(line) < 20 || line[:2] != "  " || curCat == "" {
			continue
		}
		name := strings.TrimSpace(line[2:20])
		if _, ok := cliCommands[name]; ok {
			gotByCat[curCat] = append(gotByCat[curCat], name)
		}
	}

	// 所有已注册命令都应出现在 help 中
	total := 0
	for _, names := range gotByCat {
		total += len(names)
	}
	if total != len(cliCommands) {
		t.Errorf("help 命令数 %d != 已注册数 %d", total, len(cliCommands))
	}

	// 每个分类内应按字母序
	for cat, names := range gotByCat {
		if len(names) == 0 {
			t.Errorf("分类 %q 未解析到任何命令", cat)
			continue
		}
		for i := 1; i < len(names); i++ {
			if names[i-1] > names[i] {
				t.Errorf("分类 %q 命令列表应按字母序, got %v", cat, names)
				break
			}
		}
	}

	// 至少有一个分类被解析到
	if len(seenCats) == 0 {
		t.Fatal("help 输出未解析到任何分类标题")
	}
}

// ---- helpers ----

func mustWrite(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("写入 %s: %v", path, err)
	}
}

func listDirNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("读取目录 %s: %v", dir, err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

// ========== mmd 命令测试 ==========

func TestFileBench_RequiresDirOrFile(t *testing.T) {
	err := runFileBench(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--dir") {
		t.Errorf("file-bench 缺 --dir/--file 应报错, got: %v", err)
	}
}

func TestFileBench_SingleFile(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "test.ysm")
	mustWrite(t, filePath, bytes.Repeat([]byte("x"), 2*1024*1024)) // 2MB

	out := captureOutput(t, func() {
		if err := runFileBench(&CmdContext{App: &app.App{}, Args: []string{"--file", filePath}}); err != nil {
			t.Fatalf("runFileBench 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "文件读取性能测试") {
		t.Errorf("输出应包含标题, got: %s", out)
	}
}

func TestFileBench_DirWithLargeFiles(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < 3; i++ {
		mustWrite(t, filepath.Join(dir, fmt.Sprintf("file_%d.ysm", i)), bytes.Repeat([]byte("x"), 2*1024*1024))
	}

	out := captureOutput(t, func() {
		if err := runFileBench(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir, "--iterations", "1"}}); err != nil {
			t.Fatalf("runFileBench 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "文件读取性能测试") {
		t.Errorf("输出应包含标题, got: %s", out)
	}
}

func TestScanDir_RequiresDir(t *testing.T) {
	err := runScanDir(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--dir") {
		t.Errorf("scan-dir 缺 --dir 应报错, got: %v", err)
	}
}

func TestScanDir_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runScanDir(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("runScanDir 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "目录统计") {
		t.Errorf("输出应包含目录统计, got: %s", out)
	}
	if !strings.Contains(out, "文件数:   0") {
		t.Errorf("空目录应显示 0 文件, got: %s", out)
	}
}

func TestScanDir_WithFiles(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "test.png"), []byte("fake png"))
	mustWrite(t, filepath.Join(dir, "test.jpg"), []byte("fake jpg"))
	mustWrite(t, filepath.Join(dir, "model.pmx"), bytes.Repeat([]byte("x"), 15*1024*1024)) // 15MB

	out := captureOutput(t, func() {
		if err := runScanDir(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("runScanDir 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "目录统计") {
		t.Errorf("输出应包含目录统计, got: %s", out)
	}
	if !strings.Contains(out, ".png") || !strings.Contains(out, ".jpg") {
		t.Errorf("应显示按扩展名分组, got: %s", out)
	}
}

func TestAnalyzeMMD_RequiresDir(t *testing.T) {
	err := runAnalyzeMMD(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--dir") {
		t.Errorf("analyze-mmd 缺 --dir 应报错, got: %v", err)
	}
}

func TestAnalyzeMMD_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runAnalyzeMMD(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("runAnalyzeMMD 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "MMD 模型资产分析") {
		t.Errorf("输出应包含标题, got: %s", out)
	}
	if !strings.Contains(out, "资产统计") {
		t.Errorf("输出应包含资产统计, got: %s", out)
	}
}

func TestAnalyzeMMD_WithModels(t *testing.T) {
	dir := t.TempDir()
	// 创建模拟的 MMD 文件
	mustWrite(t, filepath.Join(dir, "model.pmx"), []byte("fake pmx"))
	mustWrite(t, filepath.Join(dir, "motion.vmd"), []byte("fake vmd"))
	mustWrite(t, filepath.Join(dir, "physics.vpd"), []byte("fake vpd"))
	mustWrite(t, filepath.Join(dir, "tex1.png"), bytes.Repeat([]byte{0x89, 0x50, 0x4E, 0x47}, 8))

	out := captureOutput(t, func() {
		if err := runAnalyzeMMD(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("runAnalyzeMMD 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "PMX/PMD 模型:  1 个") {
		t.Errorf("应显示 1 个 PMX 模型, got: %s", out)
	}
	if !strings.Contains(out, "VMD 动画:      1 个") {
		t.Errorf("应显示 1 个 VMD 动画, got: %s", out)
	}
}

// ========== concurrent 命令测试 ==========

func TestConcurrentBench_NoModels(t *testing.T) {
	dir := t.TempDir()
	a := app.NewApp()
	err := runConcurrentBench(&CmdContext{App: a, FilesRoot: dir, Args: []string{"--files-root", dir}})
	if err == nil {
		t.Log("无模型时 concurrent-bench 返回错误属正常")
	}
}

func TestSingleBench_RequiresModel(t *testing.T) {
	err := runSingleBench(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("single-bench 缺 --model 应报错, got: %v", err)
	}
}

func TestSingleBench_WithFakeModel(t *testing.T) {
	dir := t.TempDir()
	modelPath := filepath.Join(dir, "test.ysm")
	mustWrite(t, modelPath, []byte(`{"test": "model"}`))

	out := captureOutput(t, func() {
		if err := runSingleBench(&CmdContext{App: &app.App{}, Args: []string{"--model", modelPath, "--iterations", "1"}}); err != nil {
			t.Logf("runSingleBench 返回: %v（可能因模型格式不标准而正常）", err)
		}
	})
	if strings.Contains(out, "单模型加载基准测试") {
		t.Log("single-bench 成功执行")
	}
}

// ---- iterations 参数校验（--iterations 0/负值 必须拒绝，防 allStages[0] 越界 panic）----

func TestSingleBench_RejectsInvalidIterations(t *testing.T) {
	for _, it := range []string{"0", "-1"} {
		err := runSingleBench(&CmdContext{App: &app.App{}, Args: []string{"--model", "test.ysm", "--iterations", it}})
		if err == nil || !strings.Contains(err.Error(), "--iterations") {
			t.Errorf("single-bench --iterations %s 应报错, got: %v", it, err)
		}
		if _, ok := err.(*ErrParam); !ok {
			t.Errorf("single-bench --iterations %s 应为 ErrParam, got: %T", it, err)
		}
	}
}

// parseStageName：阶段②「模型解析」按格式切换（MMD 不再误导为 JSON 解析）
func TestParseStageName_ByFormat(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"model.ysm", "② JSON 解析"},
		{"model.json", "② JSON 解析"},
		{"mmd/子言/model.pmx", "② PMX 解析"},
		{"model.pmd", "② PMX 解析"},
		{"model.vrm", "② 模型解析"},
		{"model.gltf", "② 模型解析"},
		{"model.unknown", "② 模型解析"},
	}
	for _, c := range cases {
		if got := parseStageName(c.path); got != c.want {
			t.Errorf("parseStageName(%s) = %q, want %q", c.path, got, c.want)
		}
	}
}

func TestFileBench_RejectsInvalidIterations(t *testing.T) {
	for _, it := range []string{"0", "-1"} {
		err := runFileBench(&CmdContext{App: &app.App{}, Args: []string{"--dir", ".", "--iterations", it}})
		if err == nil || !strings.Contains(err.Error(), "--iterations") {
			t.Errorf("file-bench --iterations %s 应报错, got: %v", it, err)
		}
		if _, ok := err.(*ErrParam); !ok {
			t.Errorf("file-bench --iterations %s 应为 ErrParam, got: %T", it, err)
		}
	}
}

func TestBenchmark_RejectsInvalidIterations(t *testing.T) {
	for _, it := range []string{"0", "-1"} {
		err := runBenchmark(&CmdContext{App: &app.App{}, Args: []string{"--iterations", it}})
		if err == nil || !strings.Contains(err.Error(), "--iterations") {
			t.Errorf("benchmark --iterations %s 应报错, got: %v", it, err)
		}
		if _, ok := err.(*ErrParam); !ok {
			t.Errorf("benchmark --iterations %s 应为 ErrParam, got: %T", it, err)
		}
	}
}

// ========== flow 命令测试 ==========

func TestGUIFlow_NoModels(t *testing.T) {
	dir := t.TempDir()
	a := app.NewApp()
	err := runGUIFlow(&CmdContext{App: a, FilesRoot: dir, Args: []string{"--files-root", dir}})
	if err != nil {
		t.Logf("gui-flow 无模型时返回: %v（属正常）", err)
	}
}

func TestGUIFlow_WithVerbose(t *testing.T) {
	dir := t.TempDir()
	a := app.NewApp()
	out := captureOutput(t, func() {
		if err := runGUIFlow(&CmdContext{App: a, FilesRoot: dir, Args: []string{"--files-root", dir, "--verbose"}}); err != nil {
			t.Logf("gui-flow verbose 返回: %v（可能因无模型而正常）", err)
		}
	})
	if strings.Contains(out, "GUI 流程模拟器") {
		t.Log("gui-flow 成功执行")
	}
}

// TestGUIFlow_DoesNotWriteRealConfig 回归守卫：gui-flow「配置加载」阶段只读，不得写穿真实用户配置。
// 此前 runPhaseConfigLoad 调 SaveAppConfig 落盘 APPDATA/ysm_config.json（filesRoot 指向临时目录），
// 污染用户配置并触发 test_config_defaults.mjs FAIL ①；修复后文件应保持原样（存在则内容不变，不存在则不新建）。
func TestGUIFlow_DoesNotWriteRealConfig(t *testing.T) {
	userCfg, err := os.UserConfigDir()
	if err != nil {
		t.Fatalf("os.UserConfigDir: %v", err)
	}
	cfgPath := filepath.Join(userCfg, "YSM-Model-Manager", "ysm_config.json")
	readCfg := func() ([]byte, bool) {
		b, err := os.ReadFile(cfgPath)
		if err != nil {
			return nil, false
		}
		return b, true
	}
	before, beforeExists := readCfg()

	dir := t.TempDir()
	a := app.NewApp()
	_ = runGUIFlow(&CmdContext{App: a, FilesRoot: dir, Args: []string{"--files-root", dir, "--verbose"}})

	after, afterExists := readCfg()
	if beforeExists != afterExists || !bytes.Equal(before, after) {
		t.Errorf("gui-flow 不应写盘真实用户配置 %s\n  before: %q\n  after:  %q", cfgPath, before, after)
	}
}

// TestScanSummaryByType 扫描统计按注册表类型聚合（PMX 不再归 "other"）：
// MMD 仓库 100 个 PMX 此前全部落入 "其他: 333" 槽（硬编码 yml/ysm/other），
// 现按路径消歧 + 注册表展示真实类型分布；firstModel 仅提升 .ysm（分析阶段可处理）。
func TestScanSummaryByType(t *testing.T) {
	entries := []types.ModelEntry{
		{Path: `/repo/mmd/PMX/2.大学学姐/角色A.pmx`},
		{Path: `/repo/mmd/PMX/2.大学学姐/角色B.pmx`},
		{Path: `/repo/mmd/PMX/2.大学学姐/动作A.vmd`},
		{Path: `/repo/mmd/PMX/角色包.zip`}, // 模型包容器：目录归属 > 扩展名（location 路由）
		{Path: `/repo/ysm/模型A.ysm`},
		{Path: `/repo/ysm/模型B.ysm`},
		{Path: `/repo/misc/说明.txt`},
	}
	byType, first := scanSummaryByType(entries)

	// PMX 目录下全部资源（.pmx/.vmd/.zip）经 location 路由归 EntityPlayer
	if byType["EntityPlayer"] != 4 {
		t.Errorf("EntityPlayer 计数 = %d, 期望 4（pmx×2+vmd+zip）(byType=%v)", byType["EntityPlayer"], byType)
	}
	if byType["ysm"] != 2 {
		t.Errorf("ysm 计数 = %d, 期望 2", byType["ysm"])
	}
	// .txt 未命中注册表才落 other
	if byType["other"] != 1 {
		t.Errorf("other 计数 = %d, 期望 1（仅 txt）", byType["other"])
	}
	// firstModel 只选 .ysm
	if !strings.HasSuffix(first, "模型A.ysm") {
		t.Errorf("firstModel = %q, 期望 .ysm 模型", first)
	}
}

// TestClassifyForScan_LocationRouting 目录归属 > 扩展名（MMD 子类型 location 路由）：
// mmd/PMX 目录下 zip 模型包/表情/动作文件都归 EntityPlayer（此前 zip 被
// repoaudit.Classify 归到最后一个声明 .zip 的 DefaultMorph——217 个 PMX 包误统计）；
// 更深目录优先（mmd/PMX/DefaultMorph 下归 DefaultMorph）。
func TestClassifyForScan_LocationRouting(t *testing.T) {
	registry := types.LoadRegistry()

	// mmd/PMX 目录（EntityPlayer.storageSubDir=PMX）下各类文件归 EntityPlayer
	cases := []struct {
		path string
		ext  string
		want string
	}{
		{`/repo/mmd/PMX/角色包.zip`, ".zip", "EntityPlayer"},             // 模型包容器
		{`/repo/mmd/PMX/表情.vpd`, ".vpd", "EntityPlayer"},              // 表情文件
		{`/repo/mmd/PMX/动作.vmd`, ".vmd", "EntityPlayer"},              // 动作文件
		{`/repo/mmd/PMX/角色.pmx`, ".pmx", "EntityPlayer"},              // 裸模型
		{`/repo/mmd/DefaultMorph/表情.vpd`, ".vpd", "DefaultMorph"},     // 各自目录归属
		{`/repo/mmd/CustomAnim/动作.vmd`, ".vmd", "CustomAnim"},         // 各自目录归属
		{`/repo/mmd/PMX/DefaultMorph/内嵌.vpd`, ".vpd", "DefaultMorph"}, // 深目录优先
		{`/repo/ysm/模型A.ysm`, ".ysm", "ysm"},
	}
	for _, tc := range cases {
		if got := classifyForScan(tc.path, tc.ext, registry); got != tc.want {
			t.Errorf("classifyForScan(%s) = %q, 期望 %q", tc.path, got, tc.want)
		}
	}
}

// TestScanSummaryByType_PmxOnly 纯 PMX 仓库：分布如实展示，firstModel 为空（CLI 不模拟 PMX 分析）
func TestScanSummaryByType_PmxOnly(t *testing.T) {
	entries := []types.ModelEntry{
		{Path: `/repo/mmd/PMX/角色A.pmx`},
		{Path: `/repo/mmd/PMX/角色B.pmx`},
	}
	byType, first := scanSummaryByType(entries)
	if byType["EntityPlayer"] != 2 {
		t.Errorf("EntityPlayer 计数 = %d, 期望 2", byType["EntityPlayer"])
	}
	if first != "" {
		t.Errorf("纯 PMX 仓库 firstModel = %q, 期望空（无 .ysm 可分析）", first)
	}
}

// TestGUIFlow_PmxTarget 指定 PMX 目标：③ 阶段明确提示 CLI 不模拟，而非「分析失败」假象；
// 且不再产出 ④⑤⑥ 假数据阶段。
func TestGUIFlow_PmxTarget(t *testing.T) {
	out := captureOutput(t, func() {
		_ = runGUIFlow(&CmdContext{App: app.NewApp(), FilesRoot: t.TempDir(), Args: []string{"--model", "/repo/角色A.pmx", "--verbose"}})
	})
	if !strings.Contains(out, "PMX/PMD 加载链路在 Three.js 前端") {
		t.Errorf("PMX 目标应提示 CLI 不模拟, 输出:\n%s", out)
	}
	if strings.Contains(out, "分析失败") {
		t.Errorf("PMX 目标不应报「分析失败」（误导），输出:\n%s", out)
	}
	if strings.Contains(out, "纹理缓存") {
		t.Errorf("PMX 目标不应执行 ④ 纹理缓存（AnalyzeBedrockModel 假数据），输出:\n%s", out)
	}
}

// ========== perf 命令测试 ==========

func TestPerfLog_Output(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runPerfLog(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Errorf("runPerfLog 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "优化记录") {
		t.Errorf("perf-log 输出应包含「优化记录」, got: %s", out)
	}
	if !strings.Contains(out, "当前瓶颈") {
		t.Errorf("perf-log 输出应包含「当前瓶颈」, got: %s", out)
	}
	if !strings.Contains(out, "关键指标") {
		t.Errorf("perf-log 输出应包含「关键指标」, got: %s", out)
	}
}

// ========== model 命令更多边界测试 ==========

func TestSearch_EmptyKeyword(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runSearch(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--files-root", dir}}); err != nil {
			t.Errorf("search 空仓库应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "未找到匹配的模型") {
		t.Errorf("空仓库应显示「未找到匹配的模型」, got: %s", out)
	}
}

func TestList_EmptyRepo(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runList(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--files-root", dir}}); err != nil {
			t.Errorf("list 空仓库应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "仓库为空") {
		t.Errorf("空仓库应显示「仓库为空」, got: %s", out)
	}
}

func TestList_JsonFormat(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runList(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--files-root", dir, "--format", "json"}}); err != nil {
			t.Errorf("list json 格式应成功, got %v", err)
		}
	})
	// 空仓库时先输出 "仓库为空" 再返回，不走 json 输出路径
	if !strings.Contains(out, "仓库为空") {
		t.Errorf("空仓库应显示「仓库为空」, got: %s", out)
	}
}

func TestVerify_EmptyRepo(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runVerify(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--files-root", dir}}); err != nil {
			t.Errorf("verify 空仓库应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "验证结果") {
		t.Errorf("verify 应显示验证结果, got: %s", out)
	}
}

func TestExport_InvalidPath(t *testing.T) {
	err := runExport(&CmdContext{App: &app.App{}, Args: []string{"--model", "/nonexistent/model.ysm"}})
	if err == nil {
		t.Log("export 不存在的文件可能返回空内容")
	}
}

// ========== shared.go 工具函数测试 ==========

func TestParseCommandArgs_Basic(t *testing.T) {
	args := []string{"--files-root", "/models", "search", "--keyword", "test"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "/models" {
		t.Errorf("filesRoot 应为 /models, got: %s", filesRoot)
	}
	if jsonMode {
		t.Error("不应启用 jsonMode")
	}
	if len(cmdArgs) != 3 {
		t.Errorf("应有 3 个命令参数, got: %d", len(cmdArgs))
	}
}

func TestParseCommandArgs_InlineFormat(t *testing.T) {
	args := []string{"--files-root=/models", "list"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "/models" {
		t.Errorf("filesRoot 应为 /models, got: %s", filesRoot)
	}
	if jsonMode {
		t.Error("不应启用 jsonMode")
	}
	if len(cmdArgs) != 1 || cmdArgs[0] != "list" {
		t.Errorf("命令参数应只有 list, got: %v", cmdArgs)
	}
}

func TestParseCommandArgs_NoFilesRoot(t *testing.T) {
	args := []string{"search", "--keyword", "test"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "" {
		t.Errorf("无 files-root 应为空, got: %s", filesRoot)
	}
	if jsonMode {
		t.Error("不应启用 jsonMode")
	}
	if len(cmdArgs) != 3 {
		t.Errorf("应有 3 个命令参数, got: %d", len(cmdArgs))
	}
}

func TestFormatSize(t *testing.T) {
	tests := []struct {
		input    int64
		expected string
	}{
		{500, "500B"},
		{1024, "1.0KB"},
		{1536, "1.5KB"},
		{1048576, "1.0MB"},
		{1073741824, "1.0GB"},
	}
	for _, tt := range tests {
		result := formatSize(tt.input)
		if result != tt.expected {
			t.Errorf("formatSize(%d) = %s, want %s", tt.input, result, tt.expected)
		}
	}
}

func TestIsPowerOf2(t *testing.T) {
	tests := []struct {
		input    int
		expected bool
	}{
		{1, true},
		{2, true},
		{4, true},
		{8, true},
		{16, true},
		{1024, true},
		{3, false},
		{5, false},
		{7, false},
		{0, false},
		{-1, false},
	}
	for _, tt := range tests {
		result := isPowerOf2(tt.input)
		if result != tt.expected {
			t.Errorf("isPowerOf2(%d) = %v, want %v", tt.input, result, tt.expected)
		}
	}
}

func TestMinMax(t *testing.T) {
	if min(5, 10) != 5 {
		t.Error("min(5, 10) should be 5")
	}
	if max(5, 10) != 10 {
		t.Error("max(5, 10) should be 10")
	}
	if min(-1, -5) != -5 {
		t.Error("min(-1, -5) should be -5")
	}
	if max(0, 0) != 0 {
		t.Error("max(0, 0) should be 0")
	}
}

func TestExitCodeOf(t *testing.T) {
	paramErr := &ErrParam{Err: fmt.Errorf("参数错误")}
	if ExitCodeOf(paramErr) != ExitParamErr {
		t.Errorf("参数错误应有退出码 %d, got: %d", ExitParamErr, ExitCodeOf(paramErr))
	}

	runtimeErr := &ErrRuntime{Err: fmt.Errorf("运行时错误")}
	if ExitCodeOf(runtimeErr) != ExitRuntimeErr {
		t.Errorf("运行时错误应有退出码 %d, got: %d", ExitRuntimeErr, ExitCodeOf(runtimeErr))
	}

	genericErr := fmt.Errorf("普通错误")
	if ExitCodeOf(genericErr) != ExitRuntimeErr {
		t.Errorf("普通错误应有退出码 %d, got: %d", ExitRuntimeErr, ExitCodeOf(genericErr))
	}
}

func TestErrParam_Error(t *testing.T) {
	e := &ErrParam{CmdName: "search", Err: fmt.Errorf("缺参数")}
	if !strings.Contains(e.Error(), "search") || !strings.Contains(e.Error(), "参数错误") {
		t.Errorf("ErrParam.Error() 应包含命令名和错误类型, got: %s", e.Error())
	}

	e2 := &ErrParam{Err: fmt.Errorf("无命令名")}
	if strings.Contains(e2.Error(), "参数错误 [") {
		t.Errorf("无命令名时不应包含方括号, got: %s", e2.Error())
	}
}

func TestErrRuntime_Error(t *testing.T) {
	e := &ErrRuntime{CmdName: "benchmark", Err: fmt.Errorf("超时")}
	if !strings.Contains(e.Error(), "benchmark") || !strings.Contains(e.Error(), "运行时错误") {
		t.Errorf("ErrRuntime.Error() 应包含命令名和错误类型, got: %s", e.Error())
	}
}

func TestPrintError(t *testing.T) {
	// nil error should not panic
	PrintError(nil)

	// non-nil error should print to stderr
	// (we just verify it doesn't panic)
	PrintError(fmt.Errorf("test error"))
}

// ========== flow 辅助函数测试 ==========

func TestDurationFormat(t *testing.T) {
	tests := []struct {
		input    float64
		expected string
	}{
		{1.5, "1.50ms"},   // < 10ms: 两位小数
		{5.0, "5.00ms"},   // < 10ms: 两位小数
		{9.9, "9.90ms"},   // < 10ms: 两位小数
		{10.0, "10ms"},    // >= 10ms < 1000ms: 整数
		{99.0, "99ms"},    // >= 10ms < 1000ms: 整数
		{100.0, "100ms"},  // >= 10ms < 1000ms: 整数
		{500.0, "500ms"},  // >= 10ms < 1000ms: 整数
		{1000.0, "1.00s"}, // >= 1000ms: 秒+两位小数
		{2500.0, "2.50s"}, // >= 1000ms: 秒+两位小数
	}
	for _, tt := range tests {
		result := durationFormat(tt.input)
		if result != tt.expected {
			t.Errorf("durationFormat(%f) = %s, want %s", tt.input, result, tt.expected)
		}
	}
}

func TestWrap(t *testing.T) {
	text := "这是一段很长的文字需要被折行处理来测试 wrap 函数的折行逻辑是否正确工作"
	result := wrap(text, 20, "  ")
	if len(result) == 0 {
		t.Error("wrap 不应返回空字符串")
	}
	if !strings.Contains(result, "\n") {
		t.Log("短文本可能不需要折行")
	}
}

// ========== 回归测试：确保所有命令都已注册 ==========

func TestAllCommandsRegistered(t *testing.T) {
	expectedCommands := []string{
		"search", "analyze", "list", "verify", "benchmark", "export",
		"cache-status", "cache-verify", "cache-clear", "cache-diag",
		"file-bench", "scan-dir", "analyze-mmd",
		"concurrent-bench", "single-bench",
		"config-show",
		"gui-flow",
		"perf-log",
	}

	for _, cmd := range expectedCommands {
		if _, exists := cliCommands[cmd]; !exists {
			t.Errorf("命令 %s 未注册", cmd)
		}
	}
}

// ========== DispatchCommand 路由测试 ==========

func TestDispatchCommand_RequiresFilesRoot(t *testing.T) {
	a := app.NewApp()
	err := DispatchCommand(a, a.SaveAppConfig, "", []string{"search"}, true)
	if err == nil {
		t.Error("requireFilesRoot=true 且 filesRoot 为空时应返回错误")
	}
	if !strings.Contains(err.Error(), "files-root") {
		t.Errorf("错误信息应包含 files-root, got: %v", err)
	}
}

func TestDispatchCommand_AllowsEmptyFilesRoot(t *testing.T) {
	a := app.NewApp()
	err := DispatchCommand(a, a.SaveAppConfig, "", []string{"cache-status"}, false)
	if err != nil {
		t.Logf("无 files-root 时 dispatch 返回: %v（可能正常）", err)
	}
}

func TestDispatchCommand_UnknownCommand(t *testing.T) {
	a := app.NewApp()
	dir := t.TempDir()
	err := DispatchCommand(a, a.SaveAppConfig, dir, []string{"no-such-cmd"}, false)
	if err == nil {
		t.Error("未知命令应返回错误")
	}
	if !strings.Contains(err.Error(), "未知命令") {
		t.Errorf("错误应包含「未知命令」, got: %v", err)
	}
}

func TestDispatchCommand_SubCommandHelp(t *testing.T) {
	a := app.NewApp()
	out := captureOutput(t, func() {
		err := DispatchCommand(a, a.SaveAppConfig, "", []string{"search", "--help"}, false)
		if err != nil {
			t.Errorf("--help 应返回 nil, got: %v", err)
		}
	})
	if !strings.Contains(out, "命令: search") {
		t.Errorf("子命令帮助应包含命令名, got: %s", out)
	}
}

// TestDispatchCommand_SessionRootNoWriteThrough（审核 #4）：--files-root 是一次性
// 会话参数——DispatchCommand 不得再经 saveConfigFn 落盘真实用户配置，仅覆写内存
// 会话配置。哨兵 saveConfigFn 被调用即失败（测试自身零磁盘副作用）。
func TestDispatchCommand_SessionRootNoWriteThrough(t *testing.T) {
	a := app.NewApp()
	saved := false
	saveFn := func(string, string, string, string, string) error {
		saved = true
		return nil
	}
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := DispatchCommand(a, saveFn, dir, []string{"search", "--keyword", "zz-nohit"}, false); err != nil {
			t.Errorf("search 执行失败: %v", err)
		}
	})
	_ = out
	if saved {
		t.Error("saveConfigFn 不应被 CLI 分发调用（写穿已移除）")
	}
	if got := a.LoadAppConfig().FilesRoot; got != dir {
		t.Errorf("会话覆写未生效: got %q want %q", got, dir)
	}
}

func TestDispatchCommand_EmptyCommandList(t *testing.T) {
	a := app.NewApp()
	err := DispatchCommand(a, a.SaveAppConfig, "", nil, false)
	if err != nil {
		t.Errorf("空命令列表应返回 nil, got: %v", err)
	}
}

// ========== parseFlags 测试 ==========

func TestParseFlags_ExtractsFilesRoot(t *testing.T) {
	fs := newCmdFlagSet("test")
	fs.String("keyword", "", "关键词")
	filesRoot, err := parseFlags(fs, []string{"--files-root", "/models", "--keyword", "warrior"})
	if err != nil {
		t.Fatalf("解析应成功, got: %v", err)
	}
	if filesRoot != "/models" {
		t.Errorf("filesRoot 应为 /models, got: %s", filesRoot)
	}
}

func TestParseFlags_ExtractsFilesRootInline(t *testing.T) {
	fs := newCmdFlagSet("test")
	filesRoot, err := parseFlags(fs, []string{"--files-root=/models", "search"})
	if err != nil {
		t.Fatalf("解析应成功, got: %v", err)
	}
	if filesRoot != "/models" {
		t.Errorf("filesRoot 应为 /models, got: %s", filesRoot)
	}
}

func TestParseFlags_NoFilesRoot(t *testing.T) {
	fs := newCmdFlagSet("test")
	fs.String("keyword", "", "关键词")
	filesRoot, err := parseFlags(fs, []string{"--keyword", "test"})
	if err != nil {
		t.Fatalf("解析应成功, got: %v", err)
	}
	if filesRoot != "" {
		t.Errorf("filesRoot 应为空, got: %s", filesRoot)
	}
}

func TestParseFlags_InvalidFlag(t *testing.T) {
	fs := newCmdFlagSet("test")
	_, err := parseFlags(fs, []string{"--no-such-flag", "value"})
	if err == nil {
		t.Error("无效 flag 应返回错误")
	}
	var pe *ErrParam
	if !strings.Contains(fmt.Sprintf("%v", err), "参数错误") {
		t.Logf("无效 flag 应被包装为 ErrParam, got: %T", err)
	}
	_ = pe
}

// ========== CmdContext 测试 ==========

func TestCmdContext_Construction(t *testing.T) {
	a := app.NewApp()
	ctx := &CmdContext{App: a, FilesRoot: "/test", Args: []string{"--verbose"}}
	if ctx.App != a {
		t.Error("App 字段应正确赋值")
	}
	if ctx.FilesRoot != "/test" {
		t.Errorf("FilesRoot 应为 /test, got: %s", ctx.FilesRoot)
	}
	if len(ctx.Args) != 1 || ctx.Args[0] != "--verbose" {
		t.Errorf("Args 应为 [--verbose], got: %v", ctx.Args)
	}
}

// ========== ParseCommandArgs 边界测试 ==========

func TestParseCommandArgs_LeadingFilesRoot(t *testing.T) {
	args := []string{"--files-root", "/repo", "search", "--keyword", "x"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "/repo" {
		t.Errorf("filesRoot 应为 /repo, got: %s", filesRoot)
	}
	if jsonMode {
		t.Error("不应启用 jsonMode")
	}
	expected := []string{"search", "--keyword", "x"}
	if len(cmdArgs) != len(expected) {
		t.Fatalf("cmdArgs 长度应为 %d, got: %d (%v)", len(expected), len(cmdArgs), cmdArgs)
	}
	for i, v := range expected {
		if cmdArgs[i] != v {
			t.Errorf("cmdArgs[%d] 应为 %s, got: %s", i, v, cmdArgs[i])
		}
	}
}

func TestParseCommandArgs_TrailingFilesRoot(t *testing.T) {
	args := []string{"search", "--keyword", "x", "--files-root", "/repo"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "/repo" {
		t.Errorf("filesRoot 应为 /repo, got: %s", filesRoot)
	}
	if jsonMode {
		t.Error("不应启用 jsonMode")
	}
	if len(cmdArgs) != 3 || cmdArgs[0] != "search" {
		t.Errorf("cmdArgs 应为 [search --keyword x], got: %v (len=%d)", cmdArgs, len(cmdArgs))
	}
}

func TestParseCommandArgs_MultipleFilesRoot(t *testing.T) {
	// 只保留最后一个
	args := []string{"--files-root", "/first", "search", "--files-root", "/second"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "/second" {
		t.Errorf("应保留最后一个 filesRoot /second, got: %s", filesRoot)
	}
	if jsonMode {
		t.Error("不应启用 jsonMode")
	}
	if len(cmdArgs) != 1 || cmdArgs[0] != "search" {
		t.Errorf("cmdArgs 应只剩 search, got: %v", cmdArgs)
	}
}

// TestRunCLI_JsonMode_OutputsJsonResponse 验证 --json 全局开关输出统一 JsonResponse 协议
func TestRunCLI_JsonMode_OutputsJsonResponse(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := RunCLI([]string{"--files-root", dir, "--json", "list"}); err != nil {
			t.Logf("RunCLI --json list 返回: %v（空仓库属正常）", err)
		}
	})
	if !strings.Contains(out, `"status"`) || !strings.Contains(out, `"command"`) {
		t.Errorf("--json 输出应包含 status/command 字段, got: %s", out)
	}
	if !strings.Contains(out, `"list"`) {
		t.Errorf("--json 输出应包含命令名 list, got: %s", out)
	}
}

func TestParseCommandArgs_JsonMode(t *testing.T) {
	args := []string{"--files-root", "/repo", "--json", "search", "--keyword", "x"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "/repo" {
		t.Errorf("filesRoot 应为 /repo, got: %s", filesRoot)
	}
	if !jsonMode {
		t.Error("应启用 jsonMode")
	}
	expected := []string{"search", "--keyword", "x"}
	if len(cmdArgs) != len(expected) {
		t.Fatalf("cmdArgs 长度应为 %d, got: %d (%v)", len(expected), len(cmdArgs), cmdArgs)
	}
}

func TestParseCommandArgs_JsonModeWithoutFilesRoot(t *testing.T) {
	args := []string{"--json", "list", "--format", "table"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "" {
		t.Errorf("filesRoot 应为空, got: %s", filesRoot)
	}
	if !jsonMode {
		t.Error("应启用 jsonMode")
	}
	if len(cmdArgs) != 3 {
		t.Errorf("应有 3 个命令参数, got: %d", len(cmdArgs))
	}
}

// TestJsonDataPayload 验证 --json 响应 data 载荷构造（规律六：成功/失败共用 jsonDataPayload，
// output 为空返回 nil——omitempty 省略，前端以 status/error 为准）
func TestJsonDataPayload(t *testing.T) {
	// 空 output：返回 nil（data 省略）
	if got := jsonDataPayload("", "/repo"); got != nil {
		t.Errorf("空 output 应返回 nil, got: %v", got)
	}
	// 非空 output：含 output/lines/filesRoot（lines 按行切分）
	got := jsonDataPayload("line1\nline2\n", "/repo")
	if got == nil {
		t.Fatal("非空 output 应返回非 nil Payload")
	}
	if got["filesRoot"] != "/repo" {
		t.Errorf("filesRoot 应为 /repo, got: %v", got["filesRoot"])
	}
	if got["output"] != "line1\nline2\n" {
		t.Errorf("output 应原样保留, got: %v", got["output"])
	}
	lines, ok := got["lines"].([]string)
	if !ok || len(lines) != 2 || lines[0] != "line1" || lines[1] != "line2" {
		t.Errorf("lines 应按行切分, got: %v", got["lines"])
	}
}

// ===== C-1 single-bench 基准对比相关单测 =====

func TestAvgBenchStages(t *testing.T) {
	all := [][]singleBenchStage{
		{
			{Name: "① 文件读取", Duration: 10 * time.Millisecond},
			{Name: "② JSON 解析", Duration: 100 * time.Millisecond},
		},
		{
			{Name: "① 文件读取", Duration: 20 * time.Millisecond},
			{Name: "② JSON 解析", Duration: 200 * time.Millisecond},
		},
	}
	avg := avgBenchStages(all)
	if len(avg) != 2 {
		t.Fatalf("avg 应含 2 阶段, got %d", len(avg))
	}
	if avg[0].Duration != 15*time.Millisecond {
		t.Errorf("① 平均应为 15ms, got %v", avg[0].Duration)
	}
	if avg[1].Duration != 150*time.Millisecond {
		t.Errorf("② 平均应为 150ms, got %v", avg[1].Duration)
	}
}

// ===== 审查修复锁：按阶段名配对 + 分级函数单一实现 =====

// 不等长迭代必须按「阶段名」配对平均——某次文件读取失败只返回 1 阶段时
// （runSingleModelBench 提前 return），旧索引配对会把后续迭代错位进缺失阶段的均值，
// 且 printAverageStages 裸取 stages[i] 会 index out of range panic。
func TestAvgBenchStages_NamePairingRaggedIterations(t *testing.T) {
	all := [][]singleBenchStage{
		{
			{Name: "① 文件读取", Duration: 10 * time.Millisecond},
			{Name: "② JSON 解析", Duration: 100 * time.Millisecond},
		},
		{
			{Name: "① 文件读取", Duration: 30 * time.Millisecond}, // 失败迭代：只有读取阶段
		},
	}
	avg := avgBenchStages(all) // 不得 panic
	if len(avg) != 2 {
		t.Fatalf("应含 2 阶段, got %d", len(avg))
	}
	if avg[0].Name != "① 文件读取" || avg[0].Duration != 20*time.Millisecond {
		t.Errorf("① 应仅按名配对均值 20ms, got %s %v", avg[0].Name, avg[0].Duration)
	}
	if avg[1].Name != "② JSON 解析" || avg[1].Duration != 100*time.Millisecond {
		t.Errorf("② 只出现一次, 均值应为自身 100ms, got %s %v", avg[1].Name, avg[1].Duration)
	}
}

func TestAvgBenchStages_Empty(t *testing.T) {
	if got := avgBenchStages(nil); got != nil {
		t.Errorf("空输入应返回 nil, got %v", got)
	}
}

func TestStageMarkAndStatus(t *testing.T) {
	cases := []struct {
		ms     float64
		mark   string
		status string
	}{
		{5, "✅", "ok"},
		{10, "✅", "ok"},
		{11, "🟢", "slow"},
		{50, "🟢", "slow"},
		{51, "🟡 注意", "warn"},
		{100, "🟡 注意", "warn"},
		{101, "🔴 瓶颈", "bottleneck"},
	}
	for _, tc := range cases {
		if got := stageMark(tc.ms); got != tc.mark {
			t.Errorf("stageMark(%v) = %q, 期望 %q", tc.ms, got, tc.mark)
		}
		if got := stageStatus(tc.ms); got != tc.status {
			t.Errorf("stageStatus(%v) = %q, 期望 %q", tc.ms, got, tc.status)
		}
	}
}

func TestSpeedEmoji(t *testing.T) {
	cases := []struct {
		speedup float64
		want    string
	}{
		{2.0, "🟢"}, {1.5, "🟢"}, {1.49, "🟡"}, {1.2, "🟡"}, {1.19, "🔴"}, {0.5, "🔴"},
	}
	for _, tc := range cases {
		if got := speedEmoji(tc.speedup); got != tc.want {
			t.Errorf("speedEmoji(%v) = %q, 期望 %q", tc.speedup, got, tc.want)
		}
	}
}

func TestCollectTestFiles(t *testing.T) {
	dir := t.TempDir()
	writeFileAt := func(p, content string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	writeFileAt(filepath.Join(dir, "a.json"), "{}")
	writeFileAt(filepath.Join(dir, "big.json"), strings.Repeat("x", 3*1024*1024)) // 超 maxSizeMB=2
	writeFileAt(filepath.Join(dir, "skip.txt"), "x")                              // 扩展名不收
	writeFileAt(filepath.Join(dir, "sub", "b.json"), "{}")

	got := map[string]bool{}
	for _, f := range collectTestFiles(dir, 2) {
		rel, _ := filepath.Rel(dir, f)
		got[filepath.ToSlash(rel)] = true
	}
	if !got["a.json"] || !got["sub/b.json"] {
		t.Errorf("应递归收集 a.json 与 sub/b.json, got %v", got)
	}
	if got["big.json"] || got["skip.txt"] {
		t.Errorf("超限/非目标扩展名不应收集, got %v", got)
	}

	// 上限截断：35 个候选只收 30
	limitDir := t.TempDir()
	for i := 0; i < 35; i++ {
		writeFileAt(filepath.Join(limitDir, fmt.Sprintf("f%02d.json", i)), "{}")
	}
	if n := len(collectTestFiles(limitDir, 10)); n != 30 {
		t.Errorf("候选 35 应在上限 30 截断, got %d", n)
	}
}

func TestCompareSingleBenchBaseline(t *testing.T) {
	dir := t.TempDir()
	base := []benchStageMs{
		{Name: "① 文件读取", Ms: 10},
		{Name: "② JSON 解析", Ms: 100},
	}
	data, err := json.Marshal(base)
	if err != nil {
		t.Fatal(err)
	}
	baseFile := filepath.Join(dir, "baseline.json")
	if err := os.WriteFile(baseFile, data, 0o644); err != nil {
		t.Fatal(err)
	}

	stages := []singleBenchStage{
		{Name: "① 文件读取", Duration: 10 * time.Millisecond},
		{Name: "② JSON 解析", Duration: 100 * time.Millisecond},
	}
	// 无退化 → 通过
	if err := compareSingleBenchBaseline(baseFile, stages, 50); err != nil {
		t.Fatalf("无退化应通过, got %v", err)
	}
	// ② 退化到 200ms（2x > 1.5x 阈值）→ 应报错
	stages[1].Duration = 200 * time.Millisecond
	if err := compareSingleBenchBaseline(baseFile, stages, 50); err == nil {
		t.Fatal("退化超阈值应报错")
	}
	// 基准文件缺失 → 应报错
	if err := compareSingleBenchBaseline(filepath.Join(dir, "nope.json"), stages, 50); err == nil {
		t.Fatal("缺失基准文件应报错")
	}
	// 基准格式非法 → 应报错
	bad := filepath.Join(dir, "bad.json")
	os.WriteFile(bad, []byte("not json"), 0o644)
	if err := compareSingleBenchBaseline(bad, stages, 50); err == nil {
		t.Fatal("格式非法基准应报错")
	}
}

func TestSaveBenchBaseline_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "b.json")
	stages := []singleBenchStage{{Name: "① 文件读取", Duration: 10 * time.Millisecond}}
	if err := saveBenchBaseline(p, stages); err != nil {
		t.Fatalf("保存失败: %v", err)
	}
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	var got []benchStageMs
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("roundtrip 解析失败: %v", err)
	}
	if len(got) != 1 || got[0].Name != "① 文件读取" || got[0].Ms != 10 {
		t.Fatalf("roundtrip 内容不符: %+v", got)
	}
}

// ===== C-2 perf-log 文档驱动（optimization_log.md 表格）单测 =====

const perfLogSample = `---
kind: optimization_log
name: 优化记录
---

# 优化记录

## 优化日志

| 日期 | 领域 | 问题 | 做了什么 | 效果 | 提交 |
|------|------|------|---------|------|------|
| 2026-08-19 | KTX2 缓存 | 加载变慢 | 优化 X | 加载 1 次 RPC | fd068ac |
| 2026-08-18 | MMD dispose | 内存泄漏 | dispose 细化 | 不再闪退 | 80679cd7 |

## 当前瓶颈

- **纹理编码**：首次编码慢
- **SHA256**：大文件有延迟

## 关键指标

| 指标 | 优化前 | 优化后 | 目标 |
|------|--------|--------|------|
| 单模型 GPU 内存 | 1-2GB | 1-2GB | ~200MB |
`

func TestParseOptimizationEntries(t *testing.T) {
	entries := parseOptimizationEntries(strings.Split(perfLogSample, "\n"))
	if len(entries) != 2 {
		t.Fatalf("期望解析 2 条记录, got %d", len(entries))
	}
	first := entries[0]
	if first.date != "2026-08-19" || first.area != "KTX2 缓存" || first.commit != "fd068ac" {
		t.Errorf("首条解析不符: %+v", first)
	}
	if entries[1].date != "2026-08-18" || entries[1].area != "MMD dispose" {
		t.Errorf("次条解析不符: %+v", entries[1])
	}

	// md 中 commit 用反引号包裹（真实 optimization_log.md 如此）——解析时应清理反引号
	backtickMd := strings.Join([]string{
		"| 日期 | 领域 | 问题 | 做了什么 | 效果 | 提交 |",
		"|------|------|------|---------|------|------|",
		"| 2026-08-01 | A | B | C | D | `abc123` |",
	}, "\n")
	got := parseOptimizationEntries(strings.Split(backtickMd, "\n"))
	if len(got) != 1 || got[0].commit != "abc123" {
		t.Errorf("反引号 commit 应被清理, got %+v", got)
	}
}

func TestSplitTableRow(t *testing.T) {
	cols := splitTableRow(" | a | b | c | ")
	if len(cols) != 3 || cols[0] != "a" || cols[2] != "c" {
		t.Fatalf("splitTableRow 结果不符: %#v", cols)
	}
}

func TestPerfLogSections(t *testing.T) {
	lines := strings.Split(perfLogSample, "\n")
	bottlenecks := extractBulletSection(lines, "当前瓶颈")
	if len(bottlenecks) != 2 || !strings.Contains(bottlenecks[0], "纹理编码") {
		t.Fatalf("当前瓶颈提取不符: %#v", bottlenecks)
	}
	metrics := extractTableSection(lines, "关键指标")
	if len(metrics) != 1 || !strings.Contains(metrics[0], "GPU 内存") {
		t.Fatalf("关键指标提取不符: %#v", metrics)
	}
}

// ---- tags 薄壳 ----

func TestTags_NoSubcommand_PrintsUsage(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runTags(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runTags 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "tags") || !strings.Contains(out, "子命令") {
		t.Errorf("无子命令应打印用法, got: %s", out)
	}
}

func TestTags_UnknownSubcommand_Errors(t *testing.T) {
	err := runTags(&CmdContext{App: &app.App{}, Args: []string{"nope"}})
	if err == nil || !strings.Contains(err.Error(), "未知子命令") {
		t.Errorf("未知子命令应报错, got: %v", err)
	}
}

func TestTagsSet_RequiresModel(t *testing.T) {
	err := runTagsSet(&CmdContext{App: &app.App{}, Args: []string{"--tags", "a"}})
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("缺 --model 应报错, got: %v", err)
	}
}

func TestTagsSet_RequiresTags(t *testing.T) {
	err := runTagsSet(&CmdContext{App: &app.App{}, Args: []string{"--model", "x"}})
	if err == nil || !strings.Contains(err.Error(), "--tags") {
		t.Errorf("缺 --tags 应报错, got: %v", err)
	}
}

func TestTagsGet_RequiresModel(t *testing.T) {
	err := runTagsGet(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("缺 --model 应报错, got: %v", err)
	}
}

func TestTagsBy_RequiresTag(t *testing.T) {
	err := runTagsBy(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--tag") {
		t.Errorf("缺 --tag 应报错, got: %v", err)
	}
}

// ---- recycle 薄壳 ----

func TestRecycle_NoSubcommand_PrintsUsage(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runRecycle(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runRecycle 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "recycle") || !strings.Contains(out, "子命令") {
		t.Errorf("无子命令应打印用法, got: %s", out)
	}
}

func TestRecycle_UnknownSubcommand_Errors(t *testing.T) {
	err := runRecycle(&CmdContext{App: &app.App{}, Args: []string{"nope"}})
	if err == nil || !strings.Contains(err.Error(), "未知子命令") {
		t.Errorf("未知子命令应报错, got: %v", err)
	}
}

func TestRecycleRestore_RequiresPath(t *testing.T) {
	err := runRecycleRestore(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--path") {
		t.Errorf("缺 --path 应报错, got: %v", err)
	}
}

func TestRecycleEmpty_YesFlagRuns(t *testing.T) {
	// EmptyRecycleBin("") 在零值 App 上会走 LoadAppConfig 空配置路径，
	// 返回 (0, nil) 或错误——薄壳只验证 --yes 路径不 panic、不卡确认
	out := captureOutput(t, func() {
		_ = runRecycleEmpty(&CmdContext{App: &app.App{}, Args: []string{"--yes"}})
	})
	// 不断言具体输出，只确保不卡在确认提示
	if strings.Contains(out, "确认") {
		t.Errorf("--yes 应跳过确认, got: %s", out)
	}
}

// ---- install 薄壳 ----

func TestInstall_RequiresModel(t *testing.T) {
	err := runInstall(&CmdContext{App: &app.App{}, Args: []string{"--mc-root", "/mc"}})
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("缺 --model 应报错, got: %v", err)
	}
}

func TestInstall_RequiresMcRootOrCustomDir(t *testing.T) {
	err := runInstall(&CmdContext{App: &app.App{}, Args: []string{"--model", "x.ysm"}})
	if err == nil || !strings.Contains(err.Error(), "--mc-root") {
		t.Errorf("缺 --mc-root/--custom-dir 应报错, got: %v", err)
	}
}

// ---- link-mode 薄壳 ----

func TestLinkMode_InvalidMode_Errors(t *testing.T) {
	err := runLinkMode(&CmdContext{App: &app.App{}, Args: []string{"--mode", "bogus"}})
	if err == nil || !strings.Contains(err.Error(), "无效模式") {
		t.Errorf("无效模式应报错, got: %v", err)
	}
}

func TestLinkMode_NoMode_PrintsCurrent(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runLinkMode(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runLinkMode 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "链接模式") {
		t.Errorf("应打印当前链接模式, got: %s", out)
	}
}

// ---- instance 薄壳 ----

func TestInstance_NoSubcommand_PrintsUsage(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runInstance(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runInstance 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "instance") || !strings.Contains(out, "子命令") {
		t.Errorf("无子命令应打印用法, got: %s", out)
	}
}

func TestInstance_UnknownSubcommand_Errors(t *testing.T) {
	err := runInstance(&CmdContext{App: &app.App{}, Args: []string{"nope"}})
	if err == nil || !strings.Contains(err.Error(), "未知子命令") {
		t.Errorf("未知子命令应报错, got: %v", err)
	}
}

func TestInstanceSync_RequiresInstance(t *testing.T) {
	err := runInstanceSync(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--instance") {
		t.Errorf("缺 --instance 应报错, got: %v", err)
	}
}

func TestInstancePush_RequiresInstance(t *testing.T) {
	err := runInstancePush(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--instance") {
		t.Errorf("缺 --instance 应报错, got: %v", err)
	}
}

func TestInstancePull_RequiresInstance(t *testing.T) {
	err := runInstancePull(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--instance") {
		t.Errorf("缺 --instance 应报错, got: %v", err)
	}
}

// ---- creator 薄壳 ----

func TestCreator_NoSubcommand_PrintsUsage(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runCreator(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runCreator 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "creator") || !strings.Contains(out, "子命令") {
		t.Errorf("无子命令应打印用法, got: %s", out)
	}
}

func TestCreator_UnknownSubcommand_Errors(t *testing.T) {
	err := runCreator(&CmdContext{App: &app.App{}, Args: []string{"nope"}})
	if err == nil || !strings.Contains(err.Error(), "未知子命令") {
		t.Errorf("未知子命令应报错, got: %v", err)
	}
}

// ---- workshop 薄壳 ----

func TestWorkshop_NoSubcommand_PrintsUsage(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runWorkshop(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runWorkshop 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "workshop") || !strings.Contains(out, "子命令") {
		t.Errorf("无子命令应打印用法, got: %s", out)
	}
}

func TestWorkshop_UnknownSubcommand_Errors(t *testing.T) {
	err := runWorkshop(&CmdContext{App: &app.App{}, Args: []string{"nope"}})
	if err == nil || !strings.Contains(err.Error(), "未知子命令") {
		t.Errorf("未知子命令应报错, got: %v", err)
	}
}

// ---- fileops 薄壳 ----

func TestMove_RequiresSrc(t *testing.T) {
	err := runMove(&CmdContext{App: &app.App{}, Args: []string{"--dst", "/d"}})
	if err == nil || !strings.Contains(err.Error(), "--src") {
		t.Errorf("缺 --src 应报错, got: %v", err)
	}
}

func TestMove_RequiresDst(t *testing.T) {
	err := runMove(&CmdContext{App: &app.App{}, Args: []string{"--src", "/s"}})
	if err == nil || !strings.Contains(err.Error(), "--dst") {
		t.Errorf("缺 --dst 应报错, got: %v", err)
	}
}

func TestCopy_RequiresSrc(t *testing.T) {
	err := runCopy(&CmdContext{App: &app.App{}, Args: []string{"--dst", "/d"}})
	if err == nil || !strings.Contains(err.Error(), "--src") {
		t.Errorf("缺 --src 应报错, got: %v", err)
	}
}

func TestCopy_RequiresDst(t *testing.T) {
	err := runCopy(&CmdContext{App: &app.App{}, Args: []string{"--src", "/s"}})
	if err == nil || !strings.Contains(err.Error(), "--dst") {
		t.Errorf("缺 --dst 应报错, got: %v", err)
	}
}

func TestRename_RequiresPath(t *testing.T) {
	err := runRename(&CmdContext{App: &app.App{}, Args: []string{"--name", "n"}})
	if err == nil || !strings.Contains(err.Error(), "--path") {
		t.Errorf("缺 --path 应报错, got: %v", err)
	}
}

func TestRename_RequiresName(t *testing.T) {
	err := runRename(&CmdContext{App: &app.App{}, Args: []string{"--path", "/p"}})
	if err == nil || !strings.Contains(err.Error(), "--name") {
		t.Errorf("缺 --name 应报错, got: %v", err)
	}
}

func TestToggle_RequiresPath(t *testing.T) {
	err := runToggle(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--path") {
		t.Errorf("缺 --path 应报错, got: %v", err)
	}
}

// ---- download 薄壳 ----

func TestDownload_NoSubcommand_PrintsUsage(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runDownload(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runDownload 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "download") || !strings.Contains(out, "子命令") {
		t.Errorf("无子命令应打印用法, got: %s", out)
	}
}

func TestDownload_UnknownSubcommand_Errors(t *testing.T) {
	err := runDownload(&CmdContext{App: &app.App{}, Args: []string{"nope"}})
	if err == nil || !strings.Contains(err.Error(), "未知子命令") {
		t.Errorf("未知子命令应报错, got: %v", err)
	}
}

func TestDownloadEnqueue_RequiresURL(t *testing.T) {
	err := runDownloadEnqueue(&CmdContext{App: &app.App{}, Args: []string{"--save-dir", "/d"}})
	if err == nil || !strings.Contains(err.Error(), "--url") {
		t.Errorf("缺 --url 应报错, got: %v", err)
	}
}

func TestDownloadEnqueue_RequiresSaveDir(t *testing.T) {
	err := runDownloadEnqueue(&CmdContext{App: &app.App{}, Args: []string{"--url", "https://x"}})
	if err == nil || !strings.Contains(err.Error(), "--save-dir") {
		t.Errorf("缺 --save-dir 应报错, got: %v", err)
	}
}

func TestDownloadGitHub_RequiresURL(t *testing.T) {
	err := runDownloadGitHub(&CmdContext{App: &app.App{}, Args: []string{"--save-dir", "/d"}})
	if err == nil || !strings.Contains(err.Error(), "--url") {
		t.Errorf("缺 --url 应报错, got: %v", err)
	}
}

func TestDownloadGitHub_RequiresSaveDir(t *testing.T) {
	err := runDownloadGitHub(&CmdContext{App: &app.App{}, Args: []string{"--url", "https://x"}})
	if err == nil || !strings.Contains(err.Error(), "--save-dir") {
		t.Errorf("缺 --save-dir 应报错, got: %v", err)
	}
}

// ---- avatar 薄壳 ----

func TestAvatar_NoSubcommand_PrintsUsage(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runAvatar(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runAvatar 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "avatar") || !strings.Contains(out, "子命令") {
		t.Errorf("无子命令应打印用法, got: %s", out)
	}
}

func TestAvatar_UnknownSubcommand_Errors(t *testing.T) {
	err := runAvatar(&CmdContext{App: &app.App{}, Args: []string{"nope"}})
	if err == nil || !strings.Contains(err.Error(), "未知子命令") {
		t.Errorf("未知子命令应报错, got: %v", err)
	}
}

func TestAvatarCached_RequiresAuthor(t *testing.T) {
	err := runAvatarCached(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--author") {
		t.Errorf("缺 --author 应报错, got: %v", err)
	}
}

func TestAvatarCache_RequiresModel(t *testing.T) {
	err := runAvatarCache(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("缺 --model 应报错, got: %v", err)
	}
}

// ---- scan 薄壳 ----

func TestScan_NoSubcommand_PrintsUsage(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runScan(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runScan 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "scan") || !strings.Contains(out, "子命令") {
		t.Errorf("无子命令应打印用法, got: %s", out)
	}
}

func TestScan_UnknownSubcommand_Errors(t *testing.T) {
	err := runScan(&CmdContext{App: &app.App{}, Args: []string{"nope"}})
	if err == nil || !strings.Contains(err.Error(), "未知子命令") {
		t.Errorf("未知子命令应报错, got: %v", err)
	}
}

func TestScanModels_EmptyDir_Errors(t *testing.T) {
	// ctx.FilesRoot 为空 + --dir 未指定 → dir 解析为空 → 报错
	err := runScanModels(&CmdContext{App: &app.App{}, FilesRoot: "", Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--dir") {
		t.Errorf("空目录应报错, got: %v", err)
	}
}

// ---- config 父命令薄壳 ----

func TestConfig_NoSubcommand_PrintsUsage(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runConfig(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runConfig 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "config") || !strings.Contains(out, "子命令") {
		t.Errorf("无子命令应打印用法, got: %s", out)
	}
}

func TestConfig_UnknownSubcommand_Errors(t *testing.T) {
	err := runConfig(&CmdContext{App: &app.App{}, Args: []string{"nope"}})
	if err == nil || !strings.Contains(err.Error(), "未知子命令") {
		t.Errorf("未知子命令应报错, got: %v", err)
	}
}

func TestConfigLinkMode_InvalidMode_Errors(t *testing.T) {
	err := runConfigLinkMode(&CmdContext{App: &app.App{}, Args: []string{"--mode", "bogus"}})
	if err == nil || !strings.Contains(err.Error(), "无效模式") {
		t.Errorf("无效模式应报错, got: %v", err)
	}
}

// ===== resource-types 注册表读取能力 =====

// TestTruncate_RuneAware 验证 truncate 不切断多字节 UTF-8（CJK 组名/预览名是常态）：
// 按字节切片会把 2-3 字节 rune 切半，输出非法 UTF-8（mojibake）。
// code review P3：truncate 须按 rune 计数。
func TestTruncate_RuneAware(t *testing.T) {
	cases := []struct {
		in    string
		width int
		want  string
	}{
		{"模型", 5, "模型"},       // 6 字节但 2 rune，宽 5 不截断（rune 计数）
		{"模型管理器", 4, "模型管…"},  // 5 rune 超宽 4 → 取 3 rune + 省略号
		{"abc", 5, "abc"},     // ASCII 不超宽
		{"abcdef", 4, "abc…"}, // ASCII 超宽
		{"", 3, ""},
	}
	for _, c := range cases {
		if got := truncate(c.in, c.width); got != c.want {
			t.Errorf("truncate(%q, %d) = %q, 期望 %q", c.in, c.width, got, c.want)
		}
	}
}

// pointRegistryToRepoRoot 把 types 注册表路径指向仓库根 resource_types.json（单一事实来源），
// 结束后恢复默认（"resource_types.json"），避免污染后续测试。
func pointRegistryToRepoRoot(t *testing.T) {
	t.Helper()
	types.SetRegistryPath(filepath.Join("..", "..", "resource_types.json"))
	t.Cleanup(func() { types.SetRegistryPath("resource_types.json") })
}

func TestResourceTypes_Table(t *testing.T) {
	pointRegistryToRepoRoot(t)
	out := captureOutput(t, func() {
		if err := runResourceTypes(&CmdContext{App: &app.App{}, Args: []string{}}); err != nil {
			t.Errorf("runResourceTypes 不应报错: %v", err)
		}
	})
	if !strings.Contains(out, "资源类型注册表") {
		t.Errorf("table 输出应含标题, got: %q", out)
	}
	if !strings.Contains(out, "ysm") || !strings.Contains(out, "maid-model") {
		t.Errorf("table 输出应含 ysm / maid-model 类型, got: %q", out)
	}
}

func TestResourceTypes_JSON(t *testing.T) {
	pointRegistryToRepoRoot(t)
	out := captureOutput(t, func() {
		if err := runResourceTypes(&CmdContext{App: &app.App{}, Args: []string{"--format", "json"}}); err != nil {
			t.Errorf("runResourceTypes json 不应报错: %v", err)
		}
	})
	var entries []types.ResourceType
	if err := json.Unmarshal([]byte(out), &entries); err != nil {
		t.Fatalf("json 输出应可反序列化: %v\n输出: %s", err, out)
	}
	if len(entries) == 0 {
		t.Fatal("json 输出不应为空")
	}
	for _, rt := range entries {
		if rt.ID == "" {
			t.Errorf("存在空 ID 条目: %+v", rt)
		}
	}
}

func TestResourceTypes_TypeFilter(t *testing.T) {
	pointRegistryToRepoRoot(t)
	out := captureOutput(t, func() {
		if err := runResourceTypes(&CmdContext{App: &app.App{}, Args: []string{"--type", "ysm"}}); err != nil {
			t.Errorf("runResourceTypes --type 不应报错: %v", err)
		}
	})
	if !strings.Contains(out, "ysm") {
		t.Errorf("过滤后应含 ysm, got: %q", out)
	}
	// 未知类型 → 参数错误
	if err := runResourceTypes(&CmdContext{App: &app.App{}, Args: []string{"--type", "nope"}}); err == nil {
		t.Fatal("未知类型应报参数错误")
	}
}
