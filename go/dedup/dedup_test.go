package dedup

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func createTestFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestFindDuplicateFiles_NoDupes(t *testing.T) {
	dir := t.TempDir()
	createTestFile(t, dir, "a.txt", "alpha")
	createTestFile(t, dir, "b.txt", "beta")
	createTestFile(t, dir, "c.txt", "gamma")

	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 0 {
		t.Errorf("期望 0 组重复，得到 %d 组", len(groups))
	}
}

func TestFindDuplicateFiles_WithDupes(t *testing.T) {
	dir := t.TempDir()
	createTestFile(t, dir, "a.txt", "same content")
	createTestFile(t, dir, "b.txt", "same content")
	createTestFile(t, dir, "c.txt", "different")

	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 {
		t.Fatalf("期望 1 组重复，得到 %d 组", len(groups))
	}
	if len(groups[0].Files) != 2 {
		t.Errorf("期望组内有 2 个文件，得到 %d 个", len(groups[0].Files))
	}
}

func TestFindDuplicateFiles_MultipleGroups(t *testing.T) {
	dir := t.TempDir()
	createTestFile(t, dir, "a.txt", "content A")
	createTestFile(t, dir, "b.txt", "content A")
	createTestFile(t, dir, "c.txt", "content B")
	createTestFile(t, dir, "d.txt", "content B")

	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 2 {
		t.Fatalf("期望 2 组重复，得到 %d 组", len(groups))
	}
}

func TestFindDuplicateFiles_SkipRecycle(t *testing.T) {
	dir := t.TempDir()
	recycleDir := filepath.Join(dir, ".recycle")
	createTestFile(t, dir, "keep.txt", "keep me")
	createTestFile(t, recycleDir, "dup.txt", "duplicate")
	createTestFile(t, recycleDir, "dup2.txt", "duplicate")

	// skipRecycle = true
	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	// 只有 keep.txt 一个文件，没有重复
	if len(groups) != 0 {
		t.Errorf("skipRecycle=true 时不应检测回收站内的重复，得到 %d 组", len(groups))
	}

	// skipRecycle = false
	groups2, err := FindDuplicateFiles(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups2) != 1 {
		t.Errorf("skipRecycle=false 时应检测到回收站内的重复，得到 %d 组", len(groups2))
	}
}

func TestCountDuplicates(t *testing.T) {
	dir := t.TempDir()
	createTestFile(t, dir, "a.txt", "same")
	createTestFile(t, dir, "b.txt", "same")
	createTestFile(t, dir, "c.txt", "same")
	createTestFile(t, dir, "d.txt", "unique")

	groups, extra, err := CountDuplicates(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if groups != 1 {
		t.Errorf("期望 1 组重复，得到 %d", groups)
	}
	if extra != 2 {
		t.Errorf("期望 2 个多余文件，得到 %d", extra)
	}
}

func TestFindDuplicateFiles_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 0 {
		t.Errorf("空目录应返回 0 组，得到 %d", len(groups))
	}
}

func TestFindDuplicateFiles_SortedOutput(t *testing.T) {
	dir := t.TempDir()
	createTestFile(t, dir, "z.txt", "same")
	createTestFile(t, dir, "a.txt", "same")

	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 {
		t.Fatalf("期望 1 组重复，得到 %d 组", len(groups))
	}
	// 验证按路径排序
	paths := make([]string, len(groups[0].Files))
	for i, f := range groups[0].Files {
		paths[i] = f.Path
	}
	if !sort.StringsAreSorted(paths) {
		t.Errorf("文件路径未排序: %v", paths)
	}
}
