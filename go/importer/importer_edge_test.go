// 对抗测试：importer 路径安全边界——sanitizePath NUL 字节、SimpleCopy 相对路径、
// DirectoryCopy 根目录绕过、空路径静默
package importer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// =====================================================================
// sanitizePath 安全边界
// =====================================================================

// ---------- 1. NUL 字节注入 ----------
func TestSanitizePath_NULByte(t *testing.T) {
	path := "safe/" + "\x00" + "..\\evil"
	cleaned, err := sanitizePath(path, "test")
	if err != nil {
		t.Logf("守卫: sanitizePath NUL 路径被拒绝: %v", err)
		return
	}
	// 未拒绝必须是干净路径——NUL 截断后的 ".." 逃逸片段不得残留
	if strings.Contains(cleaned, "..") || strings.Contains(cleaned, "\\") {
		t.Fatalf("BUG(NUL-1): sanitizePath 接受 NUL 截断后的逃逸片段, cleaned=%q", cleaned)
	}
	t.Logf("守卫: sanitizePath 返回已清理路径 %q", cleaned)
}

// ---------- 2. 空路径 ----------
func TestSanitizePath_EmptyPath(t *testing.T) {
	cleaned, err := sanitizePath("", "test")
	if err != nil {
		t.Logf("INFO(NUL-EMPTY): sanitizePath 拒绝空路径: %v", err)
		return
	}
	if cleaned == "." {
		t.Log("INFO(NUL-EMPTY): sanitizePath 将空路径归一化为 '.'（by design, filepath.Clean 语义）")
	}
}

// ---------- 3. 仅分隔符 ----------
func TestSanitizePath_OnlySeparator(t *testing.T) {
	cleaned, err := sanitizePath("/", "test")
	if err != nil {
		t.Logf("INFO(NUL-SEP): sanitizePath 拒绝纯分隔符: %v", err)
		return
	}
	t.Logf("INFO(NUL-SEP): sanitizePath 通过, cleaned=%q", cleaned)
}

// =====================================================================
// SimpleCopyImporter / DirectoryCopyImporter 边界
// =====================================================================

// ---------- 4. SimpleCopy 相对路径 ----------
func TestSimpleCopyImporter_RelativeSrc(t *testing.T) {
	tmpDir := t.TempDir()
	src := filepath.Join(tmpDir, "model.ysm")
	os.WriteFile(src, []byte("test"), 0644)
	dstDir := filepath.Join(tmpDir, "dest")

	importer := NewSimpleCopy("ysm")
	err := importer.Import(src, dstDir)
	if err != nil {
		t.Fatalf("SimpleCopyImporter 相对路径导入失败: %v", err)
	}
	if _, statErr := os.Stat(dstDir); statErr != nil {
		t.Fatalf("目标目录未创建: %v", statErr)
	}
	t.Log("守卫: 相对路径导入成功")
}

// ---------- 5. SimpleCopy 源为根目录（会触发 src 包含 dst 检测）----------
func TestSimpleCopyImporter_RootSrc(t *testing.T) {
	tmpDir := t.TempDir()
	dstDir := filepath.Join(tmpDir, "dest")

	importer := NewSimpleCopy("ysm")
	// tmpDir 是目录，Import 走目录导入路径。
	// copyDirRecursive(tmpDir, tmpDir/dest/<uuid>)——tmpDir 包含目标目录，
	// 若无守卫则死递归。修复后返回错误。
	err := importer.Import(tmpDir, dstDir)
	if err == nil {
		t.Fatal("copyDirRecursive 应检测到 src 包含 dst 并拒绝")
	}

}

// ---------- 6. SimpleCopy dstDir 与 src 同目录 ----------
func TestSimpleCopyImporter_SameDirSelfCopy(t *testing.T) {
	tmpDir := t.TempDir()
	src := filepath.Join(tmpDir, "model.ysm")
	os.WriteFile(src, []byte("test"), 0644)

	importer := NewSimpleCopy("ysm")
	// 目标目录与源文件同目录——复制后文件名应相同
	err := importer.Import(src, tmpDir)
	if err != nil {
		t.Fatalf("SimpleCopyImporter 同目录自拷贝失败: %v", err)
	}
	// 同目录复制不得破坏源文件
	if data, rErr := os.ReadFile(src); rErr != nil || string(data) != "test" {
		t.Fatalf("源文件被破坏: %v %q", rErr, string(data))
	}
	t.Log("守卫: 同目录自拷贝成功且源文件完好")
}

// =====================================================================
// DirectoryCopyImporter 边界
// =====================================================================

// ---------- 7. DirectoryCopy src 为不存在的文件 ----------
func TestDirectoryCopyImporter_NonExistentSrc(t *testing.T) {
	tmpDir := t.TempDir()
	dstDir := filepath.Join(tmpDir, "dest")

	importer := NewDirectoryCopy("ysm")
	err := importer.Import(filepath.Join(tmpDir, "nonexistent.ysm"), dstDir)
	if err == nil {
		t.Fatal("DirectoryCopyImporter 应报告不存在源")
	}

}

// ---------- 8. DirectoryCopy src 为子文件 ----------
func TestDirectoryCopyImporter_FileInsideDir(t *testing.T) {
	tmpDir := t.TempDir()
	modelDir := filepath.Join(tmpDir, "model")
	os.MkdirAll(modelDir, 0755)
	os.WriteFile(filepath.Join(modelDir, "data.json"), []byte("{}"), 0644)
	dstDir := filepath.Join(tmpDir, "dest")

	importer := NewDirectoryCopy("ysm")
	// srcPath 为 modelDir/data.json——应取父目录 modelDir 作为导入源
	err := importer.Import(filepath.Join(modelDir, "data.json"), dstDir)
	if err != nil {
		t.Fatalf("DirectoryCopyImporter 从子文件取父目录导入失败: %v", err)
	}
	if _, statErr := os.Stat(dstDir); statErr != nil {
		t.Fatalf("目标目录未创建: %v", statErr)
	}
	t.Log("守卫: 从子文件取父目录导入成功")
}

// ---------- 9. DirectoryCopy src 与目标相同（回归：src==dst 守卫）----------
// copyDir(modelDir, tmpDir) → targetDir = filepath.Join(tmpDir, "model") = modelDir
// 即 src == targetDir。若无 copyDir 入口守卫，源模型文件夹会被静默替换为自身副本
// （备份 rename → 删除备份，源 inode 被销毁）。修复后应返回错误。
func TestDirectoryCopyImporter_Import_SrcEqualsDst(t *testing.T) {
	tmpDir := t.TempDir()
	modelDir := filepath.Join(tmpDir, "model")
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "model.pmx"), []byte("pmx"), 0644); err != nil {
		t.Fatal(err)
	}

	importer := NewDirectoryCopy("EntityPlayer")
	// dstDir 为 modelDir 的父目录 → dstPath == srcDir
	err := importer.Import(modelDir, tmpDir)
	if err == nil {
		t.Fatal("DirectoryCopyImporter 应拒绝 src==dst（源与目标相同）")
	}
	// 源模型文件夹不得被破坏/替换
	if data, err := os.ReadFile(filepath.Join(modelDir, "model.pmx")); err != nil || string(data) != "pmx" {
		t.Fatalf("源模型目录不应被破坏: %v %q", err, string(data))
	}

}

// ---------- 10. DirectoryCopy 目标位于源文件夹内（dst 是 src 的后代）----------
// dstDir 在模型文件夹内 → dstPath 是 srcDir 的子路径，复制会递归进自身 → 拒绝
func TestDirectoryCopyImporter_Import_DstInsideSrc(t *testing.T) {
	tmpDir := t.TempDir()
	modelDir := filepath.Join(tmpDir, "model")
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "model.pmx"), []byte("pmx"), 0644); err != nil {
		t.Fatal(err)
	}

	importer := NewDirectoryCopy("EntityPlayer")
	dstDir := filepath.Join(modelDir, "imports")
	err := importer.Import(modelDir, dstDir)
	if err == nil {
		t.Fatal("DirectoryCopyImporter 应拒绝目标位于源文件夹内")
	}
	if data, err := os.ReadFile(filepath.Join(modelDir, "model.pmx")); err != nil || string(data) != "pmx" {
		t.Fatalf("源模型目录不应被破坏: %v %q", err, string(data))
	}
}

// ---------- 11. copyDir 直调 src==dst 守卫 ----------
func TestCopyDir_SrcEqualsDst(t *testing.T) {
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("aaa"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := copyDir(src, src); err == nil {
		t.Fatal("copyDir(src, src) 应拒绝")
	}
	if data, err := os.ReadFile(filepath.Join(src, "a.txt")); err != nil || string(data) != "aaa" {
		t.Fatalf("源目录不应被替换/破坏: %v %q", err, string(data))
	}
}
