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
	if got := Get("EntityPlayer"); got == nil {
		t.Fatal("Get('EntityPlayer') = nil, want handler")
	}
	if got := Get("shaderpack"); got == nil {
		t.Fatal("Get('shaderpack') = nil, want handler")
	}
	if got := Get("blueprint"); got == nil {
		t.Fatal("Get('blueprint') = nil, want handler")
	}
	if got := Get("SceneModel"); got == nil {
		t.Fatal("Get('SceneModel') = nil, want handler")
	}
	if got := Get("ysm"); got == nil {
		t.Fatal("Get('ysm') = nil, want handler")
	}
	if got := Get("litematic"); got == nil {
		t.Fatal("Get('litematic') = nil, want handler")
	}
	if got := Get("fbx"); got == nil {
		t.Fatal("Get('fbx') = nil, want handler（resource_types.json 已含 fbx 类型）")
	}
	// 防回归：vrm 独立类型已随 ADR-111 退役
	if got := Get("vrm"); got != nil {
		t.Fatalf("Get('vrm') = %v, want nil（已并入 EntityPlayer variants）", got)
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
		{"blueprint", "blueprint"},
		{"EntityPlayer", "EntityPlayer"},
		{"SceneModel", "SceneModel"},
	}
	for _, tc := range tests {
		h := Get(tc.rtype)
		if h == nil {
			t.Fatalf("Get(%v) = nil", tc.rtype)
		}
		if got := h.Type(); got != tc.want {
			t.Errorf("Type() = %v, want %v", got, tc.want)
		}
	}
	// 防回归：vrm 独立类型已随 ADR-111 退役，注册表不得复活
	if h := Get("vrm"); h != nil {
		t.Errorf("Get('vrm') = %v, want nil（vrm 已并入 EntityPlayer variants）", h)
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
		_, err := sanitizePath(tc.path, "test")
		gotErr := err != nil
		if gotErr != tc.wantErr {
			t.Errorf("sanitizePath(%v) err=%v, wantErr=%v", tc.path, err, tc.wantErr)
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
	err := imp.Import(srcFile, dstDir)
	if err != nil {
		t.Fatalf("Import() = %v, want empty", err)
	}

	// 验证文件已复制
	dstFile := filepath.Join(dstDir, "test.txt")
	if _, err := os.Stat(dstFile); os.IsNotExist(err) {
		t.Fatal("目标文件未创建")
	}
	data, _ := os.ReadFile(dstFile)
	if string(data) != "hello" {
		t.Fatalf("文件内容 = %v, want %v", string(data), "hello")
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
	err := imp.Import(srcDir, dstDir)
	if err != nil {
		t.Fatalf("Import(dir) = %v, want empty", err)
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
	if err := imp.Import("", "/tmp"); err == nil {
		t.Error("空源路径应返回错误")
	}
	if err := imp.Import("/tmp", ""); err == nil {
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

	imp := NewDirectoryCopy("EntityPlayer")
	// 传入文件夹内任意文件
	err := imp.Import(filepath.Join(modelDir, "model.pmx"), dstDir)
	if err != nil {
		t.Fatalf("Import(file) = %v, want empty", err)
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

	imp := NewDirectoryCopy("vrm")
	// 传入文件夹本体
	err := imp.Import(modelDir, dstDir)
	if err != nil {
		t.Fatalf("Import(dir) = %v, want empty", err)
	}
	dstFile := filepath.Join(dstDir, folderName, "model.vrm")
	if _, err := os.Stat(dstFile); os.IsNotExist(err) {
		t.Fatal("目标文件未创建")
	}
}
