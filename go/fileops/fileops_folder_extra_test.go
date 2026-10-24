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
	err := WriteModelFolder("", "sub", "name", files)
	testutil.NotNil(t, err, "repoRoot 空应报错")
	err = WriteModelFolder(t.TempDir(), "", "", files)
	testutil.NotNil(t, err, "folderName 空应报错")
}

// 文件夹名为 . 或 .. 应拒绝（防止绕过模型文件夹抽象直接写入仓库根）
func TestWriteModelFolder_DotFolderName(t *testing.T) {
	files := []types.ImportFileItem{{RelPath: "ysm.json", Base64: b64(`{}`)}}
	for _, name := range []string{".", ".."} {
		err := WriteModelFolder(t.TempDir(), "", name, files)
		testutil.NotNil(t, err, "文件夹名 %q 应被拒绝", name)
	}
}

// 非法子路径（穿越）应拒绝
func TestWriteModelFolder_BadSubpath(t *testing.T) {
	files := []types.ImportFileItem{{RelPath: "ysm.json", Base64: b64(`{}`)}}
	err := WriteModelFolder(t.TempDir(), "..", "name", files)
	testutil.NotNil(t, err, "子路径 .. 应被拒绝")
}

// 文件 base64 解码失败：报错且已写的半成品目录被回滚
func TestWriteModelFolder_InvalidBase64(t *testing.T) {
	repo := t.TempDir()
	files := []types.ImportFileItem{
		{RelPath: "ysm.json", Base64: b64(`{"spec":1}`)},
		{RelPath: "main.json", Base64: "!!!"}, // 非法 base64
	}
	err := WriteModelFolder(repo, "", "模型A", files)
	testutil.NotNil(t, err, "base64 解码失败应报错")
	// 失败回滚：半成品目录不应残留（防「目标已存在」卡死重试）
	testutil.FileNotExists(t, filepath.Join(repo, "模型A"), "写入失败后模型目录应被回滚")
}

// writeModelFolderFiles：RelPath 为 "." 的条目应跳过（不写文件不报错）
func TestWriteModelFolderFiles_DotRelPathSkipped(t *testing.T) {
	dir := t.TempDir()
	dstRoot := filepath.Join(dir, "model")
	files := []types.ImportFileItem{{RelPath: ".", Base64: b64("x")}}
	err := writeModelFolderFiles(dstRoot, files)
	testutil.NoError(t, err, "'.' 条目应跳过不报错")
	testutil.FileNotExists(t, dstRoot, "'.' 条目不应创建目录")
}

// writeModelFolderFiles：路径越权（逃出 dstRoot）应拒绝
func TestWriteModelFolderFiles_EscapeRejected(t *testing.T) {
	dir := t.TempDir()
	files := []types.ImportFileItem{{RelPath: "../evil.ysm", Base64: b64("x")}}
	err := writeModelFolderFiles(filepath.Join(dir, "model"), files)
	testutil.NotNil(t, err, "路径越权应报错")
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
	err := writeModelFolderFiles(dstRoot, files)
	testutil.NotNil(t, err, "父路径组件为文件时应报错")
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
	err := writeModelFolderFiles(dstRoot, files)
	testutil.NotNil(t, err, "父目录为符号链接应拒绝写入")
	// 仓库外不应有穿透写入
	testutil.FileNotExists(t, filepath.Join(outside, "a.ysm"), "仓库外不应有穿透写入")
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
	err := writeModelFolderFiles(dstRoot, files)
	testutil.NotNil(t, err, "目标文件为符号链接应拒绝覆盖")
	// 外部文件内容应未被改写
	data, err := os.ReadFile(leak)
	testutil.NoError(t, err)
	testutil.Equal(t, string(data), "original", "外部文件不应被改写")
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
	err := WriteModelFolder(repo, "symdir/sub", "模型A", files)
	testutil.NotNil(t, err, "子路径中间段为符号链接应拒绝")
	// 仓库外不应有穿透写入
	testutil.FileNotExists(t, filepath.Join(outside, "sub", "模型A", "ysm.json"), "仓库外不应有穿透写入")
}

// WriteModelFolder 子路径带盘符前缀（`C:foo` 形态）→ 由**路径守卫**拒绝（2026-10-15 对齐 installer 口径）。
//
// 病灶：`C:foo` 在 Windows 上 filepath.IsAbs 返回 false、paths.HasTraversal 也不命中 → 原判定放行，
// 一路走到 MkdirAll 才炸在文件系统层（实测报「The directory name is invalid」——冒号在 Windows
// 文件名里非法）。⚠️ **不构成逃逸、也不造出「怪目录」**：初版锐评的「仓库里留下 C:foo 目录」推断
// 已被本用例证伪——该输入在守卫缺失时同样失败，只是错误来自 mkdir 底层。故本刀收益 = 错误清晰度
// + 与 installer.resolveFinalDst 的 VolumeName 口径同答。
//
// 判别力（防假绿灯）：断言错误来自**路径守卫**（含「子路径非法」）。撤掉 VolumeName 判定后，同一输入
// 仍会 err != nil，但错误变成 mkdir 底层报错 → 只有这条消息断言能抓住它。
// 非 Windows 平台 VolumeName 对 `C:foo` 返回空 → 用例按平台跳过（与 installer 侧同判）。
func TestWriteModelFolder_DrivePrefixSubpathRejected(t *testing.T) {
	if filepath.VolumeName("C:foo") == "" {
		t.Skip("本平台 VolumeName 不识别盘符前缀，该分支不可达")
	}
	repo := t.TempDir()
	files := []types.ImportFileItem{{RelPath: "ysm.json", Base64: b64(`{}`)}}
	err := WriteModelFolder(repo, "C:foo", "模型A", files)
	testutil.ErrorContains(t, err, "子路径非法", "子路径带盘符前缀应拒绝（与 installer.resolveFinalDst 同口径），且应由路径守卫拒绝")
	// 终态：不得在仓库内造出 C:foo 目录
	testutil.FileNotExists(t, filepath.Join(repo, "C:foo"), "拒绝后不得留下 C:foo 目录")
}
