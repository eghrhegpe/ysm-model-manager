package ysm

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
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
		// P2 修复：limit+1 探测截断——LimitReader 截断后 ReadAll 返回 nil 错误（ADR-033 陷阱），
		// >1MB 的 mods.toml 会以截断数据继续匹配，导致 IsYSMJar 误判 false。
		// ADR-044 策略 A：统一走 fsutil.ReadLimitedEntry（超限/错误返回 nil → 跳过）
		const maxModsToml = 1 << 20
		data := fsutil.ReadLimitedEntry(rc, int64(maxModsToml))
		if data == nil {
			continue // 读取失败或超过 1MB 上限，视为畸形文件跳过
		}

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

// HasYSMMod 检查 mods 目录是否有 YSM 模组（先做文件名过滤避免对每个 JAR 打开 ZIP）
func HasYSMMod(modsDir string) bool {
	files, err := os.ReadDir(modsDir)
	if err != nil {
		return false
	}
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(strings.ToLower(f.Name()), ".jar") {
			continue
		}
		// 文件名快速过滤：只对名称含 yes_steve_model 或 ysm- 的 JAR 打开 ZIP
		name := strings.ToLower(f.Name())
		if !strings.Contains(name, "yes_steve_model") && !strings.Contains(name, "ysm-") {
			continue
		}
		if IsYSMJar(filepath.Join(modsDir, f.Name())) {
			return true
		}
	}
	return false
}

// 各资源类型的 mod 文件名关键词
var ModKeywords = map[string][]string{
	"ysm":           {"yes_steve_model", "ysm-"},
	"mmd-skin":      {"mmdskin", "mmd-skin"},
	"vrchat-avatar": {"vrchat"},
}

// HasModInDir 检查 mods 目录是否有匹配指定类型关键词的 jar
func HasModInDir(modsDir, rtype string) bool {
	keywords, ok := ModKeywords[rtype]
	if !ok {
		// 非模型类（资源包/光影包/蓝图等）默认假设 mod 已安装，由调用方按需处理
		return true
	}
	files, err := os.ReadDir(modsDir)
	if err != nil {
		return false
	}
	lower := strings.ToLower
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(lower(f.Name()), ".jar") {
			continue
		}
		// 文件名快速过滤
		name := lower(f.Name())
		match := false
		for _, kw := range keywords {
			if strings.Contains(name, kw) {
				match = true
				break
			}
		}
		if !match {
			continue
		}
		// 进一步检查：对于 ysm 类型打开 ZIP 确认 mods.toml
		if rtype == "ysm" {
			if IsYSMJar(filepath.Join(modsDir, f.Name())) {
				return true
			}
		} else {
			// 其他类型仅凭文件名匹配即可
			return true
		}
	}
	return false
}
