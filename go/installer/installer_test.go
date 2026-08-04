package installer

import (
	"os"
	"path/filepath"
	"testing"
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
	if err := InstallDir(srcDir, custom, repo, "hardlink", "mmd-skin"); err != nil {
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
	err := InstallDir(srcDir, dstDir, repo, "copy", "mmd-skin")
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
	err := InstallDir("", custom, "/tmp", "copy", "mmd-skin")
	if err == nil {
		t.Fatal("空源目录应返回错误")
	}
}

func TestInstallDir_EmptyDst(t *testing.T) {
	repo, _, _, _ := setupTestDirs(t)
	err := InstallDir(repo, "", repo, "copy", "mmd-skin")
	if err == nil {
		t.Fatal("空目标目录应返回错误")
	}
}

func TestIsValidRepoRoot(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{t.TempDir(), true},
		{"C:\\", false},
		{"C:\\Windows", false},
		{"C:\\Program Files", false},
	}
	for _, tc := range tests {
		got := IsValidRepoRoot(tc.path)
		if got != tc.want {
			t.Errorf("IsValidRepoRoot(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}
