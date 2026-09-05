package fsutil

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

func TestWalkAllFiles(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "a.txt", "a")
	testutil.CreateTestFile(t, dir, "sub/b.txt", "b")
	testutil.CreateTestFile(t, dir, "sub/deep/c.txt", "c")

	files := WalkAllFiles(dir, true)
	if len(files) != 3 {
		t.Fatalf("期望 3 个文件，得到 %d", len(files))
	}
}

func TestWalkAllFiles_SkipRecycle(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "keep.txt", "keep")
	testutil.CreateTestFile(t, dir, ".recycle/gone.txt", "gone")

	files := WalkAllFiles(dir, true)
	if len(files) != 1 {
		t.Fatalf("skipRecycle=true 时应只有 1 个文件，得到 %d: %v", len(files), files)
	}

	files2 := WalkAllFiles(dir, false)
	if len(files2) != 2 {
		t.Fatalf("skipRecycle=false 时应返回 2 个文件，得到 %d", len(files2))
	}
}

func TestWalkAllFiles_NonExistent(t *testing.T) {
	files := WalkAllFiles(filepath.Join(t.TempDir(), "no_such"), true)
	if len(files) != 0 {
		t.Fatalf("不存在的目录应返回 0 个文件，得到 %d", len(files))
	}
}

func TestWalkAllFiles_EmptyDir(t *testing.T) {
	if files := WalkAllFiles(t.TempDir(), true); len(files) != 0 {
		t.Fatalf("空目录应返回 0 个文件，得到 %d", len(files))
	}
}

func TestCountFiles(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "a.txt", "a")
	testutil.CreateTestFile(t, dir, "b.txt", "b")

	if n := CountFiles(dir, true); n != 2 {
		t.Errorf("期望 2 个文件，得到 %d", n)
	}
}

// CountFiles 的 skipRecycle 口径必须与 WalkAllFiles 一致（流式计数不物化整树）。
func TestCountFiles_SkipRecycle(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "keep.txt", "keep")
	testutil.CreateTestFile(t, dir, ".recycle/gone.txt", "gone")

	if n := CountFiles(dir, true); n != 1 {
		t.Errorf("skipRecycle=true 期望 1 个文件，得到 %d", n)
	}
	if n := CountFiles(dir, false); n != 2 {
		t.Errorf("skipRecycle=false 期望 2 个文件，得到 %d", n)
	}
}

func TestWalkAllDirs(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "a", "b", "c"), 0755)

	dirs := WalkAllDirs(dir, true)
	// 应有 a/b/c, a/b, a
	if len(dirs) != 3 {
		t.Fatalf("期望 3 个子目录，得到 %d: %v", len(dirs), dirs)
	}
	// 后序：最深在前
	expected := []string{"a/b/c", "a/b", "a"}
	for i, d := range expected {
		rel, _ := filepath.Rel(dir, dirs[i])
		rel = filepath.ToSlash(rel)
		if rel != d {
			t.Errorf("索引 %d：期望 %s，得到 %s", i, d, rel)
		}
	}
}

func TestWalkAllDirs_SkipRecycleToggle(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "a", ".recycle", "inner"), 0755)
	os.MkdirAll(filepath.Join(dir, "keep"), 0755)

	dirs := WalkAllDirs(dir, true)
	if len(dirs) != 2 { // a, keep —— .recycle 整棵子树被跳过
		t.Fatalf("skipRecycle=true 期望 2 个子目录，得到 %d: %v", len(dirs), dirs)
	}
	for _, d := range dirs {
		rel, _ := filepath.Rel(dir, d)
		if strings.Contains(rel, ".recycle") {
			t.Fatalf("skipRecycle=true 不应包含 .recycle 子树: %s", rel)
		}
	}

	dirs2 := WalkAllDirs(dir, false)
	if len(dirs2) != 4 { // a/.recycle/inner, a/.recycle, a, keep
		t.Fatalf("skipRecycle=false 期望 4 个子目录，得到 %d: %v", len(dirs2), dirs2)
	}
}

func TestCleanEmptyDirs(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "a", "b", "c")
	os.MkdirAll(sub, 0755)

	n := CleanEmptyDirs(dir, true)
	if n != 3 {
		t.Fatalf("期望删除 3 个空目录，得到 %d", n)
	}
	// 检查已删除
	if _, err := os.Stat(sub); !os.IsNotExist(err) {
		t.Error("最深目录应已被删除")
	}
}

func TestCleanEmptyDirs_NonEmpty(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "a", "b"), 0755)
	testutil.CreateTestFile(t, dir, "a/b/keep.txt", "keep")

	n := CleanEmptyDirs(dir, true)
	if n != 0 {
		t.Fatalf("非空目录不应被删除，得到 %d", n)
	}
}

// 空 .recycle 目录在 skipRecycle=true 时必须被保留（回收站目录不参与清理）。
func TestCleanEmptyDirs_KeepRecycle(t *testing.T) {
	dir := t.TempDir()
	recycle := filepath.Join(dir, ".recycle")
	os.MkdirAll(recycle, 0755)

	if n := CleanEmptyDirs(dir, true); n != 0 {
		t.Fatalf("skipRecycle=true 不应删除 .recycle，得到 %d", n)
	}
	if _, err := os.Stat(recycle); err != nil {
		t.Fatalf(".recycle 应被保留: %v", err)
	}
}

// 不存在的目录：幂等返回 0，不 panic（对齐 dedup 侧 CleanEmptyDirs 幂等语义）。
func TestCleanEmptyDirs_NonExistent(t *testing.T) {
	if n := CleanEmptyDirs(filepath.Join(t.TempDir(), "no_such"), true); n != 0 {
		t.Fatalf("不存在的目录应返回 0，得到 %d", n)
	}
}

// ====== IsResourcePackFolder（收敛自 sync/instance 两包各自重复的三件套） ======

func TestIsResourcePackFolder_Yes(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "pack.mcmeta"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if !IsResourcePackFolder(dir) {
		t.Error("dir with pack.mcmeta should be a resource pack folder")
	}
}

func TestIsResourcePackFolder_No(t *testing.T) {
	dir := t.TempDir()
	if IsResourcePackFolder(dir) {
		t.Error("dir without pack.mcmeta should NOT be a resource pack folder")
	}
}

func TestIsResourcePackFolder_NonExistent(t *testing.T) {
	if IsResourcePackFolder("/nonexistent/path") {
		t.Error("non-existent dir should NOT be a resource pack folder")
	}
}
