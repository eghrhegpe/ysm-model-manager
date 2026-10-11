package fileops

// ===== MoveModelFile 跨设备（EXDEV）fallback 测试 =====
// os.Rename 跨卷返回 EXDEV → 回退「复制 + 删除源」。
// 用可注入的 renameForMove 强制触发，验证：
//   1. 单文件移动：目标存在、源清理、内容一致
//   2. 被禁单文件（文件名带 .disabled 后缀，重命名约定）跨设备移动后禁用态保留
//   3. 无关兄弟 `<src>.disabled`（另一个撞名被禁模型）不被触碰

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// forceEXDEV 替换 renameForMove 使每次 rename 返回 EXDEV（跨设备错误），
// 返回恢复函数。
func forceEXDEV(t *testing.T) {
	t.Helper()
	orig := renameForMove
	renameForMove = func(string, string) error { return syscall.EXDEV }
	t.Cleanup(func() { renameForMove = orig })
}

func TestMoveModelFile_CrossDeviceFallback(t *testing.T) {
	forceEXDEV(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "m.ysm")
	dstDir := filepath.Join(dir, "sub")
	if err := os.WriteFile(src, []byte("content"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	if err := MoveModelFile(dir, src, dstDir); err != nil {
		t.Fatalf("跨设备 fallback 失败: %v", err)
	}
	// 目标存在且内容一致
	dst := filepath.Join(dstDir, "m.ysm")
	got, err := os.ReadFile(dst)
	testutil.NoError(t, err, "目标不存在/不可读")
	if string(got) != "content" {
		t.Errorf("内容不一致: got %q", got)
	}
	// 源已清理
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Errorf("源应已删除，got err=%v", err)
	}
}

func TestMoveModelFile_CrossDeviceBannedKeepsSuffix(t *testing.T) {
	// 禁用态 = 文件名重命名约定（ToggleModelEnable：path → path+".disabled"），
	// 被禁单文件本身以 .disabled 结尾，跨设备移动后后缀必须随文件名保留
	forceEXDEV(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "m.ysm.disabled")
	dstDir := filepath.Join(dir, "sub")
	if err := os.WriteFile(src, []byte("banned"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	if err := MoveModelFile(dir, src, dstDir); err != nil {
		t.Fatalf("跨设备 fallback 失败: %v", err)
	}
	dst := filepath.Join(dstDir, "m.ysm.disabled")
	if _, err := os.Stat(dst); err != nil {
		t.Errorf("禁用态后缀未保留（目标 m.ysm.disabled 缺失）: %v", err)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Errorf("源应已删除，got err=%v", err)
	}
}

func TestMoveModelFile_CrossDeviceIgnoresUnrelatedBanSibling(t *testing.T) {
	// 兄弟 `<src>.disabled` 属于另一个撞名的被禁模型（重命名约定下被禁模型本身
	// 就叫 `<name>.ysm.disabled`，旁边不可能同时存在 src 和 src.disabled 是同一模型）——
	// fallback 不得复制也不得删除该兄弟
	forceEXDEV(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "m.ysm")
	banSibling := src + ".disabled" // 无关的被禁模型
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(banSibling, []byte("unrelated"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	if err := MoveModelFile(dir, src, dstDirOf(t, dir)); err != nil {
		t.Fatalf("跨设备 fallback 失败: %v", err)
	}
	// 兄弟 .disabled 未被删除（源侧保留）
	if _, err := os.Stat(banSibling); err != nil {
		t.Errorf("无关兄弟 .disabled 不应被删除: %v", err)
	}
	// 兄弟 .disabled 未被复制到目标
	dstBan := filepath.Join(dir, "sub", "m.ysm.disabled")
	if _, err := os.Stat(dstBan); !os.IsNotExist(err) {
		t.Errorf("无关兄弟 .disabled 不应被复制到目标: %v", err)
	}
}

func dstDirOf(t *testing.T, dir string) string {
	t.Helper()
	dstDir := filepath.Join(dir, "sub")
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	return dstDir
}

func TestMoveModelFile_CrossDeviceBannedDirKeepsSuffix(t *testing.T) {
	// 整组禁用（ADR-038 D3.7）：目录重命名为 `父目录.disabled`——目录名带 .disabled
	// 后缀，跨设备移动后整组禁用态必须随目录名保留
	forceEXDEV(t)
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "modelA.disabled")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "m.ysm"), []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	dstDir := filepath.Join(dir, "sub")
	if err := MoveModelFile(dir, srcDir, dstDir); err != nil {
		t.Fatalf("跨设备 fallback 失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dstDir, "modelA.disabled", "m.ysm")); err != nil {
		t.Errorf("整组禁用后缀未保留: %v", err)
	}
	if _, err := os.Stat(srcDir); !os.IsNotExist(err) {
		t.Errorf("源应已删除: %v", err)
	}
}

func TestMoveModelFile_CrossDeviceDirNestedBanSurvives(t *testing.T) {
	// 启用目录内含文件级被禁条目（重命名约定：loose.ysm.disabled）——
	// 跨设备移动经 copyDirRecursive 递归复制，嵌套 .disabled 必须随树保留
	forceEXDEV(t)
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "modelA")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "loose.ysm.disabled"), []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	dstDir := filepath.Join(dir, "sub")
	if err := MoveModelFile(dir, srcDir, dstDir); err != nil {
		t.Fatalf("跨设备 fallback 失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dstDir, "modelA", "loose.ysm.disabled")); err != nil {
		t.Errorf("嵌套 .disabled 未保留: %v", err)
	}
	if _, err := os.Stat(srcDir); !os.IsNotExist(err) {
		t.Errorf("源应已删除: %v", err)
	}
}
