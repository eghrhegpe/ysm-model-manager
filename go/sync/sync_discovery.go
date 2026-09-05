// ===== 实例发现（ADR-040 拆分）=====
// 从 sync.go 拆出：整合包实例布局探测（vanilla / PrismLauncher / 直连 instances 目录）
package sync

import (
	"os"
	"path/filepath"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// ListVersionsFunc 列出版本实例（函数类型，测试时可注入 mock）
type ListVersionsFunc func(mcRoot string) []types.VersionInstance

func ListVersions(mcRoot string) []types.VersionInstance {
	// 1. 自身就是 instances 目录（子目录中含 .minecraft/）
	if HasDotMinecraftSubdirs(mcRoot) {
		return listPrismInstances(mcRoot)
	}
	// 2. PrismLauncher 根目录: {mcRoot}/instances/{name}/.minecraft/
	instancesDir := filepath.Join(mcRoot, "instances")
	if info, err := os.Stat(instancesDir); err == nil && info.IsDir() {
		return listPrismInstances(instancesDir)
	}
	// 3. 标准布局: {mcRoot}/versions/{name}/
	return listVanillaInstances(mcRoot)
}

// HasDotMinecraftSubdirs 检测目录的子目录中是否包含 .minecraft/ 或 minecraft/（用于识别 instances 目录）
func HasDotMinecraftSubdirs(path string) bool {
	ents, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		if FindMinecraftDir(filepath.Join(path, e.Name())) != "" {
			return true
		}
	}
	return false
}

// FindMinecraftDir 在给定目录下查找 .minecraft 或 minecraft 子目录，返回找到的路径
func FindMinecraftDir(parentDir string) string {
	for _, sub := range []string{".minecraft", "minecraft"} {
		p := filepath.Join(parentDir, sub)
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			return p
		}
	}
	return ""
}

// listVanillaInstances 标准 .minecraft/versions/{name}/ 布局
func listVanillaInstances(mcRoot string) []types.VersionInstance {
	versionsDir := filepath.Join(mcRoot, "versions")
	ents, err := os.ReadDir(versionsDir)
	if err != nil {
		return []types.VersionInstance{}
	}
	out := []types.VersionInstance{}
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		verDir := filepath.Join(versionsDir, name)
		// CustomDir 指向 YSM custom 子目录（InstallModelTo/SyncToggleStatus 消费者依赖此路径）
		ysmCustom := filepath.Join(verDir, registry.SubDirMap("ysm"))
		exists := true
		if _, st := os.Stat(ysmCustom); os.IsNotExist(st) {
			exists = false
		}
		out = append(out, types.VersionInstance{
			Name:       name,
			VersionDir: verDir,
			CustomDir:  ysmCustom,
			Exists:     exists,
		})
	}
	return out
}

// listPrismInstances PrismLauncher 布局: {instancesDir}/{name}/.minecraft/ 或 minecraft/
func listPrismInstances(instancesDir string) []types.VersionInstance {
	ents, err := os.ReadDir(instancesDir)
	if err != nil {
		return []types.VersionInstance{}
	}
	out := []types.VersionInstance{}
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		// PrismLauncher 实例目录下可能是 .minecraft 或 minecraft（无点）
		mcDir := FindMinecraftDir(filepath.Join(instancesDir, name))
		if mcDir == "" {
			continue
		}
		// CustomDir 指向 YSM custom 子目录（InstallModelTo/SyncToggleStatus 消费者依赖此路径）
		ysmCustom := filepath.Join(mcDir, registry.SubDirMap("ysm"))
		exists := true
		if _, st := os.Stat(ysmCustom); os.IsNotExist(st) {
			exists = false
		}
		out = append(out, types.VersionInstance{
			Name:       name,
			VersionDir: mcDir,
			CustomDir:  ysmCustom,
			Exists:     exists,
		})
	}
	return out
}
