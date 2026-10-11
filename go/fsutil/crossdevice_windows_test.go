//go:build windows

package fsutil

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// ====== IsCrossDeviceErr 测试（Windows）=====

// TestIsCrossDeviceErr_EXDEV：构造含 EXDEV 的 LinkError，验证被识别为跨设备错误。
func TestIsCrossDeviceErr_EXDEV(t *testing.T) {
	linkErr := &os.LinkError{
		Op:  "rename",
		Old: "C:/a/file.txt",
		New: "D:/a/file.txt",
		Err: syscall.EXDEV,
	}
	if !IsCrossDeviceErr(linkErr) {
		t.Error("含 EXDEV 的 LinkError 应被识别为跨设备错误")
	}
}

// TestIsCrossDeviceErr_NotSameDevice：Windows 特有错误码 17（ERROR_NOT_SAME_DEVICE），验证被识别。
func TestIsCrossDeviceErr_NotSameDevice(t *testing.T) {
	const errNotSameDevice = syscall.Errno(17)
	linkErr := &os.LinkError{
		Op:  "rename",
		Old: "C:/a/file.txt",
		New: "D:/a/file.txt",
		Err: errNotSameDevice,
	}
	if !IsCrossDeviceErr(linkErr) {
		t.Error("含 ERROR_NOT_SAME_DEVICE 的 LinkError 应被识别为跨设备错误")
	}
}

// TestIsCrossDeviceErr_NotCrossDevice：普通 error 不应被误判为跨设备。
func TestIsCrossDeviceErr_NotCrossDevice(t *testing.T) {
	err := errors.New("some unrelated error")
	if IsCrossDeviceErr(err) {
		t.Error("普通 error 不应被识别为跨设备错误")
	}
}

// TestIsCrossDeviceErr_NilError：nil error 不应 panic，返回 false。
func TestIsCrossDeviceErr_NilError(t *testing.T) {
	if IsCrossDeviceErr(nil) {
		t.Error("nil error 应返回 false")
	}
}

// ====== IsHardLink 测试 ======

// TestIsHardLink_NonExistent：不存在的文件应返回 false（不 panic）。
func TestIsHardLink_NonExistent(t *testing.T) {
	if IsHardLink(filepath.Join(t.TempDir(), "no_such_file")) {
		t.Error("不存在的文件应返回 false")
	}
}

// TestIsHardLink_Dir：目录明确排除，防止 Move 操作误删（ADR-038 D3.4）。
func TestIsHardLink_Dir(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "sub")
	if err := os.MkdirAll(sub, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if IsHardLink(sub) {
		t.Error("目录应返回 false（目录无硬链接语义，不可误判）")
	}
}

// TestIsHardLink_SingleFile：普通单文件（NumberOfLinks == 1）应返回 false。
func TestIsHardLink_SingleFile(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "single.txt")
	if err := os.WriteFile(f, []byte("hello"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if IsHardLink(f) {
		t.Error("普通单文件应返回 false")
	}
}

// TestIsHardLink_HardLink：os.Link 创建的硬链接（NumberOfLinks > 1）应返回 true。
// Windows 不支持 os.Link 跨卷，失败时 t.Skip。
func TestIsHardLink_HardLink(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "dst.txt")
	if err := os.WriteFile(src, []byte("linkme"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.Link(src, dst); err != nil {
		t.Skipf("os.Link 失败（可能跨卷或权限不足），跳过：%v", err)
	}
	if !IsHardLink(dst) {
		t.Error("硬链接文件应返回 true")
	}
}

// TestIsHardLink_Symlink：IsHardLink 经 os.Stat/CreateFile 跟随符号链接——
// 指向普通文件（NumberOfLinks==1）的 symlink 应返回 false。
// 调用方（recycle.moveEx / sync.GetLinkType）先用 Lstat 判 symlink 再调本函数。
func TestIsHardLink_Symlink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target.txt")
	link := filepath.Join(dir, "link.txt")
	if err := os.WriteFile(target, []byte("data"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("Windows: symlink 创建需管理员/开发者模式，跳过：%v", err)
	}
	if IsHardLink(link) {
		t.Error("指向普通文件的 symlink 应返回 false（目标 NumberOfLinks==1）")
	}
}
