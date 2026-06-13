// ===== 扩展名集中定义 =====
// 所有新增扩展名只需在此添加，resource_types.json 同步更新
// 重要：Go 端和前端 JS 都依赖此定义，保持两者一致
package types

import "strings"

// ResourceExts 每种资源类型对应的扩展名集合
var ResourceExts = map[string][]string{
	"ysm":              {".ysm", ".zip", ".7z", ".json"},
	"mmd-skin":         {".pmx", ".pmd"},
	"vrchat-avatar":    {".vrca", ".vrm"},
	"resourcepack":     {".zip"},
	"shaderpack":       {".zip"},
	"create-blueprint": {".nbt", ".schematic"},
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

// SubDirMap 每种资源类型在整合包实例中的子目录
func SubDirMap(rtype string) string {
	m := map[string]string{
		"ysm":              "config/yes_steve_model/custom",
		"resourcepack":     "resourcepacks",
		"shaderpack":       "shaderpacks",
		"create-blueprint": "schematics",
		"mmd-skin":         "3d-skin/EntityPlayer",
		"vrchat-avatar":    "vrchat-avatars",
	}
	return m[strings.ToLower(rtype)]
}

// AllSubDirs 返回所有资源类型的子目录信息（遍历用）
type SubDirEntry struct {
	SubDir string
	RType  string
}

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
