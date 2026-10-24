package fileops

// ===== ToggleModelEnable 文件系统终态 特征测试 =====
// 禁用/启用是**改名约定**（path → path+".disabled"），代价是「半启用」不一致态与
// 误改名仓库根。既有用例已覆盖守卫拒绝与目标已存在；本文件补齐终态断言：
//   1. 文件级：目录条目全集 = {原名.disabled}（后缀追加而非替换），内容随名走
//   2. 目录级（整组）：条目全集 = {模型的.disabled}——整组一起走，不留半个模型
//   3. 失败不留半启用：两段式还原在「先父目录」之前被拒时，磁盘必须逐字节原样
//   4. 畸形路径的 Abs 失败必须传播（不得 fail-open 静默跳过根守卫）

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// 文件级禁用→启用：目录条目全集在后缀追加/去掉之间往返，内容逐字节不变。
func TestToggleModelEnable_EndState_FileSuffixAppendedNotReplaced(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "m.ysm")
	content := []byte("payload\x00binary")
	if err := os.WriteFile(src, content, 0644); err != nil {
		testutil.NoError(t, err)
	}

	enabled, err := ToggleModelEnable(dir, src)
	testutil.NoError(t, err, "禁用应返回 enabled=false")
	testutil.Equal(t, enabled, false, "禁用应返回 enabled=false")
	// 终态：条目全集恰为 {m.ysm.disabled}——后缀是**追加**（防实现改成替换/加前缀丢扩展名）
	got := strings.Join(sortedDirNames(t, dir), ",")
	testutil.Equal(t, got, "m.ysm.disabled", "禁用后条目全集")
	gotData, rerr := os.ReadFile(filepath.Join(dir, "m.ysm.disabled"))
	testutil.NoError(t, rerr, "禁用后内容必须随文件一起走")
	testutil.Equal(t, bytes.Equal(gotData, content), true, "禁用后内容必须随文件一起走")

	enabled, err = ToggleModelEnable(dir, filepath.Join(dir, "m.ysm.disabled"))
	testutil.NoError(t, err, "启用应返回 enabled=true")
	testutil.Equal(t, enabled, true, "启用应返回 enabled=true")
	// 终态：条目全集回到 {m.ysm}，不留 .disabled 残影
	got = strings.Join(sortedDirNames(t, dir), ",")
	testutil.Equal(t, got, "m.ysm", "启用后条目全集")
	gotData, rerr = os.ReadFile(src)
	testutil.NoError(t, rerr, "启用后内容必须逐字节一致")
	testutil.Equal(t, bytes.Equal(gotData, content), true, "启用后内容必须逐字节一致")
}

// 目录级整组禁用→启用：整组资源随目录名一起被隔离/还原，松散文件不被单独改名。
func TestToggleModelEnable_EndState_DirGroupMovesAsWhole(t *testing.T) {
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	loose := filepath.Join(modelDir, "loose.ysm")
	if err := os.WriteFile(loose, []byte("loose"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	enabled, err := ToggleModelEnable(base, filepath.Join(modelDir, "ysm.json"))
	testutil.NoError(t, err, "整组禁用应返回 enabled=false")
	testutil.Equal(t, enabled, false, "整组禁用应返回 enabled=false")
	// 终态：base 下恰有「模型A.disabled」——整组走，不留半个模型目录
	got := strings.Join(sortedDirNames(t, base), ",")
	testutil.Equal(t, got, "模型A.disabled", "整组禁用后 base 条目全集")
	bannedDir := filepath.Join(base, "模型A.disabled")
	// 包内所有资源（geometry/animation/语言/纹理/松散文件）随目录一起隔离
	for _, f := range []string{"ysm.json", "main.json", "arm.animation.json", "zh_cn.json", "textures/skin.png", "loose.ysm"} {
		testutil.FileExists(t, filepath.Join(bannedDir, filepath.FromSlash(f)), "整组禁用应连带隔离 %s", f)
	}

	// 经目录内**松散文件**触发整组启用（与 ysm.json 入口对称）
	enabled, err = ToggleModelEnable(base, filepath.Join(bannedDir, "loose.ysm"))
	testutil.NoError(t, err, "整组启用应返回 enabled=true")
	testutil.Equal(t, enabled, true, "整组启用应返回 enabled=true")
	got = strings.Join(sortedDirNames(t, base), ",")
	testutil.Equal(t, got, "模型A", "整组启用后 base 条目全集")
	// 启用后目录内不得残留任何禁用标记名（扩展名与顺序均未被改写）
	for _, n := range sortedDirNames(t, modelDir) {
		residue := strings.Contains(strings.ToLower(n), ".disabled") || strings.Contains(strings.ToLower(n), ".ban")
		testutil.Equal(t, residue, false, "启用后不得残留禁用名: %q", n)
	}
	gotData, rerr := os.ReadFile(loose)
	testutil.NoError(t, rerr, "松散文件必须保留原名与内容")
	testutil.Equal(t, string(gotData), "loose", "松散文件必须保留原名与内容")
}

// 旧状态残留（父目录 + 文件双禁用）且**父目录**还原目标已存在：
// 必须在「先父目录」的决定性 Rename 之前拒绝 → 磁盘逐字节原样，不得出现半启用态。
func TestToggleModelEnable_DirBanResidueDirNewExistsKeepsDiskUntouched(t *testing.T) {
	base := t.TempDir()
	bannedDir := filepath.Join(base, "模型A.ban")
	if err := os.MkdirAll(bannedDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	residue := filepath.Join(bannedDir, "loose.ysm.ban")
	if err := os.WriteFile(residue, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// 预置父目录还原目标 → 应命中「父目录目标已存在」
	if err := os.MkdirAll(filepath.Join(base, "模型A"), 0755); err != nil {
		testutil.NoError(t, err)
	}

	_, err := ToggleModelEnable(base, residue)
	testutil.NotNil(t, err, "父目录还原目标已存在应报错")
	// 终态：.ban 目录与残留文件原样保留
	testutil.FileExists(t, bannedDir, ".ban 目录必须原样保留")
	testutil.FileExists(t, residue, ".ban 残留文件必须原样保留")
	// 关键：不得先做文件级还原（P3-1 顺序）——旧父目录下不得凭空出现去后缀文件
	testutil.FileNotExists(t, filepath.Join(bannedDir, "loose.ysm"), "失败时不得先还原文件名（半启用不一致态）")
}

// 畸形路径（NUL）令 filepath.Abs 失败时必须传播错误——原实现 if err==nil 静默跳过守卫
// 即 fail-open，根保护静默丢失。非 Windows 平台 Abs 不报错 → 自动跳过。
func TestToggleModelEnable_AbsErrorPropagatedNotFailOpen(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "m.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if _, probeErr := filepath.Abs("a\x00b"); probeErr == nil {
		t.Skip("本平台 filepath.Abs 对 NUL 不报错，Abs 错误分支不可达")
	}

	// ① Abs(root) 失败必须传播
	_, err := ToggleModelEnable(dir+"\x00", src)
	testutil.NotNil(t, err, "root 路径异常必须传播错误（不得 fail-open 跳过根守卫）")
	// ② Abs(path) 失败必须传播
	_, err = ToggleModelEnable(dir, src+"\x00")
	testutil.NotNil(t, err, "path 路径异常必须传播错误")
	// 终态：畸形输入不得在磁盘上留下任何 .disabled / .ban 改名痕迹
	got := strings.Join(sortedDirNames(t, dir), ",")
	testutil.Equal(t, got, "m.ysm", "畸形输入不得改动磁盘，目录内容")
}
