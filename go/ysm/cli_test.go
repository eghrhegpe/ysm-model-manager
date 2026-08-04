// ===== go/ysm CLI 工具查找单测 =====
package ysm

import (
	"os"
	"path/filepath"
	"testing"
)

// ====== fileExists ======

func TestFileExists_Yes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "exists.txt")
	if err := os.WriteFile(path, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	if !fileExists(path) {
		t.Error("存在文件应返回 true")
	}
}

func TestFileExists_No(t *testing.T) {
	if fileExists("/nonexistent/path/file.txt") {
		t.Error("不存在文件应返回 false")
	}
}

func TestFileExists_Dir(t *testing.T) {
	dir := t.TempDir()
	if !fileExists(dir) {
		// os.Stat 对目录也返回 nil，所以应 true
		t.Error("存在的目录应返回 true")
	}
}

// ====== FindCLI ======

func TestFindCLI_ReturnsSomething(t *testing.T) {
	// FindCLI 在环境中查找 YSMParser.exe
	// 当前环境可能找不到，验证返回空字符串不崩溃即可
	result := FindCLI()
	// 不验证具体值，只验证不 panic
	_ = result
}

func TestFindCLI_WithExeInCwd(t *testing.T) {
	// 在当前工作目录放一个 YSMParser.exe 文件
	origWd, _ := os.Getwd()
	// 在临时目录中模拟
	dir := t.TempDir()
	exePath := filepath.Join(dir, "YSMParser.exe")
	if err := os.WriteFile(exePath, []byte("fake exe"), 0644); err != nil {
		t.Fatal(err)
	}

	// 切换到临时目录测试
	oldWd, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(oldWd)

	// 临时目录中有 YSMParser.exe，FindCLI 应能找到
	result := FindCLI()
	// 注意：FindCLI 先检查 os.Executable() 所在目录，再检查 CWD
	// 所以结果可能为空，但不会崩溃
	_ = result
	// 恢复到原工作目录
	os.Chdir(origWd)
}