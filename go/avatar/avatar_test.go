package avatar

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
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

func TestExtractAvatarURIInvalidPath(t *testing.T) {
	result := ExtractAvatarURI("/nonexistent/file.ysm", "test")
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

// ====== ExtractAvatarURI ======

func TestExtractAvatarURI_FromZip(t *testing.T) {
	old := CacheDir
	tempDir := t.TempDir()
	CacheDir = func() string { return tempDir }
	defer func() { CacheDir = old }()

	// 构造含 ysm.json + avatar 图片的 zip
	ysmJSON := `{"metadata":{"authors":[{"name":"测试用户","avatar":"avatar/face.png"}]}}`
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f1, _ := w.Create("ysm.json")
	f1.Write([]byte(ysmJSON))
	f2, _ := w.Create("avatar/face.png")
	f2.Write([]byte("fake-png-data"))
	w.Close()

	zipPath := filepath.Join(t.TempDir(), "model.zip")
	if err := os.WriteFile(zipPath, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	result := ExtractAvatarURI(zipPath, "测试用户")
	if result == "" {
		t.Fatal("expected non-empty data URI")
	}
	if !strings.HasPrefix(result, "data:image/png;base64,") {
		t.Errorf("expected PNG data URI, got %q", result)
	}
}

// 回归测试：ysm.json 用裸文件名（如 "sdf"，无 avatar/ 前缀、无扩展名）声明头像时，
// .zip 模型仍能定位真实文件 avatar/sdf.png 并提取（Fix1：ExtractAvatarURI 放开裸文件名）。
func TestExtractAvatarURI_FromZipBareName(t *testing.T) {
	old := CacheDir
	tempDir := t.TempDir()
	CacheDir = func() string { return tempDir }
	defer func() { CacheDir = old }()

	ysmJSON := `{"metadata":{"authors":[{"name":"测试用户","avatar":"sdf"}]}}`
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f1, _ := w.Create("ysm.json")
	f1.Write([]byte(ysmJSON))
	f2, _ := w.Create("avatar/sdf.png")
	f2.Write([]byte("fake-png-data"))
	w.Close()

	zipPath := filepath.Join(t.TempDir(), "model.zip")
	if err := os.WriteFile(zipPath, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	result := ExtractAvatarURI(zipPath, "测试用户")
	if result == "" {
		t.Fatal("裸文件名 avatar 应仍能提取头像, 得到空")
	}
	if !strings.HasPrefix(result, "data:image/png;base64,") {
		t.Errorf("expected PNG data URI, got %q", result)
	}
}

func TestExtractAvatarURI_FromZipNoMatch(t *testing.T) {
	old := CacheDir
	tempDir := t.TempDir()
	CacheDir = func() string { return tempDir }
	defer func() { CacheDir = old }()

	ysmJSON := `{"metadata":{"authors":[{"name":"用户A","avatar":"avatar/face.png"}]}}`
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f1, _ := w.Create("ysm.json")
	f1.Write([]byte(ysmJSON))
	f2, _ := w.Create("avatar/face.png")
	f2.Write([]byte("fake-png-data"))
	w.Close()

	zipPath := filepath.Join(t.TempDir(), "model.zip")
	if err := os.WriteFile(zipPath, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	// 请求不存在的用户 → 无作者匹配，降级扫描 avatar/ 目录（找到 face.png）→ 非空
	result := ExtractAvatarURI(zipPath, "不存在用户")
	if result == "" {
		t.Fatal("降级路径应返回降级头像, 得到空")
	}
}

func TestExtractAvatarURI_FromZipBadData(t *testing.T) {
	bad := filepath.Join(t.TempDir(), "bad.zip")
	if err := os.WriteFile(bad, []byte("notzip"), 0644); err != nil {
		t.Fatal(err)
	}
	result := ExtractAvatarURI(bad, "test")
	if result != "" {
		t.Errorf("坏 zip 应返回空, 得到 %q", result)
	}
}

func TestExtractAvatarURI_FromJSON(t *testing.T) {
	old := CacheDir
	tempDir := t.TempDir()
	CacheDir = func() string { return tempDir }
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "model.json")
	jsonData := `{"metadata":{"authors":[{"name":"张三","avatar":"avatar/face.png"}]}}`
	if err := os.WriteFile(jsonPath, []byte(jsonData), 0644); err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Join(dir, "avatar"), 0755)
	if err := os.WriteFile(filepath.Join(dir, "avatar", "face.png"), []byte("face-data"), 0644); err != nil {
		t.Fatal(err)
	}

	result := ExtractAvatarURI(jsonPath, "张三")
	if result == "" {
		t.Fatal("expected non-empty data URI")
	}
	if !strings.HasPrefix(result, "data:image/png;base64,") {
		t.Errorf("expected PNG data URI, got %q", result)
	}
}

func TestExtractAvatarURI_FromJSONNoAvatarDir(t *testing.T) {
	old := CacheDir
	tempDir := t.TempDir()
	CacheDir = func() string { return tempDir }
	defer func() { CacheDir = old }()

	// 作者指定了 avatar 路径但文件不存在 → 空
	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "model.json")
	jsonData := `{"metadata":{"authors":[{"name":"李四","avatar":"avatar/face.png"}]}}`
	if err := os.WriteFile(jsonPath, []byte(jsonData), 0644); err != nil {
		t.Fatal(err)
	}
	// 不创建 avatar 目录

	result := ExtractAvatarURI(jsonPath, "李四")
	if result != "" {
		t.Errorf("avatar 文件不存在应返回空, 得到 %q", result)
	}
}

// ====== SetNodeJS ======

func TestSetNodeJS(t *testing.T) {
	// 验证 SetNodeJS 不会 panic
	nodePath := "/usr/bin/node"
	glueCalled := false
	wasmCalled := false

	SetNodeJS(nodePath,
		func() string { glueCalled = true; return "glue code" },
		func() []byte { wasmCalled = true; return []byte{1, 2, 3} },
	)

	// 验证全局变量被设置（通过 DecodeYSMFiles 间接验证）
	// 由于 DecodeYSMFiles 需要真实 Node.js，这里只验证函数调用不 panic
	_ = glueCalled
	_ = wasmCalled
}

// TestAvatarCacheDirEmpty_NoOp 锁定 ADR-046 P2：平台数据根缺失（CacheDir==""）时，
// 头像缓存读写全部 no-op，不降级为相对路径写 CWD，且 SaveAvatarData 仍返回 data URI 以保即时显示。
func TestAvatarCacheDirEmpty_NoOp(t *testing.T) {
	old := CacheDir
	CacheDir = func() string { return "" }
	defer func() { CacheDir = old }()

	// 1. SaveAvatarData 仍返回 data URI，但不写 CWD
	uri := SaveAvatarData("noopuser", []byte("fake"), "image/png")
	if !strings.HasPrefix(uri, "data:image/png;base64,") {
		t.Errorf("SaveAvatarData 应返回 data URI, got %q", uri)
	}
	if _, err := os.Stat("noopuser.png"); err == nil {
		t.Error("CacheDir 为空时不应在 CWD 写入头像文件")
		os.Remove("noopuser.png")
	}

	// 2. ReadCachedAvatar 返回 no-op（非错误）
	res, err := ReadCachedAvatar("noopuser")
	if err != nil {
		t.Errorf("ReadCachedAvatar 应为 nil 错误, got %v", err)
	}
	if res != "" {
		t.Errorf("ReadCachedAvatar 应为空, got %q", res)
	}

	// 3. CacheAvatarsFromJSON no-op 不 panic
	jsonPath := filepath.Join(t.TempDir(), "model.json")
	_ = os.WriteFile(jsonPath, []byte(`{"metadata":{"authors":[{"name":"A","avatar":"avatar/f.png"}]}}`), 0644)
	CacheAvatarsFromJSON(jsonPath)

	// 4. CacheAvatarsFromModel no-op 不 panic（构造最小 zip 含 ysm.json）
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	zf, _ := zw.Create("ysm.json")
	zf.Write([]byte(`{"metadata":{"authors":[{"name":"A"}]}}`))
	zw.Close()
	zipPath := filepath.Join(t.TempDir(), "m.zip")
	_ = os.WriteFile(zipPath, buf.Bytes(), 0644)
	CacheAvatarsFromModel(zipPath)
}
