//go:build windows

package recycle

import (
	"os"
	"syscall"
)

// isHardLink 判断文件是否为硬链接（NumberOfLinks > 1）。
// Windows 的 os.FileInfo.Sys() 不暴露 Nlink，须通过 syscall 获取。
func isHardLink(info os.FileInfo, path string) bool {
	pathp, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return false
	}
	handle, err := syscall.CreateFile(pathp,
		syscall.GENERIC_READ,
		syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE,
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
