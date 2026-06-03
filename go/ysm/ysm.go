package ysm

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// IsYSMJar 检查单个 jar 是否是 YSM 模组（支持 mods.toml 和 neoforge.mods.toml）
func IsYSMJar(jarPath string) bool {
	r, err := zip.OpenReader(jarPath)
	if err != nil {
		return false
	}
	defer r.Close()

	for _, f := range r.File {
		// 支持 mods.toml 和 neoforge.mods.toml
		name := strings.ToLower(f.Name)
		if name != "meta-inf/mods.toml" && name != "meta-inf/neoforge.mods.toml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		data, _ := io.ReadAll(rc)
		rc.Close()

		content := string(data)
		lines := strings.Split(content, "\n")
		inModsBlock := false
		foundModId := false
		foundDisplayName := false
		for _, line := range lines {
			trimmed := strings.TrimSpace(line)
			if trimmed == "[[mods]]" {
				inModsBlock = true
				foundModId = false
				foundDisplayName = false
				continue
			}
			if inModsBlock {
				if strings.HasPrefix(trimmed, "[[") || strings.HasPrefix(trimmed, "[") {
					if foundModId && foundDisplayName {
						return true
					}
					inModsBlock = false
					continue
				}
				if strings.HasPrefix(trimmed, `modId="yes_steve_model"`) ||
					strings.HasPrefix(trimmed, `modId = "yes_steve_model"`) {
					foundModId = true
				}
				if strings.HasPrefix(trimmed, `displayName="Yes Steve Model"`) ||
					strings.HasPrefix(trimmed, `displayName = "Yes Steve Model"`) {
					foundDisplayName = true
				}
			}
		}
		if inModsBlock && foundModId && foundDisplayName {
			return true
		}
	}
	return false
}

// HasYSMMod 检查 mods 目录是否有 YSM 模组
func HasYSMMod(modsDir string) bool {
	files, err := os.ReadDir(modsDir)
	if err != nil {
		return false
	}
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(strings.ToLower(f.Name()), ".jar") {
			continue
		}
		if IsYSMJar(filepath.Join(modsDir, f.Name())) {
			return true
		}
	}
	return false
}
