// ===== go/fileops 单测（ADR-003 P3 下沉验证）=====
package fileops

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRenameFile_IllegalChars(t *testing.T) {
	if err := RenameFile("/x", "bad:name"); err == nil {
		t.Fatal("非法字符应报错")
	}
	if err := RenameFile("", "name"); err == nil {
		t.Fatal("空路径应报错")
	}
}

func TestRenameFile_Ok(t *testing.T) {
	dir := t.TempDir()
	oldPath := filepath.Join(dir, "a.ysm")
	if err := os.WriteFile(oldPath, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := RenameFile(oldPath, "b.ysm"); err != nil {
		t.Fatalf("重命名失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "b.ysm")); err != nil {
		t.Fatalf("新文件应存在: %v", err)
	}
}

func TestCreateDir_Validation(t *testing.T) {
	root := t.TempDir()
	if err := CreateDir(root, "ok"); err != nil {
		t.Fatalf("合法目录应成功: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "ok")); err != nil {
		t.Fatalf("目录应已创建: %v", err)
	}
	if err := CreateDir(root, "../escape"); err == nil {
		t.Fatal("路径穿越应被拦截")
	}
	if err := CreateDir(root, "~tilde"); err == nil {
		t.Fatal("~ 应被拦截")
	}
	if err := CreateDir(root, "  "); err == nil {
		t.Fatal("空目录名应报错")
	}
}

func TestMoveModelFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "a.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "sub")
	if err := MoveModelFile(src, dst); err != nil {
		t.Fatalf("移动失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dst, "a.ysm")); err != nil {
		t.Fatalf("目标应存在: %v", err)
	}
	if err := MoveModelFile("", dst); err == nil {
		t.Fatal("空源应报错")
	}
}

func TestCopyModelFile_PathSafety(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "a.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// 目录外 → 拦截
	if err := CopyModelFile(root, src, t.TempDir()); err == nil {
		t.Fatal("目录外目标应被拦截")
	}
	// 目录内 → 成功
	dst := filepath.Join(root, "sub")
	if err := CopyModelFile(root, src, dst); err != nil {
		t.Fatalf("复制失败: %v", err)
	}
	// 防覆盖
	if err := CopyModelFile(root, src, dst); err == nil {
		t.Fatal("目标已存在应报错")
	}
	// root 为空跳过校验
	if err := CopyModelFile("", src, t.TempDir()); err != nil {
		t.Fatalf("root 空时应跳过校验: %v", err)
	}
}

func TestToggleModelEnable(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "m.ysm")
	if err := os.WriteFile(path, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// 禁用
	enabled, err := ToggleModelEnable(path)
	if err != nil || enabled {
		t.Fatalf("禁用应返回 enabled=false: %v", err)
	}
	if !IsFileBanned(path + ".ban") {
		t.Fatal(".ban 应被识别")
	}
	// 启用
	enabled, err = ToggleModelEnable(path + ".ban")
	if err != nil || !enabled {
		t.Fatalf("启用应返回 enabled=true: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("原文件应恢复: %v", err)
	}
}

func TestIsFileBanned(t *testing.T) {
	if !IsFileBanned("x.ysm.ban") {
		t.Fatal(".ban 后缀应识别")
	}
	if IsFileBanned("x.ysm") {
		t.Fatal("非 .ban 不应识别")
	}
	if !IsFileBanned("X.YSM.BAN") {
		t.Fatal("大小写不敏感")
	}
}

func TestGetPackInfo(t *testing.T) {
	dir := t.TempDir()
	// 无 pack.json → 空
	if info := GetPackInfo("", dir); info.Name != "" {
		t.Fatalf("无 pack.json 应返回空: %+v", info)
	}
	content := `{"name":"测试包","description":"描述"}`
	jsonPath := filepath.Join(dir, "ysm-pack.json")
	if err := os.WriteFile(jsonPath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	info := GetPackInfo("", dir)
	if info.Name != "测试包" || info.Description != "描述" {
		t.Fatalf("解析失败: %+v", info)
	}
	// BOM 前缀剥离
	bom := append([]byte{0xEF, 0xBB, 0xBF}, []byte(content)...)
	if err := os.WriteFile(jsonPath, bom, 0644); err != nil {
		t.Fatal(err)
	}
	if info = GetPackInfo("", dir); info.Name != "测试包" {
		t.Fatalf("BOM 应被剥离: %+v", info)
	}
	// root 相对路径
	if info = GetPackInfo(filepath.Dir(dir), filepath.Base(dir)); info.Name != "测试包" {
		t.Fatalf("root 相对路径解析失败: %+v", info)
	}
}

func TestFindPreviewImage(t *testing.T) {
	dir := t.TempDir()
	model := filepath.Join(dir, "m.ysm")
	// 无预览图
	if got := FindPreviewImage(model); got != "" {
		t.Fatalf("无预览图应返回空: %q", got)
	}
	// 同目录 png → data URI
	pngPath := filepath.Join(dir, "m.png")
	if err := os.WriteFile(pngPath, []byte("PNGDATA"), 0644); err != nil {
		t.Fatal(err)
	}
	got := FindPreviewImage(model)
	if !strings.HasPrefix(got, "data:image/png;base64,") {
		t.Fatalf("应返回 data URI: %q", got)
	}
}

// ====== RenameDir ======

func TestRenameDir_Ok(t *testing.T) {
	dir := t.TempDir()
	oldPath := filepath.Join(dir, "olddir")
	if err := os.MkdirAll(oldPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := RenameDir(oldPath, "newdir"); err != nil {
		t.Fatalf("重命名失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "newdir")); err != nil {
		t.Fatalf("新目录应存在: %v", err)
	}
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Fatal("旧目录应不存在")
	}
}

func TestRenameDir_EmptyArgs(t *testing.T) {
	dir := t.TempDir()
	if err := RenameDir("", "new"); err == nil {
		t.Fatal("空 oldPath 应报错")
	}
	if err := RenameDir(dir, ""); err == nil {
		t.Fatal("空 newName 应报错")
	}
}

func TestRenameDir_NonExistent(t *testing.T) {
	if err := RenameDir("/nonexistent/path", "new"); err == nil {
		t.Fatal("不存在的目录应报错")
	}
}

// ====== RemoveDir ======

func TestRemoveDir_Ok(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "subdir")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	if err := RemoveDir(sub); err != nil {
		t.Fatalf("删除失败: %v", err)
	}
	if _, err := os.Stat(sub); !os.IsNotExist(err) {
		t.Fatal("目录应已被删除")
	}
}

func TestRemoveDir_NonExistent(t *testing.T) {
	// 删除不存在的目录不应报错（os.RemoveAll 行为）
	if err := RemoveDir("/nonexistent/path"); err != nil {
		t.Fatalf("删除不存在的目录不应报错: %v", err)
	}
}

func TestRemoveDir_Empty(t *testing.T) {
	if err := RemoveDir(""); err != nil {
		// 空字符串删除，os.RemoveAll("") 会报错
		// 只需验证不 panic
	}
}

// ====== ExtractPreviewTexture ======

func TestExtractPreviewTexture_NonExistent(t *testing.T) {
	got := ExtractPreviewTexture("/nonexistent/file.zip")
	if got != "" {
		t.Errorf("不存在文件应返回空, 得到 %q", got)
	}
}

func TestExtractPreviewTexture_FromZip(t *testing.T) {
	dir := t.TempDir()
	// 构造含 PNG 的 zip
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, _ := w.Create("preview.png")
	f.Write([]byte("PNGDATA123"))
	w.Close()

	zipPath := filepath.Join(dir, "model.zip")
	if err := os.WriteFile(zipPath, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	got := ExtractPreviewTexture(zipPath)
	if !strings.HasPrefix(got, "data:image/png;base64,") {
		t.Errorf("应返回 data URI, 得到 %q", got)
	}
}

func TestExtractPreviewTexture_FromZipNoPNG(t *testing.T) {
	dir := t.TempDir()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, _ := w.Create("readme.txt")
	f.Write([]byte("hello"))
	w.Close()

	zipPath := filepath.Join(dir, "model.zip")
	if err := os.WriteFile(zipPath, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	got := ExtractPreviewTexture(zipPath)
	if got != "" {
		t.Errorf("无 PNG 的 zip 应返回空, 得到 %q", got)
	}
}

func TestExtractPreviewTexture_From7zBadData(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "model.7z")
	if err := os.WriteFile(path, []byte("not7z"), 0644); err != nil {
		t.Fatal(err)
	}
	got := ExtractPreviewTexture(path)
	if got != "" {
		t.Errorf("坏 7z 应返回空, 得到 %q", got)
	}
}

func TestExtractPreviewTexture_FromYSM(t *testing.T) {
	dir := t.TempDir()
	// .ysm 文件需要 YSMParser CLI，不存在时返回空
	path := filepath.Join(dir, "model.ysm")
	if err := os.WriteFile(path, []byte("fake ysm data"), 0644); err != nil {
		t.Fatal(err)
	}
	got := ExtractPreviewTexture(path)
	if got != "" {
		t.Errorf("无 CLI 时 .ysm 应返回空, 得到 %q", got)
	}
}

func TestExtractPreviewTexture_FromJSON(t *testing.T) {
	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "model.json")
	if err := os.WriteFile(jsonPath, []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}

	//  textures/ 子目录下的 PNG
	texDir := filepath.Join(dir, "textures")
	if err := os.MkdirAll(texDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(texDir, "tex.png"), []byte("TEXDATA"), 0644); err != nil {
		t.Fatal(err)
	}

	got := ExtractPreviewTexture(jsonPath)
	if !strings.HasPrefix(got, "data:image/png;base64,") {
		t.Errorf("应返回 data URI, 得到 %q", got)
	}
}

func TestExtractPreviewTexture_FromJSONFallback(t *testing.T) {
	// 无 textures/ 子目录时，回退到同目录 PNG
	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "model.json")
	if err := os.WriteFile(jsonPath, []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "tex.png"), []byte("FALLBACK"), 0644); err != nil {
		t.Fatal(err)
	}

	got := ExtractPreviewTexture(jsonPath)
	if !strings.HasPrefix(got, "data:image/png;base64,") {
		t.Errorf("应返回 data URI, 得到 %q", got)
	}
}
