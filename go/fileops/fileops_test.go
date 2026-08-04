// ===== go/fileops 单测（ADR-003 P3 下沉验证）=====
package fileops

import (
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
