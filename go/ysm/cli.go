// ===== YSMParser CLI 工具查找与调用 =====
package ysm

import (
	"os"
	"os/exec"
	"path/filepath"
)

// FindCLI 查找 YSMParser.exe 可执行文件路径
func FindCLI() string {
	if exe, err := os.Executable(); err == nil {
		if p := filepath.Join(filepath.Dir(exe), "YSMParser.exe"); fileExists(p) {
			return p
		}
	}
	if wd, err := os.Getwd(); err == nil {
		if p := filepath.Join(wd, "YSMParser.exe"); fileExists(p) {
			return p
		}
	}
	if p, err := exec.LookPath("YSMParser.exe"); err == nil {
		return p
	}
	if p, err := exec.LookPath("YSMParser"); err == nil {
		return p
	}
	return ""
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
