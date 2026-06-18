package avatar

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestSafeName(t *testing.T) {
	tests := []struct{ in, want string }{
		{"hello", "hello"},
		{"hello/world", "hello_world"},
		{"a:b*c?d\"e<f>g|h", "a_b_c_d_e_f_g_h"},
	}
	for _, tt := range tests {
		got := SafeName(tt.in)
		if got != tt.want {
			t.Errorf("SafeName(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestCacheDir(t *testing.T) {
	dir := CacheDir()
	if dir == "" {
		t.Fatal("CacheDir() returned empty")
	}
}

func TestReadCachedAvatarMissing(t *testing.T) {
	old := CacheDir
	CacheDir = func() string { return t.TempDir() }
	defer func() { CacheDir = old }()

	result, err := ReadCachedAvatar("nonexistent")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result != "" {
		t.Fatalf("expected empty, got %q", result)
	}
}

func TestSaveAndReadCachedAvatar(t *testing.T) {
	old := CacheDir
	tempDir := t.TempDir()
	CacheDir = func() string { return tempDir }
	defer func() { CacheDir = old }()

	dataURI := SaveAvatarData("testuser", []byte("fake-png-data"), "image/png")
	if dataURI == "" {
		t.Fatal("SaveAvatarData returned empty")
	}

	result, err := ReadCachedAvatar("testuser")
	if err != nil {
		t.Fatalf("ReadCachedAvatar error: %v", err)
	}
	if result == "" {
		t.Fatal("ReadCachedAvatar returned empty after save")
	}
}

func TestReadFileFromZip(t *testing.T) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, _ := w.Create("avatar/test.png")
	f.Write([]byte("png-data"))
	w.Close()

	zr, _ := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	data := ReadFileFromZip(zr, "test.png")
	if data == nil {
		t.Fatal("ReadFileFromZip returned nil")
	}
	if string(data) != "png-data" {
		t.Fatalf("got %q, want %q", string(data), "png-data")
	}
}

func TestDecodeOneAvatarInvalidPath(t *testing.T) {
	result := DecodeOneAvatar("/nonexistent/file.ysm", t.TempDir(), "test")
	if result != "" {
		t.Fatalf("expected empty, got %q", result)
	}
}

func TestCacheAvatarsFromJSON(t *testing.T) {
	old := CacheDir
	tempDir := t.TempDir()
	CacheDir = func() string { return tempDir }
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "model.json")
	jsonData := `{"metadata":{"authors":[{"name":"testuser","avatar":"avatar/face.png"}]}}`
	os.WriteFile(jsonPath, []byte(jsonData), 0644)
	os.MkdirAll(filepath.Join(dir, "avatar"), 0755)
	os.WriteFile(filepath.Join(dir, "avatar", "face.png"), []byte("face-data"), 0644)

	CacheAvatarsFromJSON(jsonPath)

	cachedPath := filepath.Join(CacheDir(), "testuser.png")
	if _, err := os.Stat(cachedPath); err != nil {
		t.Fatalf("cached file not found: %v", err)
	}
}

func TestToBytes(t *testing.T) {
	result := toBytes([]int{72, 73, 74})
	if string(result) != "HIJ" {
		t.Fatalf("got %q, want %q", string(result), "HIJ")
	}
}
