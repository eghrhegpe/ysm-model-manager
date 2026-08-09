// ===== 整合包实例同步状态组装（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 GetInstanceSyncStatus 提取组装逻辑；
// 纯 Go 逻辑，无 Wails runtime 依赖；McRoot/注册表/仓库根目录由薄壳注入。
package instance

import (
	"os"
	"path/filepath"
	"strings"

	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
)

// ResourceTypeInfo 资源类型注册表条目（BuildSyncItems 需要的字段）
type ResourceTypeInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
}

// BuildSyncItems 组装整合包内各资源类型的同步状态项（纯逻辑，root 由调用方注入）
func BuildSyncItems(ins *types.VersionInstance, rtypes []ResourceTypeInfo, repoRoots map[string]string) []types.ResourceSyncItem {
	// 各资源类型允许的扩展名（防止跨类型混入如 .pmx 出现在 VRC 中）
	extMatch := func(name, rtype string) bool {
		exts := types.SupportedExtsForType(rtype)
		if len(exts) == 0 {
			return true
		}
		low := strings.ToLower(name)
		// 去掉 .disabled/.ban 后缀后再匹配
		base := strings.TrimSuffix(low, ".disabled")
		base = strings.TrimSuffix(base, ".ban")
		// YSM 的 .json 仅允许 ysm.json（其他是动作/动画文件，不应单独展示）
		if rtype == "ysm" && strings.HasSuffix(base, ".json") && base != "ysm.json" {
			return false
		}
		for _, e := range exts {
			if strings.HasSuffix(base, e) {
				return true
			}
		}
		return false
	}
	sizeOf := func(path string) int64 {
		fi, err := os.Stat(path)
		if err != nil {
			return 0
		}
		return fi.Size()
	}

	var items []types.ResourceSyncItem

	for _, rt := range rtypes {
		subDir := types.SubDirMap(rt.ID)
		if subDir == "" {
			continue
		}
		// 全局目录
		globalDir := repoRoots[rt.ID]
		if globalDir == "" {
			continue
		}
		// 整合包子目录——先试标准目录，再兜底扫描
		instDir := types.FindInstDir(ins.VersionDir, subDir, rt.ID)
		// 展示用文件级同步（推送时再用文件夹级推送）
		result := ysmsync.SyncResources(globalDir, instDir)

		for _, p := range result.Synced {
			if !extMatch(filepath.Base(p), rt.ID) && !isResourcePackFolder(p) {
				continue
			}
			// 检测是否有 .disabled/.ban 后缀标记禁用状态
			lowName := strings.ToLower(filepath.Base(p))
			isDisabled := strings.HasSuffix(lowName, ".disabled") || strings.HasSuffix(lowName, ".ban")
			status := types.SyncStatusSynced
			statusIcon := rt.Icon
			if isDisabled {
				status = types.SyncStatusDisabled
				statusIcon = "⛔"
			}
			items = append(items, types.ResourceSyncItem{
				Path: p, Name: filepath.Base(p),
				Status: status, Type: rt.ID, Icon: statusIcon, Size: sizeOf(p),
			})
		}
		for _, p := range result.Missing {
			if !extMatch(filepath.Base(p), rt.ID) && !isResourcePackFolder(p) {
				continue
			}
			items = append(items, types.ResourceSyncItem{
				Path: p, Name: filepath.Base(p),
				Status: types.SyncStatusMissing, Type: rt.ID, Icon: rt.Icon, Size: sizeOf(p),
			})
		}
		for _, p := range result.Extra {
			if !extMatch(filepath.Base(p), rt.ID) && !isResourcePackFolder(p) {
				continue
			}
			// 检测是否为硬链接（来自旧仓库的遗留文件）
			status := types.SyncStatusOptional
			icon := rt.Icon
			if ysmsync.GetLinkType(p) == types.LinkHard {
				status = types.SyncStatusLegacy
				icon = "🔗"
			}
			items = append(items, types.ResourceSyncItem{
				Path: p, Name: filepath.Base(p),
				Status: status, Type: rt.ID, Icon: icon, Size: sizeOf(p),
			})
		}
		// 对于非模型类型（光影包/蓝图/资源包），额外扫描整合包目录中所有未被 SyncResources 覆盖的文件
		// （SyncResources 的 map 去重会丢失同名文件）
		if rt.ID == "shaderpack" || rt.ID == "create-blueprint" || rt.ID == "resourcepack" {
			// 已由 result 覆盖的文件名集合（避免额外扫描重复添加）。
			// P2 修复：只记录「确实展示」的条目名（extMatch 通过者），
			// 否则资源包文件夹名已被 result 记录 → seenNames 命中 → 兜底 Walk 的
			// 文件夹分支被跳过，导致「未解压资源包文件夹」永远不出现在同步列表
			seenNames := map[string]bool{}
			for _, p := range result.Extra {
				if extMatch(filepath.Base(p), rt.ID) {
					seenNames[strings.ToLower(filepath.Base(p))] = true
				}
			}
			for _, p := range result.Synced {
				if extMatch(filepath.Base(p), rt.ID) {
					seenNames[strings.ToLower(filepath.Base(p))] = true
				}
			}
			for _, p := range result.Missing {
				if extMatch(filepath.Base(p), rt.ID) {
					seenNames[strings.ToLower(filepath.Base(p))] = true
				}
			}
			_ = filepath.Walk(instDir, func(path string, info os.FileInfo, err error) error {
				if err != nil {
					return nil
				}
				if info.IsDir() {
					// 资源包文件夹（含 pack.mcmeta）
					if path != instDir && isResourcePackFolder(path) {
						low := strings.ToLower(info.Name())
						if !seenNames[low] {
							items = append(items, types.ResourceSyncItem{
								Path: path, Name: info.Name(),
								Status: types.SyncStatusOptional, Type: rt.ID, Icon: rt.Icon, Size: 0,
							})
						}
					}
					return nil
				}
				low := strings.ToLower(info.Name())
				// P2 修复：兜底过滤改用 extMatch（注册表驱动）而非硬编码后缀清单——
				// 原硬编码含 .litematic（蓝图与 litematic 共享 schematics 目录时，
				// .litematic 文件被蓝图兜底重复加为 optional，且 litematic 类型又产出一条）；
				// 注册表蓝图扩展名不含 .litematic，extMatch 天然排除跨类型重复
				if !extMatch(info.Name(), rt.ID) {
					return nil
				}
				if seenNames[low] {
					return nil
				}
				items = append(items, types.ResourceSyncItem{
					Path: path, Name: info.Name(),
					Status: types.SyncStatusOptional, Type: rt.ID, Icon: rt.Icon, Size: info.Size(),
				})
				return nil
			})
		}
	}
	return items
}

// isResourcePackFolder 检查目录是否是资源包文件夹（内含 pack.mcmeta）
func isResourcePackFolder(path string) bool {
	_, err := os.Stat(filepath.Join(path, "pack.mcmeta"))
	return err == nil
}
