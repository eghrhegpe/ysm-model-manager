// 对抗测试：fsutil 路径安全边界——NUL 字节、symlink、相对路径、幂等删除
package fsutil

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// =====================================================================
// WriteFileAtomic 安全边界
// =====================================================================

// ---------- 1. NUL 字节注入 ----------
func TestWriteFileAtomic_NULByteInDest(t *testing.T) {
	tmpDir := t.TempDir()
	// destPath 内嵌 NUL 字节——Windows 上 filepath.Dir 会在 NUL 处截断，
	// Linux 上 filepath.Abs 截断同理。
	// 攻击意图：将写入目标截断到其他目录（如 dest.ysm\x00.exe → dest.ysm）
	destPath := filepath.Join(tmpDir, "safe.ysm") + "\x00" + "..\\evil.exe"
	err := WriteFileAtomic(destPath, []byte("malicious"))
	if err == nil {
		t.Fatalf("BUG(NUL-1): WriteFileAtomic 接受含 NUL 的路径, dest=%q", destPath)
	}
	// 拒绝即守卫生效（显式 ErrTempCreateFailed 或 OS 层拒绝皆可）
	if errors.Is(err, ErrTempCreateFailed) {
		t.Logf("守卫: NUL 字节路径被显式拒绝(ErrTempCreateFailed): %v", err)
	} else {
		t.Logf("守卫: NUL 字节路径被 OS 层拒绝: %v", err)
	}
}

// ---------- 2. Symlink 目标重定向 ----------
func TestWriteFileAtomic_SymlinkDest(t *testing.T) {
	if runtime.GOOS == "windows" {
		// Windows 创建 symlink 需开发者模式或管理员权限，部分环境不支持
		// 用 Lstat 检测环境能力
		tmpDir := t.TempDir()
		src := filepath.Join(tmpDir, "src")
		dst := filepath.Join(tmpDir, "dst")
		if err := os.Symlink(src, dst); err != nil {
			t.Skip("Windows: symlink 创建需管理员权限/开发者模式")
			return
		}
		os.Remove(dst) // cleanup
	}

	tmpDir := t.TempDir()
	// 创建合法目标文件
	realDest := filepath.Join(tmpDir, "real.ysm")
	if err := os.WriteFile(realDest, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}

	// 创建 symlink 指向 realDest
	symlinkPath := filepath.Join(tmpDir, "link.ysm")
	if err := os.Symlink(realDest, symlinkPath); err != nil {
		t.Skip("Linux/macOS: symlink 创建失败: " + err.Error())
		return
	}

	// 通过 symlink 写入——renameFile 在 Linux 上跟随 symlink，
	// 直接覆盖 realDest 内容（可能非预期）
	err := WriteFileAtomic(symlinkPath, []byte("OVERWRITTEN"))
	if err != nil {
		t.Logf("FIXED(INFO-SYM): symlink dest 被拒绝: %v", err)
		return
	}

	data, _ := os.ReadFile(realDest)
	if string(data) == "OVERWRITTEN" {
		t.Logf("INFO(INFO-SYM): renameFile 跟随 symlink 覆盖了真实目标 (rename 语义, 非漏洞, 但需注意)")
	} else {
		t.Logf("INFO(INFO-SYM): renameFile 未覆盖真实目标: data=%s", string(data))
	}
}

// ---------- 3. 相对路径 ----------
func TestWriteFileAtomic_RelativePath(t *testing.T) {
	// 相对路径是 WriteFileAtomic 的合法输入（utility 函数），
	// 测试确认不崩溃，destDir 在 CWD 下创建临时文件。
	origWD, _ := os.Getwd()
	tmpDir := t.TempDir()
	t.Cleanup(func() { _ = os.Chdir(origWD) })
	_ = os.Chdir(tmpDir)

	err := WriteFileAtomic("relative.ysm", []byte("test"))
	if err != nil {
		t.Fatalf("相对路径应正常工作: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(tmpDir, "relative.ysm"))
	if err != nil {
		t.Fatalf("相对路径文件未找到: %v", err)
	}
	t.Logf("FIXED(INFO-REL): 相对路径写入成功, data=%s", string(data))
}

// ---------- 4. 空 destPath ----------
func TestWriteFileAtomic_EmptyDest(t *testing.T) {
	err := WriteFileAtomic("", []byte("test"))
	if err != nil {
		t.Logf("FIXED(INFO-EMPTY): 空 destPath 被拒绝: %v", err)
		return
	}
	t.Log("INFO(INFO-EMPTY): 空 destPath 未报错——创建在 CWD 下")
}

// =====================================================================
// WalkAllFiles / CleanEmptyDirs 安全边界
// =====================================================================

// ---------- 5. WalkAllFiles symlink 根目录 ----------
func TestWalkAllFiles_SymlinkRoot(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows: symlink 需管理员权限")
		return
	}
	// 创建外部目录
	secretDir, err := os.MkdirTemp("", "secret")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(secretDir)
	os.WriteFile(filepath.Join(secretDir, "secret.txt"), []byte("SECRET"), 0644)

	// 创建 symlink 指向 secretDir
	tmpDir := t.TempDir()
	symlinkPath := filepath.Join(tmpDir, "link")
	if err := os.Symlink(secretDir, symlinkPath); err != nil {
		t.Skip("symlink 创建失败: " + err.Error())
		return
	}

	// WalkAllFiles 会跟随根 symlink——列出 secret.txt
	files := WalkAllFiles(symlinkPath, false)
	for _, f := range files {
		if strings.Contains(f, "secret.txt") {
			t.Logf("INFO(INFO-SYM-ROOT): WalkAllFiles 跟随根 symlink, 列出 %s（expected, filepath.WalkDir 语义）", f)
			return
		}
	}
	t.Logf("INFO(INFO-SYM-ROOT): WalkAllFiles 未列出 secret.txt, files=%v", files)
}

// ---------- 6. CleanEmptyDirs NUL 字节 ----------
func TestCleanEmptyDirs_NULByte(t *testing.T) {
	tmpDir := t.TempDir()
	os.MkdirAll(filepath.Join(tmpDir, "empty_subdir"), 0755)
	os.WriteFile(filepath.Join(tmpDir, "empty_subdir", "placeholder"), []byte{}, 0644)
	os.Remove(filepath.Join(tmpDir, "empty_subdir", "placeholder"))

	// NUL 字节注入路径
	badPath := tmpDir + "\x00" + "..\\..\\evil"
	count := CleanEmptyDirs(badPath, false)
	t.Logf("INFO(NUL-2): CleanEmptyDirs 处理 NUL 路径, removed=%d", count)
}

// ---------- 7. IsRecycleDir 边界 ----------
func TestIsRecycleDir_EdgeCases(t *testing.T) {
	cases := []struct {
		input    string
		expected bool
	}{
		{".recycle", true},
		{".RECYCLE", true},
		{".Recycle", true},
		{"sub/.recycle", true},
		{"/abs/path/.recycle", true},
		{".recycle/sub", false},
		{"recycle", false},
		{"", false},
	}
	for _, c := range cases {
		result := IsRecycleDir(c.input)
		if result != c.expected {
			t.Errorf("IsRecycleDir(%q) = %v, 期望 %v", c.input, result, c.expected)
		}
	}
	t.Log("FIXED(INFO-REC): IsRecycleDir 大小写不敏感判断通过")
}
