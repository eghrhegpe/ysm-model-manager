//go:build !windows

package recycle

import "os"

// isHardLink 判断文件是否为硬链接（nlink > 1）。
// Unix/macOS 通过 os.FileInfo.Sys().Nlink() 接口获取。
func isHardLink(info os.FileInfo, path string) bool {
	if stat, ok := info.Sys().(interface{ Nlink() uint64 }); ok && stat.Nlink() > 1 {
		return true
	}
	return false
}
