//go:build windows

// ===== SyncToggleStatus 共享锁重试契约（Windows）=====
// 目标文件被独占打开（share=0）时 os.Rename 报 ERROR_SHARING_VIOLATION：
// 实现对瞬时锁等待后重试一次，仍锁则静默跳过（不进 failures、不返回 error）。
// 本测试锁定「跳过语义」不被回归成失败报错；重试本身为内部健壮性增强。
package sync

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

func TestSyncToggleStatus_LockedFileSkippedSilently(t *testing.T) {
	base := t.TempDir()
	filesRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "custom")
	if err := os.MkdirAll(filesRoot, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}
	repoFile := filepath.Join(filesRoot, "m.ysm")
	if err := os.WriteFile(repoFile, []byte("repo"), 0644); err != nil {
		t.Fatal(err)
	}
	disabled := filepath.Join(customDir, "m.ysm.disabled")
	if err := os.WriteFile(disabled, []byte("local"), 0644); err != nil {
		t.Fatal(err)
	}

	// 独占锁定待启用的源文件（share=0），令 Rename 失败
	p, err := syscall.UTF16PtrFromString(disabled)
	if err != nil {
		t.Skipf("UTF16 转换失败: %v", err)
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_READ, 0, nil,
		syscall.OPEN_EXISTING, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Skipf("独占打开文件失败: %v", err)
	}
	defer syscall.CloseHandle(h)

	// 探针：锁应令 Rename 失败，否则环境不执行共享锁语义
	probe := disabled + ".probe"
	if rerr := os.Rename(disabled, probe); rerr == nil {
		_ = os.Rename(probe, disabled)
		t.Skip("环境未执行共享锁（Rename 仍成功），跳过")
	}

	scanFn := mockScanDir(filesRoot, []types.ModelEntry{
		{Name: "m.ysm", Path: repoFile},
	}, nil)

	disableCount, enableCount, err := SyncToggleStatus(customDir, filesRoot, scanFn)
	testutil.NoError(t, err, "锁定文件应静默跳过而非报错，got")
	if enableCount != 0 || disableCount != 0 {
		t.Fatalf("锁定期间不应有任何改名生效，got disable=%d enable=%d", disableCount, enableCount)
	}
	if _, serr := os.Stat(disabled); serr != nil {
		t.Fatalf("源文件应保持原位: %v", serr)
	}
}
