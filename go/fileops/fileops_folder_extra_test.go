// ===== WriteModelFolder / writeModelFolderFiles 补测 =====
// 覆盖：WriteModelFolder 的参数空/文件夹名 . .. /非法子路径/base64 解码失败
// （含失败回滚）、子路径 symlink 中间段拒绝；
// writeModelFolderFiles 的 "." 相对路径跳过、路径越权、MkdirAll 失败、
// 符号链接父目录/目标文件拒绝。
package fileops

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

// 参数空：repoRoot 空或 folderName 空应报错
func TestWriteModelFolder_EmptyArgs(t *testing.T) {
	files := []types.ImportFileItem{{RelPath: "ysm.json", Base64: b64(`{}`)}}
	if err := WriteModelFolder("", "sub", "name", files); err == nil {
		t.Fatal("repoRoot 空应报错")
	}
	if err := WriteModelFolder(t.TempDir(), "", "", files); err == nil {
		t.Fatal("folderName 空应报错")
	}
}

// 文件夹名为 . 或 .. 应拒绝（防止绕过模型文件夹抽象直接写入仓库根）
func TestWriteModelFolder_DotFolderName(t *testing.T) {
	files := []types.ImportFileItem{{RelPath: "ysm.json", Base64: b64(`{}`)}}
	for _, name := range []string{".", ".."} {
		if err := WriteModelFolder(t.TempDir(), "", name, files); err == nil {
			t.Fatalf("文件夹名 %q 应被拒绝", name)
		}
	}
}

// 非法子路径（穿越）应拒绝
func TestWriteModelFolder_BadSubpath(t *testing.T) {
	files := []types.ImportFileItem{{RelPath: "ysm.json", Base64: b64(`{}`)}}
	if err := WriteModelFolder(t.TempDir(), "..", "name", files); err == nil {
		t.Fatal("子路径 .. 应被拒绝")
	}
}

// 文件 base64 解码失败：报错且已写的半成品目录被回滚
func TestWriteModelFolder_InvalidBase64(t *testing.T) {
	repo := t.TempDir()
	files := []types.ImportFileItem{
		{RelPath: "ysm.json", Base64: b64(`{"spec":1}`)},
		{RelPath: "main.json", Base64: "!!!"}, // 非法 base64
	}
	if err := WriteModelFolder(repo, "", "模型A", files); err == nil {
		t.Fatal("base64 解码失败应报错")
	}
	// 失败回滚：半成品目录不应残留（防「目标已存在」卡死重试）
	if _, err := os.Stat(filepath.Join(repo, "模型A")); !os.IsNotExist(err) {
		t.Fatalf("写入失败后模型目录应被回滚: %v", err)
	}
}

// writeModelFolderFiles：RelPath 为 "." 的条目应跳过（不写文件不报错）
func TestWriteModelFolderFiles_DotRelPathSkipped(t *testing.T) {
	dir := t.TempDir()
	dstRoot := filepath.Join(dir, "model")
	files := []types.ImportFileItem{{RelPath: ".", Base64: b64("x")}}
	if err := writeModelFolderFiles(dstRoot, files); err != nil {
		t.Fatalf("'.' 条目应跳过不报错: %v", err)
	}
	if _, err := os.Stat(dstRoot); !os.IsNotExist(err) {
		t.Fatal("'.' 条目不应创建目录")
	}
}

// writeModelFolderFiles：路径越权（逃出 dstRoot）应拒绝
func TestWriteModelFolderFiles_EscapeRejected(t *testing.T) {
	dir := t.TempDir()
	files := []types.ImportFileItem{{RelPath: "../evil.ysm", Base64: b64("x")}}
	if err := writeModelFolderFiles(filepath.Join(dir, "model"), files); err == nil {
		t.Fatal("路径越权应报错")
	}
}

// writeModelFolderFiles：目标父路径组件为文件 → MkdirAll 失败应报错
func TestWriteModelFolderFiles_MkdirAllError(t *testing.T) {
	dir := t.TempDir()
	dstRoot := filepath.Join(dir, "model")
	if err := os.MkdirAll(dstRoot, 0755); err != nil {
		testutil.NoError(t, err)
	}
	blocker := filepath.Join(dstRoot, "sub")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	files := []types.ImportFileItem{{RelPath: "sub/a.ysm", Base64: b64("x")}}
	if err := writeModelFolderFiles(dstRoot, files); err == nil {
		t.Fatal("父路径组件为文件时应报错")
	}
}

// writeModelFolderFiles：目标父目录为符号链接 → 拒绝写入（防穿透写出）
func TestWriteModelFolderFiles_SymlinkParentRejected(t *testing.T) {
	dir := t.TempDir()
	dstRoot := filepath.Join(dir, "model")
	if err := os.MkdirAll(dstRoot, 0755); err != nil {
		testutil.NoError(t, err)
	}
	outside := t.TempDir()
	symDir := filepath.Join(dstRoot, "symdir")
	if err := os.Symlink(outside, symDir); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}
	files := []types.ImportFileItem{{RelPath: "symdir/a.ysm", Base64: b64("x")}}
	if err := writeModelFolderFiles(dstRoot, files); err == nil {
		t.Fatal("父目录为符号链接应拒绝写入")
	}
	// 仓库外不应有穿透写入
	if _, err := os.Stat(filepath.Join(outside, "a.ysm")); !os.IsNotExist(err) {
		t.Fatalf("仓库外不应有穿透写入: %v", err)
	}
}

// writeModelFolderFiles：目标文件自身为符号链接 → 拒绝覆盖（防改写外部文件）
func TestWriteModelFolderFiles_SymlinkFileRejected(t *testing.T) {
	dir := t.TempDir()
	dstRoot := filepath.Join(dir, "model")
	sub := filepath.Join(dstRoot, "sub")
	if err := os.MkdirAll(sub, 0755); err != nil {
		testutil.NoError(t, err)
	}
	outside := t.TempDir()
	leak := filepath.Join(outside, "leaked.txt")
	if err := os.WriteFile(leak, []byte("original"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	symFile := filepath.Join(sub, "a.ysm")
	if err := os.Symlink(leak, symFile); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}
	files := []types.ImportFileItem{{RelPath: "sub/a.ysm", Base64: b64("NEW")}}
	if err := writeModelFolderFiles(dstRoot, files); err == nil {
		t.Fatal("目标文件为符号链接应拒绝覆盖")
	}
	// 外部文件内容应未被改写
	data, err := os.ReadFile(leak)
	testutil.NoError(t, err)
	if string(data) != "original" {
		t.Fatalf("外部文件不应被改写: %q", data)
	}
}

// WriteModelFolder 子路径中间段为符号链接（指向仓库外已存在目录）→ 拒绝
func TestWriteModelFolder_SymlinkSubpathRejected(t *testing.T) {
	repo := t.TempDir()
	outside := t.TempDir()
	symDir := filepath.Join(repo, "symdir")
	if err := os.Symlink(outside, symDir); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}
	files := []types.ImportFileItem{{RelPath: "ysm.json", Base64: b64(`{}`)}}
	if err := WriteModelFolder(repo, "symdir/sub", "模型A", files); err == nil {
		t.Fatal("子路径中间段为符号链接应拒绝")
	}
	// 仓库外不应有穿透写入
	if _, err := os.Stat(filepath.Join(outside, "sub", "模型A", "ysm.json")); !os.IsNotExist(err) {
		t.Fatalf("仓库外不应有穿透写入: %v", err)
	}
}
