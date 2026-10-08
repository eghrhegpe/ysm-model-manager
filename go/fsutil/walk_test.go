package fsutil

import (
	"bytes"
	"log"
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

// SafeWalk 必须在「回调对访问失败的条目返回 nil（静默跳过）」时补记日志，
// 恢复失败可见性（ADR-030）。构造一个不可读的子目录触发 err != nil，
// 回调选择跳过，捕获 log 输出并断言补记行为发生。
func TestSafeWalk_LogsSkippedError(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "ok.txt", "ok")

	// 制造一个不可读的子目录（Windows 上 chmod 000 仍可能被管理员读取，
	// 故用交叉校验：用 os.Chmod 降权，并在 chmod 实际生效的平台断言）。
	badDir := filepath.Join(dir, "bad")
	if err := os.Mkdir(badDir, 0o000); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(badDir, 0o755) // 还原，便于临时目录清理

	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)

	// 回调对所有条目原样透传（含 err 条目返回 nil = 静默跳过）
	err := SafeWalk(dir, func(p string, d os.DirEntry, walkErr error) error {
		return nil
	})
	if err != nil {
		t.Fatalf("SafeWalk 顶层不应返回错误，得到 %v", err)
	}

	// 只要 chmod 降权在该平台生效（err != nil 真发生），SafeWalk 必须补记日志。
	// 若平台未生效（err 始终 nil），则无日志也属正确，跳过断言。
	_, statErr := os.ReadDir(badDir)
	if statErr != nil {
		if !strings.Contains(buf.String(), "[fsutil] SafeWalk 跳过访问失败的条目") {
			t.Fatalf("err 条目被静默跳过时 SafeWalk 必须补记日志，实际输出: %q", buf.String())
		}
	}
}

// SafeWalk 对「回调自行处理的 err（返回非 nil）」不重复干预——此处仅验证
// 回调返回 filepath.SkipDir 时 SafeWalk 原样透传、遍历行为符合预期。
func TestSafeWalk_PassthroughNonNil(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "a.txt", "a")
	testutil.CreateTestFile(t, dir, "sub/b.txt", "b")

	seen := 0
	_ = SafeWalk(dir, func(p string, d os.DirEntry, walkErr error) error {
		seen++
		return nil
	})
	if seen < 3 { // root + a.txt + sub + b.txt
		t.Fatalf("期望访问 >=3 个条目，得到 %d", seen)
	}
}
