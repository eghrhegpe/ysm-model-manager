package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/dedup"
	"ysm-model-manager/go/importer"
	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/types"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// LoadResourceTypes 加载资源类型注册表
func (a *App) LoadResourceTypes() string {
	data, err := os.ReadFile("resource_types.json")
	if err != nil {
		return "{}"
	}
	return string(data)
}

// ReadPackMeta 读取材质包信息（pack.mcmeta + pack.png）
func (a *App) ReadPackMeta(path string) string {
	meta, thumb, err := packs.ReadPackMeta(path)
	if err != nil {
		return "{}"
	}
	data, _ := json.Marshal(map[string]interface{}{
		"pack_format": meta.Pack.PackFormat,
		"description": meta.Pack.Description,
		"thumbnail":   thumb,
	})
	return string(data)
}

// DetectResourceType 检测指定文件的资源类型
func (a *App) DetectResourceType(path string) string {
	var registry types.ResourceTypeRegistry
	if data, err := os.ReadFile("resource_types.json"); err == nil {
		json.Unmarshal(data, &registry)
	}
	return packs.DetectResourceType(path, &registry)
}

// GetRepoRoot 根据资源类型返回对应的仓库根目录
func (a *App) GetRepoRoot(rtype string) string {
	cfg := a.LoadAppConfig()
	switch rtype {
	case "resourcepack":
		if cfg.ResourcepackRoot != "" {
			return cfg.ResourcepackRoot
		}
		if cfg.McRoot != "" {
			return cfg.McRoot + "/resourcepacks"
		}
		return ""
	case "shaderpack":
		if cfg.ShaderpackRoot != "" {
			return cfg.ShaderpackRoot
		}
		if cfg.McRoot != "" {
			return cfg.McRoot + "/shaderpacks"
		}
		return ""
	case "create-blueprint":
		if cfg.SchematicRoot != "" {
			return cfg.SchematicRoot
		}
		if cfg.McRoot != "" {
			return cfg.McRoot + "/schematics"
		}
		return ""
	case "mmd-skin":
		if cfg.MmdRoot != "" {
			return cfg.MmdRoot
		}
		if cfg.McRoot != "" {
			return cfg.McRoot + "/3d-skin/EntityPlayer"
		}
		return ""
	case "vrchat-avatar":
		if cfg.VrcRoot != "" {
			return cfg.VrcRoot
		}
		if cfg.McRoot != "" {
			return cfg.McRoot + "/vrchat-avatars"
		}
		return ""
	default:
		return cfg.RepoRoot
	}
}

// ToggleResourcePack 切换材质包的启用/禁用状态（.zip ↔ .zip.disabled）
func (a *App) ToggleResourcePack(path string) bool {
	disabled := strings.HasSuffix(path, ".disabled")
	var src, dst string
	if disabled {
		src = path
		dst = strings.TrimSuffix(path, ".disabled")
	} else {
		src = path
		dst = path + ".disabled"
	}
	if err := os.Rename(src, dst); err != nil {
		return false
	}
	return true
}

// IsResourcePackEnabled 检查材质包是否启用
func (a *App) IsResourcePackEnabled(path string) bool {
	return !strings.HasSuffix(path, ".disabled")
}

// SelectImportZip 打开文件选择器选取 .zip 文件
func (a *App) SelectImportZip() string {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择资源包文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "ZIP 资源包", Pattern: "*.zip"},
		},
	})
	if err != nil {
		return ""
	}
	return path
}

// SelectImportFile 打开文件选择器，按给定扩展名过滤
// filter 格式: "显示名|*.ext1;*.ext2"
func (a *App) SelectImportFile(filter, title string) string {
	var filters []runtime.FileFilter
	if filter != "" {
		parts := strings.SplitN(filter, "|", 2)
		if len(parts) == 2 {
			filters = append(filters, runtime.FileFilter{
				DisplayName: parts[0],
				Pattern:     parts[1],
			})
		}
	}
	if title == "" {
		title = "选择文件"
	}
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   title,
		Filters: filters,
	})
	if err != nil {
		return ""
	}
	return path
}

// SetResourceRoot 设置指定资源类型的自定义根路径（空=恢复默认）
func (a *App) SetResourceRoot(rtype, path string) error {
	cfg := a.LoadAppConfig()
	switch rtype {
	case "shaderpack":
		cfg.ShaderpackRoot = path
	case "create-blueprint":
		cfg.SchematicRoot = path
	case "mmd-skin":
		cfg.MmdRoot = path
	case "vrchat-avatar":
		cfg.VrcRoot = path
	case "resourcepack":
		cfg.ResourcepackRoot = path
	case "ysm":
		cfg.RepoRoot = path
	default:
		cfg.RepoRoot = path
	}
	return a.saveConfig(cfg)
}

// ResetResourceRoot 恢复指定资源类型的路径为默认（清空自定义值）
func (a *App) ResetResourceRoot(rtype string) error {
	return a.SetResourceRoot(rtype, "")
}

// saveConfig 写入配置到文件
func (a *App) saveConfig(cfg types.AppConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath(), data, 0644)
}

// ImportResourcePack 使用策略模式导入资源包
func (a *App) ImportResourcePack(srcPath, rtype string) string {
	dstDir := a.GetRepoRoot(rtype)
	if dstDir == "" {
		return "未设置" + rtype + "目录"
	}
	h := importer.Get(rtype)
	if h == nil {
		return fmt.Sprintf("未知的资源类型: %s", rtype)
	}
	return h.Import(srcPath, dstDir)
}

// ImportByType 统一导入入口——根据资源类型自动选择导入策略
func (a *App) ImportByType(rtype, srcPath string) string {
	h := importer.Get(rtype)
	if h == nil {
		return fmt.Sprintf("未找到资源类型 %s 的导入策略", rtype)
	}
	dstDir := a.GetRepoRoot(rtype)
	if dstDir == "" {
		return "未设置" + rtype + "目录"
	}
	return h.Import(srcPath, dstDir)
}

// DeleteResourcePack 删除资源包文件
func (a *App) DeleteResourcePack(path string) error {
	return os.Remove(path)
}

// DeleteModelDir 删除文件夹型资源（MMD 模型等），删除文件所在父文件夹
func (a *App) DeleteModelDir(path string) error {
	return os.RemoveAll(filepath.Dir(path))
}

// FindDuplicateFiles 扫描目录返回所有重复文件分组（JSON 字符串）
func (a *App) FindDuplicateFiles(dir string) string {
	groups, err := dedup.FindDuplicateFiles(dir, true)
	if err != nil {
		return "[]"
	}
	data, _ := json.Marshal(groups)
	return string(data)
}

// CountDuplicateFiles 快速统计重复文件数量
func (a *App) CountDuplicateFiles(dir string) string {
	groups, extra, err := dedup.CountDuplicates(dir, true)
	if err != nil {
		return `{"groups":0,"extra":0}`
	}
	data, _ := json.Marshal(map[string]int{"groups": groups, "extra": extra})
	return string(data)
}

// InstallResourceToInstance 将资源文件安装到指定整合包
// rtype: 资源类型（resourcepack/shaderpack 等），srcPath: 源文件路径，instanceName: 整合包名称
func (a *App) InstallResourceToInstance(rtype, srcPath, instanceName string) error {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return fmt.Errorf("请先设置游戏根目录")
	}

	// 查找目标整合包
	instances := a.ListVersionInstances(cfg.McRoot)
	var target *types.VersionInstance
	for i := range instances {
		if instances[i].Name == instanceName {
			target = &instances[i]
			break
		}
	}
	if target == nil {
		return fmt.Errorf("未找到整合包: %s", instanceName)
	}

	// 根据 rtype 确定安装子目录
	var subDir string
	switch rtype {
	case "resourcepack":
		subDir = "resourcepacks"
	case "shaderpack":
		subDir = "shaderpacks"
	case "create-blueprint":
		subDir = "schematics"
	case "mmd-skin":
		subDir = "3d-skin/EntityPlayer"
	case "vrchat-avatar":
		subDir = "vrchat-avatars"
	case "ysm":
		subDir = "config/yes_steve_model/custom"
	default:
		// 从 resource_types.json 读取
		var registry struct {
			ResourceTypes []struct {
				ID         string `json:"id"`
				InstallDir string `json:"installDir"`
			} `json:"resourceTypes"`
		}
		if data, err := os.ReadFile("resource_types.json"); err == nil {
			json.Unmarshal(data, &registry)
			for _, rt := range registry.ResourceTypes {
				if rt.ID == rtype {
					subDir = rt.InstallDir
					break
				}
			}
		}
		if subDir == "" {
			return fmt.Errorf("未知的资源类型: %s", rtype)
		}
	}

	// 目标路径 = 整合包版本目录 + 子目录
	dstDir := filepath.Join(target.VersionDir, subDir)

	// 统一走 installer.Install，复用链接模式支持
	globalRoot := a.GetRepoRoot(rtype)
	return installer.Install(srcPath, dstDir, globalRoot, a.LinkMode)
}
