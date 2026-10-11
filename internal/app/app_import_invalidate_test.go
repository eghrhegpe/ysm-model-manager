// ImportByType 落盘后的派生缓存失效（锐评 2026-10-10 日志/闸审计顺手抓到的活 bug）。
// 立因：菜单「导入文件/导入文件夹」是活路径（toolbar-commands.ts runImport → ImportByType，
// 事后只 vm._load() 不 InvalidateScanCache——与 sync.ts:81 批量回拉路径不同，那条有补）。
// ImportByType 经 importer.Get(rtype) 取策略、以**接口方法值** h.Import() 写进仓库根，
// 落盘后 app 层零失效、go/importer 包内也完全不引用 scanner——新导入文件 ≤TTL 不可见，
// 与下载/安装漏清缓存同族病，且因「接口方法值」这一形态，此前两枚枚举式契约闸天然看不见。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/internal/testutil"
)

func TestImportByType_InvalidatesScanCache(t *testing.T) {
	a, _, _ := packApp(t)

	rpRoot, err := a.GetRepoRoot("resourcepack")
	testutil.NoError(t, err, "GetRepoRoot(resourcepack)")
	testutil.Equal(t, rpRoot != "", true, "resourcepack 根应可用")
	err = os.MkdirAll(rpRoot, 0o755)
	testutil.NoError(t, err, "MkdirAll")
	srcDir := t.TempDir()
	src := filepath.Join(srcDir, "pack.zip")
	err = os.WriteFile(src, []byte("zip-bytes"), 0o644)
	testutil.NoError(t, err, "WriteFile")

	// 预扫描建立缓存（首 miss 二 hit，同 app_scan_test 口径）
	_, hit := a.scanModelEntriesWithHit(rpRoot)
	testutil.Equal(t, hit, false, "首次扫描不应命中缓存")
	_, hit = a.scanModelEntriesWithHit(rpRoot)
	testutil.Equal(t, hit, true, "二次扫描应命中缓存（前置条件）")

	err = a.ImportByType("resourcepack", src)
	testutil.NoError(t, err, "ImportByType")
	if _, hit := a.scanModelEntriesWithHit(rpRoot); hit {
		t.Error("ImportByType 落盘后不应命中旧扫描缓存（菜单导入后 vm._load 须立即可见新文件）")
	}
	var found bool
	for _, e := range a.ScanModelEntries(rpRoot) {
		if filepath.Base(e.Path) == "pack.zip" {
			found = true
		}
	}
	if !found {
		t.Error("重扫应包含新导入文件 pack.zip")
	}
}
