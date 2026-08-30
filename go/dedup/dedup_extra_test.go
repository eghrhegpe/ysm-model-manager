// ===== go/dedup 补充单测：CountDuplicates / FindDuplicateFiles 边界分支 =====
package dedup

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// ====== CountDuplicates ======

// skipRecycle 开关：true 排除 .recycle 子树，false 计入（IsRecycleDir 口径）
func TestCountDuplicates_RecycleSkipToggle(t *testing.T) {
	dir := t.TempDir()
	recycleDir := filepath.Join(dir, ".recycle")
	testutil.CreateTestFile(t, dir, "keep.txt", "dup")
	testutil.CreateTestFile(t, recycleDir, "r1.txt", "dup")
	testutil.CreateTestFile(t, recycleDir, "r2.txt", "dup")

	g, e, err := CountDuplicates(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if g != 0 || e != 0 {
		t.Fatalf("skipRecycle=true 应排除回收站重复: groups=%d extra=%d, want 0/0", g, e)
	}
	g2, e2, err := CountDuplicates(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	if g2 != 1 || e2 != 2 {
		t.Fatalf("skipRecycle=false 应计入回收站重复: groups=%d extra=%d, want 1/2", g2, e2)
	}
}

// 空文件跳过：占位空文件不是重复文件
func TestCountDuplicates_EmptyFilesSkipped(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "e1.txt", "")
	testutil.CreateTestFile(t, dir, "e2.txt", "")

	g, e, err := CountDuplicates(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if g != 0 || e != 0 {
		t.Fatalf("空文件应全部跳过: groups=%d extra=%d, want 0/0", g, e)
	}
}

// 根目录为符号链接：显式报错，不得静默返回「无重复」假绿
func TestCountDuplicates_SymlinkRootError(t *testing.T) {
	realDir := t.TempDir()
	testutil.CreateTestFile(t, realDir, "a.txt", "same")
	testutil.CreateTestFile(t, realDir, "b.txt", "same")
	link := filepath.Join(t.TempDir(), "rootlink")
	if err := os.Symlink(realDir, link); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}
	if _, _, err := CountDuplicates(link, true); err == nil ||
		!errors.Is(err, ErrSymlinkRoot) {
		t.Fatalf("根目录为符号链接应显式报错, got %v", err)
	}
}

// 子目录/子文件符号链接：跳过（去重只处理实际文件），不报错
func TestCountDuplicates_SymlinkChildSkipped(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "a.txt", "same")
	target := testutil.CreateTestFile(t, dir, "b.txt", "same")
	if err := os.Symlink(target, filepath.Join(dir, "c.txt")); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}
	g, e, err := CountDuplicates(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	// a.txt 与 b.txt 真实重复 → 1 组 1 多余；c.txt 符号链接被跳过
	if g != 1 || e != 1 {
		t.Fatalf("符号链接子项应被跳过: groups=%d extra=%d, want 1/1", g, e)
	}
}

// 根目录不存在：WalkDir 回调收到 lstat 错误 → log + 继续 → 返回空结果不报错
func TestCountDuplicates_NonexistentRootNoError(t *testing.T) {
	g, e, err := CountDuplicates(filepath.Join(t.TempDir(), "missing"), true)
	if err != nil {
		t.Fatalf("不存在的根目录不应报错: %v", err)
	}
	if g != 0 || e != 0 {
		t.Fatalf("不存在的根目录应返回 0/0, got %d/%d", g, e)
	}
}

// ====== FindDuplicateFiles 同源分支 ======

// 空目录字符串 → 显式报错
func TestFindDuplicateFiles_EmptyPathError(t *testing.T) {
	if _, err := FindDuplicateFiles("", true); err == nil {
		t.Fatal("空目录应报错")
	}
}

// 根目录为符号链接：显式报错（与 CountDuplicates 对齐）
func TestFindDuplicateFiles_SymlinkRootError(t *testing.T) {
	realDir := t.TempDir()
	testutil.CreateTestFile(t, realDir, "a.txt", "same")
	link := filepath.Join(t.TempDir(), "rootlink")
	if err := os.Symlink(realDir, link); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}
	if _, err := FindDuplicateFiles(link, true); err == nil ||
		!errors.Is(err, ErrSymlinkRoot) {
		t.Fatalf("根目录为符号链接应显式报错, got %v", err)
	}
}

// 子项符号链接跳过
func TestFindDuplicateFiles_SymlinkChildSkipped(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "a.txt", "same")
	target := testutil.CreateTestFile(t, dir, "b.txt", "same")
	if err := os.Symlink(target, filepath.Join(dir, "c.txt")); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}
	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 {
		t.Fatalf("符号链接子项应被跳过: 期望 1 组（a/b 真实重复）, got %d", len(groups))
	}
}

// 空文件跳过：占位空文件不构成重复
func TestFindDuplicateFiles_EmptyFilesSkipped(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "e1.txt", "")
	testutil.CreateTestFile(t, dir, "e2.txt", "")
	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 0 {
		t.Fatalf("空文件应全部跳过, got %d 组", len(groups))
	}
}

// 根目录不存在：访问失败 log + 继续 → 返回空结果不报错
func TestFindDuplicateFiles_NonexistentRootNoError(t *testing.T) {
	groups, err := FindDuplicateFiles(filepath.Join(t.TempDir(), "missing"), true)
	if err != nil {
		t.Fatalf("不存在的根目录不应报错: %v", err)
	}
	if len(groups) != 0 {
		t.Fatalf("不存在的根目录应返回 0 组, got %d", len(groups))
	}
}

// ====== sentinel 错误分类契约（陷阱 #11）======
// FindDuplicateFiles / CountDuplicates 的符号链接根错误必须以 errors.Is 判定，
// 禁止 strings.Contains(err.Error(), ...) 文本匹配——易碎、误分类。
// 本组测试覆盖「错误分类」分支，验证 sentinel ErrSymlinkRoot 经 fmt.Errorf("%w") 包裹后仍可被 errors.Is 识别。

func TestErrSymlinkRoot_SentinelIdentity(t *testing.T) {
	// sentinel 自身 errors.Is 成立
	if !errors.Is(ErrSymlinkRoot, ErrSymlinkRoot) {
		t.Fatal("errors.Is(ErrSymlinkRoot, ErrSymlinkRoot) 应为 true")
	}
	// 经 fmt.Errorf("%w") 包裹后仍可识别（wrap 不丢失链）
	wrapped := fmt.Errorf("%w: /path/to/link", ErrSymlinkRoot)
	if !errors.Is(wrapped, ErrSymlinkRoot) {
		t.Fatalf("fmt.Errorf %%w 包裹后 errors.Is 应仍成立, got %v", wrapped)
	}
	// 非符号链接错误不得误判为 ErrSymlinkRoot
	other := errors.New("dedup: 目录为空")
	if errors.Is(other, ErrSymlinkRoot) {
		t.Fatal("无关错误不得误判为 ErrSymlinkRoot")
	}
}

func TestFindDuplicateFiles_SymlinkRootErrorIsClassifiable(t *testing.T) {
	realDir := t.TempDir()
	testutil.CreateTestFile(t, realDir, "a.txt", "same")
	testutil.CreateTestFile(t, realDir, "b.txt", "same")
	link := filepath.Join(t.TempDir(), "rootlink")
	if err := os.Symlink(realDir, link); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}
	_, err := FindDuplicateFiles(link, true)
	if err == nil {
		t.Fatal("符号链接根应报错")
	}
	// 陷阱 #11 修复验证：errors.Is 可判定（不依赖错误文本内容）
	if !errors.Is(err, ErrSymlinkRoot) {
		t.Fatalf("FindDuplicateFiles 符号链接根错误应 errors.Is(ErrSymlinkRoot), got %v", err)
	}
	// 且错误信息仍含路径（人类可读）
	if !strings.Contains(err.Error(), link) {
		t.Fatalf("错误信息应含路径 %s, got %v", link, err)
	}
}

func TestCountDuplicates_SymlinkRootErrorIsClassifiable(t *testing.T) {
	realDir := t.TempDir()
	testutil.CreateTestFile(t, realDir, "a.txt", "same")
	testutil.CreateTestFile(t, realDir, "b.txt", "same")
	link := filepath.Join(t.TempDir(), "rootlink")
	if err := os.Symlink(realDir, link); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}
	_, _, err := CountDuplicates(link, true)
	if err == nil {
		t.Fatal("符号链接根应报错")
	}
	if !errors.Is(err, ErrSymlinkRoot) {
		t.Fatalf("CountDuplicates 符号链接根错误应 errors.Is(ErrSymlinkRoot), got %v", err)
	}
	if !strings.Contains(err.Error(), link) {
		t.Fatalf("错误信息应含路径 %s, got %v", link, err)
	}
}

// ====== 剩余未覆盖分支（dedup.go） ======

// filepath.Abs 失败时（Windows 上含 NUL 字节的路径）必须显式报错：
// 静默退回入参形态会让 WalkDir→Lstat 失败被 log 吞掉、返回「无重复」= 假绿，
// 与 ErrSymlinkRoot 同类的静默漏扫。Linux 上 Abs 不校验 NUL，分支不可达 → 跳过。
func TestFindDuplicateFiles_UnparseableRootError(t *testing.T) {
	badPath := t.TempDir() + "\x00" + "suffix"
	if abs, err := filepath.Abs(badPath); err == nil {
		t.Logf("当前平台 filepath.Abs 不拒绝 NUL 路径（Abs=%q），分支不可达，跳过", abs)
		return
	}
	if _, err := FindDuplicateFiles(badPath, true); err == nil {
		t.Fatal("filepath.Abs 失败时必须显式报错，不得静默返回「无重复」假绿")
	}
}

// TrimSpace 后为空串的路径（全空白）应等价于空目录报错
func TestFindDuplicateFiles_WhitespacePathError(t *testing.T) {
	if _, err := FindDuplicateFiles("   ", true); err == nil {
		t.Fatal("全空白目录应报错（TrimSpace 后为空）")
	}
}

// os.Open 失败分支（FindDuplicateFiles）：不可读文件被 log+跳过，扫描不报错、
// 不进入结果。Windows 上 chmod 0000 不阻止读取、root 下 0000 仍可读 → 跳过。
func TestFindDuplicateFiles_UnreadableFileSkipped(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 上 chmod 0000 不阻止读取，无法构造不可读文件")
	}
	dir := t.TempDir()
	_ = testutil.CreateTestFile(t, dir, "a.txt", "same content")
	b := testutil.CreateTestFile(t, dir, "b.txt", "same content")
	if err := os.Chmod(b, 0000); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(b, 0644)
	if f, err := os.Open(b); err == nil {
		f.Close()
		t.Skip("当前以 root 运行，0000 权限文件仍可读，无法覆盖 os.Open 失败分支")
	}

	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatalf("不可读文件应被跳过（log+continue），不得返回错误: %v", err)
	}
	// a.txt 可读、b.txt 打开失败被跳过 → 只有 1 个文件被哈希 → 0 组重复
	if len(groups) != 0 {
		t.Fatalf("期望 0 组重复（b.txt 打开失败被跳过），got %d 组", len(groups))
	}
}

// os.Open 失败分支（CountDuplicates 同源）：不可读文件跳过，计数不受影响
func TestCountDuplicates_UnreadableFileSkipped(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 上 chmod 0000 不阻止读取，无法构造不可读文件")
	}
	dir := t.TempDir()
	_ = testutil.CreateTestFile(t, dir, "a.txt", "same content")
	b := testutil.CreateTestFile(t, dir, "b.txt", "same content")
	if err := os.Chmod(b, 0000); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(b, 0644)
	if f, err := os.Open(b); err == nil {
		f.Close()
		t.Skip("当前以 root 运行，0000 权限文件仍可读，无法覆盖 os.Open 失败分支")
	}

	g, e, err := CountDuplicates(dir, true)
	if err != nil {
		t.Fatalf("不可读文件应被跳过，不得返回错误: %v", err)
	}
	if g != 0 || e != 0 {
		t.Fatalf("期望 0 组 0 多余（b.txt 打开失败被跳过），got groups=%d extra=%d", g, e)
	}
}
