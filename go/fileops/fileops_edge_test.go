// 对抗测试：fileops 路径安全边界——RemoveDir 零校验、FindPreviewImage 任意路径读、
// root="" 绕过写入函数、NUL 字节注入
package fileops

import (
	"os"
	"path/filepath"
	"testing"
)

// =====================================================================
// RemoveDir 零校验——CRITICAL
// =====================================================================

// ---------- 1. RemoveDir 接受相对路径穿越 ----------
func TestRemoveDir_RelativeTraversal(t *testing.T) {
	tmpDir := t.TempDir()
	inner := filepath.Join(tmpDir, "inner")
	os.MkdirAll(inner, 0755)
	os.WriteFile(filepath.Join(inner, "file.ysm"), []byte("test"), 0644)

	origWD, _ := os.Getwd()
	t.Cleanup(func() { _ = os.Chdir(origWD) })
	_ = os.Chdir(inner)

	err := RemoveDir("..")
	// 相对路径穿越无论由 RemoveDir 自身校验还是 OS 层拒绝，都必须失败
	if err == nil {
		t.Fatalf("BUG(INFO-TRAVERSAL): RemoveDir(\"..\") 未报错——父目录可能已被删除")
	}
	t.Logf("守卫: RemoveDir(\"..\") 被拒绝: %v", err)
}

// ---------- 2. RemoveDir 接受绝对路径 ----------
// KNOWN-DESIGN: RemoveDir 是底层删除原语,接受任意绝对路径是其 API 语义,
// root 归属校验在上层封装(MoveModelFile/CopyModelFile 在 fileops_test.go
// 有"仓库外源应被拒绝"断言)。此探针曾记录"接受任意绝对路径",非缺陷——
// 把它翻成断言等于断言与 API 设计相反的契约。
func TestRemoveDir_AbsolutePath(t *testing.T) {
	t.Skip("KNOWN-DESIGN: RemoveDir 接受任意绝对路径属底层原语语义,调用方负责 root 校验")
}

// ---------- 3. RemoveDir NUL 字节 ----------
func TestRemoveDir_NULByte(t *testing.T) {
	tmpDir := t.TempDir()
	os.MkdirAll(filepath.Join(tmpDir, "empty_subdir"), 0755)

	// NUL 字节注入——OS 层会拒绝，但 RemoveDir 自身无显式校验
	err := RemoveDir(tmpDir + "\x00" + "..\\evil")
	if err == nil {
		t.Fatalf("BUG(INFO-NUL): RemoveDir NUL 字节未报错（可能静默截断到其他目录）")
	}
	t.Logf("守卫: RemoveDir NUL 字节路径被拒绝: %v", err)
}

// =====================================================================
// FindPreviewImage 任意路径读——HIGH
// =====================================================================

// ---------- 4. FindPreviewImage 读取任意路径的 preview.png ----------
// KNOWN-DESIGN: FindPreviewImage 按设计从给定模型路径的同名目录读取 preview,
// 无 root 归属校验——路径由调用方（UI 预览流）传入。上层的模型路径均来自
// 仓库扫描结果。若后续引入任意路径预览入口,需在此补 root 校验。
func TestFindPreviewImage_ArbitraryPathRead(t *testing.T) {
	t.Skip("KNOWN-DESIGN: FindPreviewImage 按设计读取任意路径的 preview,调用方保证路径归属")
}

// ---------- 5. FindPreviewImage 空路径 ----------
func TestFindPreviewImage_EmptyPath(t *testing.T) {
	result := FindPreviewImage("")
	// filepath.Dir("") = "."，会从 CWD 查找预览图
	t.Logf("INFO(INFO-EMPTY): FindPreviewImage(\"\") 返回 %q（从 CWD 查找，无报错）", result)
}

// =====================================================================
// CreateDir root="" 绕过——HIGH
// =====================================================================

// ---------- 6. CreateDir root="" 拒绝 ----------
// 2026-09-07 关闭 KNOWN-DESIGN（待拍板→已定）：生产唯一调用方（app_files.go CreateDir）
// 恒传仓库根（a.ysmRoot() 非空），空 root 是畸形输入——按防御纵深显式拒绝，
// 杜绝退化到相对当前工作目录创建（原行为会污染 CWD）。
func TestCreateDir_EmptyRoot(t *testing.T) {
	if err := CreateDir("", "subdir"); err == nil {
		t.Fatal("CreateDir 空 root 应被拒绝（禁止退化到 CWD 创建）")
	}
	if err := CreateDir("   ", "subdir"); err == nil {
		t.Fatal("空白 root 应被拒绝")
	}
}

// =====================================================================
// RenameDir 无 oldPath 校验——MEDIUM
// =====================================================================

// ---------- 7. RenameDir 接受任意 oldPath ----------
// KNOWN-DESIGN: RenameDir 是重命名原语,接受任意 oldPath 为其 API 语义
// （fileops_test.go TestRenameDir_Ok 覆盖成功路径）。上层调用方保证
// 源路径的仓库归属。
func TestRenameDir_ArbitraryOldPath(t *testing.T) {
	t.Skip("KNOWN-DESIGN: RenameDir 接受任意 oldPath 属原语语义,调用方负责校验")
}

// =====================================================================
// ExtractPreviewTexture 任意路径读——HIGH
// =====================================================================

// ---------- 8. ExtractPreviewTexture 读取任意 .zip ----------
func TestExtractPreviewTexture_ArbitraryZipRead(t *testing.T) {
	tmpDir := t.TempDir()
	// 创建任意 .zip 文件（含 PNG）
	zipPath := filepath.Join(tmpDir, "arbitrary.zip")
	// 用合法 zip 写入
	f, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	// 写最小 zip 头部（PK + 无效 body——extractFirstPNGFromZip 返回 nil）
	f.Write([]byte("PK\x03\x04"))
	f.Close()

	// ExtractPreviewTexture 应接受此路径
	result := ExtractPreviewTexture(zipPath)
	t.Logf("INFO(INFO-ZIP): ExtractPreviewTexture 接受任意 .zip 路径, result=%q（无效 zip 返回空）", result)
}

// ---------- 9. ExtractPreviewTexture NUL 字节 ----------
func TestExtractPreviewTexture_NULByte(t *testing.T) {
	tmpDir := t.TempDir()
	badPath := filepath.Join(tmpDir, "file.ysm") + "\x00" + ".zip"
	result := ExtractPreviewTexture(badPath)
	if result != "" {
		t.Fatalf("BUG(INFO-NUL-TEX): ExtractPreviewTexture 接受 NUL 字节路径, result=%q", result)
	}
	t.Log("守卫: ExtractPreviewTexture NUL 路径返回空")
}
