//go:build windows

package sync

import (
	"syscall"
	"ysm-model-manager/go/types"
)

// checkHardLink 检查文件是否为硬链接（Windows 上通过 nlink 判断）
func checkHardLink(path string) types.LinkType {
	pathp, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return types.LinkCopy
	}
	handle, err := syscall.CreateFile(pathp,
		syscall.GENERIC_READ,
		syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE,
		nil,
		syscall.OPEN_EXISTING,
		syscall.FILE_ATTRIBUTE_NORMAL,
		0)
	if err != nil {
		return types.LinkCopy
	}
	defer syscall.CloseHandle(handle)

	var info syscall.ByHandleFileInformation
	err = syscall.GetFileInformationByHandle(handle, &info)
	if err != nil {
		return types.LinkCopy
	}

	// nlink > 1 表示有多个硬链接
	if info.NumberOfLinks > 1 {
		return types.LinkHard
	}
	return types.LinkCopy
}
