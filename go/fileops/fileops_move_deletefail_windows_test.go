//go:build windows

package fileops

// ===== 跨设备回退「复制成功但删除源失败」的数据安全特征测试（Windows 专属）=====
// 这是 EXDEV 回退里最难构造、也最该钉住的一条：源删除失败时**绝不能回滚已到达目标的复制**，
// 否则两侧都没了 = 真丢文件。
//
// 构造手法：用 syscall.CreateFile 以「只共享读」打开源文件——Go 的 os.Open 恒带
// FILE_SHARE_DELETE（删除会成功），而本句柄的共享模式只有 FILE_SHARE_READ，
// 缺 FILE_SHARE_DELETE → DeleteFile 报 ERROR_SHARING_VIOLATION
// （与 go/AGENTS.md「Windows os.Rename 会 ERROR_SHARING_VIOLATION」同源机制）。
// 期间复制仍可成功（只读打开被 FILE_SHARE_READ 放行）。

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestMoveModelFile_CrossDeviceDeleteSourceFails_KeepsBothCopies(t *testing.T) {
	forceEXDEV(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "m.ysm")
	if err := os.WriteFile(src, []byte("payload"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(dir, "sub")

	// 持有源句柄：共享模式缺 FILE_SHARE_DELETE → 复制可读、删除被拒
	ptr, err := syscall.UTF16PtrFromString(src)
	if err != nil {
		t.Fatal(err)
	}
	h, err := syscall.CreateFile(ptr, syscall.GENERIC_READ, syscall.FILE_SHARE_READ, nil,
		syscall.OPEN_EXISTING, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatalf("构造独占读句柄失败: %v", err)
	}
	// 句柄必须在 t.Cleanup（含 TempDir 清理）之前关闭（defer 早于 t.Cleanup 执行）
	defer func() { _ = syscall.CloseHandle(h) }()

	moveErr := MoveModelFile(dir, src, dstDir)
	if moveErr == nil {
		t.Fatal("删除源失败必须报错（不得静默成功）")
	}
	if !strings.Contains(moveErr.Error(), "复制成功但删除源失败") {
		t.Fatalf("应报「复制成功但删除源失败」，got %v", moveErr)
	}
	// 数据安全铁律：复制已成功到达目标，绝不回滚——目标副本必须完好
	got, rerr := os.ReadFile(filepath.Join(dstDir, "m.ysm"))
	if rerr != nil || string(got) != "payload" {
		t.Fatalf("目标副本必须完好保留: got=%q err=%v", got, rerr)
	}
	// 源删除失败 = 原文件仍在，内容必须未受损（两侧都有 > 两侧都无）
	gotSrc, serr := os.ReadFile(src)
	if serr != nil || string(gotSrc) != "payload" {
		t.Fatalf("源必须原样保留: got=%q err=%v", gotSrc, serr)
	}
}
