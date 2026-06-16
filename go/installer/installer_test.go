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
	if _, err := os.Stat(dst); os.IsNotExist(err) {
		t.Fatal("硬链接目标未创建")
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
