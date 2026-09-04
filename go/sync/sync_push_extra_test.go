// ===== go/sync 推送/拉取执行层错误分支补充单测 =====
// 覆盖 sync_push.go 中 copyDirRecursive / PullResources 与 fsutil.CopyFile 的错误分支：
// 复制源不可读、目标路径被目录/文件占位（Create/Rename/MkdirAll 失败）、
// 复制中途失败时对既有目标目录保留旧内容、符号链接不跟随复制。
// 需要 Windows 共享锁触发的递归枚举失败回滚见 sync_push_lock_windows_test.go。
package sync

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/fsutil"
)

// ===== copyFile 错误分支 =====

// assertNoFsutilTmp 断言 dir 下无 fsutil.CopyFile 的临时文件残留（.copy-* 前缀）
func assertNoFsutilTmp(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return
		}
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".copy-") {
			t.Fatalf("失败后不应残留 .copy-* 临时文件: %s", e.Name())
		}
	}
}

func TestCopyFile_OpenSrcError(t *testing.T) {
	base := t.TempDir()
	dst := filepath.Join(base, "out", "f.txt")
	if err := fsutil.CopyFile(filepath.Join(base, "nope.txt"), dst); err == nil {
		t.Fatal("源不存在应报错")
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("打开源失败时不应创建目标: %v", err)
	}
}

func TestCopyFile_MkdirAllError(t *testing.T) {
	base := t.TempDir()
	blocker := filepath.Join(base, "afile")
	_ = os.WriteFile(blocker, []byte("x"), 0644)
	src := filepath.Join(base, "src.txt")
	_ = os.WriteFile(src, []byte("data"), 0644)
	if err := fsutil.CopyFile(src, filepath.Join(blocker, "sub", "f.txt")); err == nil {
		t.Fatal("目标父级为文件时应报错")
	}
}

func TestCopyFile_TmpNameRandomized(t *testing.T) {
	// 旧实现固定 tmp 名 dst+".copy-tmp"，被外部目录占位会阻塞复制（CreateTmpError）。
	// 收敛至 fsutil.CopyFile（os.CreateTemp 随机名）后该占位被天然规避——复制应成功。
	base := t.TempDir()
	src := filepath.Join(base, "src.txt")
	_ = os.WriteFile(src, []byte("data"), 0644)
	dst := filepath.Join(base, "out", "f.txt")
	if err := os.MkdirAll(dst+".copy-tmp", 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dst+".copy-tmp", "guard"), []byte("g"), 0644)
	if err := fsutil.CopyFile(src, dst); err != nil {
		t.Fatalf("随机 tmp 名应规避占位冲突，实际报错: %v", err)
	}
	data, _ := os.ReadFile(dst)
	if string(data) != "data" {
		t.Fatalf("目标内容 = %q", string(data))
	}
	// 占位目录应原样保留（未被误清）
	if _, err := os.Stat(filepath.Join(dst+".copy-tmp", "guard")); err != nil {
		t.Fatalf("占位目录不应被清理: %v", err)
	}
}

func TestCopyFile_IOCopyError(t *testing.T) {
	// 源为目录：os.Open 成功但 io.Copy 读取失败（Windows: Incorrect function；Unix: EISDIR）
	// → 触发失败分支与 defer 兜底的 tmp 清理
	base := t.TempDir()
	srcDir := filepath.Join(base, "srcdir")
	_ = os.MkdirAll(srcDir, 0755)
	dst := filepath.Join(base, "out", "f.txt")
	if err := fsutil.CopyFile(srcDir, dst); err == nil {
		t.Fatal("复制目录句柄应报错")
	}
	assertNoFsutilTmp(t, filepath.Join(base, "out"))
}

func TestCopyFile_RenameError(t *testing.T) {
	// 目标路径被目录占位 → 原子落地 Rename 失败
	base := t.TempDir()
	src := filepath.Join(base, "src.txt")
	_ = os.WriteFile(src, []byte("data"), 0644)
	dst := filepath.Join(base, "out", "f.txt")
	if err := os.MkdirAll(dst, 0755); err != nil { // dst 已存在为目录
		t.Fatal(err)
	}
	if err := fsutil.CopyFile(src, dst); err == nil {
		t.Fatal("目标为目录时应报错")
	}
	assertNoFsutilTmp(t, filepath.Join(base, "out"))
}

// ===== copyDirRecursive 基本分支 =====

func TestCopyDirRecursive_Basic(t *testing.T) {
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(filepath.Join(src, "sub", "deep"), 0755)
	_ = os.WriteFile(filepath.Join(src, "root.txt"), []byte("r"), 0644)
	_ = os.WriteFile(filepath.Join(src, "sub", "s.txt"), []byte("s"), 0644)
	_ = os.WriteFile(filepath.Join(src, "sub", "deep", "d.txt"), []byte("d"), 0644)
	dst := filepath.Join(base, "dst")
	if err := copyDirRecursive(src, dst); err != nil {
		t.Fatalf("copyDirRecursive 失败: %v", err)
	}
	for _, rel := range []string{"root.txt", filepath.Join("sub", "s.txt"), filepath.Join("sub", "deep", "d.txt")} {
		if _, err := os.Stat(filepath.Join(dst, rel)); err != nil {
			t.Fatalf("%s 应存在: %v", rel, err)
		}
	}
}

func TestCopyDirRecursive_DstExisted(t *testing.T) {
	// dst 已存在（重拉/刷新场景）→ dstExisted=true，旧内容保留，新内容并入
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(src, 0755)
	_ = os.WriteFile(filepath.Join(src, "a.txt"), []byte("new"), 0644)
	dst := filepath.Join(base, "dst")
	_ = os.MkdirAll(dst, 0755)
	_ = os.WriteFile(filepath.Join(dst, "old.txt"), []byte("old"), 0644)
	if err := copyDirRecursive(src, dst); err != nil {
		t.Fatalf("dst 已存在时复制失败: %v", err)
	}
	data, _ := os.ReadFile(filepath.Join(dst, "a.txt"))
	if string(data) != "new" {
		t.Fatalf("新文件内容 = %q", string(data))
	}
	if _, err := os.Stat(filepath.Join(dst, "old.txt")); err != nil {
		t.Fatalf("既有内容应保留: %v", err)
	}
}

func TestCopyDirRecursive_MkdirAllError(t *testing.T) {
	base := t.TempDir()
	blocker := filepath.Join(base, "afile")
	_ = os.WriteFile(blocker, []byte("x"), 0644)
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(src, 0755)
	if err := copyDirRecursive(src, filepath.Join(blocker, "sub", "dst")); err == nil {
		t.Fatal("dst 父级为文件时应报错")
	}
}

// TestCopyDirRecursive_ErrorKeepsExistingDst 复制中途失败且 dst 已存在 → 不整树回滚，
// 保留用户既有内容（防重拉/刷新场景误删旧模型文件夹，对齐 installer.InstallDir 语义）
func TestCopyDirRecursive_ErrorKeepsExistingDst(t *testing.T) {
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(src, 0755)
	_ = os.WriteFile(filepath.Join(src, "x"), []byte("x"), 0644)
	dst := filepath.Join(base, "dst")
	// dst 已存在，且 x 位置被目录占位 → 文件复制在最终 Rename 处失败
	_ = os.MkdirAll(filepath.Join(dst, "x"), 0755)
	_ = os.WriteFile(filepath.Join(dst, "keep.txt"), []byte("keep"), 0644)
	if err := copyDirRecursive(src, dst); err == nil {
		t.Fatal("复制应失败（dst/x 被目录占位）")
	}
	if _, err := os.Stat(filepath.Join(dst, "keep.txt")); err != nil {
		t.Fatalf("既有目录内容不应被回滚删除: %v", err)
	}
}

// TestCopyDirRecursive_Symlink 符号链接：复制链接本身（保留语义），不跟随复制
func TestCopyDirRecursive_Symlink(t *testing.T) {
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(filepath.Join(src, "sub"), 0755)
	_ = os.WriteFile(filepath.Join(src, "file.txt"), []byte("f"), 0644)
	_ = os.WriteFile(filepath.Join(src, "sub", "real.txt"), []byte("r"), 0644)
	if err := os.Symlink(filepath.Join(src, "file.txt"), filepath.Join(src, "file-link")); err != nil {
		t.Skipf("环境不支持创建符号链接: %v", err)
	}
	if err := os.Symlink(filepath.Join(src, "sub"), filepath.Join(src, "dir-link")); err != nil {
		t.Skipf("环境不支持创建符号链接: %v", err)
	}
	dst := filepath.Join(base, "dst")
	if err := copyDirRecursive(src, dst); err != nil {
		t.Fatalf("复制失败: %v", err)
	}
	for _, l := range []string{"file-link", "dir-link"} {
		info, err := os.Lstat(filepath.Join(dst, l))
		if err != nil {
			t.Fatalf("%s 应被复制为链接: %v", l, err)
		}
		if info.Mode()&os.ModeSymlink == 0 {
			t.Fatalf("%s 应为符号链接，实际 %v", l, info.Mode())
		}
	}
	// 链接指向的目标本身不因复制而缺失
	if _, err := os.Stat(filepath.Join(dst, "sub", "real.txt")); err != nil {
		t.Fatalf("普通内容应复制: %v", err)
	}
}

// ===== PullResources 错误分支 =====

func TestPullResources_DirCopyFailure(t *testing.T) {
	// 文件夹级（ysm）：extra 文件夹复制失败（global 侧同名路径被文件占位）→ failed 计数 + 报错
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)
	_ = os.MkdirAll(filepath.Join(targetDir, "pack"), 0755)
	_ = os.WriteFile(filepath.Join(targetDir, "pack", "m.ysm"), []byte("e"), 0644)
	_ = os.WriteFile(filepath.Join(globalDir, "pack"), []byte("blocker"), 0644)

	var logs []string
	count, err := PullResources("ysm", globalDir, targetDir,
		func(name, src, dst string, size int64, status, msg string) { logs = append(logs, status) })
	if err == nil {
		t.Fatal("目录复制失败应返回错误")
	}
	if count != 0 {
		t.Fatalf("失败路径应计数 0，实际 %d", count)
	}
	if len(logs) != 1 || logs[0] != "failed" {
		t.Fatalf("应有 1 条 failed 日志: %v", logs)
	}
}

func TestPullResources_FileCopyFailure(t *testing.T) {
	// 文件夹级（ysm）平铺文件复制失败：global 侧是文件 → copyFile 的 MkdirAll 失败
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(targetDir, 0755)
	_ = os.WriteFile(globalDir, []byte("blocker"), 0644)
	_ = os.WriteFile(filepath.Join(targetDir, "flat.ysm"), []byte("f"), 0644)

	_, err := PullResources("ysm", globalDir, targetDir,
		func(name, src, dst string, size int64, status, msg string) {})
	if err == nil {
		t.Fatal("平铺文件复制失败应返回错误")
	}
}

func TestPullResources_FileLevelMkdirFailure(t *testing.T) {
	// 文件级（resourcepack）：mapSrcToGlobal 成功但目标父目录 MkdirAll 失败
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(targetDir, 0755)
	_ = os.WriteFile(globalDir, []byte("blocker"), 0644)
	_ = os.WriteFile(filepath.Join(targetDir, "extra.zip"), []byte("e"), 0644)

	_, err := PullResources("resourcepack", globalDir, targetDir,
		func(name, src, dst string, size int64, status, msg string) {})
	if err == nil {
		t.Fatal("MkdirAll 失败应返回错误")
	}
}

func TestPullResources_FileLevelCopyFailure(t *testing.T) {
	// 文件级：global 侧同名路径被目录占位 → copyFile 最终 Rename 失败
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)
	_ = os.WriteFile(filepath.Join(targetDir, "extra.zip"), []byte("e"), 0644)
	_ = os.MkdirAll(filepath.Join(globalDir, "extra.zip"), 0755) // 目录占位

	_, err := PullResources("resourcepack", globalDir, targetDir,
		func(name, src, dst string, size int64, status, msg string) {})
	if err == nil {
		t.Fatal("复制失败应返回错误")
	}
}

// TestMapSrcToGlobal_EscapeRejected 路径映射越界防护：src 不在 targetDir 下显式报错
func TestMapSrcToGlobal_EscapeRejected(t *testing.T) {
	base := t.TempDir()
	targetDir := filepath.Join(base, "inst")
	globalDir := filepath.Join(base, "global")
	src := filepath.Join(targetDir, "..", "leaked", "m.ysm")
	if _, err := mapSrcToGlobal(src, targetDir, globalDir); err == nil {
		t.Fatal("越界路径应报错")
	}
}
