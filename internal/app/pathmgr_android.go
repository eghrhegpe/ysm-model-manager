//go:build android

package app

import (
	"errors"
	"os"
)

// androidPathManager Android 实现：应用沙盒私有目录
// Android 上 os.UserConfigDir() 依赖 HOME/XDG_CONFIG_HOME 环境变量，通常未设置会报错；
// 应用私有目录（沙盒，无需存储权限）是配置/日志/标签的唯一可靠落点。
// 用户资源（模型仓库）不走此接口——由用户在 UI 选择存储路径（SAF），见 GetRepoRoot。
type androidPathManager struct{}

// AppDataRoot 按候选序返回第一个可写目录；全不可写返回错误——
// 直接返回 HOME/Getwd 可能退化为不可写的文件系统根 "/"（P2 审核发现），
// 配置/标签将静默不落盘；显式报错让 appDataRoot 兜底，杜绝假成功
func (androidPathManager) AppDataRoot() (string, error) {
	var candidates []string
	if home := os.Getenv("HOME"); home != "" {
		candidates = append(candidates, home)
	}
	if d, err := os.UserConfigDir(); err == nil && d != "" {
		candidates = append(candidates, d)
	}
	if wd, err := os.Getwd(); err == nil && wd != "" {
		candidates = append(candidates, wd)
	}
	for _, dir := range candidates {
		if writableDir(dir) {
			return dir, nil
		}
	}
	return "", errors.New("pathmgr: Android 无可写配置目录（沙盒注入缺失）")
}

// writableDir 可写性探针：MkdirAll 对已存在目录不报错（即使不可写），
// 必须以实际写文件验证——CreateTemp 成功即证明可写，随即清理
func writableDir(dir string) bool {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return false
	}
	probe, err := os.CreateTemp(dir, ".ysm-probe-*")
	if err != nil {
		return false
	}
	_ = probe.Close()
	_ = os.Remove(probe.Name())
	return true
}

func init() {
	pathMgr = androidPathManager{}
}
