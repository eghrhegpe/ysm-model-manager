package fsutil

// dirsize_test.go — DirSize 单测（ADR-262 D3「全库前 N 大」目标集的体量口径基础）。
// 立因：排名要用「模型占用」而不是「入口文件大小」——目录式模型的入口是 115B 的 ysm.json 清单，
// 按清单大小排会把最大的解包模型排到最后（scanner.ScanEntries 的 ModelEntry.Size 正是清单大小）。

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path string, size int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, size), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDirSize_RecursiveSum(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "ysm.json"), 115)
	writeFile(t, filepath.Join(dir, "models", "main.json"), 2000)
	writeFile(t, filepath.Join(dir, "textures", "skin.png"), 3000)

	got, err := DirSize(dir)
	if err != nil {
		t.Fatalf("DirSize 不应报错: %v", err)
	}
	if got != 115+2000+3000 {
		t.Errorf("应递归合计全部文件字节, got %d", got)
	}
}

func TestDirSize_FileAndMissing(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	file := filepath.Join(dir, "a.ysm")
	writeFile(t, file, 1234)

	// 传单文件：返回该文件大小（调用方不必先判类型）
	if got, err := DirSize(file); err != nil || got != 1234 {
		t.Errorf("单文件应返回自身大小 1234, got %d err=%v", got, err)
	}
	// 不存在：报错且 0（不得静默当作 0 字节模型参与排序——调用方据此决定是跳过还是如实标注）
	got, err := DirSize(filepath.Join(dir, "nope"))
	if err == nil {
		t.Error("不存在的路径应报错（静默 0 会让最大的模型排到最后）")
	}
	if got != 0 {
		t.Errorf("失败时应返回 0, got %d", got)
	}
}

func TestDirSize_EmptyDir(t *testing.T) {
	t.Parallel()
	got, err := DirSize(t.TempDir())
	if err != nil || got != 0 {
		t.Errorf("空目录应为 0 且不报错, got %d err=%v", got, err)
	}
}
