// ===== go/installer 补充单测（P4 补测：InstallToGlobal / installDirRecursive / 失败分支全覆盖）=====
package installer

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// mcCustomDir 构造含 .minecraft marker 的测试 custom 目录
func mcCustomDir(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), ".minecraft", "versions", "1.20", "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	return dir
}

// ====== InstallToGlobal ======

func TestInstallToGlobal_EmptySrc(t *testing.T) {
	if _, err := InstallToGlobal("", t.TempDir()); err == nil {
		t.Fatal("空源路径应返回错误")
	}
}

func TestInstallToGlobal_EmptyMcRoot(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "model.ysm")
	if err := os.WriteFile(src, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallToGlobal(src, ""); err == nil {
		t.Fatal("空 mcRoot 应返回错误")
	}
}

func TestInstallToGlobal_NonMinecraftPath(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "model.ysm")
	if err := os.WriteFile(src, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallToGlobal(src, dir); err == nil {
		t.Fatal("mcRoot 不含 .minecraft marker 应返回错误")
	}
}

func TestInstallToGlobal_MkdirFail(t *testing.T) {
	mcRoot := filepath.Join(t.TempDir(), ".minecraft")
	if err := os.MkdirAll(mcRoot, 0755); err != nil {
		t.Fatal(err)
	}
	blocker := filepath.Join(mcRoot, "config")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(t.TempDir(), "model.ysm")
	if err := os.WriteFile(src, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	_, err := InstallToGlobal(src, mcRoot) // config 是文件 → MkdirAll 失败
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "IO_ERROR" {
		t.Fatalf("应返回 IO_ERROR, got %v", err)
	}
}

func TestInstallToGlobal_Success(t *testing.T) {
	mcRoot := filepath.Join(t.TempDir(), ".minecraft")
	if err := os.MkdirAll(mcRoot, 0755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(t.TempDir(), "model.ysm")
	content := []byte("global model data")
	if err := os.WriteFile(src, content, 0644); err != nil {
		t.Fatal(err)
	}
	dst, err := InstallToGlobal(src, mcRoot)
	if err != nil {
		t.Fatalf("InstallToGlobal = %v", err)
	}
	want := filepath.Join(mcRoot, "config", "yes_steve_model", "custom", "model.ysm")
	if dst != want {
		t.Errorf("目标路径 = %q, want %q", dst, want)
	}
	readBack, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(readBack) != string(content) {
		t.Errorf("内容 = %q, want %q", string(readBack), string(content))
	}
}

// ====== InstallDirLocked 守卫分支 ======

func TestInstallDir_NonMinecraftDst(t *testing.T) {
	repo, _, _, _ := setupTestDirs(t)
	srcDir := filepath.Join(repo, "m")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	err := InstallDir(srcDir, t.TempDir(), repo, "copy", "")
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "INVALID_PATH" {
		t.Fatalf("dstDir 不在 .minecraft 内应返回 INVALID_PATH, got %v", err)
	}
}

func TestInstallDir_SrcOutsideRepo(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)
	srcDir := t.TempDir() // 仓库外
	err := InstallDir(srcDir, custom, repo, "copy", "")
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "INVALID_PATH" {
		t.Fatalf("srcDir 在仓库外应返回 INVALID_PATH, got %v", err)
	}
}

// ====== installDirRecursive 错误分支 ======

func TestInstallDirRecursive_MkdirFail(t *testing.T) {
	base := t.TempDir()
	blocker := filepath.Join(base, "file")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	err := installDirRecursive(t.TempDir(), filepath.Join(blocker, "sub"), "copy", "", "")
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "IO_ERROR" {
		t.Fatalf("MkdirAll 失败应返回 IO_ERROR, got %v", err)
	}
}

func TestInstallDirRecursive_OutsideMinecraft(t *testing.T) {
	srcDir := t.TempDir()
	finalDst := filepath.Join(t.TempDir(), "plain")
	err := installDirRecursive(srcDir, finalDst, "copy", "", "")
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "INVALID_PATH" {
		t.Fatalf("finalDst 不在 .minecraft 内应返回 INVALID_PATH, got %v", err)
	}
}

func TestInstallDirRecursive_ReadDirFail(t *testing.T) {
	srcFile := filepath.Join(t.TempDir(), "notdir.ysm")
	if err := os.WriteFile(srcFile, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	err := installDirRecursive(srcFile, filepath.Join(mcCustomDir(t), "model"), "copy", "", "")
	if err == nil {
		t.Fatal("srcDir 是文件时 ReadDir 应报错")
	}
}

func TestInstallDirRecursive_NestedSubdir(t *testing.T) {
	srcDir := filepath.Join(t.TempDir(), "model")
	if err := os.MkdirAll(filepath.Join(srcDir, "tex"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "root.pmx"), []byte("pmx"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "tex", "tex.png"), []byte("png"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "ignore.txt"), []byte("no"), 0644); err != nil {
		t.Fatal(err)
	}
	finalDst := filepath.Join(mcCustomDir(t), "model")
	if err := installDirRecursive(srcDir, finalDst, "copy", "EntityPlayer", ""); err != nil {
		t.Fatalf("installDirRecursive = %v", err)
	}
	if _, err := os.Stat(filepath.Join(finalDst, "root.pmx")); err != nil {
		t.Fatal("根文件应被安装")
	}
	if _, err := os.Stat(filepath.Join(finalDst, "tex", "tex.png")); err != nil {
		t.Fatal("嵌套子目录文件应被安装")
	}
	// EntityPlayer 无 installExts，所有非可执行文件均放行（含 .txt）
	if _, err := os.Stat(filepath.Join(finalDst, "ignore.txt")); err != nil {
		t.Fatalf("EntityPlayer 无 installExts 限制，.txt 也应放行: %v", err)
	}
}

// TestInstallDirRecursive_PartialFailure 子目录 MkdirAll 失败应返回 fatal（非 partial）。
//
// code_review P1-2 修正：旧实现把 MkdirAll 失败误分类为 partial（ErrPartialInstall），
// 导致 callInstallDirRecursiveWithRollback 跳过整树回滚，留半截损坏目录树。
// 修复后 MkdirAll 失败直接返回 fatal（不含「部分失败」），触发整树回滚。
//
// 测试用同名文件占位 sub 目录 → 递归 MkdirAll(sub) 失败，应返回 fatal 而非 partial。
func TestInstallDirRecursive_PartialFailure(t *testing.T) {
	srcDir := filepath.Join(t.TempDir(), "model")
	if err := os.MkdirAll(filepath.Join(srcDir, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "sub", "a.ysm"), []byte("a"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "ok.ysm"), []byte("ok"), 0644); err != nil {
		t.Fatal(err)
	}
	finalDst := filepath.Join(mcCustomDir(t), "model")
	if err := os.MkdirAll(finalDst, 0755); err != nil {
		t.Fatal(err)
	}
	// 用同名文件占位 sub 目录 → 递归落地时 MkdirAll 失败
	if err := os.WriteFile(filepath.Join(finalDst, "sub"), []byte("blocker"), 0644); err != nil {
		t.Fatal(err)
	}
	err := installDirRecursive(srcDir, finalDst, "copy", "", "")
	if err == nil {
		t.Fatal("应返回错误, got nil")
	}
	// MkdirAll 失败是 fatal，不应包含「部分失败」（partial 语义）
	if strings.Contains(err.Error(), "部分失败") {
		t.Fatalf("MkdirAll 失败应返回 fatal 而非 partial, got %v", err)
	}
}

// TestInstallDirRecursive_SymlinkEscape 指向仓库外的 symlink 条目应被跳过（不落地）
func TestInstallDirRecursive_SymlinkEscape(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)
	srcDir := filepath.Join(repo, "linked_model")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	realFile := filepath.Join(outside, "secret.ysm")
	if err := os.WriteFile(realFile, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(srcDir, "escaped.ysm")
	if err := os.Symlink(realFile, link); err != nil {
		t.Skipf("平台不支持符号链接: %v", err)
	}
	if err := InstallDir(srcDir, custom, repo, "copy", ""); err != nil {
		t.Fatalf("InstallDir = %v", err)
	}
	dstFile := filepath.Join(custom, "linked_model", "escaped.ysm")
	if _, err := os.Lstat(dstFile); !os.IsNotExist(err) {
		t.Fatalf("越权 symlink 条目应被跳过, dst=%s err=%v", dstFile, err)
	}
}

// TestCheckDstSymlinkSegments_OutsideSymlink 目标父链含指向 .minecraft 外的 symlink 段应拒绝
func TestCheckDstSymlinkSegments_OutsideSymlink(t *testing.T) {
	mcRoot := t.TempDir()
	mc := filepath.Join(mcRoot, ".minecraft")
	if err := os.MkdirAll(mc, 0755); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	link := filepath.Join(mc, "link_out")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("平台不支持符号链接: %v", err)
	}
	err := checkDstSymlinkSegments(filepath.Join(link, "sub", "model"))
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "INVALID_PATH" {
		t.Fatalf("父链 symlink 指向 .minecraft 外应返回 INVALID_PATH, got %v", err)
	}
}

// ====== Install（src 在仓库子目录 → 相对路径保持）======

func TestInstall_SubdirRelPath(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)
	sub := filepath.Join(repo, "subdir")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(sub, "model.ysm")
	if err := os.WriteFile(src, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := Install(src, custom, repo, "copy"); err != nil {
		t.Fatalf("Install = %v", err)
	}
	dst := filepath.Join(custom, "subdir", "model.ysm")
	if _, err := os.Stat(dst); err != nil {
		t.Fatalf("子目录相对路径应保持, dst=%s err=%v", dst, err)
	}
}

func TestInstall_CustomDirNotMinecraft(t *testing.T) {
	repo, _, _, src := setupTestDirs(t)
	err := Install(src, t.TempDir(), repo, "copy")
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "INVALID_PATH" {
		t.Fatalf("customDir 不在 .minecraft 内应返回 INVALID_PATH, got %v", err)
	}
}

// ====== copyFileLocked 失败分支 ======

func TestCopyFileLocked_MkdirAllFail(t *testing.T) {
	base := t.TempDir()
	blocker := filepath.Join(base, "file")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(base, "src.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := copyFileLocked(src, filepath.Join(blocker, "sub")); err == nil {
		t.Fatal("MkdirAll 失败应返回错误")
	}
}

// TestCopyFileLocked_RenameFail 目标被非空目录占位时原子替换失败应返回 IO_ERROR
func TestCopyFileLocked_RenameFail(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "model.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(dir, "dst")
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		t.Fatal(err)
	}
	block := filepath.Join(dstDir, "model.ysm")
	if err := os.MkdirAll(block, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(block, "x"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	_, err := copyFileLocked(src, dstDir) // rename tmp → 非空目录必败
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "IO_ERROR" {
		t.Fatalf("替换失败应返回 IO_ERROR, got %v", err)
	}
}

// ====== linkOrCopyLocked 失败分支 ======

// TestLinkOrCopyLocked_LinkErr 源是目录时 os.Link 必败 → 分类为 LINK_FAILED
func TestLinkOrCopyLocked_LinkErr(t *testing.T) {
	srcDir := t.TempDir() // 目录作源，硬链接必败
	err := linkOrCopyLocked(srcDir, filepath.Join(t.TempDir(), "dst"))
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "LINK_FAILED" {
		t.Fatalf("目录源硬链接应返回 LINK_FAILED, got %v", err)
	}
}

// ====== symlinkOrCopyLocked 失败分支 ======

func TestSymlinkOrCopyLocked_MkdirAllFail(t *testing.T) {
	base := t.TempDir()
	blocker := filepath.Join(base, "file")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(base, "src.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := symlinkOrCopyLocked(src, filepath.Join(blocker, "sub")); err == nil {
		t.Fatal("MkdirAll 失败应返回错误")
	}
}

func TestSymlinkOrCopyLocked_SrcMissing(t *testing.T) {
	err := symlinkOrCopyLocked(filepath.Join(t.TempDir(), "missing.ysm"), t.TempDir())
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "IO_ERROR" {
		t.Fatalf("源不存在应返回 IO_ERROR, got %v", err)
	}
	if !strings.Contains(err.Error(), "源文件不存在") {
		t.Errorf("应提示源文件不存在, got %v", err)
	}
}

// TestSymlinkOrCopyLocked_RenameFail 目标被非空目录占位时替换失败应返回 IO_ERROR
func TestSymlinkOrCopyLocked_RenameFail(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "model.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// 先探测平台 symlink 能力
	probe := filepath.Join(dir, "probe")
	if err := os.Symlink(src, probe); err != nil {
		t.Skipf("平台不支持符号链接: %v", err)
	}
	os.Remove(probe)

	dstDir := filepath.Join(dir, "dst")
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		t.Fatal(err)
	}
	block := filepath.Join(dstDir, "model.ysm")
	if err := os.MkdirAll(block, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(block, "x"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	err := symlinkOrCopyLocked(src, dstDir) // rename tmp → 非空目录必败
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "IO_ERROR" {
		t.Fatalf("替换失败应返回 IO_ERROR, got %v", err)
	}
}

// ====== symlinkErr 分类 ======

// TestSymlinkErr_TextFallback 文本兜底已删（陷阱 #11）：非 errno 包装的文本错误
// 不再分类，一律落通用提示——验证不误分类（errno 判定由 TestSymlinkErr_Errno 覆盖）
func TestSymlinkErr_TextFallback(t *testing.T) {
	if e := symlinkErr("/a", "/b", fmt.Errorf("access is denied")); !strings.Contains(e.Error(), "符号链接失败") {
		t.Errorf("文本错误不应分类为管理员权限, got %v", e)
	}
	if e := symlinkErr("/a", "/b", fmt.Errorf("privilege not held")); !strings.Contains(e.Error(), "符号链接失败") {
		t.Errorf("文本错误不应分类为管理员权限, got %v", e)
	}
	if e := symlinkErr("/a", "/b", fmt.Errorf("permission required")); !strings.Contains(e.Error(), "符号链接失败") {
		t.Errorf("文本错误不应分类为管理员权限, got %v", e)
	}
}

// TestSymlinkErr_Default 未知错误回退通用提示
func TestSymlinkErr_Default(t *testing.T) {
	if e := symlinkErr("/a", "/b", fmt.Errorf("some weird failure")); !strings.Contains(e.Error(), "符号链接失败") {
		t.Errorf("未知错误应回退通用提示, got %v", e)
	}
	// 与本平台权限码无关的 errno 也走默认
	var other syscall.Errno
	if runtime.GOOS == "windows" {
		other = 17 // ERROR_NOT_SAME_DEVICE
	} else {
		other = 18 // EXDEV
	}
	if e := symlinkErr("/a", "/b", other); !strings.Contains(e.Error(), "符号链接失败") {
		t.Errorf("无关 errno 应回退通用提示, got %v", e)
	}
}

// TestSymlinkErr_PrivilegeErrno 本平台权限 errno 应提示管理员权限
func TestSymlinkErr_PrivilegeErrno(t *testing.T) {
	var perm1, perm2 syscall.Errno
	if runtime.GOOS == "windows" {
		perm1, perm2 = 1314, 5 // ERROR_PRIVILEGE_NOT_HELD / ERROR_ACCESS_DENIED
	} else {
		perm1, perm2 = 1, 13 // EPERM / EACCES
	}
	if e := symlinkErr("/a", "/b", perm1); !strings.Contains(e.Error(), "管理员权限") {
		t.Errorf("权限 errno 应提示管理员权限, got %v", e)
	}
	if e := symlinkErr("/a", "/b", perm2); !strings.Contains(e.Error(), "管理员权限") {
		t.Errorf("权限 errno 应提示管理员权限, got %v", e)
	}
}

// ====== 纯逻辑函数 ======

func TestEvalSymlinksOrKeep(t *testing.T) {
	dir := t.TempDir()
	// 不存在的路径 EvalSymlinks 失败 → 保留原样
	missing := filepath.Join(dir, "missing", "x")
	if got := evalSymlinksOrKeep(missing); got != missing {
		t.Errorf("不存在的路径应原样返回, got %q", got)
	}
	// 存在的路径解析为真实路径（与 EvalSymlinks 结果一致；Windows 上 Temp 目录
	// 可能是 junction，不能与原始字符串直接比较）
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := evalSymlinksOrKeep(dir); got != resolved {
		t.Errorf("已存在路径应解析为真实路径, got %q, want %q", got, resolved)
	}
}

func TestIsSupportedModelExt_BanVariant(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"a.ysm", true},
		{"A.YSM", true},
		{"a.ysm.ban", true}, // .ban 变体 → 回退到 .ysm
		{"a.ban", false},    // 纯 .ban → 空扩展名不支持
		{"a.txt", false},
	}
	for _, tc := range cases {
		if got := isSupportedModelExt(tc.name); got != tc.want {
			t.Errorf("isSupportedModelExt(%q) = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestInstallToGlobal_UnsupportedExt_ValidMcRoot(t *testing.T) {
	// 注意：既有 TestInstallToGlobal_UnsupportedExt 的 mcRoot 本身不含 ".minecraft" 段，
	// 实际触发的是 marker 分支而非扩展名分支；此处 mcRoot 含 marker 才能走到 ext 校验
	mcRoot := filepath.Join(t.TempDir(), ".minecraft")
	if err := os.MkdirAll(mcRoot, 0755); err != nil {
		t.Fatal(err)
	}
	badFile := filepath.Join(t.TempDir(), "payload.exe")
	if err := os.WriteFile(badFile, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	_, err := InstallToGlobal(badFile, mcRoot)
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "UNSUPPORTED_FORMAT" {
		t.Fatalf("不支持的文件类型应返回 UNSUPPORTED_FORMAT, got %v", err)
	}
}

// ====== InstallWithOverlay 补充分支 ======

func TestInstallWithOverlay_UnsupportedExt_ValidCustomDir(t *testing.T) {
	customDir := mcCustomDir(t)
	src := filepath.Join(t.TempDir(), "model.txt")
	if err := os.WriteFile(src, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	_, err := InstallWithOverlay(src, customDir)
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "UNSUPPORTED_FORMAT" {
		t.Fatalf("不支持扩展名应返回 UNSUPPORTED_FORMAT, got %v", err)
	}
}

func TestInstallWithOverlay_MkdirFail(t *testing.T) {
	mcRoot := filepath.Join(t.TempDir(), ".minecraft")
	if err := os.MkdirAll(mcRoot, 0755); err != nil {
		t.Fatal(err)
	}
	blocker := filepath.Join(mcRoot, "config")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(t.TempDir(), "model.ysm")
	if err := os.WriteFile(src, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	customDir := filepath.Join(mcRoot, "config", "yes_steve_model", "custom")
	_, err := InstallWithOverlay(src, customDir) // config 是文件 → MkdirAll 失败
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "IO_ERROR" {
		t.Fatalf("MkdirAll 失败应返回 IO_ERROR, got %v", err)
	}
}

// ====== InstallLocked symlink 守卫分支（本环境 os.Symlink 可用；不可用时跳过）======

func TestInstall_CustomDirSymlinkOutside(t *testing.T) {
	repo, _, mcRoot, src := setupTestDirs(t)
	outside := t.TempDir()
	externalCustom := filepath.Join(outside, "custom")
	if err := os.MkdirAll(externalCustom, 0755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(mcRoot, ".minecraft", "versions", "link_out")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("平台不支持符号链接: %v", err)
	}
	// custom 路径字符串含 .minecraft 通过守卫；EvalSymlinks 解析到仓库外 → 二次校验拒绝
	custom := filepath.Join(link, "custom")
	if _, err := os.Stat(custom); err != nil {
		t.Fatal(err)
	}
	err := Install(src, custom, repo, "copy")
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "INVALID_PATH" {
		t.Fatalf("customDir 真实路径不含 .minecraft 应返回 INVALID_PATH, got %v", err)
	}
}

func TestInstall_SrcSymlinkOutside(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)
	outside := t.TempDir()
	realFile := filepath.Join(outside, "model.ysm")
	if err := os.WriteFile(realFile, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(repo, "link_out")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("平台不支持符号链接: %v", err)
	}
	src := filepath.Join(link, "model.ysm")
	err := Install(src, custom, repo, "copy")
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "INVALID_PATH" {
		t.Fatalf("src 真实路径不在仓库内应返回 INVALID_PATH, got %v", err)
	}
}

// ====== InstallDirLocked 守卫与回滚分支 ======

// TestInstallDir_FinalDstInsideSrc finalDst 落在 srcDir 内的死递归守卫
func TestInstallDir_FinalDstInsideSrc(t *testing.T) {
	repo := filepath.Join(t.TempDir(), ".minecraft", "versions", "1.20") // repo 含 marker
	if err := os.MkdirAll(repo, 0755); err != nil {
		t.Fatal(err)
	}
	srcDir := filepath.Join(repo, "a")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	err := InstallDir(srcDir, repo, repo, "copy", "")
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "INVALID_PATH" {
		t.Fatalf("finalDst 在 srcDir 内应返回 INVALID_PATH, got %v", err)
	}
}

// TestInstallDir_ExistingFinalDst 重装场景 finalDst 已存在 → 成功路径不误删旧目录
func TestInstallDir_ExistingFinalDst(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)
	srcDir := filepath.Join(repo, "model")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "a.ysm"), []byte("a"), 0644); err != nil {
		t.Fatal(err)
	}
	finalDst := filepath.Join(custom, "model")
	if err := os.MkdirAll(finalDst, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(finalDst, "keep.txt"), []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := InstallDir(srcDir, custom, repo, "copy", ""); err != nil {
		t.Fatalf("InstallDir = %v", err)
	}
	if _, err := os.Stat(filepath.Join(finalDst, "keep.txt")); err != nil {
		t.Fatalf("既有目录内容不应被删除: %v", err)
	}
}

// TestInstallDir_RollbackRemoveFail 安装失败且回滚删除也失败（路径含 NUL 无效字符）→ 复合错误
func TestInstallDir_RollbackRemoveFail(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)
	srcDir := filepath.Join(repo, "model")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "a.ysm"), []byte("a"), 0644); err != nil {
		t.Fatal(err)
	}
	// dstDir 含 NUL 字节：os.Stat/RemoveAll/MkdirAll 均以非 NotExist 错误失败（win32 ERROR_INVALID_NAME）
	dstDir := filepath.Join(custom, "x\x00y")
	err := InstallDir(srcDir, dstDir, repo, "copy", "")
	if err == nil {
		t.Fatal("无效目标路径应安装失败")
	}
	if !strings.Contains(err.Error(), "回滚失败") {
		t.Fatalf("回滚失败应返回复合错误, got %v", err)
	}
}

// ====== installDirRecursive 剩余分支 ======

// TestInstallDirRecursive_SymlinkSegmentReject 目标父链含越界 symlink 段在 MkdirAll 前拒绝
func TestInstallDirRecursive_SymlinkSegmentReject(t *testing.T) {
	mcRoot := t.TempDir()
	mc := filepath.Join(mcRoot, ".minecraft")
	if err := os.MkdirAll(mc, 0755); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	link := filepath.Join(mc, "link_out")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("平台不支持符号链接: %v", err)
	}
	srcDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(srcDir, "a.ysm"), []byte("a"), 0644); err != nil {
		t.Fatal(err)
	}
	err := installDirRecursive(srcDir, filepath.Join(link, "sub", "model"), "copy", "", "")
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "INVALID_PATH" {
		t.Fatalf("父链越界 symlink 应返回 INVALID_PATH, got %v", err)
	}
}

// TestInstallDirRecursive_EntryFailures 条目落地失败（目标被非空目录占位）→ errs 累积返回部分失败
func TestInstallDirRecursive_EntryFailures(t *testing.T) {
	// 占位目录：finalDst/conflict.ysm 是非空目录 → Rename 原子替换必败
	setup := func(t *testing.T) (srcDir, finalDst string) {
		t.Helper()
		srcDir = t.TempDir()
		if err := os.WriteFile(filepath.Join(srcDir, "conflict.ysm"), []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
		finalDst = filepath.Join(mcCustomDir(t), "model")
		if err := os.MkdirAll(finalDst, 0755); err != nil {
			t.Fatal(err)
		}
		block := filepath.Join(finalDst, "conflict.ysm")
		if err := os.MkdirAll(block, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(block, "x"), []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
		return
	}

	t.Run("copy 条目失败", func(t *testing.T) {
		srcDir, finalDst := setup(t)
		err := installDirRecursive(srcDir, finalDst, "copy", "", "")
		if err == nil || !strings.Contains(err.Error(), "部分失败") {
			t.Fatalf("应返回部分失败, got %v", err)
		}
	})
	t.Run("hardlink 条目失败", func(t *testing.T) {
		srcDir, finalDst := setup(t)
		err := installDirRecursive(srcDir, finalDst, "hardlink", "", "")
		if err == nil || !strings.Contains(err.Error(), "部分失败") {
			t.Fatalf("应返回部分失败, got %v", err)
		}
	})
	t.Run("symlink 条目失败", func(t *testing.T) {
		srcDir, finalDst := setup(t)
		probe := filepath.Join(t.TempDir(), "probe")
		if err := os.Symlink(filepath.Join(srcDir, "conflict.ysm"), probe); err != nil {
			t.Skipf("平台不支持符号链接: %v", err)
		}
		os.Remove(probe)
		err := installDirRecursive(srcDir, finalDst, "symlink", "", "")
		if err == nil || !strings.Contains(err.Error(), "部分失败") {
			t.Fatalf("应返回部分失败, got %v", err)
		}
	})
}

// ====== linkOrCopyLocked 失败分支 ======

func TestLinkOrCopyLocked_MkdirAllFail(t *testing.T) {
	base := t.TempDir()
	blocker := filepath.Join(base, "file")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(base, "src.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := linkOrCopyLocked(src, filepath.Join(blocker, "sub")); err == nil {
		t.Fatal("MkdirAll 失败应返回错误")
	}
}

// TestLinkOrCopyLocked_RenameFail 目标被非空目录占位时硬链接原子替换失败
func TestLinkOrCopyLocked_RenameFail(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "model.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(dir, "dst")
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		t.Fatal(err)
	}
	block := filepath.Join(dstDir, "model.ysm")
	if err := os.MkdirAll(block, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(block, "x"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	err := linkOrCopyLocked(src, dstDir) // os.Link 成功 → Rename(tmp, 非空目录) 必败
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "IO_ERROR" {
		t.Fatalf("替换失败应返回 IO_ERROR, got %v", err)
	}
}

// ====== symlinkOrCopyLocked 剩余分支 ======

// TestSymlinkOrCopyLocked_Idempotent 目标已是指向 src 的 symlink → 幂等返回
func TestSymlinkOrCopyLocked_Idempotent(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "model.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(dir, "dst")
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(src, filepath.Join(dstDir, "model.ysm")); err != nil {
		t.Skipf("平台不支持符号链接: %v", err)
	}
	if err := symlinkOrCopyLocked(src, dstDir); err != nil {
		t.Fatalf("幂等重装应成功: %v", err)
	}
}

// TestSymlinkOrCopyLocked_SymlinkErr tmp 路径被非空目录占位 → os.Symlink 失败 → LINK_FAILED
func TestSymlinkOrCopyLocked_SymlinkErr(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "model.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(dir, "dst")
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		t.Fatal(err)
	}
	block := filepath.Join(dstDir, "model.ysm.symlink-tmp")
	if err := os.MkdirAll(block, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(block, "x"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	err := symlinkOrCopyLocked(src, dstDir) // os.Remove 忽略失败 → os.Symlink 撞上目录必败
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "LINK_FAILED" {
		t.Fatalf("symlink 创建失败应返回 LINK_FAILED, got %v", err)
	}
}

// ====== copyFileLocked 剩余分支 ======

// TestCopyFileLocked_Success 已覆盖主路径；固定名占位用例（.copy-tmp 被占目录）
// 随收敛到 fsutil.CopyFile 的 CreateTemp 随机名而天然规避，不再有该失败路径，
// 故删除旧 TestCopyFileLocked_CreateFail（孤儿副本漂移证据，见 sync_push_extra 记载）。

// TestCopyFileLocked_SrcMissing 源缺失经 fsutil StepStat 前置拒绝 → IO_ERROR
func TestCopyFileLocked_SrcMissingStepErr(t *testing.T) {
	_, err := copyFileLocked(filepath.Join(t.TempDir(), "nope.ysm"), t.TempDir())
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "IO_ERROR" {
		t.Fatalf("源缺失应返回 IO_ERROR, got %v", err)
	}
	if ae.Reason != "无法读取源文件" {
		t.Fatalf("源缺失 Reason 应为「无法读取源文件」, got %q", ae.Reason)
	}
}

// ====== sameSource 剩余分支 ======

func TestSameSource_SrcMissing(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "missing.ysm")
	dst := filepath.Join(dir, "dst.ysm")
	if err := os.WriteFile(dst, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	same, err := sameSource(src, dst, false)
	if err == nil || same {
		t.Fatalf("源缺失应报错且不同源: same=%v err=%v", same, err)
	}
}

// TestSameSource_DanglingSymlink 目标为断链 symlink → Lstat 成功但 Stat 失败
func TestSameSource_DanglingSymlink(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "dangling.ysm")
	if err := os.Symlink(filepath.Join(dir, "gone.ysm"), dst); err != nil {
		t.Skipf("平台不支持符号链接: %v", err)
	}
	same, err := sameSource(src, dst, true)
	if err == nil || same {
		t.Fatalf("断链 symlink 目标应报错且不同源: same=%v err=%v", same, err)
	}
}

// TestInstallDir_ReadDirFailRollback srcDir 是文件 → ReadDir 失败，本次新建的 finalDst 应被成功回滚
func TestInstallDir_ReadDirFailRollback(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)
	srcFile := filepath.Join(repo, "notdir.ysm")
	if err := os.WriteFile(srcFile, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	err := InstallDir(srcFile, custom, repo, "copy", "")
	if err == nil {
		t.Fatal("srcDir 是文件时安装应报错")
	}
	finalDst := filepath.Join(custom, "notdir.ysm")
	if _, statErr := os.Stat(finalDst); !os.IsNotExist(statErr) {
		t.Fatalf("新建 finalDst 应被回滚删除: %v", statErr)
	}
}

func TestCleanAbs_Normal(t *testing.T) {
	dir := t.TempDir()
	if got := cleanAbs(dir); got != dir {
		t.Errorf("cleanAbs(%q) = %q, want 原路径", dir, got)
	}
	// 相对路径应转绝对路径
	if got := cleanAbs("."); !filepath.IsAbs(got) {
		t.Errorf("cleanAbs(\".\") 应为绝对路径, got %q", got)
	}
}

// ====== P5 补测：io.Copy 失败分支 / errno 穿透 / BUG-3 硬断言 / BUG-4 回归 ======

// TestCopyFileLocked_ReadDirAsSourceFails 以目录作源触发 io.Copy 读失败
// （os.Open 目录在 Unix/Windows 均成功，Read 报错）→ 应返回 IO_ERROR，
// 且失败后不得残留目标文件与 .copy-tmp 临时文件。
func TestCopyFileLocked_ReadDirAsSourceFails(t *testing.T) {
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "srcdir")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(dir, "dst")
	_, err := copyFileLocked(srcDir, dstDir)
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "IO_ERROR" {
		t.Fatalf("目录作源复制应返回 IO_ERROR, got %v", err)
	}
	base := filepath.Base(srcDir)
	if _, statErr := os.Stat(filepath.Join(dstDir, base)); !os.IsNotExist(statErr) {
		t.Fatalf("失败后目标不应存在: %v", statErr)
	}
	if _, statErr := os.Stat(filepath.Join(dstDir, base+".copy-tmp")); !os.IsNotExist(statErr) {
		t.Fatalf("失败后临时文件不应残留: %v", statErr)
	}
}

// ====== mapStepToAppError 差异化文案映射表（ADR-044 策略 A：机制归 fsutil、文案归 installer）======

// TestMapStepToAppError 断言每个中性步骤名映射回六档既有差异化文案，
// 保证收敛 fsutil.CopyFile 后 UI 提示与旧 copyFileLocked 逐字一致（回归护栏）。
func TestMapStepToAppError(t *testing.T) {
	src := "/repo/a.ysm"
	dst := "/mc/custom/a.ysm"
	inner := errors.New("root cause")
	cases := []struct {
		step                          string
		operation, reason, suggestion string
	}{
		{fsutil.StepStat, "复制文件", "无法读取源文件", "请检查文件是否被占用或已删除"},
		{fsutil.StepOpen, "复制文件", "无法读取源文件", "请检查文件是否被占用或已删除"},
		{fsutil.StepCloseSrc, "复制文件", "源文件读取未正常完成", "请检查文件访问权限"},
		{fsutil.StepMkdir, "复制文件", "无法创建目录", "请检查磁盘权限或空间"},
		{fsutil.StepCreateTmp, "复制文件", "无法创建临时文件", "请检查磁盘空间或权限"},
		{fsutil.StepCopy, "复制文件", "写入临时文件失败", "请检查磁盘空间或权限"},
		{fsutil.StepSync, "复制文件", "临时文件落盘失败", "请检查磁盘空间或权限"},
		{fsutil.StepClose, "复制文件", "临时文件写入未完成", "请检查磁盘空间或权限"},
		{fsutil.StepChmod, "复制文件", "设置文件权限失败", "请检查目标位置权限"},
		{fsutil.StepRename, "安装模型", "替换目标文件失败", "请检查目标文件是否被占用或为只读"},
	}
	for _, c := range cases {
		ae := mapStepToAppError(c.step, src, dst, inner)
		if ae.Code != "IO_ERROR" {
			t.Errorf("%s: Code=%q want IO_ERROR", c.step, ae.Code)
		}
		if ae.Operation != c.operation {
			t.Errorf("%s: Operation=%q want %q", c.step, ae.Operation, c.operation)
		}
		if ae.Reason != c.reason {
			t.Errorf("%s: Reason=%q want %q", c.step, ae.Reason, c.reason)
		}
		if ae.Suggestion != c.suggestion {
			t.Errorf("%s: Suggestion=%q want %q", c.step, ae.Suggestion, c.suggestion)
		}
		if ae.SourcePath != src {
			t.Errorf("%s: SourcePath=%q want %q", c.step, ae.SourcePath, src)
		}
		if ae.TargetPath != dst {
			t.Errorf("%s: TargetPath=%q want %q", c.step, ae.TargetPath, dst)
		}
	}
}

// TestMapStepToAppError_Unknown 未知步骤兜底为 IO_ERROR + 非空默认文案（防遗漏后静默空 Reason）
func TestMapStepToAppError_Unknown(t *testing.T) {
	ae := mapStepToAppError("unknown_step", "/s", "/d", errors.New("x"))
	if ae.Code != "IO_ERROR" || ae.Reason == "" || ae.Suggestion == "" {
		t.Fatalf("未知步骤应兜底为 IO_ERROR+默认文案, got %+v", ae)
	}
}

// 真实 os.Link/os.Symlink 返回 *LinkError→*PathError→syscall.Errno 链，
// linkErr/symlinkErr 的 errno 分类必须经 errors.Is 穿透包裹层（sentinel 语义）。
func TestLinkErr_WrappedErrno(t *testing.T) {
	var cross syscall.Errno
	if runtime.GOOS == "windows" {
		cross = 17 // ERROR_NOT_SAME_DEVICE
	} else {
		cross = 18 // EXDEV
	}
	wrapped := fmt.Errorf("link /a/x.ysm /b/x.ysm: %w", cross)
	if e := linkErr("/a/x.ysm", "/b/x.ysm", wrapped); !strings.Contains(e.Error(), "不同分区") {
		t.Errorf("fmt.Errorf(%%w) 包裹的跨设备 errno 应被 errors.Is 穿透分类, got %v", e)
	}
}

func TestSymlinkErr_WrappedErrno(t *testing.T) {
	var perm syscall.Errno
	if runtime.GOOS == "windows" {
		perm = 1314 // ERROR_PRIVILEGE_NOT_HELD
	} else {
		perm = 1 // EPERM
	}
	wrapped := fmt.Errorf("symlink /a/x.ysm /b/x.ysm: %w", perm)
	if e := symlinkErr("/a/x.ysm", "/b/x.ysm", wrapped); !strings.Contains(e.Error(), "管理员权限") {
		t.Errorf("fmt.Errorf(%%w) 包裹的权限 errno 应被 errors.Is 穿透分类, got %v", e)
	}
}

// TestInstallDir_DenyExecutablesWithEmptyRtype BUG-3 硬断言：
// rtype="" 时 deny-list 仍须拦截可执行文件（adversarial 测试仅日志记录，此处断言）。
func TestInstallDir_DenyExecutablesWithEmptyRtype(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)
	srcDir := filepath.Join(repo, "troll_model")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "model.ysm"), []byte("ysm"), 0644); err != nil {
		t.Fatal(err)
	}
	denied := []string{
		"payload.exe", "exploit.bat", "evil.dll", "script.cmd",
		"screen.scr", "p.pif", "cmd.com", "pkg.msi", "run.ps1", "v.vbs",
	}
	for _, name := range denied {
		if err := os.WriteFile(filepath.Join(srcDir, name), []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := InstallDir(srcDir, custom, repo, "copy", ""); err != nil {
		t.Fatalf("InstallDir(rtype='') = %v", err)
	}
	finalDst := filepath.Join(custom, filepath.Base(srcDir))
	if _, err := os.Stat(filepath.Join(finalDst, "model.ysm")); err != nil {
		t.Fatal("正常模型文件应被安装")
	}
	for _, name := range denied {
		if _, err := os.Stat(filepath.Join(finalDst, name)); err == nil {
			t.Errorf("rtype=\"\" 时 %s 应被 deny-list 拒绝（BUG-3）", name)
		}
	}
}

// TestInstallDir_DeadRecursionGuard_CaseSensitiveFS BUG-4 回归：
// 大小写敏感 FS（Linux/macOS）上 srcDir 与 dstDir 仅大小写不同是不同目录，
// 旧 strings.EqualFold 守卫会误拒；sameDir（SameFile）应放行并正常安装。
func TestInstallDir_DeadRecursionGuard_CaseSensitiveFS(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 大小写不敏感 FS：不同大小写路径是同一目录")
	}
	repo := filepath.Join(t.TempDir(), ".minecraft", "versions", "1.20")
	if err := os.MkdirAll(repo, 0755); err != nil {
		t.Fatal(err)
	}
	srcDir := filepath.Join(repo, "SRC")
	dstDir := filepath.Join(repo, "src")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "model.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	si, _ := os.Lstat(srcDir)
	di, _ := os.Lstat(dstDir)
	if os.SameFile(si, di) {
		t.Skip("当前 FS 大小写不敏感，无法构造不同目录")
	}
	err := InstallDir(srcDir, dstDir, repo, "copy", "")
	if err != nil {
		t.Fatalf("大小写敏感 FS 上不同大小写目录应可安装（非死递归）, got %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(dstDir, "SRC", "model.ysm")); statErr != nil {
		t.Fatalf("目标应被安装: %v", statErr)
	}
}

// ====== sameDir 单元测试 ======

func TestSameDir(t *testing.T) {
	base := t.TempDir()
	a := filepath.Join(base, "a")
	b := filepath.Join(base, "b")
	if err := os.MkdirAll(a, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(b, 0755); err != nil {
		t.Fatal(err)
	}
	if !sameDir(a, a) {
		t.Error("sameDir(a,a) 应为 true")
	}
	if sameDir(a, b) {
		t.Error("sameDir(a,b) 应为 false")
	}
	// 不存在的路径退化为字符串相等比较
	missing := filepath.Join(base, "missing")
	if !sameDir(missing, missing) {
		t.Error("sameDir(missing,missing) 应为 true")
	}
	if sameDir(a, missing) {
		t.Error("存在与不存在的目录应判不同")
	}
}

// ====== IsValidRepoRoot 补充分支 ======

// Unix 系统关键目录 / 根目录应被拒绝（此前仅 Windows 分支有覆盖）
func TestIsValidRepoRoot_SystemDirs(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("系统目录禁列按平台分支，本测试面向 Unix")
	}
	for _, p := range []string{"/", "/etc", "/usr", "/bin", "/sbin", "/var", "/dev", "/proc", "/sys", "/System", "/private"} {
		if IsValidRepoRoot(p) {
			t.Errorf("IsValidRepoRoot(%q) = true, 期望 false（系统/根目录）", p)
		}
	}
	if !IsValidRepoRoot(t.TempDir()) {
		t.Error("临时目录应返回 true")
	}
}

// 非法路径（含 NUL）触发 filepath.Abs 错误 → 返回 false（Windows 的 Abs 校验 NUL）
func TestIsValidRepoRoot_InvalidPath(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Unix 上 filepath.Abs 不校验 NUL，行为不同")
	}
	if IsValidRepoRoot("x\x00y") {
		t.Error("含 NUL 的非法路径应返回 false")
	}
}
