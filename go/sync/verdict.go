// verdict.go：两侧条目内容判定单点（ADR-347 D1/D4，2026-10-15）。
//
// 立因（散落判定病）：「两侧内容是否不同」的规则曾有**两份同义实现**
// （原 sync_diff.go|contentDiffers 与 sync_dirlevel_diff.go|diffFolderContentsCore 的
// contentStatus 闭包，都是「哈希优先 / Size 兜底」）——每加一条新信道（哈希、折叠指纹、
// 超限标记…）都要人肉核对每份实现是否同步升级，漏一份即静默判定退化（ADR-344 D1 先例：
// dirLevel 单元缺内容字段 → 「平铺模型改内容恒判 Synced」假绿）。
// 本文件把两份实现收敛为单一纯函数 ContentVerdict：输入 = 两侧完整状态（信道强度是显式
// 字段——哈希有无、Oversize 置位、FoldDigest、IsDir），输出 = (是否不同, 判定所用信道)。
// 全信道语义锁 = verdict_matrix_test.go（ADR-347 D3：先打现行实现钉基线，重构后复跑对比）。
//
// 判定表的边界（不做什么，同 ADR-347 范围边界）：
//   - 只管「同键两侧内容判定」——四桶归并（missing/extra/diverged 归属）仍是 ResourceDiff；
//   - 键碰撞（upsertDirLevelUnit last-write-wins）是 collect 层记录，不是内容判定；
//   - dirLevel 跨格式守卫（dirLevelDiffEntries 的内容字段填充规则）是信道元数据填充，保留原位。
package sync

// 判定信道名（诊断信道：本次判定实际走了哪条腿——ADR-347 D4 信道强度显式化）。
// 未来「假绿收据」（体检页）按信道挂账；新增信道 = 加一个判定输入字段 + 一个常量 +
// verdict_matrix_test.go 加一行矩阵（签名层面挡住静默退化）。
const (
	VerdictChannelFold     = "fold"     // 目录折叠指纹对比（D2′-b；异指纹 = 夹内容变）
	VerdictChannelHash     = "hash"     // 两侧 SHA256 对比（D2′-a；异哈希 = 同大小异内容）
	VerdictChannelOversize = "oversize" // 任一侧超限（>MaxImportSize）被刻意跳过哈希 → 保守「可能不同」（P0-2 诚实化）
	VerdictChannelSize     = "size"     // 无哈希回退比 Size（非 hashable / 无 scanFn 的原语义，非假绿）
	VerdictChannelNone     = "none"     // 退化语义：目录未折叠（ADR-344 D2 存在性）/ 跨格式同身份（ADR-344 D1）
)

// ContentVerdict 单点判定两侧同键条目内容是否不同 + 所用判定信道（ADR-347 D1/D4）。
//
// 规则（单一事实源，取代旧 contentDiffers 与 diffFolderContentsCore.contentStatus 两份
// 同义实现）：
//  1. 目录条目（任一侧 IsDir）：两侧折叠指纹均在 → 比指纹（fold）；任一侧指纹空
//     （未折叠 / 旧数据）→ 视为相同（none，存在性语义，ADR-344 D2——scan 信道产不出
//     目录指纹，只在 Walk 侧加会让两信道劈裂，不回归）；
//  2. 两侧哈希均在 → 比哈希（hash；消除「改内容不改大小」假绿）；
//  3. 任一侧因超限被刻意跳过哈希（Oversize 置位）→ 保守判「可能不同」（oversize；
//     同尺寸不足以证明内容一致，P0-2 诚实化——仅对 collect 明确置位者生效）；
//  4. 其余 → 比 Size（size；空哈希的非 hashable / 无 scanFn 场景按大小判是原语义，非假绿）。
//
// 纯函数、零 I/O；DiffEntry 由调用方按自身信道填充（缺的元数据留零值 = 信道如实降级）。
func ContentVerdict(g, i DiffEntry) (differs bool, channel string) {
	if g.IsDir || i.IsDir {
		if g.FoldDigest != "" && i.FoldDigest != "" {
			return g.FoldDigest != i.FoldDigest, VerdictChannelFold
		}
		return false, VerdictChannelNone
	}
	if g.Hash != "" && i.Hash != "" {
		return g.Hash != i.Hash, VerdictChannelHash
	}
	if g.Oversize || i.Oversize {
		return true, VerdictChannelOversize
	}
	return g.Size != i.Size, VerdictChannelSize
}
