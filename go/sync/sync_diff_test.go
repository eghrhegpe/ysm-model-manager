package sync

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// TestResourceDiff_HashComparison 锁定 D2′-a 判据：
//   - 两侧均算出哈希 → 比哈希（异哈希即使同大小也 Missing，消除"改内容不改大小"假绿）；
//   - 任一侧空哈希（大 zip / 非 hashable / 旧无 scanFn 调用）→ 回退比 Size（现状不回归）；
//   - 目录型 pack 条目 → 恒 Synced（内容盲区属 D2′-b/c，本切片不动）。
func TestResourceDiff_HashComparison(t *testing.T) {
	cases := []struct {
		name        string
		g, i        DiffEntry
		wantSynced  bool
		wantMissing bool
	}{
		{
			name:        "异哈希_同大小→Missing（D2′-a 核心修复，盲区1）",
			g:           DiffEntry{Path: "pack.zip", Size: 1024, Hash: "aaa"},
			i:           DiffEntry{Path: "pack.zip", Size: 1024, Hash: "bbb"},
			wantSynced:  false,
			wantMissing: true,
		},
		{
			name:        "同哈希_同大小→Synced",
			g:           DiffEntry{Path: "pack.zip", Size: 1024, Hash: "aaa"},
			i:           DiffEntry{Path: "pack.zip", Size: 1024, Hash: "aaa"},
			wantSynced:  true,
			wantMissing: false,
		},
		{
			name:        "空哈希_同大小→Synced（回退 Size，大 zip 不回归）",
			g:           DiffEntry{Path: "big.zip", Size: 1024},
			i:           DiffEntry{Path: "big.zip", Size: 1024},
			wantSynced:  true,
			wantMissing: false,
		},
		{
			name:        "空哈希_异大小→Missing（回退 Size，现状语义）",
			g:           DiffEntry{Path: "big.zip", Size: 1024},
			i:           DiffEntry{Path: "big.zip", Size: 2048},
			wantSynced:  false,
			wantMissing: true,
		},
		{
			name:        "一侧空哈希_同大小→Synced（非两侧均非空→回退，不误判 Missing）",
			g:           DiffEntry{Path: "pack.zip", Size: 1024, Hash: "aaa"},
			i:           DiffEntry{Path: "pack.zip", Size: 1024},
			wantSynced:  true,
			wantMissing: false,
		},
		{
			name:        "目录条目_异大小→Synced（目录短路保留）",
			g:           DiffEntry{Path: "packdir", IsDir: true},
			i:           DiffEntry{Path: "packdir", IsDir: true},
			wantSynced:  true,
			wantMissing: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := ResourceDiff(
				map[string]DiffEntry{"k": tc.g},
				map[string]DiffEntry{"k": tc.i},
			)
			if got := containsPath(r.Synced, tc.g.Path); got != tc.wantSynced {
				t.Errorf("Synced 含 %q = %v, want %v (result=%+v)", tc.g.Path, got, tc.wantSynced, r)
			}
			if got := containsPath(r.Missing, tc.g.Path); got != tc.wantMissing {
				t.Errorf("Missing 含 %q = %v, want %v (result=%+v)", tc.g.Path, got, tc.wantMissing, r)
			}
		})
	}
}

// TestSyncResourcesWithConfig_HashDetectsContentChange 端到端验证 D2′-a 接线：
// collect 用注入的 scanFn 旁挂哈希（按 relKey 归一匹配）→ 同名同大小、内容不同的文件型
// pack 被判 Missing（消除假绿）；scanFn=nil 回退 Size 判 Synced（现状不回归）。
func TestSyncResourcesWithConfig_HashDetectsContentChange(t *testing.T) {
	global := t.TempDir()
	inst := t.TempDir()
	// 同名同大小（均 4 字节）、内容不同——纯 Size 对比会误判 Synced
	if err := os.WriteFile(filepath.Join(global, "pack.zip"), []byte("AAAA"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inst, "pack.zip"), []byte("BBBB"), 0o644); err != nil {
		t.Fatal(err)
	}

	scanFn := func(dir string) []types.ModelEntry {
		h := "globalHash"
		if dir == inst {
			h = "instHash"
		}
		return []types.ModelEntry{{Name: "pack.zip", Path: filepath.Join(dir, "pack.zip"), Hash: h}}
	}
	wantPath := filepath.Join(global, "pack.zip")

	// 注入 scanFn：两侧哈希异 → Missing
	r := SyncResourcesWithConfig(global, inst, nil, scanFn, "resourcepack")
	if !containsPath(r.Missing, wantPath) {
		t.Fatalf("异内容同大小应经哈希判 Missing, got %+v", r)
	}
	if containsPath(r.Synced, wantPath) {
		t.Errorf("不应误判 Synced, got %+v", r)
	}

	// scanFn=nil：无哈希回退 Size（同大小）→ Synced（现状不回归）
	r0 := SyncResourcesWithConfig(global, inst, nil, nil, "resourcepack")
	if !containsPath(r0.Synced, wantPath) {
		t.Errorf("nil scanFn 应回退 Size 判 Synced, got %+v", r0)
	}
}

func containsPath(list []string, p string) bool {
	for _, v := range list {
		if v == p {
			return true
		}
	}
	return false
}

// TestDiffFolderContentsScan_HashDetectsDivergence 锁定 D2′-c 盲区③修复：
// 夹内同名同大小、内容不同的模型文件，经 scanner 旁挂哈希后判 Diverged
// （消除「存在即 Synced」假绿）；单侧缺哈希 → 回退 Size 判 Synced（现状不回归）；
// 无 scanFn 的公共入口 DiffFolderContents（两侧 Walk 无哈希）→ 恒 Size 判定不误升 Diverged。
func TestDiffFolderContentsScan_HashDetectsDivergence(t *testing.T) {
	root := t.TempDir()
	globalFolder := filepath.Join(root, "gpkg")
	instRoot := t.TempDir()
	instFolder := filepath.Join(instRoot, "ipkg")
	if err := os.MkdirAll(globalFolder, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(instFolder, 0o755); err != nil {
		t.Fatal(err)
	}
	// 三文件同名同大小（4 字节），内容各异——纯 Size 对比全判 Synced（假绿）。
	for _, name := range []string{"a.pmx", "b.pmx", "d.pmx"} {
		if err := os.WriteFile(filepath.Join(globalFolder, name), []byte("AAAA"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(instFolder, name), []byte("BBBB"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	rtype := "EntityPlayer" // 无嵌套模式，走 scan 反推路径

	// scanFn：dir==instFolder 返回实例侧条目，否则返回组根（全局侧）条目。
	// a：两侧异哈希 → Diverged；b：两侧同哈希 → Synced；d：实例侧空哈希 → 回退 Size → Synced。
	scanFn := func(dir string) ([]types.ModelEntry, bool) {
		base := globalFolder
		gh := map[string]string{"a.pmx": "AG", "b.pmx": "BB", "d.pmx": "DG"}
		ih := map[string]string{"a.pmx": "AI", "b.pmx": "BB", "d.pmx": ""}
		if dir == instFolder {
			base = instFolder
		}
		hm := gh
		if dir == instFolder {
			hm = ih
		}
		entries := make([]types.ModelEntry, 0, 3)
		for _, name := range []string{"a.pmx", "b.pmx", "d.pmx"} {
			entries = append(entries, types.ModelEntry{
				Name: name,
				Path: filepath.Join(base, name),
				Hash: hm[name],
			})
		}
		return entries, true
	}

	diffs := DiffFolderContentsScan(globalFolder, instFolder, rtype, scanFn, root)
	statusOf := func(rel string) (types.SyncStatus, bool) {
		for _, d := range diffs {
			if d.RelPath == rel {
				return d.Status, true
			}
		}
		return "", false
	}
	if s, ok := statusOf("a.pmx"); !ok || s != types.SyncStatusDiverged {
		t.Errorf("a.pmx 异哈希应判 Diverged, got %v ok=%v", s, ok)
	}
	if s, ok := statusOf("b.pmx"); !ok || s != types.SyncStatusSynced {
		t.Errorf("b.pmx 同哈希应判 Synced, got %v ok=%v", s, ok)
	}
	if s, ok := statusOf("d.pmx"); !ok || s != types.SyncStatusSynced {
		t.Errorf("d.pmx 实例侧空哈希应回退 Size 判 Synced, got %v ok=%v", s, ok)
	}

	// 公共入口无 scanFn：两侧 Walk 无哈希 → Size 相等 → 全 Synced（现状不回归）
	plain := DiffFolderContents(globalFolder, instFolder, rtype)
	for _, d := range plain {
		if d.Status != types.SyncStatusSynced {
			t.Errorf("DiffFolderContents 无哈希应恒 Size 判定 Synced, got %+v", d)
		}
	}
}
