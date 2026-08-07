package tags

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func TestNewStore(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	if s == nil {
		t.Fatal("NewStore returned nil")
	}
	if s.path != filepath.Join(dir, "tags.json") {
		t.Errorf("unexpected path: %s", s.path)
	}
}

func TestSetAndGetTags(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)

	err := s.SetTags("/path/to/model", []string{"tag1", "tag2"})
	if err != nil {
		t.Fatalf("SetTags failed: %v", err)
	}

	tags, err := s.GetTags("/path/to/model")
	if err != nil {
		t.Fatalf("GetTags failed: %v", err)
	}
	if len(tags) != 2 || tags[0] != "tag1" || tags[1] != "tag2" {
		t.Errorf("unexpected tags: %v", tags)
	}
}

func TestSetTagsDedup(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)

	s.SetTags("/path", []string{"a", "b", "a", "c", "b"})
	tags, _ := s.GetTags("/path")
	if len(tags) != 3 {
		t.Errorf("expected 3 unique tags, got %v", tags)
	}
	if !sort.StringsAreSorted(tags) {
		t.Errorf("tags not sorted: %v", tags)
	}
}

func TestSetTagsEmptyRemoves(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)

	s.SetTags("/path", []string{"a", "b"})
	s.SetTags("/path", []string{})
	tags, _ := s.GetTags("/path")
	if len(tags) != 0 {
		t.Errorf("expected empty tags after setting empty list, got %v", tags)
	}
}

func TestAddTag(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)

	s.AddTag("/path", "tag1")
	s.AddTag("/path", "tag2")
	s.AddTag("/path", "tag1") // duplicate

	tags, _ := s.GetTags("/path")
	if len(tags) != 2 {
		t.Errorf("expected 2 tags, got %v", tags)
	}
}

func TestRemoveTag(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)

	s.SetTags("/path", []string{"a", "b", "c"})
	s.RemoveTag("/path", "b")

	tags, _ := s.GetTags("/path")
	if len(tags) != 2 || tags[0] != "a" || tags[1] != "c" {
		t.Errorf("unexpected tags after removal: %v", tags)
	}
}

func TestListByTag(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)

	s.SetTags("/a", []string{"x"})
	s.SetTags("/b", []string{"x", "y"})
	s.SetTags("/c", []string{"y"})

	paths, err := s.ListByTag("x")
	if err != nil {
		t.Fatalf("ListByTag failed: %v", err)
	}
	if len(paths) != 2 || paths[0] != "/a" || paths[1] != "/b" {
		t.Errorf("unexpected paths for tag x: %v", paths)
	}
}

func TestAllTags(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)

	s.SetTags("/a", []string{"x", "y"})
	s.SetTags("/b", []string{"x"})
	s.SetTags("/c", []string{"z"})

	all, err := s.AllTags()
	if err != nil {
		t.Fatalf("AllTags failed: %v", err)
	}
	// x appears twice, y once, z once → x first
	if len(all) != 3 || all[0] != "x" {
		t.Errorf("unexpected tags order: %v (want x first)", all)
	}
}

func TestTrimTag(t *testing.T) {
	if got := trimTag("  hello  "); got != "hello" {
		t.Errorf("trimTag('  hello  ') = %q, want 'hello'", got)
	}
	if got := trimTag(""); got != "" {
		t.Errorf("trimTag('') = %q, want ''", got)
	}
}

func TestPersistenceAcrossStores(t *testing.T) {
	dir := t.TempDir()
	s1 := NewStore(dir)
	s1.SetTags("/persist", []string{"saved"})

	// New store instance reading same file
	s2 := NewStore(dir)
	tags, _ := s2.GetTags("/persist")
	if len(tags) != 1 || tags[0] != "saved" {
		t.Errorf("tags not persisted: %v", tags)
	}
}

func TestNoFileOnFirstUse(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	tags, err := s.GetTags("/nonexistent")
	if err != nil {
		t.Fatalf("GetTags on fresh store failed: %v", err)
	}
	if len(tags) != 0 {
		t.Errorf("expected empty tags, got %v", tags)
	}
	// Verify no file was created by GetTags alone
	if _, err := os.Stat(s.path); err == nil {
		t.Error("tags.json should not exist before first SetTags")
	}
}

// P3 修复（code_review）：损坏 tags.json → 备份 .corrupt + 重建空存储，写路径可恢复
func TestCorruptFileRecovers(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	// 先写一个损坏的 tags.json
	if err := os.WriteFile(s.path, []byte("{not valid json"), 0644); err != nil {
		t.Fatal(err)
	}
	// 读应不报错（已备份重建），返回空
	tags, err := s.GetTags("/m")
	if err != nil {
		t.Fatalf("GetTags after corrupt should not error: %v", err)
	}
	if len(tags) != 0 {
		t.Errorf("expected empty tags after corrupt recovery, got %v", tags)
	}
	// 备份文件存在
	if _, err := os.Stat(s.path + ".corrupt"); err != nil {
		t.Errorf("corrupt backup missing: %v", err)
	}
	// 写路径可恢复：SetTags 后能读回
	if err := s.SetTags("/m", []string{"new"}); err != nil {
		t.Fatalf("SetTags after corrupt failed: %v", err)
	}
	tags, _ = s.GetTags("/m")
	if len(tags) != 1 || tags[0] != "new" {
		t.Errorf("tags not recovered after SetTags: %v", tags)
	}
}

// P3 修复（code_review）：SetTags 全空白串应删除条目而非写空数组
func TestSetTagsWhitespaceOnlyDeletes(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	s.SetTags("/m", []string{"a", "b"})
	if err := s.SetTags("/m", []string{"  ", " "}); err != nil {
		t.Fatalf("SetTags whitespace-only failed: %v", err)
	}
	tags, _ := s.GetTags("/m")
	if len(tags) != 0 {
		t.Errorf("whitespace-only SetTags should delete entry, got %v", tags)
	}
}

// P3 修复（code_review）：AddTag 后保持存储排序不变量
func TestAddTagKeepsSorted(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	s.SetTags("/m", []string{"zeta", "alpha"})
	if err := s.AddTag("/m", "middle"); err != nil {
		t.Fatalf("AddTag failed: %v", err)
	}
	tags, _ := s.GetTags("/m")
	want := []string{"alpha", "middle", "zeta"}
	for i := range want {
		if tags[i] != want[i] {
			t.Fatalf("tags not sorted after AddTag: %v (want %v)", tags, want)
		}
	}
}

// P3 修复（code_review）：save 原子写后无 .tmp 残留
func TestSaveLeavesNoTmp(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	if err := s.SetTags("/m", []string{"x"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.path + ".tmp"); err == nil {
		t.Error("tags.json.tmp should not remain after save")
	}
}
