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
