// resource_guard.go：registry 模式不变量校验（原 resource.go 拆分，2026-10 文件行数治理）。
// validateRegistrySchema 的各个 guard* 单点出口——storage_sub_dir 唯一 / config 组唯一 /
// fallback 可解析 / 裸共享扩展名 / zip 锚点优先级 / scan-instance fallback 目录。
package registry

import (
	"fmt"
	"strings"
)

func validateRegistrySchema(reg *ResourceTypeRegistry) []string {
	var violations []string
	violations = append(violations, guardStorageSubDirUnique(reg)...)
	violations = append(violations, guardConfigFieldGroupUnique(reg)...)
	violations = append(violations, guardConfigFallbackResolvable(reg)...)
	violations = append(violations, guardNakedSharedExt(reg)...)
	violations = append(violations, guardSharedZipAnchorPriority(reg)...)
	violations = append(violations, guardScanInstanceFallbackDir(reg)...)
	return violations
}

// guardStorageSubDirUnique 守卫 1：storageSubDir 全局唯一。
// 重复值意味着两个类型落盘到同一路径——存储冲突。
func guardStorageSubDirUnique(reg *ResourceTypeRegistry) []string {
	var violations []string
	subDirOwners := make(map[string][]string) // storageSubDir → []typeID
	for _, rt := range reg.ResourceTypes {
		if rt.StorageSubDir != "" {
			subDirOwners[rt.StorageSubDir] = append(subDirOwners[rt.StorageSubDir], rt.ID)
		}
	}
	for subDir, owners := range subDirOwners {
		if len(owners) > 1 {
			violations = append(violations, fmt.Sprintf(
				"storageSubDir=%q 被多个类型声明: %v——存储路径冲突", subDir, owners))
		}
	}
	return violations
}

// guardConfigFieldGroupUnique 守卫 2：configField 组内唯一。
// 同组共享合法（mmd 家族 9 类型共享 MmdRoot 配置槽——用户配一次、组内各
// storageSubDir 挂其下；守卫 3 范例 L「vrc 经 configFallback 回退 MmdRoot」同
// 一族多消费方设计）；违规仅限同一字段被**不同组**的类型声明——配置槽归属歧义。
func guardConfigFieldGroupUnique(reg *ResourceTypeRegistry) []string {
	var violations []string
	configOwners := make(map[string]map[string][]string) // configField → group → []typeID
	for _, rt := range reg.ResourceTypes {
		if rt.ConfigField != "" {
			byGroup := configOwners[rt.ConfigField]
			if byGroup == nil {
				byGroup = make(map[string][]string)
				configOwners[rt.ConfigField] = byGroup
			}
			byGroup[rt.Group] = append(byGroup[rt.Group], rt.ID)
		}
	}
	for cfg, byGroup := range configOwners {
		if len(byGroup) > 1 {
			ids := make([]string, 0, len(byGroup))
			for _, gIDs := range byGroup {
				ids = append(ids, gIDs...)
			}
			violations = append(violations, fmt.Sprintf(
				"configField=%q 被多个组的类型声明: %v——配置槽归属歧义", cfg, ids))
		}
	}
	return violations
}

// guardConfigFallbackResolvable 守卫 3：configFallback 必须指向已声明的 configField，
// 否则该回退字段永远解析不到配置槽——孤儿回退。
func guardConfigFallbackResolvable(reg *ResourceTypeRegistry) []string {
	var violations []string
	declaredFields := make(map[string]bool, len(reg.ResourceTypes))
	for _, rt := range reg.ResourceTypes {
		if rt.ConfigField != "" {
			declaredFields[rt.ConfigField] = true
		}
	}
	for _, rt := range reg.ResourceTypes {
		if rt.ConfigFallback != "" && !declaredFields[rt.ConfigFallback] {
			violations = append(violations, fmt.Sprintf(
				"configFallback=%q 引用了不存在的 configField（类型 %s）——孤儿回退",
				rt.ConfigFallback, rt.ID))
		}
	}
	return violations
}

// guardNakedSharedExt 守卫 4：裸扩展名 last-wins 防护——仅靠共享扩展名、无任何
// 锚点/指纹/嵌套模式的类型在收敛后的 ClassifyExt（多声明者→"other"）下无法被识别，
// 是历史 last-wins 回归源。仅当该类型确有「裸扩展名兜底」需求（无 location 锚点、
// 无指纹、无嵌套模式）且至少依赖一个被多类型共享的扩展名时才告警——
// 单一声明者的裸扩展名（如 .fbx）合法。
func guardNakedSharedExt(reg *ResourceTypeRegistry) []string {
	var violations []string
	for _, rt := range reg.ResourceTypes {
		if !isNakedExtType(rt) {
			continue
		}
		for _, ext := range rt.EffectiveExtensions() {
			if owners := ExtBelongsToBy(ext, reg); len(owners) > 1 {
				violations = append(violations, fmt.Sprintf(
					"类型 %s 仅靠裸扩展名 %s 识别（无 location 锚点/无指纹），且该扩展名被 %v 共享——last-wins 回归源，必须补锚点或指纹",
					rt.ID, ext, owners))
				break
			}
		}
	}
	return violations
}

// isNakedExtType 判断类型是否「裸」：无 location 锚点、无容器指纹、无嵌套模式——
// 三重定位依据全缺，只能靠扩展名本身识别。
func isNakedExtType(rt ResourceType) bool {
	hasAnchor := rt.StorageSubDir != "" || rt.InstanceDir != ""
	return !hasAnchor && !hasContainerFingerprint(rt) && len(rt.NestedPatterns) == 0
}

// hasContainerFingerprint 判断类型是否具备容器内容识别能力（zip 条目特征或容器型 detector）。
// 守卫 4 的「指纹」与守卫 5 的「容器型」是同一判据，共用此处避免两处清单漂移。
func hasContainerFingerprint(rt ResourceType) bool {
	return len(rt.ZipEntries) > 0 ||
		strings.EqualFold(rt.Detector, "ysm") ||
		strings.EqualFold(rt.Detector, "mcmeta") ||
		strings.EqualFold(rt.Detector, "shader") ||
		strings.EqualFold(rt.Detector, "zipentry")
}

// guardSharedZipAnchorPriority 守卫 5：共享 .zip 且 location 锚点碰撞的容器型必须显式 priority。
// 收敛后 tiebreak 为 (priority desc, id asc)，但 priority==0 仍隐含「同 priority 取 id」，
// 为消除「注册序兜底」遗留语义，要求碰撞组内的 .zip 容器型显式声明 priority。
// 典型碰撞：blueprint 与 litematic 共享 instanceDir="schematics" 且均声明 .zip。
func guardSharedZipAnchorPriority(reg *ResourceTypeRegistry) []string {
	var violations []string
	anchorOwners := collectZipAnchorOwners(reg)
	for anchor, owners := range anchorOwners {
		if len(owners) < 2 {
			continue
		}
		ids := make([]string, 0, len(owners))
		for id := range owners {
			ids = append(ids, id)
		}
		for id, rt := range owners {
			if rt.Priority == 0 {
				violations = append(violations, fmt.Sprintf(
					"类型 %s 与 %v 共享 location 锚点 %q 且均声明 .zip——必须显式 priority 以消除注册序兜底",
					id, ids, anchor))
			}
		}
	}
	return violations
}

// collectZipAnchorOwners 收集 location 锚点（storageSubDir / instanceDir）→ 类型 ID → 类型的
// 归属表，仅收录「声明 .zip 且具容器识别能力」的类型——非容器型共用目录名不构成检测碰撞。
func collectZipAnchorOwners(reg *ResourceTypeRegistry) map[string]map[string]ResourceType {
	anchorOwners := make(map[string]map[string]ResourceType) // anchor → typeID → ResourceType
	for _, rt := range reg.ResourceTypes {
		if !declaresZipExt(rt) || !hasContainerFingerprint(rt) {
			continue
		}
		for _, a := range []string{rt.StorageSubDir, rt.InstanceDir} {
			if a == "" {
				continue
			}
			if anchorOwners[a] == nil {
				anchorOwners[a] = make(map[string]ResourceType)
			}
			anchorOwners[a][rt.ID] = rt
		}
	}
	return anchorOwners
}

// declaresZipExt 判断类型的有效扩展名集是否含 .zip（EffectiveExtensions 已小写化）。
func declaresZipExt(rt ResourceType) bool {
	for _, e := range rt.EffectiveExtensions() {
		if e == ".zip" {
			return true
		}
	}
	return false
}

// guardScanInstanceFallbackDir 守卫 6：scanInstance=true 必须声明 fallbackDir——兜底扫描
// （ScanInstance）目前只允许「注册表显式点名的兄弟目录」；缺 fallbackDir 会退回“任一兄弟目录
// 含扩展名即命中”的危险行为（structures/数据包混入）。未来类型若确需兼容多个目录名，
// 应显式扩展 fallbackDir 语义而非留空走非限定。
func guardScanInstanceFallbackDir(reg *ResourceTypeRegistry) []string {
	var violations []string
	for _, rt := range reg.ResourceTypes {
		if rt.ScanInstance && rt.FallbackDir == "" {
			violations = append(violations, fmt.Sprintf(
				"类型 %s scanInstance=true 必须声明 fallbackDir（限定兜底目录名），否则兜底会越界扫兄弟目录",
				rt.ID))
		}
	}
	return violations
}

// loadRegistryBytes 解析注册表字节，单一事实来源为编译期嵌入：
//  1. 显式路径（SetRegistryPath 设置的测试/自定义绝对路径，仅测试与显式覆盖使用）；
//  2. 编译期嵌入的单源字节 bundledRegistryJSON（由根包 main 经 embed.go 注入，
//     等同仓库根 resource_types.json；测试进程由各包 main_test.go 显式注入同一基线）。
//
// 注意：不再扫描 exe 同级/上级目录寻找 resource_types.json，亦无 CWD 相对回退
// 旧部署模型已废弃——zip 附带数据 JSON、updater 覆盖 exe 旁文件
// 已于 2026-08 废弃（见 internal/app/bundled_data.go：纯 exe 发布），残留的 exe 旁
// 快照或 CWD 下意外文件会静默遮蔽嵌入单源，导致「改了 root JSON 却不生效」。
// 嵌入单源即权威，杜绝漂移。
