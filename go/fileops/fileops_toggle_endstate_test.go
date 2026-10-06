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
)

// 文件级禁用→启用：目录条目全集在后缀追加/去掉之间往返，内容逐字节不变。
func TestToggleModelEnable_EndState_FileSuffixAppendedNotReplaced(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "m.ysm")
	content := []byte("payload\x00binary")
	if err := os.WriteFile(src, content, 0644); err != nil {
		t.Fatal(err)
	}

	enabled, err := ToggleModelEnable(dir, src)
	if err != nil || enabled {
		t.Fatalf("禁用应返回 enabled=false: %v", err)
	}
	// 终态：条目全集恰为 {m.ysm.disabled}——后缀是**追加**（防实现改成替换/加前缀丢扩展名）
	if got := strings.Join(sortedDirNames(t, dir), ","); got != "m.ysm.disabled" {
		t.Fatalf("禁用后条目全集 = %q, want m.ysm.disabled", got)
	}
	if got, rerr := os.ReadFile(filepath.Join(dir, "m.ysm.disabled")); rerr != nil || !bytes.Equal(got, content) {
		t.Fatalf("禁用后内容必须随文件一起走: got=%q err=%v", got, rerr)
	}

	enabled, err = ToggleModelEnable(dir, filepath.Join(dir, "m.ysm.disabled"))
	if err != nil || !enabled {
		t.Fatalf("启用应返回 enabled=true: %v", err)
	}
	// 终态：条目全集回到 {m.ysm}，不留 .disabled 残影
	if got := strings.Join(sortedDirNames(t, dir), ","); got != "m.ysm" {
		t.Fatalf("启用后条目全集 = %q, want m.ysm", got)
	}
	if got, rerr := os.ReadFile(src); rerr != nil || !bytes.Equal(got, content) {
		t.Fatalf("启用后内容必须逐字节一致: got=%q err=%v", got, rerr)
	}
}

// 目录级整组禁用→启用：整组资源随目录名一起被隔离/还原，松散文件不被单独改名。
func TestToggleModelEnable_EndState_DirGroupMovesAsWhole(t *testing.T) {
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	loose := filepath.Join(modelDir, "loose.ysm")
	if err := os.WriteFile(loose, []byte("loose"), 0644); err != nil {
		t.Fatal(err)
	}

	enabled, err := ToggleModelEnable(base, filepath.Join(modelDir, "ysm.json"))
	if err != nil || enabled {
		t.Fatalf("整组禁用应返回 enabled=false: %v", err)
	}
	// 终态：base 下恰有「模型A.disabled」——整组走，不留半个模型目录
	if got := strings.Join(sortedDirNames(t, base), ","); got != "模型A.disabled" {
		t.Fatalf("整组禁用后 base 条目全集 = %q, want 模型A.disabled", got)
	}
	bannedDir := filepath.Join(base, "模型A.disabled")
	// 包内所有资源（geometry/animation/语言/纹理/松散文件）随目录一起隔离
	for _, f := range []string{"ysm.json", "main.json", "arm.animation.json", "zh_cn.json", "textures/skin.png", "loose.ysm"} {
		if _, serr := os.Stat(filepath.Join(bannedDir, filepath.FromSlash(f))); serr != nil {
			t.Fatalf("整组禁用应连带隔离 %s: %v", f, serr)
		}
	}

	// 经目录内**松散文件**触发整组启用（与 ysm.json 入口对称）
	enabled, err = ToggleModelEnable(base, filepath.Join(bannedDir, "loose.ysm"))
	if err != nil || !enabled {
		t.Fatalf("整组启用应返回 enabled=true: %v", err)
	}
	if got := strings.Join(sortedDirNames(t, base), ","); got != "模型A" {
		t.Fatalf("整组启用后 base 条目全集 = %q, want 模型A", got)
	}
	// 启用后目录内不得残留任何禁用标记名（扩展名与顺序均未被改写）
	for _, n := range sortedDirNames(t, modelDir) {
		if strings.Contains(strings.ToLower(n), ".disabled") || strings.Contains(strings.ToLower(n), ".ban") {
			t.Fatalf("启用后不得残留禁用名: %v", sortedDirNames(t, modelDir))
		}
	}
	if got, rerr := os.ReadFile(loose); rerr != nil || string(got) != "loose" {
		t.Fatalf("松散文件必须保留原名与内容: got=%q err=%v", got, rerr)
	}
}

// 旧状态残留（父目录 + 文件双禁用）且**父目录**还原目标已存在：
// 必须在「先父目录」的决定性 Rename 之前拒绝 → 磁盘逐字节原样，不得出现半启用态。
func TestToggleModelEnable_DirBanResidueDirNewExistsKeepsDiskUntouched(t *testing.T) {
	base := t.TempDir()
	bannedDir := filepath.Join(base, "模型A.ban")
	if err := os.MkdirAll(bannedDir, 0755); err != nil {
		t.Fatal(err)
	}
	residue := filepath.Join(bannedDir, "loose.ysm.ban")
	if err := os.WriteFile(residue, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// 预置父目录还原目标 → 应命中「父目录目标已存在」
	if err := os.MkdirAll(filepath.Join(base, "模型A"), 0755); err != nil {
		t.Fatal(err)
	}

	if _, err := ToggleModelEnable(base, residue); err == nil {
		t.Fatal("父目录还原目标已存在应报错")
	}
	// 终态：.ban 目录与残留文件原样保留
	if _, serr := os.Stat(bannedDir); serr != nil {
		t.Fatalf(".ban 目录必须原样保留: %v", serr)
	}
	if _, serr := os.Stat(residue); serr != nil {
		t.Fatalf(".ban 残留文件必须原样保留: %v", serr)
	}
	// 关键：不得先做文件级还原（P3-1 顺序）——旧父目录下不得凭空出现去后缀文件
	if _, serr := os.Stat(filepath.Join(bannedDir, "loose.ysm")); !os.IsNotExist(serr) {
		t.Fatalf("失败时不得先还原文件名（半启用不一致态）: %v", serr)
	}
}

// 畸形路径（NUL）令 filepath.Abs 失败时必须传播错误——原实现 if err==nil 静默跳过守卫
// 即 fail-open，根保护静默丢失。非 Windows 平台 Abs 不报错 → 自动跳过。
func TestToggleModelEnable_AbsErrorPropagatedNotFailOpen(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "m.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, probeErr := filepath.Abs("a\x00b"); probeErr == nil {
		t.Skip("本平台 filepath.Abs 对 NUL 不报错，Abs 错误分支不可达")
	}

	// ① Abs(root) 失败必须传播
	if _, err := ToggleModelEnable(dir+"\x00", src); err == nil {
		t.Fatal("root 路径异常必须传播错误（不得 fail-open 跳过根守卫）")
	}
	// ② Abs(path) 失败必须传播
	if _, err := ToggleModelEnable(dir, src+"\x00"); err == nil {
		t.Fatal("path 路径异常必须传播错误")
	}
	// 终态：畸形输入不得在磁盘上留下任何 .disabled / .ban 改名痕迹
	if got := strings.Join(sortedDirNames(t, dir), ","); got != "m.ysm" {
		t.Fatalf("畸形输入不得改动磁盘，目录内容 = %q", got)
	}
}
