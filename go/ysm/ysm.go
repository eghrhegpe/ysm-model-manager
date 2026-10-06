package ysm

import (
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types/registry"
)

// IsYSMJar 检查单个 jar 是否是 YSM 模组（支持 mods.toml 和 neoforge.mods.toml）
func IsYSMJar(jarPath string) bool {
	return IsModJar(jarPath, "yes_steve_model", "Yes Steve Model")
}

// IsModJar 内容检测单个 jar 是否是指定 mod（读取 META-INF/mods.toml / neoforge.mods.toml
// 的 [[mods]] 块，按 modId + displayName 判定，非文件名匹配）。
// ADR-095：车万女仆等模型 mod 复用此内容检测，避免 ModKeywords 手写文件名关键词。
func IsModJar(jarPath, modID, displayName string) bool {
	r, err := container.OpenZipPath(jarPath)
	if err != nil {
		return false
	}
	defer func() { _ = r.Close() }()

	for _, f := range r.Entries() {
		// 支持 mods.toml 和 neoforge.mods.toml
		if !isModsTomlEntry(f.Name()) {
			continue
		}
		data := readModsToml(f)
		if data == nil {
			continue
		}
		if modsTomlDeclares(string(data), modID, displayName) {
			return true
		}
	}
	return false
}

// maxModsToml mods.toml 读取上限（超限即视为畸形文件跳过）。
const maxModsToml = 1 << 20

// isModsTomlEntry 判断 ZIP 条目是否为 mods.toml / neoforge.mods.toml（大小写不敏感）。
func isModsTomlEntry(name string) bool {
	n := strings.ToLower(name)
	return n == "meta-inf/mods.toml" || n == "meta-inf/neoforge.mods.toml"
}

// readModsToml 读取 mods.toml 内容；打开失败或超限返回 nil（调用方跳过）。
// limit+1 探测截断——LimitReader 截断后 ReadAll 返回 nil 错误（ADR-033 陷阱），
// >1MB 的 mods.toml 会以截断数据继续匹配，导致 IsYSMJar 误判 false。
// ADR-044 策略 A：统一走 fsutil.ReadLimitedEntry（超限/错误返回 nil → 跳过）
func readModsToml(f container.Entry) []byte {
	rc, err := f.Open()
	if err != nil {
		return nil
	}
	return fsutil.ReadLimitedEntry(rc, int64(maxModsToml))
}

// modsTomlDeclares 扫描 [[mods]] 块，判定是否存在 modId 与 displayName 同时命中的块。
// 每个块在遇到下一个 [ 开头的表头或文件结尾时结算；结算点命中即返回。
func modsTomlDeclares(content, modID, displayName string) bool {
	inModsBlock := false
	foundModID := false
	foundDisplayName := false
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "[[mods]]" {
			inModsBlock = true
			foundModID = false
			foundDisplayName = false
			continue
		}
		if !inModsBlock {
			continue
		}
		if strings.HasPrefix(trimmed, "[[") || strings.HasPrefix(trimmed, "[") {
			if foundModID && foundDisplayName {
				return true
			}
			inModsBlock = false
			continue
		}
		if tomlLineDeclaresValue(trimmed, "modId", modID) {
			foundModID = true
		}
		if tomlLineDeclaresValue(trimmed, "displayName", displayName) {
			foundDisplayName = true
		}
	}
	return inModsBlock && foundModID && foundDisplayName
}

// tomlLineDeclaresValue 判断 toml 行是否以 key="value" 或 key = "value" 写法声明指定值——
// mods.toml 的历史写法不统一（有无空格两种），两种都要认。
func tomlLineDeclaresValue(trimmed, key, value string) bool {
	return strings.HasPrefix(trimmed, key+`="`+value+`"`) ||
		strings.HasPrefix(trimmed, key+` = "`+value+`"`)
}

// HasModInDir 检查 mods 目录是否有匹配指定类型关键词的 jar
// ADR-110：mod 依赖从注册表查询（registry.ModKeywordsFor / registry.ModMetaFor），
// 消除 Go 硬编码（旧 ModKeywords/ModGroupKeywords/ModMeta 已删除）。
func HasModInDir(modsDir, rtype string) bool {
	// ADR-095：内容检测型资源（注册表 mod.modId 有值）优先读 mods.toml，
	// 不靠文件名关键词匹配（避免 jar 改名/翻译导致误判）
	if modID, displayName := registry.ModMetaFor(rtype); modID != "" {
		files, err := os.ReadDir(modsDir)
		if err != nil {
			return false
		}
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(strings.ToLower(f.Name()), ".jar") {
				continue
			}
			if IsModJar(filepath.Join(modsDir, f.Name()), modID, displayName) {
				return true
			}
		}
		return false
	}
	// ADR-110：从注册表查询 jarKeywords（含组级回退）
	keywords := registry.ModKeywordsFor(rtype)
	if keywords == nil {
		// 非模型类（资源包/光影包等）默认假设 mod 已安装，由调用方按需处理
		return true
	}
	files, err := os.ReadDir(modsDir)
	if err != nil {
		return false
	}
	lower := strings.ToLower
	// 循环不变量提升：rtype 在遍历中不变，注册表查询只执行一次
	rt := registry.RegistryType(rtype)
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
		// 进一步检查：内容检测型资源（注册表 detector=ysm）打开 ZIP 确认 mods.toml，
		// 其余类型仅凭文件名匹配（ADR-065：rtype 分支注册表化，新增类型只需改 JSON）
		if rt != nil && rt.Detector == "ysm" {
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
