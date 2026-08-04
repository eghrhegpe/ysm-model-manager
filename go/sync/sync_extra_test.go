// ===== go/sync 补充单测（纯函数/文件操作）=====
package sync

import (
	"os"
	"path/filepath"
	"testing"

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
	if !isSyncAllowed("model.ysm") {
		t.Error("model.ysm should be allowed")
	}
	if !isSyncAllowed("model.ysm.ban") {
		t.Error("model.ysm.ban should be allowed")
	}
	if !isSyncAllowed("model.ysm.disabled") {
		t.Error("model.ysm.disabled should be allowed")
	}
}

func TestIsSyncAllowed_Zip7z(t *testing.T) {
	if !isSyncAllowed("model.zip") {
		t.Error("model.zip should be allowed")
	}
	if !isSyncAllowed("model.7z") {
		t.Error("model.7z should be allowed")
	}
}

func TestIsSyncAllowed_YsmJson(t *testing.T) {
	if !isSyncAllowed("ysm.json") {
		t.Error("ysm.json should be allowed")
	}
}

func TestIsSyncAllowed_OtherJson(t *testing.T) {
	if isSyncAllowed("animation.json") {
		t.Error("animation.json should NOT be allowed")
	}
	if isSyncAllowed("model.geo.json") {
		t.Error("model.geo.json should NOT be allowed")
	}
	if isSyncAllowed("controller.json") {
		t.Error("controller.json should NOT be allowed")
	}
}

func TestIsSyncAllowed_UnsupportedExt(t *testing.T) {
	if isSyncAllowed("readme.txt") {
		t.Error(".txt should NOT be allowed")
	}
	if isSyncAllowed("") {
		t.Error("empty string should NOT be allowed")
	}
}

// ====== isResourcePackFolder ======

func TestIsResourcePackFolder_Yes(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "pack.mcmeta"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if !isResourcePackFolder(dir) {
		t.Error("dir with pack.mcmeta should be a resource pack folder")
	}
}

func TestIsResourcePackFolder_No(t *testing.T) {
	dir := t.TempDir()
	if isResourcePackFolder(dir) {
		t.Error("dir without pack.mcmeta should NOT be a resource pack folder")
	}
}

func TestIsResourcePackFolder_NonExistent(t *testing.T) {
	if isResourcePackFolder("/nonexistent/path") {
		t.Error("non-existent dir should NOT be a resource pack folder")
	}
}

// ====== isModelFile ======

func TestIsModelFile_Ysm(t *testing.T) {
	if !isModelFile("model.ysm", "ysm") {
		t.Error("model.ysm should be ysm model")
	}
	if !isModelFile("model.zip", "ysm") {
		t.Error("model.zip should be ysm model")
	}
	if !isModelFile("model.7z", "ysm") {
		t.Error("model.7z should be ysm model")
	}
	if !isModelFile("ysm.json", "ysm") {
		t.Error("ysm.json should be ysm model")
	}
}

func TestIsModelFile_YsmNegative(t *testing.T) {
	if isModelFile("readme.txt", "ysm") {
		t.Error(".txt should NOT be ysm model")
	}
	if isModelFile("model.pmx", "ysm") {
		t.Error(".pmx should NOT be ysm model")
	}
}

func TestIsModelFile_MmdSkin(t *testing.T) {
	if !isModelFile("model.pmx", "mmd-skin") {
		t.Error(".pmx should be mmd-skin model")
	}
	if !isModelFile("model.pmd", "mmd-skin") {
		t.Error(".pmd should be mmd-skin model")
	}
}

func TestIsModelFile_MmdSkinNegative(t *testing.T) {
	if isModelFile("model.ysm", "mmd-skin") {
		t.Error(".ysm should NOT be mmd-skin model")
	}
}

func TestIsModelFile_UnknownType(t *testing.T) {
	if isModelFile("model.ysm", "unknown") {
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
	if lt == types.LinkUnknown {
		t.Logf("regular file link type: %v", lt)
	}
}

// ====== GetInstanceStatus ======

func TestGetInstanceStatus_EmptyPathsExtra(t *testing.T) {
	// 空路径应返回空切片
	scanFn := func(dir string) []types.ModelEntry { return nil }
	result := GetInstanceStatus("", "", scanFn)
	if len(result) != 0 {
		t.Errorf("empty paths should return empty, got %d", len(result))
	}
}