// ===== go/sync 补充单测（纯函数/文件操作）=====
package sync

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/types"
)

// ====== computeHash ======

func TestComputeHash_Valid(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	if err := os.WriteFile(path, []byte("hello world"), 0644); err != nil {
		t.Fatal(err)
	}
	h := computeHash(path)
	if h == "" {
		t.Fatal("hash should not be empty")
	}
	if len(h) != 64 {
		t.Errorf("SHA256 hex should be 64 chars, got %d", len(h))
	}
}

func TestComputeHash_NonExistent(t *testing.T) {
	h := computeHash("/nonexistent/path")
	if h != "" {
		t.Errorf("non-existent file should return empty, got %q", h)
	}
}

func TestComputeHash_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.txt")
	if err := os.WriteFile(path, []byte{}, 0644); err != nil {
		t.Fatal(err)
	}
	h := computeHash(path)
	if h == "" {
		t.Fatal("empty file should still produce a hash")
	}
}

// ====== isSyncAllowed ======

func TestIsSyncAllowed_Ysm(t *testing.T) {
	if !types.IsResourceAllowed("model.ysm") {
		t.Error("model.ysm should be allowed")
	}
	if !types.IsResourceAllowed("model.ysm.ban") {
		t.Error("model.ysm.ban should be allowed")
	}
	if !types.IsResourceAllowed("model.ysm.disabled") {
		t.Error("model.ysm.disabled should be allowed")
	}
}

func TestIsSyncAllowed_Zip7z(t *testing.T) {
	if !types.IsResourceAllowed("model.zip") {
		t.Error("model.zip should be allowed")
	}
	if !types.IsResourceAllowed("model.7z") {
		t.Error("model.7z should be allowed")
	}
}

func TestIsSyncAllowed_YsmJson(t *testing.T) {
	if !types.IsResourceAllowed("ysm.json") {
		t.Error("ysm.json should be allowed")
	}
}

func TestIsSyncAllowed_OtherJson(t *testing.T) {
	if types.IsResourceAllowed("animation.json") {
		t.Error("animation.json should NOT be allowed")
	}
	if types.IsResourceAllowed("model.geo.json") {
		t.Error("model.geo.json should NOT be allowed")
	}
	if types.IsResourceAllowed("controller.json") {
		t.Error("controller.json should NOT be allowed")
	}
}

func TestIsSyncAllowed_UnsupportedExt(t *testing.T) {
	if types.IsResourceAllowed("readme.txt") {
		t.Error(".txt should NOT be allowed")
	}
	if types.IsResourceAllowed("") {
		t.Error("empty string should NOT be allowed")
	}
}

// ====== fsutil.IsResourcePackFolder（已收敛至 fsutil 包测试，见 walk_test.go） ======

// ====== isModelFile ======

func TestIsModelFile_Ysm(t *testing.T) {
	if !packs.IsTypeModelFile("model.ysm", "ysm") {
		t.Error("model.ysm should be ysm model")
	}
	if !packs.IsTypeModelFile("model.zip", "ysm") {
		t.Error("model.zip should be ysm model")
	}
	if !packs.IsTypeModelFile("model.7z", "ysm") {
		t.Error("model.7z should be ysm model")
	}
	if !packs.IsTypeModelFile("ysm.json", "ysm") {
		t.Error("ysm.json should be ysm model")
	}
}

func TestIsModelFile_YsmNegative(t *testing.T) {
	if packs.IsTypeModelFile("readme.txt", "ysm") {
		t.Error(".txt should NOT be ysm model")
	}
	if packs.IsTypeModelFile("model.pmx", "ysm") {
		t.Error(".pmx should NOT be ysm model")
	}
}

func TestIsModelFile_EntityPlayer(t *testing.T) {
	if !packs.IsTypeModelFile("model.pmx", "EntityPlayer") {
		t.Error(".pmx should be EntityPlayer model")
	}
	if !packs.IsTypeModelFile("model.pmd", "EntityPlayer") {
		t.Error(".pmd should be EntityPlayer model")
	}
	// EntityPlayer 是 zipentry 检测器类型：.zip 必须内装 .pmx/.pmd 才算模型，
	// 纯 .zip 文件名不再直判（否则同步推送会搬运坏包/纯打包物）。
	zipPath := writeEntityPlayerZip(t)
	if !packs.IsTypeModelFile(zipPath, "EntityPlayer") {
		t.Error("内装 .pmx 的 .zip 应识别为 EntityPlayer 模型")
	}
	if packs.IsTypeModelFile(filepath.Join(t.TempDir(), "plain.zip"), "EntityPlayer") {
		t.Error("空/纯打包 .zip 不得识别为 EntityPlayer 模型")
	}
}

// writeEntityPlayerZip 造一个内装 model.pmx 的 zip（模拟玩家打包的 MMD 模型）。
func writeEntityPlayerZip(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "model.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	w, err := zw.Create("model.pmx")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("pmx")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestIsModelFile_EntityPlayerNegative(t *testing.T) {
	if packs.IsTypeModelFile("model.ysm", "EntityPlayer") {
		t.Error(".ysm should NOT be EntityPlayer model")
	}
}

func TestIsModelFile_UnknownType(t *testing.T) {
	if packs.IsTypeModelFile("model.ysm", "unknown") {
		t.Error("unknown type should return false")
	}
}

// ====== isDirTypeModelFolder ======

func TestIsDirTypeModelFolder_Yes(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "model.ysm"), []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	if !isDirTypeModelFolder(dir, "ysm") {
		t.Error("dir with .ysm should be ysm model folder")
	}
}

func TestIsDirTypeModelFolder_No(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "readme.txt"), []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	if isDirTypeModelFolder(dir, "ysm") {
		t.Error("dir without model files should NOT be model folder")
	}
}

func TestIsDirTypeModelFolder_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	if isDirTypeModelFolder(dir, "ysm") {
		t.Error("empty dir should NOT be model folder")
	}
}

func TestIsDirTypeModelFolder_NonExistent(t *testing.T) {
	if isDirTypeModelFolder("/nonexistent/path", "ysm") {
		t.Error("non-existent dir should NOT be model folder")
	}
}

// ====== SortEntries ======

func TestSortEntries(t *testing.T) {
	entries := []types.ModelEntry{
		{Name: "z_model.ysm", Path: "/a/z.ysm"},
		{Name: "a_model.ysm", Path: "/a/a.ysm"},
		{Name: "m_model.ysm", Path: "/a/m.ysm"},
	}
	SortEntries(entries)
	if entries[0].Name != "a_model.ysm" {
		t.Errorf("first should be a_model.ysm, got %q", entries[0].Name)
	}
	if entries[1].Name != "m_model.ysm" {
		t.Errorf("second should be m_model.ysm, got %q", entries[1].Name)
	}
	if entries[2].Name != "z_model.ysm" {
		t.Errorf("third should be z_model.ysm, got %q", entries[2].Name)
	}
}

func TestSortEntries_Empty(t *testing.T) {
	// should not panic
	SortEntries(nil)
	SortEntries([]types.ModelEntry{})
}

// ====== GetLinkType ======

func TestGetLinkType_NonExistent(t *testing.T) {
	lt := GetLinkType("/nonexistent/path")
	if lt != types.LinkUnknown {
		t.Errorf("non-existent should return LinkUnknown, got %v", lt)
	}
}

func TestGetLinkType_RegularFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "regular.txt")
	if err := os.WriteFile(path, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	lt := GetLinkType(path)
	// 原 `if lt == LinkUnknown { t.Logf(...) }` 永不失败——
	// 普通文件应走 fsutil.IsHardLink 返回 LinkCopy，硬断言
	if lt != types.LinkCopy {
		t.Errorf("regular file link type = %v, 期望 %v", lt, types.LinkCopy)
	}
}

// ====== GetInstanceStatus ======

func TestGetInstanceStatus_EmptyPathsExtra(t *testing.T) {
	// 空路径应返回空切片
	scanFn := func(dir string) []types.ModelEntry { return nil }
	result := GetInstanceStatus("", "", "", scanFn)
	if len(result) != 0 {
		t.Errorf("empty paths should return empty, got %d", len(result))
	}
}
