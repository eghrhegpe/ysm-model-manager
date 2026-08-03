package importer

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRegistry(t *testing.T) {
	if got := Get("resourcepack"); got == nil {
		t.Fatal("Get('resourcepack') = nil, want handler")
	}
	if got := Get("mmd-skin"); got == nil {
		t.Fatal("Get('mmd-skin') = nil, want handler")
	}
	if got := Get("shaderpack"); got == nil {
		t.Fatal("Get('shaderpack') = nil, want handler")
	}
	if got := Get("create-blueprint"); got == nil {
		t.Fatal("Get('create-blueprint') = nil, want handler")
	}
	if got := Get("vrchat-avatar"); got == nil {
		t.Fatal("Get('vrchat-avatar') = nil, want handler")
	}
	if got := Get("ysm"); got == nil {
		t.Fatal("Get('ysm') = nil, want handler")
	}
	if got := Get("litematic"); got == nil {
		t.Fatal("Get('litematic') = nil, want handler")
	}
	if got := Get("nonexistent"); got != nil {
		t.Fatalf("Get('nonexistent') = %v, want nil", got)
	}
}

func TestType(t *testing.T) {
	tests := []struct {
		rtype string
		want  string
	}{
		{"resourcepack", "resourcepack"},
		{"shaderpack", "shaderpack"},
		{"create-blueprint", "create-blueprint"},
		{"mmd-skin", "mmd-skin"},
		{"vrchat-avatar", "vrchat-avatar"},
	}
	for _, tc := range tests {
		h := Get(tc.rtype)
		if h == nil {
			t.Fatalf("Get(%q) = nil", tc.rtype)
		}
		if got := h.Type(); got != tc.want {
			t.Errorf("Type() = %q, want %q", got, tc.want)
		}
	}
}

func TestSanitizePath(t *testing.T) {
	tests := []struct {
		path    string
		wantErr bool
	}{
		{"/safe/path/file.txt", false},
		{"safe/relative/path", false},
		{"../etc/passwd", true},
		{"foo/../../etc", true},
		{"..", true},
		{"foo/..", false},
		{".", false},
		{"ok/path/../nested", false},
	}
	for _, tc := range tests {
		_, errMsg := sanitizePath(tc.path, "test")
		gotErr := errMsg != ""
		if gotErr != tc.wantErr {
			t.Errorf("sanitizePath(%q) err=%q, wantErr=%v", tc.path, errMsg, tc.wantErr)
		}
	}
}

func TestSimpleCopyImporter_Import(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()

	// 准备源文件
	srcFile := filepath.Join(srcDir, "test.txt")
	if err := os.WriteFile(srcFile, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	imp := NewSimpleCopy("test")
	errMsg := imp.Import(srcFile, dstDir)
	if errMsg != "" {
		t.Fatalf("Import() = %q, want empty", errMsg)
	}

	// 验证文件已复制
	dstFile := filepath.Join(dstDir, "test.txt")
	if _, err := os.Stat(dstFile); os.IsNotExist(err) {
		t.Fatal("目标文件未创建")
	}
	data, _ := os.ReadFile(dstFile)
	if string(data) != "hello" {
		t.Fatalf("文件内容 = %q, want %q", string(data), "hello")
	}
}

func TestSimpleCopyImporter_Import_Dir(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	subDir := filepath.Join(srcDir, "sub")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(subDir, "a.txt"), []byte("a"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "b.txt"), []byte("b"), 0644); err != nil {
		t.Fatal(err)
	}

	imp := NewSimpleCopy("test")
	errMsg := imp.Import(srcDir, dstDir)
	if errMsg != "" {
		t.Fatalf("Import(dir) = %q, want empty", errMsg)
	}

	// 验证目录已复制
	dstSub := filepath.Join(dstDir, filepath.Base(srcDir), "sub", "a.txt")
	if _, err := os.Stat(dstSub); os.IsNotExist(err) {
		t.Fatal("子目录文件未创建")
	}
	dstB := filepath.Join(dstDir, filepath.Base(srcDir), "b.txt")
	if _, err := os.Stat(dstB); os.IsNotExist(err) {
		t.Fatal("根文件未创建")
	}
}

func TestSimpleCopyImporter_Import_EmptyPath(t *testing.T) {
	imp := NewSimpleCopy("test")
	if msg := imp.Import("", "/tmp"); msg == "" {
		t.Error("空源路径应返回错误")
	}
	if msg := imp.Import("/tmp", ""); msg == "" {
		t.Error("空目标路径应返回错误")
	}
}

func TestDirectoryCopyImporter_Import(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	folderName := "mmd_model"
	modelDir := filepath.Join(srcDir, folderName)
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "model.pmx"), []byte("pmx"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "tex.png"), []byte("png"), 0644); err != nil {
		t.Fatal(err)
	}

	imp := NewDirectoryCopy("mmd-skin")
	// 传入文件夹内任意文件
	errMsg := imp.Import(filepath.Join(modelDir, "model.pmx"), dstDir)
	if errMsg != "" {
		t.Fatalf("Import(file) = %q, want empty", errMsg)
	}
	// 验证文件夹已复制
	dstFile := filepath.Join(dstDir, folderName, "model.pmx")
	if _, err := os.Stat(dstFile); os.IsNotExist(err) {
		t.Fatal("目标文件未创建")
	}
	dstTex := filepath.Join(dstDir, folderName, "tex.png")
	if _, err := os.Stat(dstTex); os.IsNotExist(err) {
		t.Fatal("纹理文件未创建")
	}
}

func TestDirectoryCopyImporter_Import_Dir(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	folderName := "vrc_model"
	modelDir := filepath.Join(srcDir, folderName)
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "model.vrm"), []byte("vrm"), 0644); err != nil {
		t.Fatal(err)
	}

	imp := NewDirectoryCopy("vrchat-avatar")
	// 传入文件夹本体
	errMsg := imp.Import(modelDir, dstDir)
	if errMsg != "" {
		t.Fatalf("Import(dir) = %q, want empty", errMsg)
	}
	dstFile := filepath.Join(dstDir, folderName, "model.vrm")
	if _, err := os.Stat(dstFile); os.IsNotExist(err) {
		t.Fatal("目标文件未创建")
	}
}
