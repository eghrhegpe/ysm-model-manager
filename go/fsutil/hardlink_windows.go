//go:build windows

package fsutil

import (
	"os"
	"syscall"
)

// IsHardLink 判断路径是否为硬链接（NumberOfLinks > 1）。
// Windows 的 os.FileInfo.Sys() 不暴露 Nlink，须通过 syscall 获取。
// 目录不参与硬链接判断：目录 CreateFile 需 BACKUP_SEMANTICS 且无硬链接语义，
// 直接排除避免文件夹模型 Move 误判（ADR-038 D3.4）。
func IsHardLink(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	pathp, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return false
	}
	handle, err := syscall.CreateFile(pathp,
		// access=0（仅查询属性）：GENERIC_READ 会被游戏的 FileShare.None 独占句柄
		// 挡出 ERROR_SHARING_VIOLATION → 静默 false → 硬链接误判为普通文件（D7 留观项
		// 经探针实证根治）。NumberOfLinks 是内核实时元数据，0 access + OPEN_EXISTING
		// 照样读得到（真硬链接仍=2、普通文件仍=1，零副作用）。
		// 不加 FILE_FLAG_BACKUP_SEMANTICS：它只为打开目录所必需（本函数已在开头
		// 排除目录），且以备份语义打开文件要求 SE_BACKUP_NAME 特权，普通权限下
		// 反而可能 ERROR_PRIVILEGE_NOT_HELD——纯负作用。share 补 DELETE 进一步
		// 放宽与「可删除打开」进程的兼容面。
		0,
		syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE,
		nil,
		syscall.OPEN_EXISTING,
		syscall.FILE_ATTRIBUTE_NORMAL,
		0)
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(handle)
	var bhi syscall.ByHandleFileInformation
	if err := syscall.GetFileInformationByHandle(handle, &bhi); err == nil && bhi.NumberOfLinks > 1 {
		return true
	}
	return false
}
