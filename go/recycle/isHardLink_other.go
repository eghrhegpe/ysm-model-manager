//go:build !windows

package recycle

import "os"

// isHardLink 判断文件是否为硬链接（nlink > 1）。
// Unix/macOS 通过 os.FileInfo.Sys().Nlink() 接口获取。
// 目录不参与硬链接判断：目录 nlink = 2 + 子目录数恒 > 1（. / .. / 每子目录 1 链接），
// 误判会导致文件夹模型 Move 被当硬链接直接删除（ADR-038 D3.4）。
func isHardLink(info os.FileInfo, path string) bool {
	if info.IsDir() {
		return false
	}
	if stat, ok := info.Sys().(interface{ Nlink() uint64 }); ok && stat.Nlink() > 1 {
		return true
	}
	return false
}
