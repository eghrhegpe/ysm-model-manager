//go:build !android

package app

import "os"

// desktopPathManager 桌面实现：系统标准用户配置目录
type desktopPathManager struct{}

func (desktopPathManager) AppDataRoot() (string, error) {
	return os.UserConfigDir()
}

func init() {
	pathMgr = desktopPathManager{}
}
