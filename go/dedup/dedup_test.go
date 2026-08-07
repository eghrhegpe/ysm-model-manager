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

// ====== CleanEmptyDirs ======

func TestCleanEmptyDirs_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "empty")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	removed, err := CleanEmptyDirs(dir)
	if err != nil {
		t.Fatal(err)
	}
	// P2 修复后：根目录自身永不删除（只删空子目录）→ 仅 empty 1 个
	if removed != 1 {
		t.Errorf("期望删除 1 个空子目录（根不删），得到 %d", removed)
	}
}

func TestCleanEmptyDirs_NestedEmpty(t *testing.T) {
	dir := t.TempDir()
	nested := filepath.Join(dir, "a", "b", "c")
	if err := os.MkdirAll(nested, 0755); err != nil {
		t.Fatal(err)
	}
	removed, err := CleanEmptyDirs(dir)
	if err != nil {
		t.Fatal(err)
	}
	// P2 修复后：删除 c → b → a 共 3 个，根 dir 自身不删
	if removed != 3 {
		t.Errorf("期望删除 3 个嵌套空子目录（根不删），得到 %d", removed)
	}
}

func TestCleanEmptyDirs_NonEmpty(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "sub")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	createTestFile(t, sub, "file.txt", "content")
	removed, err := CleanEmptyDirs(dir)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 0 {
		t.Errorf("非空目录不应被删除，得到 %d", removed)
	}
}

func TestCleanEmptyDirs_Mixed(t *testing.T) {
	dir := t.TempDir()
	// 结构: dir/sub1/empty1, dir/sub2/file.txt, dir/sub3/empty2
	sub1 := filepath.Join(dir, "sub1", "empty1")
	if err := os.MkdirAll(sub1, 0755); err != nil {
		t.Fatal(err)
	}
	sub2 := filepath.Join(dir, "sub2")
	if err := os.MkdirAll(sub2, 0755); err != nil {
		t.Fatal(err)
	}
	createTestFile(t, sub2, "file.txt", "data")
	sub3 := filepath.Join(dir, "sub3", "empty2", "empty3")
	if err := os.MkdirAll(sub3, 0755); err != nil {
		t.Fatal(err)
	}
	removed, err := CleanEmptyDirs(dir)
	if err != nil {
		t.Fatal(err)
	}
	// sub1/empty1(1) → sub1(2) → sub3/empty3(3) → empty2(4) → sub3(5) → 共 5 个
	if removed != 5 {
		t.Errorf("期望删除 5 个空目录，得到 %d", removed)
	}
}

func TestCleanEmptyDirs_EmptyPath(t *testing.T) {
	_, err := CleanEmptyDirs("")
	if err == nil {
		t.Fatal("空路径应报错")
	}
}

func TestCleanEmptyDirs_NonExistent(t *testing.T) {
	removed, err := CleanEmptyDirs("/nonexistent/path")
	if err != nil {
		t.Fatal("不存在的目录不应报错")
	}
	if removed != 0 {
		t.Errorf("不存在的目录应返回 0，得到 %d", removed)
	}
}
