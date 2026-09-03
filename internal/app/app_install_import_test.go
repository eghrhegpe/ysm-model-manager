// ===== 导入后 Go 侧统一失效缓存（review P1 跟进）=====
package app

import (
	"encoding/base64"
	"testing"

	"ysm-model-manager/go/scanner"
)

func TestImportModelFileWithSubpath_InvalidatesScannerCacheOnSuccess(t *testing.T) {
	a, ysm := guardedApp(t)

	// 暖缓存：第二次调用应命中 30s scanCache
	scanner.ScanEntriesWithHit(ysm)
	if _, hit := scanner.ScanEntriesWithHit(ysm); !hit {
		t.Fatal("暖缓存后二次扫描应命中")
	}

	if err := a.importModelFileWithSubpath("m.ysm", "", base64.StdEncoding.EncodeToString([]byte("x")), false); err != nil {
		t.Fatalf("导入失败: %v", err)
	}

	// Go 侧 ClearScanCache 收口后，导入成功应立即冷缓存，而不是等 30s 陈旧窗
	if _, hit := scanner.ScanEntriesWithHit(ysm); hit {
		t.Fatal("导入成功后扫描缓存应已被失效（Go 侧 ClearScanCache）")
	}
}
