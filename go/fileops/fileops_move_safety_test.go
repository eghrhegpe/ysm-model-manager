package fileops

// ===== MoveModelFile 文件系统终态 / 失败回滚 特征测试 =====
// 既有用例多止步于 err==nil 或「目标存在」；本文件补齐**终态断言**——
// 移动是真实数据搬迁，失败模式的代价是丢文件而非静默解析错：
//   1. 成功：源消失 + 目标存在 + 内容逐字节一致（防「复制了但没删」的静默双份/截断）
//   2. 失败：不得留半成品——本次新建的空 dstDir 回滚；**预存在** dstDir 及其内容绝不被清理（P3-2 红线）
//   3. 仓库边界：目标越界的错误优先级（源越界 > 目标越界）
//   4. 跨设备（EXDEV）真回退：复制失败时源必须完好、目标不留半截
// 使用与 fileops_crossdev_test.go 同一可注入 seam（renameForMove），不新增生产代码开关。

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

// forceRenameError 替换 renameForMove 恒返回指定错误（非 EXDEV → 走失败清理分支），
// 返回恢复函数由 t.Cleanup 兜底。
func forceRenameError(t *testing.T, e error) {
	t.Helper()
	orig := renameForMove
	renameForMove = func(string, string) error { return e }
	t.Cleanup(func() { renameForMove = orig })
}

// sortedDirNames 返回 dir 下条目名（升序），用于「终态目录内容」整集合断言
// （比逐个 FileExists 更能抓住多余残留 / 改名残留）。
func sortedDirNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("读取目录 %s 失败: %v", dir, err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	// 条目名全集比较不依赖顺序，直接排序后拼接即可（无需引入额外依赖）
	for i := 1; i < len(names); i++ {
		for j := i; j > 0 && names[j] < names[j-1]; j-- {
			names[j], names[j-1] = names[j-1], names[j]
		}
	}
	return names
}

// 成功移动的终态：源不存在、目标存在、内容逐字节一致。
func TestMoveModelFile_EndState_SourceGoneTargetByteIdentical(t *testing.T) {
	base := t.TempDir()
	srcDir := filepath.Join(base, "src")
	dstDir := filepath.Join(base, "dst")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(srcDir, "m.ysm")
	content := []byte("payload\x00binary\xff\xfe")
	if err := os.WriteFile(src, content, 0644); err != nil {
		t.Fatal(err)
	}

	if err := MoveModelFile(base, src, dstDir); err != nil {
		t.Fatalf("移动应成功: %v", err)
	}
	// 终态①：源必须消失——否则是「复制未删」的静默双份，用户以为搬走了实则两份
	if _, err := os.Lstat(src); !os.IsNotExist(err) {
		t.Fatalf("源应已消失，got err=%v", err)
	}
	// 终态②：目标存在且逐字节一致（防半截文件/Windows 文本模式改写）
	got, err := os.ReadFile(filepath.Join(dstDir, "m.ysm"))
	if err != nil {
		t.Fatalf("目标不可读: %v", err)
	}
	if !bytes.Equal(got, content) {
		t.Fatalf("目标内容不一致: got %q want %q", got, content)
	}
	// 终态③：源目录不得留残渣
	if names := sortedDirNames(t, srcDir); len(names) != 0 {
		t.Fatalf("源目录应清空，残留 %v", names)
	}
}

// 非 EXDEV rename 失败 + 目标目录由本次新建 → 回滚空目录，源完好。
func TestMoveModelFile_RenameFailRollsBackCreatedDstDir(t *testing.T) {
	forceRenameError(t, errors.New("simulated rename failure"))
	base := t.TempDir()
	src := filepath.Join(base, "m.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(base, "sub") // 不存在 → 由本次 prepareModelDest 新建

	err := MoveModelFile(base, src, dstDir)
	if err == nil {
		t.Fatal("rename 失败应报错")
	}
	// 原始错误必须透传（不吞错、不换成笼统文案）
	if !strings.Contains(err.Error(), "simulated rename failure") {
		t.Fatalf("应透传原 rename 错误，got %v", err)
	}
	// 失败不留半成品：本次新建的 dstDir 被回滚
	if _, statErr := os.Lstat(dstDir); !os.IsNotExist(statErr) {
		t.Fatalf("本次新建的 dstDir 应被回滚清理，got err=%v", statErr)
	}
	// 数据安全：失败绝不能丢源
	if _, statErr := os.Lstat(src); statErr != nil {
		t.Fatalf("失败时源必须保留: %v", statErr)
	}
}

// 非 EXDEV rename 失败 + 目标目录**预存在** → 预存在内容绝不被清理（P3-2 红线）。
func TestMoveModelFile_RenameFailKeepsPreexistingDstDir(t *testing.T) {
	forceRenameError(t, errors.New("simulated rename failure"))
	base := t.TempDir()
	src := filepath.Join(base, "m.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(base, "sub")
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(dstDir, "keep-me.ysm")
	if err := os.WriteFile(sentinel, []byte("precious"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := MoveModelFile(base, src, dstDir); err == nil {
		t.Fatal("rename 失败应报错")
	}
	// P3-2 红线：预存在目标目录及其内容绝不被失败清理误删（静默数据破坏）
	if got, err := os.ReadFile(sentinel); err != nil || string(got) != "precious" {
		t.Fatalf("预存在 dstDir 内容被误删/损坏: got=%q err=%v", got, err)
	}
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("失败时源必须保留: %v", err)
	}
}

// 目标目录在仓库外 → 命中「目标目录必须在仓库内」，源不动、仓库外无落点。
func TestMoveModelFile_TargetOutsideRootRejected(t *testing.T) {
	base := t.TempDir()
	repo := filepath.Join(base, "repo")
	if err := os.MkdirAll(repo, 0755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(repo, "m.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(base, "outside")
	if err := os.MkdirAll(outside, 0755); err != nil {
		t.Fatal(err)
	}

	err := MoveModelFile(repo, src, outside)
	if err == nil {
		t.Fatal("目标目录在仓库外应被拒绝")
	}
	if !strings.Contains(err.Error(), "目标目录必须在仓库内") {
		t.Fatalf("应命中目标越界守卫，got %v", err)
	}
	// 终态：源未被移动、仓库外无落点、无残留目录
	if _, serr := os.Stat(src); serr != nil {
		t.Fatalf("源必须保留: %v", serr)
	}
	if _, serr := os.Lstat(filepath.Join(outside, "m.ysm")); !os.IsNotExist(serr) {
		t.Fatalf("仓库外不得出现落点: %v", serr)
	}
}

// 路径 Abs 失败必须传播错误（fail-open 会让整条边界校验静默失效）。
// NUL 字节在 Windows 上令 filepath.Abs 报错（POSIX 放行）→ 非 Windows 自动跳过。
func TestMoveModelFile_AbsErrorPropagated(t *testing.T) {
	base := t.TempDir()
	src := filepath.Join(base, "m.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(base, "sub")
	if _, probeErr := filepath.Abs("a\x00b"); probeErr == nil {
		t.Skip("本平台 filepath.Abs 对 NUL 不报错，Abs 错误分支不可达")
	}

	// ① Abs(root) 失败
	if err := MoveModelFile(base+"\x00", src, dstDir); err == nil {
		t.Fatal("root 路径异常必须传播错误（不得 fail-open 跳过守卫）")
	}
	// ② Abs(src) 失败
	if err := MoveModelFile(base, src+"\x00", dstDir); err == nil {
		t.Fatal("src 路径异常必须传播错误")
	}
	// ③ Abs(dstDir) 失败
	if err := MoveModelFile(base, src, dstDir+"\x00"); err == nil {
		t.Fatal("dstDir 路径异常必须传播错误")
	}
	// 终态：三次畸形输入都不得改动磁盘
	if names := sortedDirNames(t, base); strings.Join(names, ",") != "m.ysm" {
		t.Fatalf("畸形输入不得改动磁盘，目录内容 = %v", names)
	}
}

// 跨设备回退：单文件复制失败（目标落点被抢占成目录，tmp→dst rename 必然失败）
// → 报错、源完好、目标无半截文件、fsutil 临时文件已清理。
func TestMoveModelFile_CrossDeviceFileCopyFailKeepsSource(t *testing.T) {
	base := t.TempDir()
	src := filepath.Join(base, "m.ysm")
	if err := os.WriteFile(src, []byte("payload"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(base, "sub")

	orig := renameForMove
	renameForMove = func(_, dst string) error {
		// 模拟 check-then-act 窗口：他方在目标落点抢先建出同名目录，
		// 使 copyFile 的 tmp→dst rename 必然失败
		if merr := os.MkdirAll(dst, 0755); merr != nil {
			return merr
		}
		return syscall.EXDEV
	}
	t.Cleanup(func() { renameForMove = orig })

	if err := MoveModelFile(base, src, dstDir); err == nil {
		t.Fatal("跨设备回退复制失败应报错")
	}
	// 数据安全铁律：复制失败绝不能删除源
	if got, rerr := os.ReadFile(src); rerr != nil || string(got) != "payload" {
		t.Fatalf("失败时源必须原样保留: got=%q err=%v", got, rerr)
	}
	// 不留半成品：目标落点无半截文件、无 .copy-*.tmp 残渣
	entries, derr := os.ReadDir(dstDir)
	if derr != nil {
		t.Fatalf("dstDir 应存在: %v", derr)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".copy-") {
			t.Fatalf("复制失败残留临时文件: %s", e.Name())
		}
	}
}

// 跨设备回退：目录复制失败（目标落点被抢占成普通文件，MkdirAll 失败）
// → 报错、源树完好。
func TestMoveModelFile_CrossDeviceDirCopyFailKeepsSource(t *testing.T) {
	base := t.TempDir()
	srcDir := filepath.Join(base, "modelA")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "m.ysm"), []byte("payload"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(base, "sub")

	orig := renameForMove
	renameForMove = func(_, dst string) error {
		// 抢占目标落点为普通文件 → 目录复制第一步 MkdirAll(dst) 失败
		if werr := os.WriteFile(dst, []byte("squatter"), 0644); werr != nil {
			return werr
		}
		return syscall.EXDEV
	}
	t.Cleanup(func() { renameForMove = orig })

	if err := MoveModelFile(base, srcDir, dstDir); err == nil {
		t.Fatal("跨设备目录复制失败应报错")
	}
	// 源树必须原样保留（复制失败 = 未发生任何搬迁）
	if got, rerr := os.ReadFile(filepath.Join(srcDir, "m.ysm")); rerr != nil || string(got) != "payload" {
		t.Fatalf("失败时源树必须原样保留: got=%q err=%v", got, rerr)
	}
}

// 跨设备回退：源在窗口内消失（os.Stat 失败）→ 透传 NotExist、不产出目标数据。
// 特征备注（非期望）：该分支不清理本次新建的 dstDir，会留下**空目录**
// （非数据丢失，与身份明确的非 EXDEV 分支的清理行为不对称）——此处如实记录，
// 不以硬断言冻结 wart，便于后续若要补齐清理时无需改测试。
func TestMoveModelFile_CrossDeviceStatSourceFails(t *testing.T) {
	base := t.TempDir()
	src := filepath.Join(base, "m.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(base, "sub")

	orig := renameForMove
	renameForMove = func(_, _ string) error {
		// 模拟窗口内源被移走：回退路径的 os.Stat(src) 失败
		_ = os.Remove(src)
		return syscall.EXDEV
	}
	t.Cleanup(func() { renameForMove = orig })

	err := MoveModelFile(base, src, dstDir)
	if err == nil {
		t.Fatal("源已消失时应报错")
	}
	// 透传 os.Stat 的原始错误（不包装），调用方可按 NotExist 分类
	if !os.IsNotExist(err) {
		t.Fatalf("应透传 NotExist，got %v", err)
	}
	// 不产出任何目标数据
	if _, serr := os.Lstat(filepath.Join(dstDir, "m.ysm")); !os.IsNotExist(serr) {
		t.Fatalf("不应产生目标文件: %v", serr)
	}
	if _, serr := os.Lstat(dstDir); serr != nil {
		t.Logf("NOTE: dstDir 已被清理（行为较原实现有变）: %v", serr)
	} else {
		t.Logf("NOTE(特征): EXDEV+statErr 分支不清理本次新建的空 dstDir（无数据丢失）")
	}
}
