// ===== 同步 diff 的 relink 备份尸体豁免回归（锐评 2026-10-14 批 A / A4）=====
//
// 背景（实证 N3）：`isRelinkBackupPath` 的豁免此前只存在于 toggle/relink 三处扫盘；
// 同步 diff 的目录跳过只看回收站 → 失败 relink 留下的 `<夹名>.relink-bak-<ts>`
// 被判成实例侧独有（Extra），面板显示「多余（可拉取）」，点一下就由
// pullDirLevelEntry 把整个恢复点复制进仓库（数 GB 垃圾入库，且恢复点被当成模型）。
//
// 覆盖四条 collect 通道：dirlevel Walk / dirlevel scan 反推 / file-level Walk / 夹内子文件。
package sync

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func mkdirAllT(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0755); err != nil {
		t.Fatalf("建目录失败 %s: %v", path, err)
	}
}

func writeT(t *testing.T, path, body string) {
	t.Helper()
	mkdirAllT(t, filepath.Dir(path))
	if err := os.WriteFile(path, []byte(body), 0644); err != nil {
		t.Fatalf("写文件失败 %s: %v", path, err)
	}
}

// TestSyncResourcesDirLevel_SkipsRelinkBackupCorpse dirlevel Walk 通道：
// 尸体夹不得出现在任何列表中；同级的活条目照常判 Extra。
func TestSyncResourcesDirLevel_SkipsRelinkBackupCorpse(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()
	writeT(t, filepath.Join(instDir, "packA.relink-bak-1700000000000000000", "x.ysm"), "old")
	writeT(t, filepath.Join(instDir, "live.ysm"), "live")

	res := SyncResourcesDirLevel(globalDir, instDir, "ysm")
	for _, list := range [][]string{res.Extra, res.Missing, res.Synced} {
		for _, p := range list {
			if isRelinkBackupPath(p) {
				t.Fatalf("relink 备份尸体不应进入同步 diff：%v（Extra=%v Missing=%v Synced=%v）",
					p, res.Extra, res.Missing, res.Synced)
			}
		}
	}
	// 负向对照：活的实例独有条目必须仍被判 Extra（防「顺手全跳过」式假修复）
	if len(res.Extra) != 1 || filepath.Base(res.Extra[0]) != "live.ysm" {
		t.Fatalf("活条目应判 Extra=[live.ysm]，实际 %v", res.Extra)
	}
}

// TestSyncResourcesDirLevelScan_SkipsRelinkBackupCorpse dirlevel scan 反推通道：
// 生产链（ysm/mmd 走 scanner 命中）在这里，仅修 Walk 通道等于没修。
func TestSyncResourcesDirLevelScan_SkipsRelinkBackupCorpse(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()
	corpse := filepath.Join(instDir, "packA.relink-bak-99", "x.ysm")
	live := filepath.Join(instDir, "live.ysm")

	scanFn := func(dir string) ([]types.ModelEntry, bool) {
		if dir != instDir {
			return nil, false // 全局侧空树（未命中 → Walk 空结果，不干扰断言）
		}
		return []types.ModelEntry{
			{Name: "x.ysm", Path: corpse, Hash: "h1"},
			{Name: "live.ysm", Path: live, Hash: "h2"},
		}, true
	}
	res := SyncResourcesDirLevelScan(globalDir, instDir, "ysm", scanFn)
	for _, list := range [][]string{res.Extra, res.Missing, res.Synced} {
		for _, p := range list {
			if isRelinkBackupPath(p) {
				t.Fatalf("scan 反推通道仍把备份尸体当条目：%v（Extra=%v Missing=%v）", p, res.Extra, res.Missing)
			}
		}
	}
	if len(res.Extra) != 1 || filepath.Base(res.Extra[0]) != "live.ysm" {
		t.Fatalf("活条目应判 Extra=[live.ysm]，实际 %v", res.Extra)
	}
}

// TestSyncResources_SkipsRelinkBackupCorpse file-level Walk 通道（resourcepack 等）：
// 尸体夹内的 zip 同样不得被判 Extra。
func TestSyncResources_SkipsRelinkBackupCorpse(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()
	writeT(t, filepath.Join(instDir, "m.zip.relink-bak-7", "other.zip"), "stale")
	writeT(t, filepath.Join(instDir, "live.zip"), "live")

	res := SyncResources(globalDir, instDir, "resourcepack")
	for _, p := range res.Extra {
		if isRelinkBackupPath(p) {
			t.Fatalf("file-level 通道仍把备份尸体当条目：%v（Extra=%v）", p, res.Extra)
		}
	}
	if len(res.Extra) != 1 || filepath.Base(res.Extra[0]) != "live.zip" {
		t.Fatalf("活条目应判 Extra=[live.zip]，实际 %v", res.Extra)
	}
}

// TestCollectFolderFiles_IgnoresRelinkBackupCorpse 夹内子文件通道（防御纵深）：
// 模型夹内若残留尸体子树（嵌套 relink 的极端形态），子文件清单不得收录。
func TestCollectFolderFiles_IgnoresRelinkBackupCorpse(t *testing.T) {
	folder := t.TempDir()
	writeT(t, filepath.Join(folder, "ysm.json"), "{}")
	writeT(t, filepath.Join(folder, "sub.relink-bak-3", "x.ysm"), "old")

	files := collectFolderFiles(folder, "ysm")
	for k := range files {
		if isRelinkBackupPath(k) {
			t.Fatalf("夹内子文件清单不应收录备份尸体：%v（keys=%v）", k, files)
		}
	}
	if len(files) != 1 {
		t.Fatalf("只应收录活文件 ysm.json，实际 %v", files)
	}
}
