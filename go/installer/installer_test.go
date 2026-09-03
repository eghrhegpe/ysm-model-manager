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

	"ysm-model-manager/go/types"
)

// setupTestDirs 创建测试用目录结构并返回 (repoRoot, customDir, mcRoot, ysmFile)
func setupTestDirs(t *testing.T) (repoRoot, customDir, mcRoot, ysmFile string) {
	t.Helper()

	repoRoot = t.TempDir()
	mcRoot = t.TempDir()

	// 创建 .minecraft marker
	mcDir := filepath.Join(mcRoot, ".minecraft")
	if err := os.MkdirAll(mcDir, 0755); err != nil {
		t.Fatal(err)
	}

	// custom 目录（整合包内路径）
	customDir = filepath.Join(mcDir, "versions", "1.20.1-Fabric", "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}

	// 仓库中的 YSM 文件
	ysmFile = filepath.Join(repoRoot, "[作者]作品-变体(202506).ysm")
	if err := os.WriteFile(ysmFile, []byte("test model data"), 0644); err != nil {
		t.Fatal(err)
	}

	return
}

func TestInstall_Copy(t *testing.T) {
	repo, custom, _, src := setupTestDirs(t)

	err := Install(src, custom, repo, "copy")
	if err != nil {
		t.Fatalf("Install() = %v", err)
	}

	// 验证文件已复制到 custom 目录
	dst := filepath.Join(custom, filepath.Base(src))
	if _, err := os.Stat(dst); os.IsNotExist(err) {
		t.Fatal("目标文件未创建")
	}
	data, _ := os.ReadFile(dst)
	if string(data) != "test model data" {
		t.Fatalf("内容 = %q, 期望 'test model data'", string(data))
	}
}

func TestInstall_Hardlink(t *testing.T) {
	repo, custom, _, src := setupTestDirs(t)

	err := Install(src, custom, repo, "hardlink")
	if err != nil {
		t.Fatalf("Install(hardlink) = %v", err)
	}
	dst := filepath.Join(custom, filepath.Base(src))
	// 验证目标是真实硬链接：与源共享 inode
	si, err := os.Stat(src)
	if err != nil {
		t.Fatal(err)
	}
	di, err := os.Stat(dst)
	if err != nil {
		t.Fatal("硬链接目标未创建")
	}
	if !os.SameFile(si, di) {
		t.Fatal("目标不是指向源文件的硬链接")
	}
}

// TestInstall_NonYSMFile_PerTypeRepoRoot 回归测试：修复 InstallModelTo 仓库根写死 a.ysmRoot()
// 前，非 YSM 单文件（.vrm/.vmd/.nbt/...）因不在 ysmRoot 内被 IsInside 守卫拦下、永远进不了硬链接分支。
// 现 installer.Install 收 filesRoot=对应类型仓库根，应通过守卫并成功硬链接。
func TestInstall_NonYSMFile_PerTypeRepoRoot(t *testing.T) {
	cases := []string{".vrm", ".vmd", ".nbt", ".zip"}
	for _, ext := range cases {
		t.Run(ext, func(t *testing.T) {
			// 该类型专属仓库根（模拟 GetRepoRoot(rtype) 返回，非 ysmRoot）
			repoRoot := t.TempDir()
			mcRoot := t.TempDir()
			mcDir := filepath.Join(mcRoot, ".minecraft")
			if err := os.MkdirAll(mcDir, 0755); err != nil {
				t.Fatal(err)
			}
			customDir := filepath.Join(mcDir, "versions", "1.20.1-Fabric", "config", "yes_steve_model", "custom")
			if err := os.MkdirAll(customDir, 0755); err != nil {
				t.Fatal(err)
			}
			src := filepath.Join(repoRoot, "resource"+ext)
			if err := os.WriteFile(src, []byte("payload"), 0644); err != nil {
				t.Fatal(err)
			}

			// 关键断言：用该类型仓库根作为 filesRoot 安装，应通过 IsInside 守卫（不再报 ErrInvalidPath）
			// 并成功建立硬链接（验证硬链接分支被命中）
			if err := Install(src, customDir, repoRoot, "hardlink"); err != nil {
				t.Fatalf("Install(%s, hardlink) = %v", ext, err)
			}
			dst := filepath.Join(customDir, filepath.Base(src))
			si, err := os.Stat(src)
			if err != nil {
				t.Fatal(err)
			}
			di, err := os.Stat(dst)
			if err != nil {
				t.Fatalf("%s 硬链接目标未创建", ext)
			}
			if !os.SameFile(si, di) {
				t.Fatalf("%s 目标不是指向源文件的硬链接（硬链接分支未命中）", ext)
			}
		})
	}
}

func TestInstall_Symlink(t *testing.T) {
	repo, custom, _, src := setupTestDirs(t)

	err := Install(src, custom, repo, "symlink")
	if err != nil {
		// Windows 上创建符号链接需要管理员/开发者模式，环境不支持时跳过
		t.Skipf("symlink 不可用: %v", err)
	}
	dst := filepath.Join(custom, filepath.Base(src))
	li, err := os.Lstat(dst)
	if err != nil {
		t.Fatal("符号链接目标未创建")
	}
	if li.Mode()&os.ModeSymlink == 0 {
		t.Fatal("目标不是符号链接")
	}
	// 符号链接应解析到源文件
	si, _ := os.Stat(src)
	di, _ := os.Stat(dst)
	if !os.SameFile(si, di) {
		t.Fatal("符号链接未指向源文件")
	}
}

func TestInstall_Overwrite(t *testing.T) {
	repo, custom, _, src := setupTestDirs(t)

	// 先以 copy 模式安装（目标为独立副本）
	if err := Install(src, custom, repo, "copy"); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(custom, filepath.Base(src))
	si, _ := os.Stat(src)
	di, _ := os.Stat(dst)
	if os.SameFile(si, di) {
		t.Fatal("前置条件错误：copy 模式不应与源同 inode")
	}
	// 更新仓库源内容（模拟下载新版本）
	if err := os.WriteFile(src, []byte("new version data"), 0644); err != nil {
		t.Fatal(err)
	}
	// 再以 hardlink 模式安装：旧副本应被原子替换为指向新源的硬链接
	if err := Install(src, custom, repo, "hardlink"); err != nil {
		t.Fatalf("Install(overwrite) = %v", err)
	}
	di2, _ := os.Stat(dst)
	if !os.SameFile(si, di2) {
		t.Fatal("旧副本未被替换为硬链接")
	}
	data, _ := os.ReadFile(dst)
	if string(data) != "new version data" {
		t.Fatalf("内容 = %q, 期望新版本", string(data))
	}
}

func TestInstall_ReinstallIdempotent(t *testing.T) {
	repo, custom, _, src := setupTestDirs(t)

	if err := Install(src, custom, repo, "hardlink"); err != nil {
		t.Fatal(err)
	}
	// 重复安装同源硬链接应幂等且不报错
	if err := Install(src, custom, repo, "hardlink"); err != nil {
		t.Fatalf("重复安装应幂等: %v", err)
	}
	dst := filepath.Join(custom, filepath.Base(src))
	si, _ := os.Stat(src)
	di, _ := os.Stat(dst)
	if !os.SameFile(si, di) {
		t.Fatal("重复安装后目标不再是硬链接")
	}
}

func TestInstallDir_Hardlink(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)

	srcDir := filepath.Join(repo, "mmd_model")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "model.pmx"), []byte("pmx"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := InstallDir(srcDir, custom, repo, "hardlink", "EntityPlayer"); err != nil {
		t.Fatalf("InstallDir(hardlink) = %v", err)
	}
	srcFile := filepath.Join(srcDir, "model.pmx")
	dstFile := filepath.Join(custom, filepath.Base(srcDir), "model.pmx")
	si, err := os.Stat(srcFile)
	if err != nil {
		t.Fatal(err)
	}
	di, err := os.Stat(dstFile)
	if err != nil {
		t.Fatal("目录硬链接目标未创建")
	}
	if !os.SameFile(si, di) {
		t.Fatal("目录安装的 pmx 不是硬链接")
	}
}

func TestInstallDir_TypeFilter(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)

	srcDir := filepath.Join(repo, "ysm_model")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "model.json"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "notes.txt"), []byte("no"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := InstallDir(srcDir, custom, repo, "copy", "ysm"); err != nil {
		t.Fatalf("InstallDir(ysm) = %v", err)
	}
	if _, err := os.Stat(filepath.Join(custom, filepath.Base(srcDir), "model.json")); err != nil {
		t.Fatal("json 应被安装")
	}
	if _, err := os.Stat(filepath.Join(custom, filepath.Base(srcDir), "notes.txt")); err == nil {
		t.Fatal("txt 应被类型过滤排除")
	}
}

// TestInstallDir_MMDVmdWhiteList：EntityPlayer 作为独立顶级类型，无 installExts 白名单——
// 所有非可执行文件（pmx/vmd/vpd/json/png/txt）均放行；可执行文件（.exe）由黑名单拦截。
// ADR-092 第 2 层 A：玩家模型目录内 anims/*.vmd、*.vpd、animations.json 须能装进 EntityPlayer/
func TestInstallDir_MMDVmdWhiteList(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)

	srcDir := filepath.Join(repo, "mmd_model")
	if err := os.MkdirAll(filepath.Join(srcDir, "anims"), 0755); err != nil {
		t.Fatal(err)
	}
	// 模型 + 随行动画/表情/槽位映射 + 干扰项
	for f, data := range map[string]string{
		"model.pmx":       "pmx",
		"anims/walk.vmd":  "vmd",
		"anims/idle.vmd":  "vmd",
		"happy.vpd":       "vpd",
		"animations.json": `{"walk":"anims/walk.vmd"}`,
		"model.png":       "png",
		"notes.txt":       "no",
		"evil.exe":        "MZ",
	} {
		if err := os.WriteFile(filepath.Join(srcDir, f), []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := InstallDir(srcDir, custom, repo, "copy", "EntityPlayer"); err != nil {
		t.Fatalf("InstallDir(EntityPlayer) = %v", err)
	}
	base := filepath.Join(custom, filepath.Base(srcDir))
	// EntityPlayer 无 installExts 配置（新架构各 MMD 类型独立），所有非可执行文件均放行
	for _, want := range []string{"model.pmx", "anims/walk.vmd", "anims/idle.vmd", "happy.vpd", "animations.json", "model.png", "notes.txt"} {
		if _, err := os.Stat(filepath.Join(base, want)); err != nil {
			t.Errorf("EntityPlayer 应安装 %s: %v", want, err)
		}
	}
	// 可执行文件黑名单仍生效
	for _, deny := range []string{"evil.exe"} {
		if _, err := os.Stat(filepath.Join(base, deny)); err == nil {
			t.Errorf("EntityPlayer 可执行文件黑名单应排除 %s", deny)
		}
	}
}

func TestInstallToGlobal_UnsupportedExt(t *testing.T) {
	_, _, mcRoot, _ := setupTestDirs(t)

	badFile := filepath.Join(t.TempDir(), "payload.exe")
	if err := os.WriteFile(badFile, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallToGlobal(badFile, mcRoot); err == nil {
		t.Fatal("不支持的文件类型应返回错误")
	}
}

// TestLinkErr_Errno 跨设备/权限 errno 应分类为可操作提示（按运行平台选错误码）
func TestLinkErr_Errno(t *testing.T) {
	var crossDevice syscall.Errno
	var permission syscall.Errno
	if runtime.GOOS == "windows" {
		crossDevice = 17 // ERROR_NOT_SAME_DEVICE
		permission = 5   // ERROR_ACCESS_DENIED
	} else {
		crossDevice = 18 // EXDEV
		permission = 13  // EACCES
	}
	if e := linkErr("/a", "/b", crossDevice); !strings.Contains(e.Error(), "不同分区") {
		t.Errorf("跨设备 errno 应提示不同分区, got %v", e)
	}
	if e := linkErr("/a", "/b", permission); !strings.Contains(e.Error(), "权限不足") {
		t.Errorf("权限 errno 应提示权限不足, got %v", e)
	}
}

// TestLinkErr_TextFallback 文本兜底已删（陷阱 #11）：非 errno 包装的文本错误不再
// 分类，一律落通用提示——验证不误分类（errno 判定由 TestLinkErr_Errno 覆盖）
func TestLinkErr_TextFallback(t *testing.T) {
	if e := linkErr("/a", "/b", fmt.Errorf("cross-device link not permitted")); !strings.Contains(e.Error(), "硬链接失败") {
		t.Errorf("文本错误不应分类为不同分区, got %v", e)
	}
	if e := linkErr("/a", "/b", fmt.Errorf("permission denied")); !strings.Contains(e.Error(), "硬链接失败") {
		t.Errorf("文本错误不应分类为权限不足, got %v", e)
	}
	if e := linkErr("/a", "/b", fmt.Errorf("unexpected error")); !strings.Contains(e.Error(), "硬链接失败") {
		t.Errorf("未知错误应回退通用提示, got %v", e)
	}
}

// TestSymlinkErr_Errno 符号链接权限 errno 应提示管理员权限
func TestSymlinkErr_Errno(t *testing.T) {
	var perm syscall.Errno
	if runtime.GOOS == "windows" {
		perm = 1314 // ERROR_PRIVILEGE_NOT_HELD
	} else {
		perm = 1 // EPERM
	}
	if e := symlinkErr("/a", "/b", perm); !strings.Contains(e.Error(), "管理员权限") {
		t.Errorf("符号链接权限 errno 应提示管理员权限, got %v", e)
	}
}

func TestInstall_EmptySrc(t *testing.T) {
	_, custom, _, _ := setupTestDirs(t)
	err := Install("", custom, "/tmp", "copy")
	if err == nil {
		t.Fatal("空源路径应返回错误")
	}
}

func TestInstall_EmptyCustomDir(t *testing.T) {
	repo, _, _, src := setupTestDirs(t)
	err := Install(src, "", repo, "copy")
	if err == nil {
		t.Fatal("空目标路径应返回错误")
	}
}

func TestInstall_SrcOutsideRepo(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)
	// src 在仓库之外
	outsideFile := filepath.Join(t.TempDir(), "outside.ysm")
	if err := os.WriteFile(outsideFile, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	err := Install(outsideFile, custom, repo, "copy")
	if err == nil {
		t.Fatal("仓库外文件应返回错误")
	}
}

func TestInstall_UnsupportedExt(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)
	badFile := filepath.Join(repo, "file.exe")
	if err := os.WriteFile(badFile, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	err := Install(badFile, custom, repo, "copy")
	if err == nil {
		t.Fatal("不支持的文件类型应返回错误")
	}
}

func TestInstallDir_Copy(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)

	// 创建源目录结构（模拟 MMD 模型）
	srcDir := filepath.Join(repo, "mmd_model")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "model.pmx"), []byte("pmx"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "tex.png"), []byte("png"), 0644); err != nil {
		t.Fatal(err)
	}

	dstDir := custom // InstallDir 会再下一层
	err := InstallDir(srcDir, dstDir, repo, "copy", "EntityPlayer")
	if err != nil {
		t.Fatalf("InstallDir() = %v", err)
	}

	// 验证目录已复制（InstallDir 在 dstDir 下创建 basename 目录）
	baseName := filepath.Base(srcDir)
	dstModel := filepath.Join(dstDir, baseName, "model.pmx")
	if _, err := os.Stat(dstModel); os.IsNotExist(err) {
		t.Fatal("目标 pmx 文件未创建")
	}
	dstTex := filepath.Join(dstDir, baseName, "tex.png")
	if _, err := os.Stat(dstTex); os.IsNotExist(err) {
		t.Fatal("目标 png 文件未创建")
	}
}

func TestInstallDir_EmptySrc(t *testing.T) {
	_, custom, _, _ := setupTestDirs(t)
	err := InstallDir("", custom, "/tmp", "copy", "EntityPlayer")
	if err == nil {
		t.Fatal("空源目录应返回错误")
	}
}

func TestInstallDir_EmptyDst(t *testing.T) {
	repo, _, _, _ := setupTestDirs(t)
	err := InstallDir(repo, "", repo, "copy", "EntityPlayer")
	if err == nil {
		t.Fatal("空目标目录应返回错误")
	}
}

func TestIsValidRepoRoot(t *testing.T) {
	// Windows 盘符用例加 GOOS 守卫——原用例在 Linux/macOS 上 filepath.Abs("C:\\")
	// 不触发盘符根判断、禁列也不匹配 → 函数返回 true 而用例期望 false，非 Windows 平台 go test 必失败
	tests := []struct {
		path string
		want bool
	}{
		{t.TempDir(), true},
	}
	if runtime.GOOS == "windows" {
		tests = append(tests,
			[]struct {
				path string
				want bool
			}{
				{"C:\\", false},
				{"C:\\Windows", false},
				{"C:\\Program Files", false},
			}...,
		)
	}
	for _, tc := range tests {
		got := IsValidRepoRoot(tc.path)
		if got != tc.want {
			t.Errorf("IsValidRepoRoot(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}

func TestCopyFile_SrcMissing(t *testing.T) {
	_, custom, _, _ := setupTestDirs(t)
	missing := filepath.Join(t.TempDir(), "不存在.ysm")

	_, err := CopyFile(missing, custom)
	if err == nil {
		t.Fatal("源文件不存在应返回错误")
	}

	// 失败路径不得在目标目录残留半截文件
	dst := filepath.Join(custom, filepath.Base(missing))
	if _, statErr := os.Stat(dst); !os.IsNotExist(statErr) {
		t.Fatalf("失败后目标文件不应存在: %v", statErr)
	}
}

func TestInstall_CopySrcMissing(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)
	missing := filepath.Join(repo, "不存在.ysm")

	err := Install(missing, custom, repo, "copy")
	if err == nil {
		t.Fatal("源文件不存在应返回错误")
	}

	dst := filepath.Join(custom, filepath.Base(missing))
	if _, statErr := os.Stat(dst); !os.IsNotExist(statErr) {
		t.Fatalf("安装失败后目标文件不应残留: %v", statErr)
	}
}

// TestInstallDir_SrcEqualsDst 死递归守卫：srcDir==dstDir 时必须拒绝
// （否则 finalDst 成为 srcDir 子目录 → os.ReadDir 列到自己 → 无限下钻，P2 审计）
func TestInstallDir_SrcEqualsDst(t *testing.T) {
	repo, _, _, _ := setupTestDirs(t)

	err := InstallDir(repo, repo, repo, "copy", "")
	if err == nil {
		t.Fatal("srcDir==dstDir 应拒绝（死递归守卫）")
	}
}

// TestInstallDir_DstInsideSrc 死递归守卫：finalDst 位于 srcDir 内时拒绝
func TestInstallDir_DstInsideSrc(t *testing.T) {
	repo, _, _, _ := setupTestDirs(t)
	// dstDir 是 srcDir 的子目录 → finalDst = srcDir/<base> 在其内部 → 死递归
	inner := filepath.Join(repo, "inner")
	if err := os.MkdirAll(inner, 0755); err != nil {
		t.Fatal(err)
	}
	err := InstallDir(repo, inner, repo, "copy", "")
	if err == nil {
		t.Fatal("finalDst 位于 srcDir 内应拒绝（死递归守卫）")
	}
}

// ====== EvalSymlinks 二次校验守卫（P2 补测）======

// Install 的 customDir 含指向 .minecraft 外的 symlink 段时：
// 字符串守卫 ContainsMinecraftMarker 放行，EvalSymlinks 解析真实路径后二次校验应返回 INVALID_PATH
func TestInstall_EvalSymlinksGuard_CustomDirSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 不支持 os.Symlink（需管理员权限）")
	}
	repo, _, mcRoot, src := setupTestDirs(t)

	// .minecraft 内一个中间段 symlink 指向仓库外目录
	outside := t.TempDir()
	externalCustom := filepath.Join(outside, "custom")
	if err := os.MkdirAll(externalCustom, 0755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(mcRoot, ".minecraft", "versions", "link_out")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	custom := filepath.Join(link, "custom")

	err := Install(src, custom, repo, "copy")
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "INVALID_PATH" {
		t.Fatalf("customDir 含指向 .minecraft 外 symlink 段应返回 INVALID_PATH, got %v", err)
	}
}

// Install 的 src 含指向仓库外的 symlink 段时：
// 字符串守卫 IsInside 放行，EvalSymlinks 解析真实路径后二次校验应返回 INVALID_PATH
func TestInstall_EvalSymlinksGuard_SrcSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 不支持 os.Symlink（需管理员权限）")
	}
	repo, custom, _, _ := setupTestDirs(t)

	// 仓库内一个 symlink 指向仓库外目录，源文件真实位置在仓库外
	outside := t.TempDir()
	realFile := filepath.Join(outside, "model.ysm")
	if err := os.WriteFile(realFile, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(repo, "link_out")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(link, "model.ysm")

	err := Install(src, custom, repo, "copy")
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != "INVALID_PATH" {
		t.Fatalf("src 含指向仓库外 symlink 段应返回 INVALID_PATH, got %v", err)
	}
}

// ====== InstallDir dstExisted 失败回滚（P2 补测）======

// srcDir 含不可读条目（权限 000 子目录）触发 installDirRecursive 报错时：
// 本次新建的 finalDst 应被回滚删除；已存在的 finalDst（用户既有数据）不得被删除
func TestInstallDir_DstExistedRollback(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 无法构造权限 000 的不可读条目")
	}
	repo, custom, _, _ := setupTestDirs(t)

	// srcDir：一个可读子目录（正常复制）+ 一个权限 000 的不可读子目录（注入失败）
	srcDir := filepath.Join(repo, "bad_model")
	if err := os.MkdirAll(filepath.Join(srcDir, "ok"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "ok", "model.pmx"), []byte("pmx"), 0644); err != nil {
		t.Fatal(err)
	}
	blocked := filepath.Join(srcDir, "blocked")
	if err := os.MkdirAll(blocked, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(blocked, 0000); err != nil {
		t.Fatal(err)
	}
	// 当前用户若不受权限位约束（root 等特权用户）无法注入失败 → 跳过
	if _, err := os.ReadDir(blocked); err == nil {
		t.Skip("当前用户可读权限 000 目录，无法构造不可读条目")
	}

	// 场景 A：finalDst 本次新建 → 失败后应被回滚删除
	if err := InstallDir(srcDir, custom, repo, "copy", "EntityPlayer"); err == nil {
		t.Fatal("srcDir 含不可读条目时安装应报错")
	}
	finalDst := filepath.Join(custom, "bad_model")
	if _, err := os.Stat(finalDst); !os.IsNotExist(err) {
		t.Fatalf("新建 finalDst 应被回滚删除: %v", err)
	}

	// 场景 B：finalDst 已存在（用户既有数据）→ 失败后不得被删除
	if err := os.MkdirAll(finalDst, 0755); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(finalDst, "keep.txt")
	if err := os.WriteFile(marker, []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := InstallDir(srcDir, custom, repo, "copy", "EntityPlayer"); err == nil {
		t.Fatal("srcDir 含不可读条目时安装应报错")
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("已存在 finalDst 不应被回滚删除: %v", err)
	}
}

// TestInstallDirRel_PlacesUnderRelPath: InstallDirRel 应将目录按 relSlash 指定的相对路径落位，
// 保留仓库多层物理路径（ADR 多层物理路径同步）。
func TestInstallDirRel_PlacesUnderRelPath(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)

	// 源目录：repo/东方/角色A/model （多层嵌套）
	srcDir := filepath.Join(repo, "东方", "角色A", "model")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(srcDir, "tex"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "char.pmx"), []byte("pmx"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "tex", "toon.png"), []byte("png"), 0644); err != nil {
		t.Fatal(err)
	}

	// relSlash="东方/角色A/model" → finalDst=custom/东方/角色A/model
	err := InstallDirRel(srcDir, custom, "东方/角色A/model", repo, "copy", "EntityPlayer")
	if err != nil {
		t.Fatalf("InstallDirRel() = %v", err)
	}

	dstPmx := filepath.Join(custom, "东方", "角色A", "model", "char.pmx")
	if _, err := os.Stat(dstPmx); os.IsNotExist(err) {
		t.Fatal("多层路径下的 char.pmx 未找到")
	}
	dstPng := filepath.Join(custom, "东方", "角色A", "model", "tex", "toon.png")
	if _, err := os.Stat(dstPng); os.IsNotExist(err) {
		t.Fatal("多层路径下的 tex/toon.png 未找到")
	}
}

// TestInstallDirRel_EmptyRelFallsBack: relSlash 为空时应回退到 InstallDir 原语义（basename 落位）
func TestInstallDirRel_EmptyRelFallsBack(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)

	srcDir := filepath.Join(repo, "mydir")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "file.pmx"), []byte("pmx"), 0644); err != nil {
		t.Fatal(err)
	}

	err := InstallDirRel(srcDir, custom, "", repo, "copy", "EntityPlayer")
	if err != nil {
		t.Fatalf("InstallDirRel('') = %v", err)
	}

	// rel 为空 → finalDst=custom/mydir （与 InstallDir 原语义一致）
	dst := filepath.Join(custom, "mydir", "file.pmx")
	if _, err := os.Stat(dst); os.IsNotExist(err) {
		t.Fatal("空 rel 应回退到 basename 语义")
	}
}

// TestInstallDirRel_RejectsEscape: relSlash 含 ".." 或绝对路径时应返回错误
func TestInstallDirRel_RejectsEscape(t *testing.T) {
	repo, custom, _, _ := setupTestDirs(t)

	srcDir := filepath.Join(repo, "model")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name string
		rel  string
	}{
		{"parent_escape", "../escape"},
		{"dot_dot_only", ".."},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := InstallDirRel(srcDir, custom, tc.rel, repo, "copy", "EntityPlayer")
			if err == nil {
				t.Errorf("rel=%q 应返回错误", tc.rel)
			}
		})
	}
	// 绝对路径测试：Windows 用盘符路径，Unix 用 / 前缀
	absRel := filepath.VolumeName(repo) + `\abs\path`
	if absRel == `\abs\path` || absRel == "" {
		absRel = `/abs/path`
	}
	t.Run("absolute_path", func(t *testing.T) {
		err := InstallDirRel(srcDir, custom, absRel, repo, "copy", "EntityPlayer")
		if err == nil {
			t.Errorf("rel=%q 应返回错误", absRel)
		}
	})
	// Windows 盘符相对路径：C:foo（无反斜杠）在 Windows 上被 filepath.IsAbs 误判为非绝对，
	// 但 Win32 会把冒号当 ADS 分隔符，需额外守卫
	// Linux 上 C:foo 是合法目录名，跳过
	if runtime.GOOS == "windows" {
		t.Run("volume_relative_path", func(t *testing.T) {
			err := InstallDirRel(srcDir, custom, `C:foo\bar`, repo, "copy", "EntityPlayer")
			if err == nil {
				t.Error("Windows 盘符相对路径 C:foo\\bar 应返回错误（ADS 风险）")
			}
		})
	}
}
