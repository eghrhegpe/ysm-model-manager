// ===== ScanModelEntriesForBrowse / InvalidateScanPath 回归锁（止血 2026-10-15 A1/A2）=====
// 覆盖：ForBrowse ≡ Filtered 减 Hash（同集合 / 同 rtype 过滤 / Banned 同口径）、
// 同步消费口径（全量扫描 Hash）不受影响、InvalidateScanPath 定向失效不核平他目录。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
	"ysm-model-manager/internal/testutil"
)

func browseScanApp(t *testing.T, base string) (*App, string) {
	t.Helper()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		testutil.NoError(t, err)
	}
	for _, f := range []string{"m1.ysm", "m2.ysm.disabled"} {
		if err := os.WriteFile(filepath.Join(root, f), []byte("x"), 0o644); err != nil {
			testutil.NoError(t, err)
		}
	}
	_ = os.WriteFile(filepath.Join(root, "anim.json"), []byte("{}"), 0o644) // 非白名单 json，两入口同丢弃
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	return a, root
}

// 1. ForBrowse ≡ Filtered 减 Hash：同集合、同 Banned 口径；ysm hashable 条目
// 全量侧有 Hash、浏览侧恒空（分歧点唯一且方向正确）
func TestScanModelEntriesForBrowse_ParityWithFiltered(t *testing.T) {
	a, root := browseScanApp(t, t.TempDir())

	full := a.ScanModelEntriesFiltered(root, "ysm", "", "YSM 模型")
	browse := a.ScanModelEntriesForBrowse(root, "ysm", "", "YSM 模型")

	if len(full) != len(browse) {
		t.Fatalf("条目数应一致: full=%d browse=%d", len(full), len(browse))
	}
	fullByPath := make(map[string]types.ModelEntry, len(full))
	for _, e := range full {
		fullByPath[e.Path] = e
	}
	for _, e := range browse {
		if e.Hash != "" {
			t.Errorf("浏览条目 %s Hash 应恒空（哈希税只在同步路径），got %q", e.Path, e.Hash)
		}
		fe, ok := fullByPath[e.Path]
		if !ok {
			t.Fatalf("浏览条目 %s 不在全量结果内（过滤口径漂移）", e.Path)
		}
		if e.Banned != fe.Banned || e.Size != fe.Size || e.Type != fe.Type {
			t.Errorf("浏览条目 %s Banned/Size/Type 与全量口径分歧: %+v vs %+v", e.Path, e, fe)
		}
	}
	// 对照：全量侧 hashable 条目（m1.ysm）应已回填 SHA256——同步消费口径不变
	for _, e := range full {
		if e.Name == "m1.ysm" && e.Hash == "" {
			t.Error("全量扫描 m1.ysm 应回填 SHA256（同步口径不受浏览投影影响）")
		}
	}
	// 禁用条目两入口同显（Banned 同口径，前端树可再启用）
	var bannedFull, bannedBrowse int
	for _, e := range full {
		if e.Banned {
			bannedFull++
		}
	}
	for _, e := range browse {
		if e.Banned {
			bannedBrowse++
		}
	}
	if bannedFull == 0 || bannedFull != bannedBrowse {
		t.Errorf("禁用条目应两入口同显且计数一致: full=%d browse=%d", bannedFull, bannedBrowse)
	}
}

// 2. rtype 白名单过滤两入口同源（EntityPlayer 白名单无 .ysm → 全空）
func TestScanModelEntriesForBrowse_RtypeFilter(t *testing.T) {
	a, root := browseScanApp(t, t.TempDir())

	full := a.ScanModelEntriesFiltered(root, "EntityPlayer", "", "角色模型")
	browse := a.ScanModelEntriesForBrowse(root, "EntityPlayer", "", "角色模型")
	if len(full) != 0 || len(browse) != 0 {
		t.Errorf("EntityPlayer 白名单下 .ysm 条目应全被过滤: full=%d browse=%d", len(full), len(browse))
	}
	// 空 rtype = 不过滤（退化口径两入口同）
	fullAll := a.ScanModelEntriesFiltered(root, "", "", "")
	browseAll := a.ScanModelEntriesForBrowse(root, "", "", "")
	testutil.Equal(t, len(fullAll), len(browseAll), "空 rtype 退化路径两入口条目数应一致")
}

// 3. InvalidateScanPath 定向失效：本目录重扫见新文件；他目录 30s 新鲜缓存不核平
// （切类型场景的验收判据——失效 mmd 根不得带走 ysm 根的 browseCache 命中）
func TestInvalidateScanPath_Targeted(t *testing.T) {
	base := t.TempDir()
	a, root := browseScanApp(t, base)

	mmdRoot := filepath.Join(base, registry.GroupStorageRoot("mmd-shader"))
	if err := os.MkdirAll(mmdRoot, 0o755); err != nil {
		testutil.NoError(t, err)
	}
	// mmd-shader 白名单 = .glsl/.vsh/.fsh/.zip（resource_types.json 单一事实源），用 .fsh
	_ = os.WriteFile(filepath.Join(mmdRoot, "shader.fsh"), []byte("s"), 0o644)
	_ = a.ScanModelEntriesForBrowse(mmdRoot, "mmd-shader", "", "") // 写 mmd browseCache

	// 失效 ysm 根：加新文件 + 定向失效 → ysm 重扫应见新文件
	_ = os.WriteFile(filepath.Join(root, "m3.ysm"), []byte("x"), 0o644)
	a.InvalidateScanPath(root)
	found := false
	for _, e := range a.ScanModelEntriesForBrowse(root, "ysm", "", "") {
		if e.Name == "m3.ysm" {
			found = true
		}
	}
	if !found {
		t.Error("InvalidateScanPath 后重扫应见新文件")
	}
	// mmd 根缓存未被动（定向失效不核平他目录）：mmd 目录再加文件、不失效、
	// 重扫仍命中旧缓存（看不到新文件）——这正是 A2 要保住的语义
	_ = os.WriteFile(filepath.Join(mmdRoot, "shader2.fsh"), []byte("s2"), 0o644)
	count := 0
	for range a.ScanModelEntriesForBrowse(mmdRoot, "mmd-shader", "", "") {
		count++
	}
	if count != 1 {
		t.Errorf("mmd 根缓存应未失效（仍 1 个条目），got %d——InvalidateScanPath 误核平他目录", count)
	}
}
