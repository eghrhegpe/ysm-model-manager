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
