// ===== 扩展名集中定义 =====
// 所有新增扩展名只需在此添加，resource_types.json 同步更新
// 重要：Go 端和前端 JS 都依赖此定义，保持两者一致
package types

import (
	"os"
	"path/filepath"
	"strings"
)

// ResourceExts 每种资源类型对应的扩展名集合
var ResourceExts = map[string][]string{
	"ysm":              {".ysm", ".zip", ".7z", ".json"},
	"mmd-skin":         {".pmx", ".pmd"},
	"vrchat-avatar":    {".vrca", ".vrm"},
	"resourcepack":     {".zip"},
	"shaderpack":       {".zip"},
	"create-blueprint": {".nbt", ".schematic", ".litematic"},
}

// AllExts 所有支持的扩展名（去重后）
var AllExts = func() []string {
	seen := map[string]bool{}
	var result []string
	for _, exts := range ResourceExts {
		for _, e := range exts {
			if !seen[e] {
				seen[e] = true
				result = append(result, e)
			}
		}
	}
	return result
}()

// IsSupportedExt 检查扩展名是否被任何资源类型支持
func IsSupportedExt(ext string) bool {
	ext = strings.ToLower(ext)
	for _, exts := range ResourceExts {
		for _, e := range exts {
			if e == ext {
				return true
			}
		}
	}
	return false
}

// ExtBelongsTo 返回扩展名所属的资源类型 ID 列表（可能多个）
func ExtBelongsTo(ext string) []string {
	ext = strings.ToLower(ext)
	var result []string
	for rtype, exts := range ResourceExts {
		for _, e := range exts {
			if e == ext {
				result = append(result, rtype)
			}
		}
	}
	return result
}

// SupportedExtsForType 返回指定资源类型的所有扩展名
func SupportedExtsForType(rtype string) []string {
	return ResourceExts[strings.ToLower(rtype)]
}

// FindInstDir 查找整合包中指定资源类型的子目录：
// 1. 优先使用标准子目录名（如 schematics）
// 2. 如果标准目录不存在，扫描整合包版本目录下所有子目录，找包含该类型文件的目录
func FindInstDir(versionDir, subDir, rtype string) string {
	standard := filepath.Join(versionDir, subDir)
	if info, err := os.Stat(standard); err == nil && info.IsDir() {
		return standard
	}
	// 标准目录不存在，兜底扫描
	exts := SupportedExtsForType(rtype)
	if len(exts) == 0 {
		return standard // 没有扩展名信息，返回标准路径
	}
	entries, err := os.ReadDir(versionDir)
	if err != nil {
		return standard
	}
	extSet := make(map[string]bool)
	for _, e := range exts {
		extSet[e] = true
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		sub := filepath.Join(versionDir, e.Name())
		found := false
		filepath.WalkDir(sub, func(p string, d os.DirEntry, err error) error {
			if err != nil || found {
				return err
			}
			if !d.IsDir() && extSet[strings.ToLower(filepath.Ext(p))] {
				found = true
				return filepath.SkipAll
			}
			return nil
		})
		if found {
			return sub
		}
	}
	return standard // 没找到，返回标准路径（SyncResources 会找到空目录返回空结果）
}

// StorageSubDir 每种资源类型在 FilesRoot 下的存储子目录
func StorageSubDir(rtype string) string {
	switch rtype {
	case "ysm":
		return "ysm"
	case "resourcepack":
		return "resourcepacks"
	case "shaderpack":
		return "shaderpacks"
	case "create-blueprint":
		return "schematics"
	case "mmd-skin":
		return "mmd"
	case "vrchat-avatar":
		return "vrchat"
	default:
		return rtype
	}
}

// SubDirMap 每种资源类型在整合包实例中的子目录
// 注意：SubDirAll()、AllSubDirs() 都是独立实现的，新增条目时需同步更新三处
func SubDirMap(rtype string) string {
	m := SubDirAll()
	return m[strings.ToLower(rtype)]
}

// SubDirAll 返回完整的资源类型→子目录映射表（用于查询）
// 注意：新增条目时需同步更新 SubDirMap() 和 AllSubDirs()
func SubDirAll() map[string]string {
	return map[string]string{
		"ysm":              "config/yes_steve_model/custom",
		"resourcepack":     "resourcepacks",
		"shaderpack":       "shaderpacks",
		"create-blueprint": "schematics",
		"mmd-skin":         "3d-skin/EntityPlayer",
		"vrchat-avatar":    "vrchat-avatars",
	}
}

// AllSubDirs 返回所有资源类型的子目录信息（遍历用）
type SubDirEntry struct {
	SubDir string
	RType  string
}

// AllSubDirs 返回所有资源类型的子目录信息（遍历用）
// 注意：新增条目时需同步更新 SubDirMap() 和 SubDirAll()
func AllSubDirs() []SubDirEntry {
	return []SubDirEntry{
		{SubDir: "config/yes_steve_model/custom", RType: "ysm"},
		{SubDir: "resourcepacks",                  RType: "resourcepack"},
		{SubDir: "shaderpacks",                    RType: "shaderpack"},
		{SubDir: "schematics",                     RType: "create-blueprint"},
		{SubDir: "3d-skin/EntityPlayer",           RType: "mmd-skin"},
		{SubDir: "vrchat-avatars",                 RType: "vrchat-avatar"},
	}
}
