package importer

import (
	"os"
	"path/filepath"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

func TestRegistry(t *testing.T) {
	testutil.NotNil(t, Get("resourcepack"), "Get('resourcepack') = nil, want handler")
	testutil.NotNil(t, Get("EntityPlayer"), "Get('EntityPlayer') = nil, want handler")
	testutil.NotNil(t, Get("shaderpack"), "Get('shaderpack') = nil, want handler")
	testutil.NotNil(t, Get("blueprint"), "Get('blueprint') = nil, want handler")
	testutil.NotNil(t, Get("SceneModel"), "Get('SceneModel') = nil, want handler")
	testutil.NotNil(t, Get("ysm"), "Get('ysm') = nil, want handler")
	testutil.NotNil(t, Get("litematic"), "Get('litematic') = nil, want handler")
	testutil.NotNil(t, Get("fbx"), "Get('fbx') = nil, want handler（resource_types.json 已含 fbx 类型）")
	// 防回归：vrm 独立类型已随 ADR-111 退役
	testutil.Nil(t, Get("vrm"), "Get('vrm') want nil（已并入 EntityPlayer variants）")
	testutil.Nil(t, Get("nonexistent"), "Get('nonexistent') want nil")
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
		testutil.NotNil(t, h, "Get(%v) = nil", tc.rtype)
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
		testutil.NoError(t, err)
	}

	imp := NewSimpleCopy("test")
	err := imp.Import(srcFile, dstDir)
	testutil.NoError(t, err, "Import() want empty")

	// 验证文件已复制
	dstFile := filepath.Join(dstDir, "test.txt")
	testutil.FileExists(t, dstFile, "目标文件未创建")
	data, _ := os.ReadFile(dstFile)
	testutil.Equal(t, string(data), "hello", "文件内容")
}

func TestSimpleCopyImporter_Import_Dir(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	subDir := filepath.Join(srcDir, "sub")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(subDir, "a.txt"), []byte("a"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "b.txt"), []byte("b"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	imp := NewSimpleCopy("test")
	err := imp.Import(srcDir, dstDir)
	testutil.NoError(t, err, "Import(dir) want empty")

	// 验证目录已复制
	dstSub := filepath.Join(dstDir, filepath.Base(srcDir), "sub", "a.txt")
	testutil.FileExists(t, dstSub, "子目录文件未创建")
	dstB := filepath.Join(dstDir, filepath.Base(srcDir), "b.txt")
	testutil.FileExists(t, dstB, "根文件未创建")
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
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "model.pmx"), []byte("pmx"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "tex.png"), []byte("png"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	imp := NewDirectoryCopy("EntityPlayer")
	// 传入文件夹内任意文件
	err := imp.Import(filepath.Join(modelDir, "model.pmx"), dstDir)
	testutil.NoError(t, err, "Import(file) want empty")
	// 验证文件夹已复制
	dstFile := filepath.Join(dstDir, folderName, "model.pmx")
	testutil.FileExists(t, dstFile, "目标文件未创建")
	dstTex := filepath.Join(dstDir, folderName, "tex.png")
	testutil.FileExists(t, dstTex, "纹理文件未创建")
}

func TestDirectoryCopyImporter_Import_Dir(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	folderName := "vrc_model"
	modelDir := filepath.Join(srcDir, folderName)
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "model.vrm"), []byte("vrm"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	imp := NewDirectoryCopy("vrm")
	// 传入文件夹本体
	err := imp.Import(modelDir, dstDir)
	testutil.NoError(t, err, "Import(dir) want empty")
	dstFile := filepath.Join(dstDir, folderName, "model.vrm")
	testutil.FileExists(t, dstFile, "目标文件未创建")
}
