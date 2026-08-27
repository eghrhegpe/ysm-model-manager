//go:build windows

// ===== RemoveRepoDuplicates 失败可见性契约（Windows）=====
// Move/Remove 失败必须经 logger 上报 failed 回调，不得裸 continue 吞错。
// 以独占方式（share=0）打开源文件使 Rename 报 ERROR_SHARING_VIOLATION，
// 确定性触发移动失败。非 Windows 平台无共享锁机制，跳过。
package recycle

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func lockFileExclusive(t *testing.T, path string) {
	t.Helper()
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		t.Skipf("UTF16 转换失败: %v", err)
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_READ, 0, nil,
		syscall.OPEN_EXISTING, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Skipf("独占打开文件失败: %v", err)
	}
	// 探针：锁应令 Rename 失败，否则环境不执行共享锁语义
	tmp := path + ".probe"
	if rerr := os.Rename(path, tmp); rerr == nil {
		_ = os.Rename(tmp, path)
		syscall.CloseHandle(h)
		t.Skip("环境未执行共享锁（Rename 仍成功），跳过")
	}
	t.Cleanup(func() { syscall.CloseHandle(h) })
}

func TestRemoveRepoDuplicates_FailureReported(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "inst")
	filesRoot := filepath.Join(base, "repo")
	recycleRoot := filepath.Join(base, "recycle")
	for _, root := range []string{dir, filesRoot} {
		if err := os.MkdirAll(root, 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(recycleRoot, 0755); err != nil {
		t.Fatal(err)
	}
	content := []byte("same-content")
	for _, name := range []string{"a.bin", "b.bin"} {
		if err := os.WriteFile(filepath.Join(dir, name), content, 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(filesRoot, name), content, 0644); err != nil {
			t.Fatal(err)
		}
	}
	// 锁定一个源文件 → 其 Move 必败；另一个正常清理
	lockFileExclusive(t, filepath.Join(dir, "a.bin"))

	var failures []string
	logger := func(name, src, dst string, size int64, status, msg string) {
		if status == "failed" {
			failures = append(failures, src+": "+msg)
		}
	}

	removed := RemoveRepoDuplicates(dir, filesRoot, recycleRoot, logger)
	if removed != 1 {
		t.Fatalf("仅未锁定的 b.bin 应清理成功, got %d", removed)
	}
	if len(failures) != 1 {
		t.Fatalf("a.bin 的移动失败应上报 1 条 failed 回调, got %d 条: %v", len(failures), failures)
	}
	if _, err := os.Stat(filepath.Join(dir, "a.bin")); err != nil {
		t.Fatalf("失败的文件应保持原位: %v", err)
	}
}
