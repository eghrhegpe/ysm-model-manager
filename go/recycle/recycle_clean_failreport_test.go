package recycle

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

const perm = 0o644

// setupRecycleDirs 创建 (recycleRoot, dir, filesRoot) 三件套，dir 放在 recycleRoot 解析树内。
// 用于验证「移入回收站」分支的确定性触发。
func setupRecycleDirs(t *testing.T) (recycleRoot, dir, filesRoot string) {
	t.Helper()
	base := t.TempDir()
	recycleRoot = filepath.Join(base, "recycle")
	dir = filepath.Join(recycleRoot, "inst") // base/recycle/inst ⊂ base/recycle
	filesRoot = filepath.Join(base, "repo")
	for _, root := range []string{recycleRoot, dir, filesRoot} {
		if err := os.MkdirAll(root, 0755); err != nil {
			t.Fatal(err)
		}
	}
	return
}

// putDup 在 dir/subdir/name.bin 和 filesRoot/name.bin 各放一个相同内容的副本。
func putDup(t *testing.T, dir, filesRoot, subdir, name, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, subdir), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, subdir, name+".bin"), []byte(content), perm); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filesRoot, name+".bin"), []byte(content), perm); err != nil {
		t.Fatal(err)
	}
}

// blockRecycleLanding 在 recycleRoot/.recycle/<subdir> 处放一个同名普通文件，
// 使 os.MkdirAll(落点目录) 因路径组件已被文件占用而必然返回 "not a directory"。
func blockRecycleLanding(t *testing.T, recycleRoot, subdir string) {
	t.Helper()
	blockParent := filepath.Join(recycleRoot, ".recycle", subdir)
	if err := os.MkdirAll(blockParent, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(blockParent, "a"), []byte("block"), perm); err != nil {
		t.Fatal(err)
	}
}

// collectFailures 返回一个 logger 回调，收集 status=="failed" 的条目。
func collectFailures(t *testing.T) (logger func(name, src, dst string, size int64, status, msg string), failures *[]string) {
	t.Helper()
	var f []string
	logger = func(name, src, dst string, size int64, status, msg string) {
		if status == "failed" {
			f = append(f, src+": "+msg)
		}
	}
	return logger, &f
}

// TestRemoveRepoDuplicates_NilLoggerBackwardCompat logger 允许 nil（向后兼容），
// 正常清理路径不 panic 且计数正确。
func TestRemoveRepoDuplicates_NilLoggerBackwardCompat(t *testing.T) {
	t.Parallel()
	_, dir, filesRoot := setupRecycleDirs(t)
	if err := os.WriteFile(filepath.Join(dir, "a.bin"), []byte("c"), perm); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filesRoot, "a.bin"), []byte("c"), perm); err != nil {
		t.Fatal(err)
	}
	removed := RemoveRepoDuplicates(dir, filesRoot, "", nil)
	testutil.Equal(t, removed, 1)
}

// TestRemoveRepoDuplicates_FailureReported 验证清理失败可见性契约：
// Move 失败必须经 logger 上报 failed 回调，不得裸 continue 吞错。
//
// 确定性触发（不依赖 OS 文件共享语义）：把待清理目录放进 recycleRoot 解析树内，
// 使 RemoveRepoDuplicates 命中「移入回收站（Move）」分支（recycle_clean.go:92 的
// IsInsideResolved 判定为真）；预先在 a.bin 的回收站落点目录处放一个同名普通文件，
// Move 内部 os.MkdirAll(filepath.Dir(dst)) 因路径组件已被文件占用而必然返回
// "not a directory" 错误 → 确定性失败。b.bin 落点未被占用 → 正常清理。
//
// 与旧版（FILE_SHARE_READ 锁源文件）对比：旧版依赖 DeleteFileW 在共享锁下的行为，
// Windows 各环境不一致（本地绿 / CI 红）；本版零锁、跨平台、结果确定，且真正覆盖
// 注释所述「移入回收站」路径，对齐 DeduplicateEntries 口径。
func TestRemoveRepoDuplicates_FailureReported(t *testing.T) {
	t.Parallel()
	recycleRoot, dir, filesRoot := setupRecycleDirs(t)
	content := []byte("same-content")
	// 在 inst/ 下分两个子目录放 a.bin / b.bin，使二者回收站落点目录不同，
	// 从而可选择性地只阻塞 a.bin 的落点（b.bin 仍正常清理），验证「失败上报 + 成功计数」双路径。
	putDup(t, dir, filesRoot, "a", "a", string(content))
	putDup(t, dir, filesRoot, "b", "b", string(content))
	// 阻塞 a.bin 的回收站落点目录：base/recycle/.recycle/inst/a
	blockRecycleLanding(t, recycleRoot, "inst")

	logger, failures := collectFailures(t)
	removed := RemoveRepoDuplicates(dir, filesRoot, recycleRoot, logger)

	testutil.Equal(t, removed, 1, "仅未阻塞的 b.bin 应清理成功")
	testutil.Equal(t, len(*failures), 1, "a.bin 的 Move 失败应上报 1 条 failed 回调")
	testutil.FileExists(t, filepath.Join(dir, "a", "a.bin"), "失败的文件应保持原位")
}
