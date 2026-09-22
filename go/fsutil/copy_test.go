// ===== fsutil.CopyFile / CopyDirRecursive / relJoin 直测（ADR-044 策略 A 收敛后补测：
// 原子复制为数据安全不变量，失败分支清理必须可检测，防残留回归）=====
package fsutil

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// ===== StepError：步骤标注不破坏既有错误断言（ADR-044 机制归 fsutil）=====

func TestStepError_WrapAndUnwrap(t *testing.T) {
	inner := errors.New("读取失败")
	err := stepErr(StepStat, inner)
	// Error() 透传内层文本，既有 caller 的 err.Error() 断言零影响
	if err.Error() != "读取失败" {
		t.Fatalf("Error() 应透传内层，got %q", err.Error())
	}
	if !errors.Is(err, inner) {
		t.Fatal("errors.Is 应穿透 StepError 命中内层")
	}
	// Unwrap 返回内层
	if w := err.(*StepError).Unwrap(); w != inner {
		t.Fatalf("Unwrap 应返回内层")
	}
}

func TestStepError_StepVisibleViaAs(t *testing.T) {
	err := stepErr(StepRename, os.ErrPermission)
	var se *StepError
	if !errors.As(err, &se) {
		t.Fatal("errors.As 应取到 StepError")
	}
	if se.Step != StepRename {
		t.Fatalf("Step 应为 %q，got %q", StepRename, se.Step)
	}
	if se.Err != os.ErrPermission {
		t.Fatalf("Err 应为 os.ErrPermission")
	}
	// 内层 fs.ErrNotExist 语义经链条保留（WINDOWS/各平台通用）
	if !errors.Is(err, os.ErrPermission) {
		t.Fatal("errors.Is(os.ErrPermission) 应命中")
	}
}

func TestCopyFile_AllStepsWrapStepError(t *testing.T) {
	// 目录源 → StepStat（既有 TestCopyFile_SrcIsDir 行为保留，且带 Step 标注）
	dir := t.TempDir()
	err := CopyFile(dir, filepath.Join(t.TempDir(), "x"))
	var se *StepError
	if !errors.As(err, &se) || se.Step != StepStat {
		t.Fatalf("目录源应映射 StepStat, got %v", err)
	}
	// 源不存在 → StepStat（stat 失败）且透传 fs.ErrNotExist
	err = CopyFile(filepath.Join(t.TempDir(), "nope.ysm"), filepath.Join(t.TempDir(), "x"))
	if !errors.As(err, &se) || se.Step != StepStat {
		t.Fatalf("源缺失应映射 StepStat, got %v", err)
	}
	_ = fmt.Sprint(err) // 确保步进打印不 panic
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatal("源缺失应可 errors.Is(fs.ErrNotExist)")
	}
}

func TestCopyFile_Success(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "sub", "dst.txt")
	if err := os.WriteFile(src, []byte("hello world"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := CopyFile(src, dst); err != nil {
		t.Fatalf("CopyFile 失败: %v", err)
	}
	data, err := os.ReadFile(dst)
	if err != nil || string(data) != "hello world" {
		t.Fatalf("内容不符: %q %v", string(data), err)
	}
	// 父目录自动创建
	fi, err := os.Stat(filepath.Join(dir, "sub"))
	if err != nil || !fi.IsDir() {
		t.Fatal("父目录未创建")
	}
	// 权限：Windows 映射 0666，其他平台 0644
	want := os.FileMode(0644)
	if runtime.GOOS == "windows" {
		want = 0666
	}
	got, err := os.Stat(dst)
	if err != nil {
		t.Fatal(err)
	}
	if got.Mode().Perm() != want {
		t.Errorf("权限应为 %o，实际 %o", want, got.Mode().Perm())
	}
	// 成功路径不得残留 .copy-*.tmp
	matches, _ := filepath.Glob(filepath.Join(dir, "sub", ".copy-*.tmp"))
	if len(matches) != 0 {
		t.Fatalf("成功路径不应残留临时文件: %v", matches)
	}
}

func TestCopyFile_SrcNotFound(t *testing.T) {
	dir := t.TempDir()
	err := CopyFile(filepath.Join(dir, "nope.txt"), filepath.Join(dir, "dst.txt"))
	if err == nil {
		t.Fatal("源文件不存在应报错")
	}
}

func TestCopyFile_DstDirIsFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	blocker := filepath.Join(dir, "blocker")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(blocker, []byte("block"), 0644); err != nil {
		t.Fatal(err)
	}
	err := CopyFile(src, filepath.Join(blocker, "dst.txt"))
	if err == nil {
		t.Fatal("目标父目录为文件时应报错")
	}
}

func TestCopyDirRecursive_Success(t *testing.T) {
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("AAA"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(src, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", "b.txt"), []byte("BBB"), 0644); err != nil {
		t.Fatal(err)
	}

	dst := filepath.Join(t.TempDir(), "dst")
	err := CopyDirRecursive(src, dst, CopyDirOptions{Overwrite: true, Rollback: true})
	if err != nil {
		t.Fatalf("CopyDirRecursive 失败: %v", err)
	}
	// 验证文件
	data, err := os.ReadFile(filepath.Join(dst, "a.txt"))
	if err != nil || string(data) != "AAA" {
		t.Fatalf("a.txt 内容不符: %q", string(data))
	}
	data, err = os.ReadFile(filepath.Join(dst, "sub", "b.txt"))
	if err != nil || string(data) != "BBB" {
		t.Fatalf("sub/b.txt 内容不符: %q", string(data))
	}
}

func TestCopyDirRecursive_RejectSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 下创建 symlink 需要管理员权限")
	}
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "target.txt"), []byte("target"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("target.txt", filepath.Join(src, "link.txt")); err != nil {
		t.Fatal(err)
	}

	dst := filepath.Join(t.TempDir(), "dst")
	err := CopyDirRecursive(src, dst, CopyDirOptions{RejectSymlink: true, Overwrite: true})
	if err == nil {
		t.Fatal("RejectSymlink=true 时应拒绝 symlink")
	}
	if !strings.Contains(err.Error(), "拒绝复制符号链接") {
		t.Errorf("错误信息应包含拒绝提示: %v", err)
	}
}

func TestCopyDirRecursive_CopySymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 下创建 symlink 需要管理员权限")
	}
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "target.txt"), []byte("target"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("target.txt", filepath.Join(src, "link.txt")); err != nil {
		t.Fatal(err)
	}

	dst := filepath.Join(t.TempDir(), "dst")
	err := CopyDirRecursive(src, dst, CopyDirOptions{RejectSymlink: false, Overwrite: true})
	if err != nil {
		t.Fatalf("复制 symlink 本身应成功: %v", err)
	}
	// 验证 symlink 被复制（保留链接语义）
	fi, err := os.Lstat(filepath.Join(dst, "link.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Error("symlink 应被复制为 symlink，而非普通文件")
	}
}

func TestCopyDirRecursive_OverwriteFalse(t *testing.T) {
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("AAA"), 0644); err != nil {
		t.Fatal(err)
	}

	dst := filepath.Join(t.TempDir(), "dst")
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dst, "a.txt"), []byte("OLD"), 0644); err != nil {
		t.Fatal(err)
	}

	err := CopyDirRecursive(src, dst, CopyDirOptions{Overwrite: false, Rollback: false})
	if err == nil {
		t.Fatal("Overwrite=false 且目标存在时应报错")
	}
	if !strings.Contains(err.Error(), "目标已存在") {
		t.Errorf("错误信息应包含存在提示: %v", err)
	}
}

func TestCopyDirRecursive_RollbackOnFailure(t *testing.T) {
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("AAA"), 0644); err != nil {
		t.Fatal(err)
	}

	// 用 Overwrite=false + 预置目标文件来制造失败
	dst := filepath.Join(t.TempDir(), "dst")
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dst, "a.txt"), []byte("OLD"), 0644); err != nil {
		t.Fatal(err)
	}

	err := CopyDirRecursive(src, dst, CopyDirOptions{Overwrite: false, Rollback: true})
	if err == nil {
		t.Fatal("应报错")
	}
	// Rollback=true 时应清理 dst 目录
	_, err = os.Stat(dst)
	if err == nil {
		t.Error("Rollback=true 时失败后 dst 应被清理")
	}
}

func TestCopyDirRecursive_AtomicRename_DstMissing(t *testing.T) {
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("AAA"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(src, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", "b.txt"), []byte("BBB"), 0644); err != nil {
		t.Fatal(err)
	}

	dst := filepath.Join(t.TempDir(), "dst")
	err := CopyDirRecursive(src, dst, CopyDirOptions{AtomicRename: true, Overwrite: true})
	if err != nil {
		t.Fatalf("AtomicRename 目标不存在失败: %v", err)
	}
	// 验证内容
	data, err := os.ReadFile(filepath.Join(dst, "a.txt"))
	if err != nil || string(data) != "AAA" {
		t.Fatalf("a.txt 内容不符: %q", string(data))
	}
	data, err = os.ReadFile(filepath.Join(dst, "sub", "b.txt"))
	if err != nil || string(data) != "BBB" {
		t.Fatalf("sub/b.txt 内容不符: %q", string(data))
	}
	// 不得残留临时目录
	matches, _ := filepath.Glob(filepath.Join(src, ".tmp_copy_*"))
	if len(matches) != 0 {
		t.Fatalf("成功路径不应残留临时目录: %v", matches)
	}
}

func TestCopyDirRecursive_AtomicRename_OverwriteExisting(t *testing.T) {
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("NEW"), 0644); err != nil {
		t.Fatal(err)
	}

	dst := filepath.Join(t.TempDir(), "target")
	// 预置旧目录
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dst, "old.txt"), []byte("OLD"), 0644); err != nil {
		t.Fatal(err)
	}

	err := CopyDirRecursive(src, dst, CopyDirOptions{AtomicRename: true, Overwrite: true})
	if err != nil {
		t.Fatalf("AtomicRename 覆盖已有目录失败: %v", err)
	}
	// 新文件存在
	data, err := os.ReadFile(filepath.Join(dst, "a.txt"))
	if err != nil || string(data) != "NEW" {
		t.Fatalf("新文件缺失: %v %q", err, string(data))
	}
	// 旧文件应被整体替换
	if _, err := os.Stat(filepath.Join(dst, "old.txt")); err == nil {
		t.Fatal("旧文件应被整体替换")
	}
	// 备份目录应被清理
	matches, _ := filepath.Glob(filepath.Join(filepath.Dir(dst), "target.bak-*"))
	if len(matches) != 0 {
		t.Fatalf("备份目录应被清理，实际残留 %d 个", len(matches))
	}
}

func TestCopyDirRecursive_AtomicRename_AncestorGuard(t *testing.T) {
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	// dst 是 src 的后代 → 拒绝
	dst := filepath.Join(src, "sub", "out")
	err := CopyDirRecursive(src, dst, CopyDirOptions{AtomicRename: true, Overwrite: true})
	if err == nil {
		t.Fatal("src 包含 dst 时应拒绝")
	}
	if !strings.Contains(err.Error(), "死循环") {
		t.Errorf("错误信息应包含死循环提示: %v", err)
	}

	// src == dst → 拒绝
	err = CopyDirRecursive(src, src, CopyDirOptions{AtomicRename: true, Overwrite: true})
	if err == nil {
		t.Fatal("src == dst 时应拒绝")
	}
	if !strings.Contains(err.Error(), "相同") {
		t.Errorf("错误信息应包含相同提示: %v", err)
	}
}

func TestCopyDirRecursive_AtomicRename_SrcIsFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "afile")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "out")
	err := CopyDirRecursive(src, dst, CopyDirOptions{AtomicRename: true, Overwrite: true})
	if err == nil {
		t.Fatal("源是文件时应报错")
	}
}

func TestRelJoin(t *testing.T) {
	// 使用 filepath.Join 构造跨平台兼容路径
	dst := filepath.Join("dst")
	src := filepath.Join("src")

	tests := []struct {
		p        string
		expected string
	}{
		{filepath.Join("src", "a.txt"), filepath.Join("dst", "a.txt")},
		{filepath.Join("src", "sub", "b.txt"), filepath.Join("dst", "sub", "b.txt")},
	}
	for _, tt := range tests {
		t.Run("", func(t *testing.T) {
			got, err := relJoin(dst, src, tt.p)
			if err != nil {
				t.Fatalf("不应报错: %v", err)
			}
			if got != tt.expected {
				t.Errorf("relJoin(%q,%q,%q) = %q, 期望 %q", dst, src, tt.p, got, tt.expected)
			}
		})
	}
	// 跨根路径：Windows 下 filepath.Rel 不报错（返回 ..\other\x.txt），
	// Linux/macOS 下报错——分别验证
	other := filepath.Join("other", "x.txt")
	got, err := relJoin(dst, src, other)
	if runtime.GOOS == "windows" {
		// Windows: 不报错，返回 dst + ..\other\x.txt
		if err != nil {
			t.Errorf("Windows 下跨根路径不应报错: %v", err)
		}
	} else {
		// Unix: 报错
		if err == nil {
			t.Errorf("Unix 下跨根路径应报错, got %q", got)
		}
	}
}

// TestRecoverAtomicRename_Recovery 验证 AtomicRename 崩溃窗口的自愈：
// 模拟 Rename(dst, backup) 成功、Rename(tmpDir, dst) 之前的崩溃状态，
// RecoverAtomicRename 应能检测到 backup 并恢复。
func TestRecoverAtomicRename_Recovery(t *testing.T) {
	dir := t.TempDir()

	// 模拟崩溃状态：dst 缺失，backup 残留
	backup := filepath.Join(dir, "mydir.bak-1234567890")
	if err := os.MkdirAll(filepath.Join(backup, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(backup, "a.txt"), []byte("recovered"), 0644); err != nil {
		t.Fatal(err)
	}

	// 确认 dst 不存在
	dst := filepath.Join(dir, "mydir")
	if _, err := os.Stat(dst); err == nil {
		t.Fatal("测试前提：dst 不应存在")
	}

	// 执行恢复
	recovered, err := RecoverAtomicRename(dir)
	if err != nil {
		t.Fatalf("RecoverAtomicRename 失败: %v", err)
	}
	if recovered != 1 {
		t.Fatalf("应恢复 1 个 backup，实际 %d", recovered)
	}

	// 验证恢复结果
	data, err := os.ReadFile(filepath.Join(dst, "a.txt"))
	if err != nil || string(data) != "recovered" {
		t.Fatalf("恢复后内容不符: %q %v", string(data), err)
	}
	// backup 应被删除
	if _, err := os.Stat(backup); err == nil {
		t.Fatal("恢复后 backup 应被删除")
	}
}

// TestRecoverAtomicRename_AlreadyRecovered 验证原始目录已存在时跳过
func TestRecoverAtomicRename_AlreadyRecovered(t *testing.T) {
	dir := t.TempDir()

	// 原始目录已存在
	dst := filepath.Join(dir, "mydir")
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}
	// backup 也存在（残留）
	backup := filepath.Join(dir, "mydir.bak-1234567890")
	if err := os.MkdirAll(backup, 0755); err != nil {
		t.Fatal(err)
	}

	recovered, err := RecoverAtomicRename(dir)
	if err != nil {
		t.Fatalf("RecoverAtomicRename 失败: %v", err)
	}
	if recovered != 0 {
		t.Fatalf("原始目录已存在时应跳过，实际恢复 %d", recovered)
	}
	// backup 应保留（未被错误恢复）
	if _, err := os.Stat(backup); err != nil {
		t.Fatal("原始目录已存在时 backup 应保留")
	}
}

// TestRecoverAtomicRename_MultipleBackups 验证多个 backup 时取最新
func TestRecoverAtomicRename_MultipleBackups(t *testing.T) {
	dir := t.TempDir()

	// 两个 backup，时间戳不同
	backup1 := filepath.Join(dir, "mydir.bak-100")
	backup2 := filepath.Join(dir, "mydir.bak-200")
	if err := os.MkdirAll(backup1, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(backup2, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(backup1, "old.txt"), []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(backup2, "new.txt"), []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}

	recovered, err := RecoverAtomicRename(dir)
	if err != nil {
		t.Fatalf("RecoverAtomicRename 失败: %v", err)
	}
	if recovered != 1 {
		t.Fatalf("应恢复 1 个 backup，实际 %d", recovered)
	}

	// 应恢复最新的 backup2
	data, err := os.ReadFile(filepath.Join(dir, "mydir", "new.txt"))
	if err != nil || string(data) != "new" {
		t.Fatalf("应恢复最新 backup，实际内容: %q %v", string(data), err)
	}
}

// TestRecoverAtomicRename_EmptyDir 验证空目录不报错
func TestRecoverAtomicRename_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	recovered, err := RecoverAtomicRename(dir)
	if err != nil {
		t.Fatalf("空目录不应报错: %v", err)
	}
	if recovered != 0 {
		t.Fatalf("空目录应恢复 0，实际 %d", recovered)
	}
}

// TestRecoverAtomicRename_NonExistentDir 验证目录不存在时返回 0
func TestRecoverAtomicRename_NonExistentDir(t *testing.T) {
	recovered, err := RecoverAtomicRename(filepath.Join(t.TempDir(), "nope"))
	if err != nil {
		t.Fatalf("目录不存在不应报错: %v", err)
	}
	if recovered != 0 {
		t.Fatalf("目录不存在应恢复 0，实际 %d", recovered)
	}
}

// TestRecoverAtomicRename_IgnoresRelinkBakFamily（ADR-296 对抗审查③）：
// relink 备份命名族 `<目录名>.relink-bak-<ts>` 不得被 .bak-* 自愈分组认领——
// 否则会把 relink 恢复点当 AtomicRename 半成品 rename 回 `<目录名>.relink-bak`
// （凭空造出脏目录、且原 dst 已存在时是二次污染）。当前 LastIndex(".bak-") 因
// "relink-bak-" 中 b 前是连字符而非点号天然不匹配，本测试钉死该免疫性，
// 防将来放宽匹配（如改 HasSuffix 前判 "-bak-"）时静默回归误搬恢复点。
func TestRecoverAtomicRename_IgnoresRelinkBakFamily(t *testing.T) {
	dir := t.TempDir()
	// 一个 relink 备份尸体 + 其 dst 原样存在（模拟 relink 崩溃后现场）
	relinkBak := filepath.Join(dir, "model.relink-bak-1700000000")
	if err := os.MkdirAll(relinkBak, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(relinkBak, "ysm.json"), []byte("bak"), 0o644); err != nil {
		t.Fatal(err)
	}
	recovered, err := RecoverAtomicRename(dir)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if recovered != 0 {
		t.Fatalf(".relink-bak-* 不得被 .bak-* 自愈认领，实际恢复 %d", recovered)
	}
	// 尸体目录原样在位，未被 rename 成 model.relink-bak
	if _, err := os.Stat(relinkBak); err != nil {
		t.Errorf("relink 备份应原样保留: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "model.relink-bak")); !os.IsNotExist(err) {
		t.Error("不得凭空 rename 出 model.relink-bak 脏目录")
	}
}
