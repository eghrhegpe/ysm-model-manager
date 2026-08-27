package recycle

import (
	"os"
	"path/filepath"
	"testing"
)

// TestRemoveRepoDuplicates_NilLoggerBackwardCompat logger 允许 nil（向后兼容），
// 正常清理路径不 panic 且计数正确。
func TestRemoveRepoDuplicates_NilLoggerBackwardCompat(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "inst")
	filesRoot := filepath.Join(base, "repo")
	for _, root := range []string{dir, filesRoot} {
		if err := os.MkdirAll(root, 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "a.bin"), []byte("c"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filesRoot, "a.bin"), []byte("c"), 0644); err != nil {
		t.Fatal(err)
	}
	removed := RemoveRepoDuplicates(dir, filesRoot, "", nil)
	if removed != 1 {
		t.Fatalf("expected 1 removed, got %d", removed)
	}
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
	base := t.TempDir()
	// recycleRoot 必须是真实目录；dir 放进其解析树内 → 走 Move 分支而非 os.Remove 分支
	recycleRoot := filepath.Join(base, "recycle")
	dir := filepath.Join(recycleRoot, "inst") // base/recycle/inst ⊂ base/recycle
	filesRoot := filepath.Join(base, "repo")
	for _, root := range []string{recycleRoot, dir, filesRoot} {
		if err := os.MkdirAll(root, 0755); err != nil {
			t.Fatal(err)
		}
	}
	content := []byte("same-content")
	// 在 inst/ 下分两个子目录放 a.bin / b.bin，使二者回收站落点目录不同，
	// 从而可选择性地只阻塞 a.bin 的落点（b.bin 仍正常清理），验证「失败上报 + 成功计数」双路径。
	for _, name := range []string{"a", "b"} {
		if err := os.MkdirAll(filepath.Join(dir, name), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name, name+".bin"), content, 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(filesRoot, name+".bin"), content, 0644); err != nil {
			t.Fatal(err)
		}
	}

	// 阻塞 a.bin 的回收站落点目录：base/recycle/.recycle/inst/a
	// 先建父目录，再在其中写一个同名普通文件，使后续 os.MkdirAll(.../inst/a) 必败。
	// a.bin 的 dst = base/recycle/.recycle/inst/a/a.bin → Dir(dst) = .../inst/a（已被文件占用）。
	// b.bin 的 dst = base/recycle/.recycle/inst/b/b.bin → Dir(dst) = .../inst/b（未被占用）。
	blockParent := filepath.Join(recycleRoot, ".recycle", "inst")
	if err := os.MkdirAll(blockParent, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(blockParent, "a"), []byte("block"), 0644); err != nil {
		t.Fatal(err)
	}

	var failures []string
	logger := func(name, src, dst string, size int64, status, msg string) {
		if status == "failed" {
			failures = append(failures, src+": "+msg)
		}
	}

	removed := RemoveRepoDuplicates(dir, filesRoot, recycleRoot, logger)
	if removed != 1 {
		t.Fatalf("仅未阻塞的 b.bin 应清理成功, got %d", removed)
	}
	if len(failures) != 1 {
		t.Fatalf("a.bin 的 Move 失败应上报 1 条 failed 回调, got %d 条: %v", len(failures), failures)
	}
	if _, err := os.Stat(filepath.Join(dir, "a", "a.bin")); err != nil {
		t.Fatalf("失败的文件应保持原位: %v", err)
	}
}
