package mc

import (
	"os"
	"path/filepath"
)

// FindMinecraftDir 自动定位 .minecraft
func FindMinecraftDir() string {
	// 1) %APPDATA%\.minecraft
	if appData := os.Getenv("APPDATA"); appData != "" {
		p := filepath.Join(appData, ".minecraft")
		if isDir(p) {
			return p
		}
	}

	// 2) 同级目录搜索（解压版/便携版常见）
	if exe, err := os.Executable(); err == nil {
		roots := []string{
			filepath.Join(filepath.Dir(exe), ".minecraft"),
			filepath.Join(filepath.Dir(exe), "..", ".minecraft"),
		}
		for _, r := range roots {
			r, _ = filepath.Abs(r)
			if isDir(r) {
				return r
			}
		}
	}

	return ""
}

func isDir(p string) bool {
	i, err := os.Stat(p)
	return err == nil && i.IsDir()
}