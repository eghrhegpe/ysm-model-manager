//go:build windows

package testutil

import (
	"os"
	"syscall"
	"testing"
)

// LockDirExclusive 以独占模式打开 dir 的目录句柄并登记 t.Cleanup 释放，
// 供验证「目标目录被占用时操作应优雅失败」的 Windows 锁语义测试。
// 若环境不执行共享锁语义（ReadDir 仍成功）则 t.Skip 探针失败，
// 调用方后续断言自然跳过——统一 importer/sync 两份逐字节相同的本地实现。
func LockDirExclusive(t *testing.T, dir string) {
	t.Helper()
	p, err := syscall.UTF16PtrFromString(dir)
	if err != nil {
		t.Skipf("UTF16 转换失败: %v", err)
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_READ, 0, nil,
		syscall.OPEN_EXISTING, syscall.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		t.Skipf("独占打开目录失败: %v", err)
	}
	// 探针：锁应令 ReadDir 失败，否则该环境不执行共享锁语义，跳过测试
	if _, err := os.ReadDir(dir); err == nil {
		syscall.CloseHandle(h)
		t.Skip("环境未执行共享锁（ReadDir 仍成功），跳过")
	}
	t.Cleanup(func() { syscall.CloseHandle(h) })
}
