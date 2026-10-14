// fsutil 禁用孪生谓词（ADR-345 D2）：把「活跃形态不存在、禁用孪生存在」收成单点。
// 全部谓词**限定目录**（复核 P2-1：同名杂散文件不是「整夹被禁用」的意图，
// 按它改整夹名 = 数据事故）；`DisabledAncestorPath` 上溯祖先（复核 P1-2：
// 容器夹被整体禁用时，只查单元自身路径全落空 → 复活）。
package fsutil

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

func mkdirAll(t *testing.T, p string) {
	t.Helper()
	if err := os.MkdirAll(p, 0o755); err != nil {
		testutil.NoError(t, err)
	}
}

func TestDisabledDirCounterpart_DirCarrier(t *testing.T) {
	dir := t.TempDir()
	carrier := filepath.Join(dir, "X.disabled")
	mkdirAll(t, carrier)

	got, ok := DisabledDirCounterpart(filepath.Join(dir, "X"))
	testutil.Equal(t, ok, true, "活跃路径不存在而禁用载体是目录时应命中")
	testutil.Equal(t, got, carrier, "应返回禁用载体路径")
}

func TestDisabledDirCounterpart_BanSuffix(t *testing.T) {
	dir := t.TempDir()
	carrier := filepath.Join(dir, "X.ban")
	mkdirAll(t, carrier)

	got, ok := DisabledDirCounterpart(filepath.Join(dir, "X"))
	testutil.Equal(t, ok, true, "历史 .ban 后缀同样兼容")
	testutil.Equal(t, got, carrier, "应返回 .ban 载体路径")
}

// 杂散**文件**不算禁用载体（复核 P2-1：否则活跃模型夹会被整夹改名禁用）。
func TestDisabledDirCounterpart_FileCarrierRejected(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(dir, "X.disabled"), "stray")

	_, ok := DisabledDirCounterpart(filepath.Join(dir, "X"))
	testutil.Equal(t, ok, false, "同名杂散文件不是「整夹被禁用」的意图")
}

func TestDisabledDirCounterpart_ActiveExists(t *testing.T) {
	dir := t.TempDir()
	mkdirAll(t, filepath.Join(dir, "X"))
	mkdirAll(t, filepath.Join(dir, "X.disabled"))

	_, ok := DisabledDirCounterpart(filepath.Join(dir, "X"))
	testutil.Equal(t, ok, false, "活跃路径存在时不得返回载体（活跃是当前真值）")
}

func TestDisabledDirCounterpart_NeitherExists(t *testing.T) {
	_, ok := DisabledDirCounterpart(filepath.Join(t.TempDir(), "nope"))
	testutil.Equal(t, ok, false, "两者都不存在时应不命中")
}

// TestDisabledAncestorPath_ContainerDisabled 复核 P1-2 的核心：祖先（容器夹）被整体禁用时，
// 单元的实际落点是「载体 + 剩余段」，否则面板/推送会把嵌套单元当成缺失并另建活跃副本。
func TestDisabledAncestorPath_ContainerDisabled(t *testing.T) {
	root := t.TempDir()
	mkdirAll(t, filepath.Join(root, "X.disabled", "sub"))

	got, ok := DisabledAncestorPath(root, filepath.Join(root, "X", "sub"))
	testutil.Equal(t, ok, true, "容器夹被禁用时应命中祖先载体")
	testutil.Equal(t, got, filepath.Join(root, "X.disabled", "sub"), "应返回载体 + 剩余段")
}

func TestDisabledAncestorPath_SelfTwin(t *testing.T) {
	root := t.TempDir()
	mkdirAll(t, filepath.Join(root, "sub.disabled"))

	got, ok := DisabledAncestorPath(root, filepath.Join(root, "sub"))
	testutil.Equal(t, ok, true, "单元自身就是载体时应命中")
	testutil.Equal(t, got, filepath.Join(root, "sub.disabled"), "应返回自身载体")
}

func TestDisabledAncestorPath_NoCarrier(t *testing.T) {
	root := t.TempDir()
	mkdirAll(t, filepath.Join(root, "sub"))

	_, ok := DisabledAncestorPath(root, filepath.Join(root, "sub"))
	testutil.Equal(t, ok, false, "无禁用祖先时不命中")
}

// 活跃祖先存在 → 沿路全部「存在」，不因后续段缺失而误判（缺失只是尚未安装）。
func TestDisabledAncestorPath_ActiveAncestorExists(t *testing.T) {
	root := t.TempDir()
	mkdirAll(t, filepath.Join(root, "X"))

	_, ok := DisabledAncestorPath(root, filepath.Join(root, "X", "sub"))
	testutil.Equal(t, ok, false, "活跃祖先存在时不得命中（后续段缺失属未安装）")
}

// 杂散文件冒充载体：整条链只认目录载体（复核 P2-1）。
func TestDisabledAncestorPath_FileCarrierIgnored(t *testing.T) {
	root := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(root, "X.disabled"), "stray")

	_, ok := DisabledAncestorPath(root, filepath.Join(root, "X", "sub"))
	testutil.Equal(t, ok, false, "文件冒充载体不得被当作禁用祖先")
}

// 越界目标不得命中（调用方传错根时不能凭 `..` 改写外部路径）。
func TestDisabledAncestorPath_OutsideRoot(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	mkdirAll(t, filepath.Join(outside, "X.disabled"))

	_, ok := DisabledAncestorPath(root, filepath.Join(outside, "X"))
	testutil.Equal(t, ok, false, "target 不在 root 内时应不命中")
}
