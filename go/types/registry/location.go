package registry

import (
	"path/filepath"
	"strings"
)

// TypeByLocation 祖先目录归属判定（location 路由，MMD 子类型共享扩展名消歧）：
// path 的祖先目录命中某类型 storageSubDir/instanceDir（后缀匹配）即归该类型，
// 不校验扩展名——模型包目录下的容器/表情/动作/贴图文件都是该类型资源
// （mmd/PMX/角色包.zip → EntityPlayer）。深目录优先：mmd/PMX/DefaultMorph/ 下
// 文件归 DefaultMorph（而非外层 EntityPlayer）。未命中返回 ""。
//
// 背景（2026-08-23）：统计链路曾直接用 repoaudit.Classify(ext)，共享扩展名
// （.zip 被 14 类型声明）last-wins 归最后一个声明者，mmd/PMX 下 217 个模型包
// zip 全部误归 DefaultMorph；目录归属优先于扩展名归属是本路由的语义。
func TypeByLocation(path string, registry *ResourceTypeRegistry) string {
	if registry == nil || len(registry.ResourceTypes) == 0 {
		return ""
	}
	dir := filepath.Dir(path)
	if dir == "." || dir == "" {
		return ""
	}
	// 祖先目录收集（深 → 浅，filepath.Dir 逐级上溯）
	var ancestors []string
	d := dir
	for d != "." && d != "" && d != string(filepath.Separator) {
		ancestors = append(ancestors, d)
		parent := filepath.Dir(d)
		if parent == d {
			break
		}
		d = parent
	}
	for _, anc := range ancestors {
		ancNorm := filepath.ToSlash(strings.ToLower(anc))
		for _, rt := range registry.ResourceTypes {
			for _, c := range []string{rt.InstanceDir, rt.StorageSubDir} {
				if c == "" {
					continue
				}
				cNorm := filepath.ToSlash(strings.ToLower(c))
				if ancNorm == cNorm || strings.HasSuffix(ancNorm, "/"+cNorm) {
					return rt.ID
				}
			}
		}
	}
	return ""
}
