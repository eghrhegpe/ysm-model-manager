package texture_cache

import (
	"os"
	"path/filepath"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

func TestTextureHash(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.png")
	if err := os.WriteFile(path, []byte("hello world"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	hash, err := TextureHash(path)
	testutil.NoError(t, err)
	if hash == "" {
		t.Fatal("expected non-empty hash")
	}
	// SHA256 of "hello world"
	const expected = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
	if hash != expected {
		t.Fatalf("hash mismatch: got %s, want %s", hash, expected)
	}
}

func TestTextureHash_FileNotFound(t *testing.T) {
	_, err := TextureHash("/nonexistent/file.png")
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestCacheDir(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	CacheDir = func() string { return t.TempDir() }
	dir := CacheDir()
	if dir == "" {
		t.Fatal("expected non-empty cache dir")
	}
}

func TestCacheDir_Empty(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	CacheDir = func() string { return "" }
	path := CachePath("abc123")
	if path != "" {
		t.Fatal("expected empty path when cache dir is empty")
	}
}

func TestCachePath(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	CacheDir = func() string { return dir }

	path := CachePath("abc123")
	expected := filepath.Join(dir, "abc123.ktx2")
	if path != expected {
		t.Fatalf("path mismatch: got %s, want %s", path, expected)
	}
}

func TestWriteAndReadCached(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	CacheDir = func() string { return dir }

	hash := "testhash123"
	data := []byte("ktx2 test data")

	if err := WriteCached(hash, data); err != nil {
		testutil.NoError(t, err)
	}

	read, ok, err := ReadCached(hash)
	testutil.NoError(t, err)
	if !ok {
		t.Fatal("expected cache hit")
	}
	if string(read) != string(data) {
		t.Fatalf("data mismatch: got %s, want %s", string(read), string(data))
	}
}

func TestReadCached_Miss(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	CacheDir = func() string { return dir }

	_, ok, err := ReadCached("nonexistent")
	testutil.NoError(t, err)
	if ok {
		t.Fatal("expected cache miss")
	}
}

func TestHasCached(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	CacheDir = func() string { return dir }

	hash := "existshash"
	// Write a file manually
	os.WriteFile(filepath.Join(dir, hash+".ktx2"), []byte("data"), 0644)

	exists, err := HasCached(hash)
	testutil.NoError(t, err)
	if !exists {
		t.Fatal("expected cache to exist")
	}

	exists, err = HasCached("nope")
	testutil.NoError(t, err)
	if exists {
		t.Fatal("expected cache to not exist")
	}
}

func TestClearCache(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	CacheDir = func() string { return dir }

	// Write a few cache files
	for _, h := range []string{"a", "b", "c"} {
		os.WriteFile(filepath.Join(dir, h+".ktx2"), []byte("data"), 0644)
	}
	// Also write a non-cache file (should be cleared too)
	os.WriteFile(filepath.Join(dir, "other.txt"), []byte("data"), 0644)

	if err := ClearCache(); err != nil {
		testutil.NoError(t, err)
	}

	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("expected empty cache dir, got %d entries", len(entries))
	}
}

func TestWriteCached_Atomic(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	CacheDir = func() string { return dir }

	hash := "atomictest"
	data := []byte("atomic write test data")

	if err := WriteCached(hash, data); err != nil {
		testutil.NoError(t, err)
	}

	// Verify no .tmp file remains
	tmpPath := filepath.Join(dir, hash+".ktx2.tmp")
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Fatal("expected temp file to be cleaned up")
	}

	// Verify data is correct
	read, ok, _ := ReadCached(hash)
	if !ok || string(read) != string(data) {
		t.Fatal("data mismatch after atomic write")
	}
}

func TestListCacheFiles_Empty(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	CacheDir = func() string { return dir }

	files, err := ListCacheFiles()
	testutil.NoError(t, err)
	if len(files) != 0 {
		t.Fatalf("expected 0 files, got %d", len(files))
	}
}

func TestListCacheFiles_WithFiles(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	CacheDir = func() string { return dir }

	// Write some cache files
	os.WriteFile(filepath.Join(dir, "hash1.ktx2"), []byte("data123"), 0644)
	os.WriteFile(filepath.Join(dir, "hash2.ktx2"), []byte("data4567"), 0644)
	// Write a non-cache file (should be ignored)
	os.WriteFile(filepath.Join(dir, "other.txt"), []byte("ignore"), 0644)

	files, err := ListCacheFiles()
	testutil.NoError(t, err)
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}

	// Verify file details
	for _, f := range files {
		if f.Hash == "" {
			t.Fatal("expected non-empty hash")
		}
		if f.Size <= 0 {
			t.Fatal("expected positive size")
		}
	}
}

func TestListCacheFiles_EmptyDir(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	CacheDir = func() string { return "" }

	files, err := ListCacheFiles()
	testutil.NoError(t, err)
	if files != nil {
		t.Fatal("expected nil when cache dir is empty")
	}
}

func TestGetCacheStats_Empty(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	CacheDir = func() string { return dir }

	stats := GetCacheStats()
	if stats.Dir != dir {
		t.Fatalf("expected dir %s, got %s", dir, stats.Dir)
	}
	if stats.FileCount != 0 {
		t.Fatalf("expected 0 files, got %d", stats.FileCount)
	}
	if stats.TotalSize != 0 {
		t.Fatalf("expected 0 total size, got %d", stats.TotalSize)
	}
}

func TestGetCacheStats_WithFiles(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	CacheDir = func() string { return dir }

	// Write cache files of known sizes
	os.WriteFile(filepath.Join(dir, "hash1.ktx2"), []byte("12345"), 0644)      // 5 bytes
	os.WriteFile(filepath.Join(dir, "hash2.ktx2"), []byte("1234567890"), 0644) // 10 bytes
	// Non-cache file should be ignored
	os.WriteFile(filepath.Join(dir, "other.txt"), []byte("ignored"), 0644)

	stats := GetCacheStats()
	if stats.FileCount != 2 {
		t.Fatalf("expected 2 files, got %d", stats.FileCount)
	}
	if stats.TotalSize != 15 { // 5 + 10 = 15
		t.Fatalf("expected 15 total size, got %d", stats.TotalSize)
	}
}

func TestGetCacheStats_EmptyDir(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	CacheDir = func() string { return "" }

	stats := GetCacheStats()
	if stats.Dir != "" {
		t.Fatal("expected empty dir")
	}
	if stats.FileCount != 0 {
		t.Fatalf("expected 0 files, got %d", stats.FileCount)
	}
}
