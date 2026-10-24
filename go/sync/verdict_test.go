// verdict_test.go：判定表单点 ContentVerdict 的纯函数测试（ADR-347 D1/D4，2026-10-15）。
//
// 分工：本文件钉「信道名 + 分支优先级」（规则单元语义）；verdict_matrix_test.go 钉
// 「经 ResourceDiff / dirLevelResult / diffFolderContentsCore 全流程的判定结果」
// （语义锁，重构前后复跑对比）。两文件各管一段，同 ADR-347 D3 矩阵纪律。
package sync

import (
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

func TestContentVerdictChannels(t *testing.T) {
	cases := []struct {
		name   string
		g, i   DiffEntry
		wantD  bool
		wantCH string
	}{
		// fold 信道（目录）
		{"目录双指纹同", DiffEntry{IsDir: true, FoldDigest: "A:1"}, DiffEntry{IsDir: true, FoldDigest: "A:1"}, false, VerdictChannelFold},
		{"目录双指纹异", DiffEntry{IsDir: true, FoldDigest: "A:1"}, DiffEntry{IsDir: true, FoldDigest: "B:2"}, true, VerdictChannelFold},
		{"目录单侧指纹空 → none（存在性语义，ADR-344 D2）", DiffEntry{IsDir: true}, DiffEntry{IsDir: true, FoldDigest: "B:2"}, false, VerdictChannelNone},
		{"双侧 IsDir + 异 Size → none（目录不比 Size，存在性语义优先）", DiffEntry{IsDir: true, Size: 1}, DiffEntry{IsDir: true, Size: 2}, false, VerdictChannelNone},
		// hash 信道
		{"双哈希同", DiffEntry{Hash: "H", Size: 1}, DiffEntry{Hash: "H", Size: 1}, false, VerdictChannelHash},
		{"双哈希异（同尺寸）", DiffEntry{Hash: "H1", Size: 1}, DiffEntry{Hash: "H2", Size: 1}, true, VerdictChannelHash},
		// oversize 信道（P0-2 诚实化）
		{"单侧 Oversize（无哈希）", DiffEntry{Oversize: true, Size: 9}, DiffEntry{Size: 9}, true, VerdictChannelOversize},
		// size 兜底信道
		{"单侧无哈希 + 同尺寸", DiffEntry{Hash: "H", Size: 9}, DiffEntry{Size: 9}, false, VerdictChannelSize},
		{"单侧无哈希 + 异尺寸", DiffEntry{Hash: "H", Size: 9}, DiffEntry{Size: 8}, true, VerdictChannelSize},
		{"双侧无哈希 + 同尺寸", DiffEntry{Size: 9}, DiffEntry{Size: 9}, false, VerdictChannelSize},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d, ch := ContentVerdict(c.g, c.i)
			// 原复合条件拆序贯
			testutil.Equal(t, d, c.wantD, "ContentVerdict(%+v, %+v) differs", c.g, c.i)
			testutil.Equal(t, ch, c.wantCH, "ContentVerdict(%+v, %+v) channel", c.g, c.i)
		})
	}
}

// 分支序钉死：IsDir 分支先于 Oversize 信道（目录条目即使误置 Oversize 也走 none/fold，
// 不翻 oversize 腿——与旧 contentDiffers 的分支序一致，ADR-347 语义不变）。
func TestContentVerdict_BranchOrder_DirBeforeOversize(t *testing.T) {
	g, i := DiffEntry{IsDir: true, Oversize: true, FoldDigest: ""}, DiffEntry{IsDir: true}
	d, ch := ContentVerdict(g, i)
	// 原复合条件拆序贯
	testutil.Equal(t, d, false, "目录 + Oversize 误走 oversize 腿：got (%v, %q)，want (false, %q)", d, ch, VerdictChannelNone)
	testutil.Equal(t, ch, VerdictChannelNone, "目录 + Oversize 误走 oversize 腿：got (%v, %q)，want (false, %q)", d, ch, VerdictChannelNone)
}
