//go:build windows

package recycle

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// TestMoveEx_WindowsCrossVolumeErrno 注入真实跨卷错误码 ERROR_NOT_SAME_DEVICE(17)，
// 验证 fsutil.IsCrossDeviceErr 能触发复制回退。
// 测试注入的 syscall.EXDEV 在 Windows 是虚构常量（zerrors_windows.go 中为
// APPLICATION_ERROR+iota），OS 调用不会返回；真实跨卷移动返回 Errno(17)，
// 必须走 errNotSameDevice 分支，本测试是该分支的唯一覆盖。
func TestMoveEx_WindowsCrossVolumeErrno(t *testing.T) {
	dir := t.TempDir()
	modDir := filepath.Join(dir, "mod")
	if err := os.MkdirAll(modDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(modDir, "ysm.json"), []byte("{}"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	tm := newTMWithRenameErr(t, dir, syscall.Errno(17)) // ERROR_NOT_SAME_DEVICE

	res := tm.MoveEx(modDir)
	testutil.Equal(t, res.Action, "recycled", "Errno(17) 应触发跨设备回退 recycled, 得到 %s/%s", res.Action, res.Reason)
	_, statErr := os.Stat(modDir)
	testutil.Equal(t, os.IsNotExist(statErr), true, "源目录应已被删除")
	entries := tm.List()
	testutil.Equal(t, len(entries), 1, "回收站应有 1 个整组条目, 得到 %d", len(entries))
}
