// fsutil 禁用孪生路径谓词（ADR-345 D2）：把「path 当前不存在、但它的禁用载体存在」
// 这一判断收成单点，避免 go/instance 与 go/sync 各自内联拼后缀（表归 registry，无环）。
package fsutil

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

func TestDisabledCounterpart_DisabledSuffix(t *testing.T) {
	dir := t.TempDir()
	carrier := filepath.Join(dir, "X.disabled")
	if err := os.MkdirAll(carrier, 0o755); err != nil {
		testutil.NoError(t, err)
	}

	got, ok := DisabledCounterpart(filepath.Join(dir, "X"))
	testutil.Equal(t, ok, true, "活跃路径不存在而禁用载体存在时应命中")
	testutil.Equal(t, got, carrier, "应返回禁用载体路径")
}

func TestDisabledCounterpart_BanSuffix(t *testing.T) {
	dir := t.TempDir()
	carrier := filepath.Join(dir, "a.pmx.ban")
	testutil.WriteTestFile(t, carrier, "pmx")

	got, ok := DisabledCounterpart(filepath.Join(dir, "a.pmx"))
	testutil.Equal(t, ok, true, "历史 .ban 后缀同样兼容")
	testutil.Equal(t, got, carrier, "应返回 .ban 载体路径")
}

// 活跃路径存在 → 恒不命中（两层含义：① 不看载体，② 载体与活跃并存时不改判）。
func TestDisabledCounterpart_ActiveExists(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(dir, "X"), "active")
	testutil.WriteTestFile(t, filepath.Join(dir, "X.disabled"), "disabled")

	_, ok := DisabledCounterpart(filepath.Join(dir, "X"))
	testutil.Equal(t, ok, false, "活跃路径存在时不得返回载体（活跃是当前真值）")
}

func TestDisabledCounterpart_NeitherExists(t *testing.T) {
	dir := t.TempDir()
	_, ok := DisabledCounterpart(filepath.Join(dir, "nope"))
	testutil.Equal(t, ok, false, "两者都不存在时应不命中")
}
