// ===== 导入后 Go 侧统一失效缓存（review P1 跟进）=====
package app

import (
	"encoding/base64"
	"testing"

	"ysm-model-manager/go/scanner"
	"ysm-model-manager/internal/testutil"
)

func TestImportModelFileWithSubpath_InvalidatesScannerCacheOnSuccess(t *testing.T) {
	a, ysm := guardedApp(t)

	// 暖缓存：第二次调用应命中 30s scanCache
	scanner.ScanEntriesWithHit(ysm)
	_, hit := scanner.ScanEntriesWithHit(ysm)
	testutil.Equal(t, hit, true, "暖缓存后二次扫描应命中")

	testutil.NoError(t, a.importModelFileWithSubpath("m.ysm", "", base64.StdEncoding.EncodeToString([]byte("x")), false), "导入失败")

	// Go 侧 ClearScanCache 收口后，导入成功应立即冷缓存，而不是等 30s 陈旧窗
	_, hit = scanner.ScanEntriesWithHit(ysm)
	testutil.Equal(t, hit, false, "导入成功后扫描缓存应已被失效（Go 侧 ClearScanCache）")
}
