package texture_cache

import (
	"os"
	"path/filepath"
	"strings"
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
	testutil.Equal(t, hash != "", true, "expected non-empty hash")
	// SHA256 of "hello world"
	const expected = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
	testutil.Equal(t, hash, expected, "hash mismatch")
}

func TestTextureHash_FileNotFound(t *testing.T) {
	_, err := TextureHash("/nonexistent/file.png")
	testutil.NotNil(t, err, "expected error for nonexistent file")
}

func TestCacheDir(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	CacheDir = func() string { return t.TempDir() }
	dir := CacheDir()
	testutil.Equal(t, dir != "", true, "expected non-empty cache dir")
}

func TestCacheDir_Empty(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	CacheDir = func() string { return "" }
	path := CachePath("abc123")
	testutil.Equal(t, path, "", "expected empty path when cache dir is empty")
}

func TestCachePath(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	CacheDir = func() string { return dir }

	path := CachePath("abc123")
	expected := filepath.Join(dir, "abc123.ktx2")
	testutil.Equal(t, path, expected, "path mismatch")
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
	testutil.Equal(t, ok, true, "expected cache hit")
	testutil.Equal(t, string(read), string(data), "data mismatch")
}

func TestReadCached_Miss(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	CacheDir = func() string { return dir }

	_, ok, err := ReadCached("nonexistent")
	testutil.NoError(t, err)
	testutil.Equal(t, ok, false, "expected cache miss")
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
	testutil.Equal(t, exists, true, "expected cache to exist")

	exists, err = HasCached("nope")
	testutil.NoError(t, err)
	testutil.Equal(t, exists, false, "expected cache to not exist")
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
	testutil.Equal(t, len(entries), 0, "expected empty cache dir, got %d entries", len(entries))
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
	_, statErr := os.Stat(tmpPath)
	testutil.Equal(t, os.IsNotExist(statErr), true, "expected temp file to be cleaned up")

	// Verify data is correct
	read, ok, _ := ReadCached(hash)
	// OR 拆序贯：read 对 miss 返回 nil slice，string(nil) 安全，无越界陷阱
	testutil.Equal(t, ok, true, "data mismatch after atomic write")
	testutil.Equal(t, string(read), string(data), "data mismatch after atomic write")
}

func TestListCacheFiles_Empty(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	CacheDir = func() string { return dir }

	files, err := ListCacheFiles()
	testutil.NoError(t, err)
	testutil.Equal(t, len(files), 0, "expected 0 files, got %d", len(files))
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
	testutil.Equal(t, len(files), 2, "expected 2 files, got %d", len(files))

	// Verify file details
	for _, f := range files {
		testutil.Equal(t, f.Hash != "", true, "expected non-empty hash")
		testutil.Equal(t, f.Size > 0, true, "expected positive size")
	}
}

func TestListCacheFiles_EmptyDir(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	CacheDir = func() string { return "" }

	files, err := ListCacheFiles()
	testutil.NoError(t, err)
	testutil.Nil(t, files, "expected nil when cache dir is empty")
}

func TestGetCacheStats_Empty(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	CacheDir = func() string { return dir }

	stats := GetCacheStats()
	testutil.Equal(t, stats.Dir, dir, "expected dir mismatch")
	testutil.Equal(t, stats.FileCount, 0, "expected 0 files")
	testutil.Equal(t, stats.TotalSize, int64(0), "expected 0 total size")
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
	testutil.Equal(t, stats.FileCount, 2, "expected 2 files")
	testutil.Equal(t, stats.TotalSize, int64(15), "expected 15 total size") // 5 + 10 = 15
}

func TestGetCacheStats_EmptyDir(t *testing.T) {
	old := CacheDir
	defer func() { CacheDir = old }()

	CacheDir = func() string { return "" }

	stats := GetCacheStats()
	testutil.Equal(t, stats.Dir, "", "expected empty dir")
	testutil.Equal(t, stats.FileCount, 0, "expected 0 files")
}

// TestValidHash 锁定缓存 key 的格式契约：只有 TextureHash 产出的 64 位小写 hex 合法。
// 该谓词是绑定层守卫的唯一事实源——CachePath 对 `..\..\evil` 会经 filepath.Clean
// 折叠到缓存目录之外，而 WriteCached 还会 MkdirAll 建中间目录再落盘（真写越界）。
func TestValidHash(t *testing.T) {
	cases := map[string]bool{
		// TextureHash 实际产出（SHA256 of "hello world"）
		"b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9": true,
		// 合法长度但非 hex
		"z94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9": false,
		// 测试曾用的短 key（修复前能穿透）
		"existshash":         false,
		"newhash":            false,
		"testhash123":        false,
		"abc123":             false,
		"other-repo-hash-00": false,
		// 路径穿越（本次修复的靶点）
		"..\\..\\evil":    false,
		"../../evil":      false,
		"C:/Users/x/evil": false,
		"..\x00evil":      false,
		"evil.ktx2":       false,
		// 长度边界
		"":                      false,
		strings.Repeat("0", 63): false,
		strings.Repeat("0", 64): true,
		strings.Repeat("0", 65): false,
		// 大写 hex 不接受（TextureHash 恒产出小写，拒绝大写避免双写同一条目）
		strings.ToUpper("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"): false,
	}
	for hash, want := range cases {
		if got := ValidHash(hash); got != want {
			t.Errorf("ValidHash(%q) = %v, want %v", hash, got, want)
		}
	}
}
