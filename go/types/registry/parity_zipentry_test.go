// ===== Go-TS 识别层指纹契约测试（ADR-154 pilot 1：双端互锁）=====
// 读取 tests/parity/go-ts-zipentry.json，锁死 MatchZipEntry 与 TS 侧
// matchZipEntryTS（frontend/src/utils/resource/types.ts:376）逐条一致的
// input→output 对。任一端改口径，另一端 vitest / go test 当场红。
// 语料来源：classify-golden.json entries 字段 + 全类型 zipEntries 指纹 + 边界。
// 单一权威 = Go types.MatchZipEntry（ADR-154 §2.2：双端互锁硬性要求）。
// 仓库根定位复用 parity_test.go 的 repoRootFromPkgDir（同包共享，避免 jscpd 重复）。
package types

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type zipentryParityFixture struct {
	Pairs [][2]string `json:"match_zip_entry"`
}

func loadZipentryParityFixture(t *testing.T) *zipentryParityFixture {
	t.Helper()
	root := repoRootFromPkgDir(t)
	raw, err := os.ReadFile(filepath.Join(root, "tests", "parity", "go-ts-zipentry.json"))
	if err != nil {
		t.Fatalf("读取 parity fixture: %v", err)
	}
	var f zipentryParityFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("解析 parity fixture: %v", err)
	}
	if len(f.Pairs) == 0 {
		t.Fatal("parity fixture 为空（防空转守卫）")
	}
	return &f
}

// TestParity_MatchZipEntry 对拍 Go types.MatchZipEntry ↔ TS matchZipEntryTS。
// 任何一条 input→output 与 fixture 不符即红；TS 侧由
// frontend/src/backend/zipentry.parity.test.ts 消费同一 fixture。
func TestParity_MatchZipEntry(t *testing.T) {
	f := loadZipentryParityFixture(t)
	for _, c := range f.Pairs {
		if got := MatchZipEntry(c[0]); got != c[1] {
			t.Errorf("MatchZipEntry(%q) = %q, 期望 %q（fixture go-ts-zipentry.json）", c[0], got, c[1])
		}
	}
}
