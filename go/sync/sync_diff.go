// ===== 同步对比单点化（ADR-064 阶段一）=====
// 从 sync.go / sync_hash.go 抽出的「归一化 key 对比」公共实现：
// SyncResources（文件级）此前内联「同名同大小 Synced / 同名不同大小 Missing /
// 仅单侧 Extra」归并逻辑（已随 CompareGlobalInstanceHashes 死代码清理删除，
// 本文件是唯一实现）——靠手工对齐口径漂移，近三轮连环 bug（深度守卫 /
// pack.mcmeta 门控 / FindInstDir 兜底）均为其代价。
// 现收敛为本文件单点实现，调用方只负责收集条目。
// 内容判定单点 = verdict.go|ContentVerdict（ADR-347：旧 contentDiffers 与本文件同源
// 收敛，夹内逐文件判定 diffFolderContentsCore 亦委托同一单点）。
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
	// 空=未知（>500MB 跳过大 zip、非 hashable、无 scanFn 旧调用），ResourceDiff 回退 Size 对比。
	// 目录型 pack 条目恒空（scanner 不逐条目哈希；其内容级判定见 FoldDigest）。
	Hash string
	// Oversize 该文件因超 MaxImportSize（>500MB）被**刻意跳过哈希**（bug-chronicle #36）。
	// 与 Hash 空但「设计上不哈希/无 scanFn」区分开：超限文件的同尺寸**不能**作为内容一致
	// 的证据（改内容可保持同尺寸），故 ContentVerdict 对其不再回退 Size 判 Synced，而是
	// 保守判「可能不同」（P0-2 诚实化，消灭 >500MB 静默假绿）。collect 按 info.Size() 设位。
	Oversize bool
	// FoldDigest 目录条目的「结构折叠指纹」（D2′-b / ADR-269，闭盲区②）：
	// collect 在 Walk 内对该 pack 文件夹下的全部子文件（含被 IsResourceAllowed 过滤、
	// 不成独立条目的 .png/.mcmeta 等）以「相对路径 + 大小」做顺序无关的 FNV 累积，
	// 形如 "hex(sum):count"。纹理/子文件的增删、改名、改大小都会翻转指纹 →
	// ContentVerdict 判 Missing。零新 I/O（复用 Walk 已得 os.FileInfo）、不依赖哈希
	// （scanFn=nil 的 UI 路径亦生效）。诚实局限：仅改字节不改大小（同尺寸重编码纹理）
	// 不在指纹内——逐文件哈希属热路径现算，触 hashlock 红线，故 D2′-b 不覆盖。
	// 空=文件条目 / 未折叠目录（回退恒 Synced，不回归）。
	FoldDigest string
}

// ResourceDiff 按调用方提供的 key（文件名或相对路径，ADR-064 阶段二统一为
// relKey 相对路径）对比两侧条目：
//   - 内容一致（文件：比哈希、无哈希回退比大小；目录：两侧折叠指纹一致）→ Synced
//   - 内容已变化（文件异哈希或无哈希时异大小 / 目录异折叠指纹）→ Missing + Diverged
//   - 仅全局有 → Missing
//   - 仅实例有 → Extra
//
// 内容判定统一走 verdict.go|ContentVerdict 单点（ADR-347：信道强度显式、全信道矩阵
// verdict_matrix_test.go 锁语义）；本函数只负责四桶归并（键存在性 + 排序确定性）。
//
// Diverged（ADR-340-d2）与 Missing 是**子集关系**而非互斥桶：前两者（两侧均有、内容不同）
// 同时进 Missing（保持既有归属，旧消费者零影响）与 Diverged（补回「待推送更新」这一维）。
// 消费端据此分辨「新建」与「覆盖实例侧已修改副本」——后者是用户侧不可逆的损失，
// 合并成一个 Missing 就等于把这件事从数据里删掉了。
//
// 结果排序保证输出确定性（map 归并迭代序随机，同输入同输出防 flaky）。
func ResourceDiff(global, instance map[string]DiffEntry) types.ResourceSyncResult {
	result := types.ResourceSyncResult{}
	for key, g := range global {
		if i, exists := instance[key]; exists {
			if differs, _ := ContentVerdict(g, i); differs {
				result.Diverged = append(result.Diverged, g.Path)
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
	sort.Strings(result.Diverged)
	return result
}
