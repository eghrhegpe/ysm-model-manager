package dedup

import (
	"path/filepath"
	"sort"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

func TestFindDuplicateFiles_NoDupes(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "a.txt", "alpha")
	testutil.CreateTestFile(t, dir, "b.txt", "beta")
	testutil.CreateTestFile(t, dir, "c.txt", "gamma")

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
	testutil.CreateTestFile(t, dir, "a.txt", "same content")
	testutil.CreateTestFile(t, dir, "b.txt", "same content")
	testutil.CreateTestFile(t, dir, "c.txt", "different")

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
	testutil.CreateTestFile(t, dir, "a.txt", "content A")
	testutil.CreateTestFile(t, dir, "b.txt", "content A")
	testutil.CreateTestFile(t, dir, "c.txt", "content B")
	testutil.CreateTestFile(t, dir, "d.txt", "content B")

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
	testutil.CreateTestFile(t, dir, "keep.txt", "keep me")
	testutil.CreateTestFile(t, recycleDir, "dup.txt", "duplicate")
	testutil.CreateTestFile(t, recycleDir, "dup2.txt", "duplicate")

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
	testutil.CreateTestFile(t, dir, "a.txt", "same")
	testutil.CreateTestFile(t, dir, "b.txt", "same")
	testutil.CreateTestFile(t, dir, "c.txt", "same")
	testutil.CreateTestFile(t, dir, "d.txt", "unique")

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
	testutil.CreateTestFile(t, dir, "z.txt", "same")
	testutil.CreateTestFile(t, dir, "a.txt", "same")

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
