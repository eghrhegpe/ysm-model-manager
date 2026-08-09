//go:build !android

package app

import "os"

// desktopPathManager 桌面实现：系统标准用户配置目录
type desktopPathManager struct{}

func (desktopPathManager) AppDataRoot() (string, error) {
	return os.UserConfigDir()
}

// DefaultRepoRoot 桌面无默认公共仓库——路径由用户在设置页配置（GetRepoRoot 走 FilesRoot）
func (desktopPathManager) DefaultRepoRoot() string {
	return ""
}

func init() {
	pathMgr = desktopPathManager{}
}
