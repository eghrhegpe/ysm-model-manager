// verdict_matrix_test.go：同步判定全信道矩阵（ADR-347 D3，2026-10-15）。
//
// 作用：把「两侧各是什么状态 → 判什么同步状态」的现行语义**逐行钉成基线**——
// 矩阵先打现行实现（全绿 = 今天语义的快照，含边缘行为），再作为判定表
// （verdict.go）重构的语义锁：重构后矩阵复跑必须全绿（判定结果字节级不变）。
//
// 四个信道区段（对应 ADR-347 的判定片）+ 冲突视图区段（ADR-351 D2）：
//   - A 文件级（ResourceDiff / contentDiffers，ADR-269 / 340-d2）：哈希双有 / 单侧 /
//     Oversize / Size 兜底 / 单侧存在
//   - B 目录单元（FoldDigest，ADR-344 D2）：双有指纹 / 异指纹 / 单侧空（存在性语义）
//   - C dirLevel 单元表（dirLevelResult，ADR-344 D1 跨格式守卫）：同名夹 / 跨格式同键
//   - D 夹内逐文件（diffFolderContentsCore，D2′-c）：哈希优先 / 单侧存在
//   - E 冲突视图（conflictFromVerdict，ADR-351 D2）：判定表输出 × 哈希缺失 → 冲突类型
//
// 矩阵只钉判定结果（四桶 / Status）；P0 键碰撞 Warnings 信道由
// sync_dirlevel_collision_test.go 专属守护，两测试各管一段。
// 本文件是 ADR-347 的回归资产：判定表实施后旧散落判定删除，矩阵仍全绿。
package sync

import (
	"testing"

	"ysm-model-manager/go/types"
)

// ── A 区：文件级判定（ResourceDiff 直接喂 DiffEntry 映射，零磁盘 I/O）─────────────

func TestVerdictMatrix_FileLevel(t *testing.T) {
	cases := []struct {
		name    string
		global  map[string]DiffEntry
		instanc map[string]DiffEntry
		want    types.ResourceSyncResult
	}{
		{"A1 双有哈希且同 → Synced",
			map[string]DiffEntry{"a.zip": {Path: "g/a.zip", Size: 10, Hash: "H"}},
			map[string]DiffEntry{"a.zip": {Path: "i/a.zip", Size: 10, Hash: "H"}},
			types.ResourceSyncResult{Synced: []string{"g/a.zip"}}},
		{"A2 双有哈希且异（同尺寸）→ Diverged ∪ Missing（同大小异内容不再假绿）",
			map[string]DiffEntry{"a.zip": {Path: "g/a.zip", Size: 10, Hash: "H1"}},
			map[string]DiffEntry{"a.zip": {Path: "i/a.zip", Size: 10, Hash: "H2"}},
			types.ResourceSyncResult{Missing: []string{"g/a.zip"}, Diverged: []string{"g/a.zip"}}},
		{"A3 单侧无哈希 + 同尺寸 → Size 兜底 Synced",
			map[string]DiffEntry{"a.zip": {Path: "g/a.zip", Size: 10, Hash: "H"}},
			map[string]DiffEntry{"a.zip": {Path: "i/a.zip", Size: 10}},
			types.ResourceSyncResult{Synced: []string{"g/a.zip"}}},
		{"A4 单侧无哈希 + 异尺寸 → Size 兜底 Diverged",
			map[string]DiffEntry{"a.zip": {Path: "g/a.zip", Size: 11, Hash: "H"}},
			map[string]DiffEntry{"a.zip": {Path: "i/a.zip", Size: 10}},
			types.ResourceSyncResult{Missing: []string{"g/a.zip"}, Diverged: []string{"g/a.zip"}}},
		{"A5 双侧无哈希 + 同尺寸 → Synced（非 hashable / 无 scanFn 原语义，非假绿）",
			map[string]DiffEntry{"a.zip": {Path: "g/a.zip", Size: 10}},
			map[string]DiffEntry{"a.zip": {Path: "i/a.zip", Size: 10}},
			types.ResourceSyncResult{Synced: []string{"g/a.zip"}}},
		{"A6 仅全局有 → Missing（新建，非 Diverged）",
			map[string]DiffEntry{"a.zip": {Path: "g/a.zip", Size: 10}},
			map[string]DiffEntry{},
			types.ResourceSyncResult{Missing: []string{"g/a.zip"}}},
		{"A7 仅实例有 → Extra",
			map[string]DiffEntry{},
			map[string]DiffEntry{"b.ysm": {Path: "i/b.ysm", Size: 5}},
			types.ResourceSyncResult{Extra: []string{"i/b.ysm"}}},
		{"A8 任一侧 Oversize（同尺寸）→ 保守判 Diverged（P0-2 诚实化，不谎报 Synced）",
			map[string]DiffEntry{"big.zip": {Path: "g/big.zip", Size: 10, Oversize: true}},
			map[string]DiffEntry{"big.zip": {Path: "i/big.zip", Size: 10}},
			types.ResourceSyncResult{Missing: []string{"g/big.zip"}, Diverged: []string{"g/big.zip"}}},
		{"A9 双侧无哈希异尺寸 → Diverged",
			map[string]DiffEntry{"a.zip": {Path: "g/a.zip", Size: 11}},
			map[string]DiffEntry{"a.zip": {Path: "i/a.zip", Size: 10}},
			types.ResourceSyncResult{Missing: []string{"g/a.zip"}, Diverged: []string{"g/a.zip"}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ResourceDiff(c.global, c.instanc)
			assertMatrixResult(t, c.name, got, c.want)
		})
	}
}

// ── B 区：目录单元判定（FoldDigest，ADR-344 D2 存在性语义边界）──────────────────────

func TestVerdictMatrix_DirUnit(t *testing.T) {
	cases := []struct {
		name    string
		global  map[string]DiffEntry
		instanc map[string]DiffEntry
		want    types.ResourceSyncResult
	}{
		{"B1 目录双有折叠指纹且同 → Synced",
			map[string]DiffEntry{"f/": {Path: "g/f", IsDir: true, FoldDigest: "D:2"}},
			map[string]DiffEntry{"f/": {Path: "i/f", IsDir: true, FoldDigest: "D:2"}},
			types.ResourceSyncResult{Synced: []string{"g/f"}}},
		{"B2 目录双有折叠指纹且异 → Diverged（夹内容变）",
			map[string]DiffEntry{"f/": {Path: "g/f", IsDir: true, FoldDigest: "D:2"}},
			map[string]DiffEntry{"f/": {Path: "i/f", IsDir: true, FoldDigest: "E:3"}},
			types.ResourceSyncResult{Missing: []string{"g/f"}, Diverged: []string{"g/f"}}},
		{"B3 目录单侧指纹空（未折叠）→ 存在性语义 Synced（ADR-344 D2 不回归）",
			map[string]DiffEntry{"f/": {Path: "g/f", IsDir: true}},
			map[string]DiffEntry{"f/": {Path: "i/f", IsDir: true, FoldDigest: "E:3"}},
			types.ResourceSyncResult{Synced: []string{"g/f"}}},
		{"B4 目录仅全局有 → Missing",
			map[string]DiffEntry{"f/": {Path: "g/f", IsDir: true}},
			map[string]DiffEntry{},
			types.ResourceSyncResult{Missing: []string{"g/f"}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ResourceDiff(c.global, c.instanc)
			assertMatrixResult(t, c.name, got, c.want)
		})
	}
}

// ── C 区：dirLevel 单元表（dirLevelResult；跨格式同键守卫，ADR-344 D1）──────────────

func TestVerdictMatrix_DirLevel(t *testing.T) {
	cases := []struct {
		name     string
		globalU  map[string]dirLevelUnit
		instancU map[string]dirLevelUnit
		want     types.ResourceSyncResult
	}{
		{"C1 同名夹两侧 → Synced",
			map[string]dirLevelUnit{"f": {Path: "g/f", Rel: "f", IsDir: true}},
			map[string]dirLevelUnit{"f": {Path: "i/f", Rel: "f", IsDir: true}},
			types.ResourceSyncResult{Synced: []string{"g/f"}}},
		{"C2 跨格式同键（B.ysm vs B.zip 同键、Rel 不同）→ 不比内容、退化 Synced",
			map[string]dirLevelUnit{"b": {Path: "g/B.ysm", Rel: "b.ysm", Size: 10, Hash: "H"}},
			map[string]dirLevelUnit{"b": {Path: "i/B.zip", Rel: "b.zip", Size: 99, Hash: "X"}},
			types.ResourceSyncResult{Synced: []string{"g/B.ysm"}}},
		{"C3 同格式同键 + 两侧哈希异 → Diverged（ADR-344 D1 内容级）",
			map[string]dirLevelUnit{"m": {Path: "g/M.ysm", Rel: "m.ysm", Size: 10, Hash: "H1"}},
			map[string]dirLevelUnit{"m": {Path: "i/M.ysm", Rel: "m.ysm", Size: 10, Hash: "H2"}},
			types.ResourceSyncResult{Missing: []string{"g/M.ysm"}, Diverged: []string{"g/M.ysm"}}},
		{"C4 仅全局有的平铺文件 → Missing",
			map[string]dirLevelUnit{"s": {Path: "g/S.ysm", Rel: "s.ysm", Size: 4}},
			map[string]dirLevelUnit{},
			types.ResourceSyncResult{Missing: []string{"g/S.ysm"}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := dirLevelResult(c.globalU, c.instancU)
			assertMatrixResult(t, c.name, got, c.want)
		})
	}
}

// ── D 区：夹内逐文件（diffFolderContentsCore，D2′-c 哈希优先）──────────────────────
// D 区 absPath 传占位符（"g/a.ysm"）：fsutil.FileSize 对不存在路径返回 0，两侧同 0 →
// Size 分支不翻转，零磁盘 I/O 钉住判定。哈希分支（D1/D2）与存在性分支（D3/D4）不经
// Size；「任一侧哈希空 + 异尺寸 → Diverged」的 Size 兜底腿由 sync_dirlevel_content_test.go
// 既有用例守护（两测试各管一段）。

func TestVerdictMatrix_FolderContents(t *testing.T) {
	cases := []struct {
		name         string
		globalFiles  map[string]string
		instancFiles map[string]string
		globalHash   map[string]string
		instancHash  map[string]string
		want         map[string]types.SyncStatus // relKey → 期望 Status
	}{
		{"D1 两侧哈希同 → synced",
			map[string]string{"a.ysm": "g/a.ysm"}, map[string]string{"a.ysm": "i/a.ysm"},
			map[string]string{"a.ysm": "H"}, map[string]string{"a.ysm": "H"},
			map[string]types.SyncStatus{"a.ysm": types.SyncStatusSynced}},
		{"D2 两侧哈希异 → diverged",
			map[string]string{"a.ysm": "g/a.ysm"}, map[string]string{"a.ysm": "i/a.ysm"},
			map[string]string{"a.ysm": "H1"}, map[string]string{"a.ysm": "H2"},
			map[string]types.SyncStatus{"a.ysm": types.SyncStatusDiverged}},
		{"D3 仅全局有 → missing",
			map[string]string{"only_g.ysm": "g/only_g.ysm"}, map[string]string{},
			nil, nil,
			map[string]types.SyncStatus{"only_g.ysm": types.SyncStatusMissing}},
		{"D4 仅实例有 → optional",
			map[string]string{}, map[string]string{"only_i.ysm": "i/only_i.ysm"},
			nil, nil,
			map[string]types.SyncStatus{"only_i.ysm": types.SyncStatusOptional}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := diffFolderContentsCore(c.globalFiles, c.instancFiles, c.globalHash, c.instancHash)
			byKey := map[string]types.SyncStatus{}
			for _, d := range got {
				byKey[d.RelPath] = d.Status
			}
			for k, want := range c.want {
				if byKey[k] != want {
					t.Fatalf("%s：relKey %q got=%s want=%s（全表 %v）", c.name, k, byKey[k], want, byKey)
				}
			}
		})
	}
}

// ── E 区：冲突视图（conflictFromVerdict，ADR-351 D2）──────────────────────────
// 判定表输出 × 哈希缺失 → 冲突类型的全映射。冲突通道不再自持平行判定（旧三分支
// switch 与 ContentVerdict 同义异构，ADR-347 漏网），本区把映射逐行钉死。
// E5 同时钉死「同哈希异尺寸 → SizeMismatch」防御分支的退役（哈希信道优先：同
// SHA256 = 同内容；该形态真实文件不可构造，从未有测试钉住）。

func TestVerdictMatrix_ConflictView(t *testing.T) {
	cases := []struct {
		name        string
		differs     bool
		channel     string
		hashMissing bool
		wantType    ConflictType
		wantFailed  bool
		wantDetect  bool
	}{
		{"E1 内容确证不同（hash 信道）→ ContentModified",
			true, VerdictChannelHash, false, ConflictContentModified, false, true},
		{"E2 大小不同 + 哈希缺（size 信道）→ SizeMismatch",
			true, VerdictChannelSize, true, ConflictSizeMismatch, false, true},
		{"E3 大小不同 + 双哈希（不可达形态，仅钉映射）→ SizeMismatch",
			true, VerdictChannelSize, false, ConflictSizeMismatch, false, true},
		{"E4 超限保守（oversize 信道，今日不可达：冲突收集全量哈希不设上限）→ SizeMismatch",
			true, VerdictChannelOversize, false, ConflictSizeMismatch, false, true},
		{"E5 同哈希（hash 信道，含旧「同哈希异尺寸」防御分支退役）→ 无冲突",
			false, VerdictChannelHash, false, "", false, false},
		{"E6 同尺寸 + 哈希失败（size 信道 + hashMissing）→ HashFailed + manual 语义",
			false, VerdictChannelSize, true, ConflictContentModified, true, true},
		{"E7 同尺寸 + 双哈希（size 信道不可达防御形态）→ 无冲突",
			false, VerdictChannelSize, false, "", false, false},
		{"E8 异折叠指纹（fold 信道，冲突收集不可达：纯文件级）→ 保守 SizeMismatch",
			true, VerdictChannelFold, false, ConflictSizeMismatch, false, true},
		{"E9 存在性语义（none 信道恒 differs=false）→ 无冲突",
			false, VerdictChannelNone, false, "", false, false},
		{"E10 未知未来信道 → 保守 SizeMismatch（宁可误报人工审，不可漏报静默覆盖）",
			true, "future-channel-x", false, ConflictSizeMismatch, false, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			typ, hashFailed, detected := conflictFromVerdict(c.differs, c.channel, c.hashMissing)
			if detected != c.wantDetect {
				t.Fatalf("%s：detected got=%v want=%v", c.name, detected, c.wantDetect)
			}
			if typ != c.wantType {
				t.Fatalf("%s：type got=%q want=%q", c.name, typ, c.wantType)
			}
			if hashFailed != c.wantFailed {
				t.Fatalf("%s：hashFailed got=%v want=%v", c.name, hashFailed, c.wantFailed)
			}
		})
	}
}

// assertMatrixResult 比较四桶（ResourceDiff 已排序）；忽略 Warnings
// （P0 键碰撞信道由专属测试守护，矩阵只钉判定结果）。
func assertMatrixResult(t *testing.T, name string, got, want types.ResourceSyncResult) {
	t.Helper()
	pairs := map[string][2][]string{
		"Synced":   {got.Synced, want.Synced},
		"Missing":  {got.Missing, want.Missing},
		"Extra":    {got.Extra, want.Extra},
		"Diverged": {got.Diverged, want.Diverged},
	}
	for label, p := range pairs {
		g, w := p[0], p[1]
		if len(g) != len(w) {
			t.Fatalf("%s：%s 桶 got=%v want=%v", name, label, g, w)
		}
		for i := range g {
			if g[i] != w[i] {
				t.Fatalf("%s：%s 桶 got=%v want=%v", name, label, g, w)
			}
		}
	}
}
