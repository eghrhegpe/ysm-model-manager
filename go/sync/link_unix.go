//go:build !windows

package sync

import (
	"os"
	"syscall"
	"ysm-model-manager/go/types"
)

// checkHardLink 检查文件是否为硬链接（Unix/macOS 上通过 stat.Nlink 判断）
func checkHardLink(path string) types.LinkType {
	info, err := os.Stat(path)
	if err != nil {
		return types.LinkCopy
	}
	if stat, ok := info.Sys().(*syscall.Stat_t); ok && stat.Nlink > 1 {
		return types.LinkHard
	}
	return types.LinkCopy
}
