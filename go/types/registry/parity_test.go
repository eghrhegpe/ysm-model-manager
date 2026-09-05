// ===== Rust-Go 边界契约测试（共享 fixture）=====
// 读取 tests/parity/go-rust-predicates.json，锁死 strip_disable_suffix /
// is_ysm_entry_json / is_disable_suffix 三个谓词与 Rust（rust-core/src/scan.rs）
// 逐字一致的 input→output 对。任一端改口径，另一端 cargo/go 测试当场红。
// 单一权威 = Go（ADR-038 D2）；fixture 由本测试与 rust-core/src/tests.rs 双端消费。
package types

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type parityFixture struct {
	Strip          [][2]string `json:"strip_disable_suffix"`
	IsYsmEntryJSON [][2]string `json:"is_ysm_entry_json"`
	IsDisable      [][2]string `json:"is_disable_suffix"`
}

// repoRootFromPkgDir 从当前包目录逐级向上找 tests/parity/go-rust-predicates.json
// （go test 的 cwd = 包目录，健壮命中仓库根），避免对 cwd 的硬假设。
func repoRootFromPkgDir(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	for d := dir; ; d = filepath.Dir(d) {
		if _, err := os.Stat(filepath.Join(d, "tests", "parity", "go-rust-predicates.json")); err == nil {
			return d
		}
		if filepath.Dir(d) == d {
			break // 到 fs 根
		}
	}
	t.Fatalf("未找到 tests/parity/go-rust-predicates.json（从 %q 向上）", dir)
	return ""
}

func loadParityFixture(t *testing.T) *parityFixture {
	t.Helper()
	root := repoRootFromPkgDir(t)
	raw, err := os.ReadFile(filepath.Join(root, "tests", "parity", "go-rust-predicates.json"))
	if err != nil {
		t.Fatalf("读取 parity fixture: %v", err)
	}
	var f parityFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("解析 parity fixture: %v", err)
	}
	return &f
}

func TestParity_StripDisableSuffix(t *testing.T) {
	f := loadParityFixture(t)
	for _, c := range f.Strip {
		if got := StripDisableSuffix(c[0]); got != c[1] {
			t.Errorf("StripDisableSuffix(%q) = %q, 期望 %q", c[0], got, c[1])
		}
	}
}

func TestParity_IsYsmEntryJSON(t *testing.T) {
	f := loadParityFixture(t)
	for _, c := range f.IsYsmEntryJSON {
		want := c[1] == "true"
		if got := IsYsmEntryJSON(c[0]); got != want {
			t.Errorf("IsYsmEntryJSON(%q) = %v, 期望 %v", c[0], got, want)
		}
	}
}

func TestParity_IsDisableSuffix(t *testing.T) {
	f := loadParityFixture(t)
	for _, c := range f.IsDisable {
		want := c[1] == "true"
		if got := IsDisableSuffix(c[0]); got != want {
			t.Errorf("IsDisableSuffix(%q) = %v, 期望 %v", c[0], got, want)
		}
	}
}
