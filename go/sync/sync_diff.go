// ===== 同步对比单点化（ADR-064 阶段一）=====
// 从 sync.go / sync_hash.go 抽出的「归一化 key 对比」公共实现：
// SyncResources（文件级）此前内联「同名同大小 Synced / 同名不同大小 Missing /
// 仅单侧 Extra」归并逻辑（已随 CompareGlobalInstanceHashes 死代码清理删除，
// 本文件是唯一实现）——靠手工对齐口径漂移，近三轮连环 bug（深度守卫 /
// pack.mcmeta 门控 / FindInstDir 兜底）均为其代价。
// 现收敛为本文件单点实现，调用方只负责收集条目。
package sync

import (
	"sort"

	"ysm-model-manager/go/types"
)

// DiffEntry 一侧目录的同步条目（文件或资源包文件夹）。
type DiffEntry struct {
	Path  string
	Size  int64
	IsDir bool
	// Hash 文件级 SHA256，由 collect 旁挂 scanner 缓存哈希回填（D2′-a / ADR-269）。
	// 空=未知（>500MB 跳过大 zip、非 hashable、无 scanFn 旧调用），ResourceDiff 回退 Size 对比；
	// 目录型 pack 条目恒空（scanner 不逐条目哈希，其内容盲区属 D2′-b/c，本字段不覆盖）。
	Hash string
}

// ResourceDiff 按调用方提供的 key（文件名或相对路径，ADR-064 阶段二统一为
// relKey 相对路径）对比两侧条目：
//   - 内容一致（比哈希，无哈希时回退比大小；或含目录条目）→ Synced
//   - 内容已变化（异哈希，或无哈希时异大小）→ Missing（待推送更新）
//   - 仅全局有 → Missing
//   - 仅实例有 → Extra
//
// 结果排序保证输出确定性（map 归并迭代序随机，同输入同输出防 flaky）。
func ResourceDiff(global, instance map[string]DiffEntry) types.ResourceSyncResult {
	result := types.ResourceSyncResult{}
	for key, g := range global {
		if i, exists := instance[key]; exists {
			if contentDiffers(g, i) {
				result.Missing = append(result.Missing, g.Path)
			} else {
				result.Synced = append(result.Synced, g.Path)
			}
		} else {
			result.Missing = append(result.Missing, g.Path)
		}
	}
	for key, i := range instance {
		if _, exists := global[key]; !exists {
			result.Extra = append(result.Extra, i.Path)
		}
	}
	sort.Strings(result.Synced)
	sort.Strings(result.Missing)
	sort.Strings(result.Extra)
	return result
}

// contentDiffers 判定两侧同名条目内容是否不同（D2′-a / ADR-269）：
//   - 任一侧目录条目 → 视为相同（目录型 pack 内容盲区属 D2′-b/c，本切片不收紧，恒 Synced 保留现状）；
//   - 两侧均算出哈希 → 比哈希（异哈希即不同，即便 Size 相同——消除「改内容不改大小」的假绿）；
//   - 否则回退比 Size（空哈希：>500MB 大 zip / 非 hashable / 无 scanFn 旧调用 → 现状语义不回归）。
func contentDiffers(g, i DiffEntry) bool {
	if g.IsDir || i.IsDir {
		return false
	}
	if g.Hash != "" && i.Hash != "" {
		return g.Hash != i.Hash
	}
	return g.Size != i.Size
}
