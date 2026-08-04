//go:build !windows

package app

import (
	"os"
	"path/filepath"
)

// scanMinecraftDirsPlatform Unix/macOS 启动器路径扫描：
// XDG 标准目录（~/.local/share 等）+ Apple Application Support（macOS）
func scanMinecraftDirsPlatform(add func(p string)) {
	// PrismLauncher：XDG_DATA_HOME 或 ~/.local/share/PrismLauncher
	if dataDir, err := os.UserConfigDir(); err == nil {
		// Linux: ~/.config；macOS: ~/Library/Application Support
		add(filepath.Join(dataDir, "PrismLauncher", "instances"))
	}
	if home, err := os.UserHomeDir(); err == nil {
		// Linux XDG data 默认 ~/.local/share
		add(filepath.Join(home, ".local", "share", "PrismLauncher", "instances"))
		// 传统 .minecraft 在用户主目录
		add(filepath.Join(home, ".minecraft"))
		// HMCL 在用户主目录
		add(filepath.Join(home, ".hmcl"))
	}
}
