//go:build android

package app

import "os"

// androidPathManager Android 实现：应用沙盒私有目录
// Android 上 os.UserConfigDir() 依赖 HOME/XDG_CONFIG_HOME 环境变量，通常未设置会报错；
// 应用私有目录（沙盒，无需存储权限）是配置/日志/标签的唯一可靠落点。
// 用户资源（模型仓库）不走此接口——由用户在 UI 选择存储路径（SAF），见 GetRepoRoot。
type androidPathManager struct{}

func (androidPathManager) AppDataRoot() (string, error) {
	if home := os.Getenv("HOME"); home != "" {
		return home, nil
	}
	if d, err := os.UserConfigDir(); err == nil && d != "" {
		return d, nil
	}
	return os.Getwd()
}

func init() {
	pathMgr = androidPathManager{}
}
