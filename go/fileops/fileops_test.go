// ===== go/fileops 单测（ADR-003 P3 下沉验证）=====
package fileops

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
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
	// 禁用（root 传 dir：m.ysm 不在仓库根，提升守卫不触发）
	enabled, err := ToggleModelEnable(dir, path)
	if err != nil || enabled {
		t.Fatalf("禁用应返回 enabled=false: %v", err)
	}
	if !IsFileBanned(path + ".ban") {
		t.Fatal(".ban 应被识别")
	}
	// 启用
	enabled, err = ToggleModelEnable(dir, path+".ban")
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

// ====== ADR-038 D3：文件夹模型整组操作 ======

// 构造一个解压后的 YSM 模型目录（ysm.json + geometry + animation + 语言 json + textures + .ban）
func makeYsmModelDir(base, name string) string {
	modelDir := filepath.Join(base, name)
	_ = os.MkdirAll(filepath.Join(modelDir, "textures"), 0755)
	_ = os.WriteFile(filepath.Join(modelDir, "ysm.json"), []byte(`{"spec":1}`), 0644)
	_ = os.WriteFile(filepath.Join(modelDir, "main.json"), []byte(`{"geometry":{}}`), 0644)
	_ = os.WriteFile(filepath.Join(modelDir, "arm.animation.json"), []byte(`{}`), 0644)
	_ = os.WriteFile(filepath.Join(modelDir, "zh_cn.json"), []byte(`{}`), 0644)
	_ = os.WriteFile(filepath.Join(modelDir, "textures", "skin.png"), []byte("PNG"), 0644)
	return modelDir
}

func TestMoveModelFile_YsmJsonLiftsParentDir(t *testing.T) {
	base := t.TempDir()
	srcRepo := filepath.Join(base, "src")
	dstRepo := filepath.Join(base, "dst")
	_ = os.MkdirAll(srcRepo, 0755)
	_ = os.MkdirAll(dstRepo, 0755)
	modelDir := makeYsmModelDir(srcRepo, "模型A")

	// 对 ysm.json 执行移动 → 应整组移动父目录
	if err := MoveModelFile(filepath.Join(modelDir, "ysm.json"), dstRepo); err != nil {
		t.Fatalf("移动失败: %v", err)
	}
	moved := filepath.Join(dstRepo, "模型A")
	if _, err := os.Stat(filepath.Join(moved, "ysm.json")); err != nil {
		t.Fatalf("ysm.json 应随目录移动: %v", err)
	}
	for _, f := range []string{"main.json", "arm.animation.json", "zh_cn.json", "textures/skin.png"} {
		if _, err := os.Stat(filepath.Join(moved, f)); err != nil {
			t.Fatalf("组内 %s 应随目录整组移动: %v", f, err)
		}
	}
	if _, err := os.Stat(modelDir); !os.IsNotExist(err) {
		t.Fatal("原模型目录应不存在")
	}
}

func TestMoveModelFile_DirMovesWholeDir(t *testing.T) {
	base := t.TempDir()
	srcRepo := filepath.Join(base, "src")
	dstRepo := filepath.Join(base, "dst")
	_ = os.MkdirAll(srcRepo, 0755)
	_ = os.MkdirAll(dstRepo, 0755)
	modelDir := makeYsmModelDir(srcRepo, "模型B")

	if err := MoveModelFile(modelDir, dstRepo); err != nil {
		t.Fatalf("目录移动失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dstRepo, "模型B", "ysm.json")); err != nil {
		t.Fatalf("目录应整组移动: %v", err)
	}
	if _, err := os.Stat(modelDir); !os.IsNotExist(err) {
		t.Fatal("原目录应不存在")
	}
}

func TestCopyModelFile_YsmJsonLiftsParentDir(t *testing.T) {
	base := t.TempDir()
	srcRepo := filepath.Join(base, "src")
	dstRepo := filepath.Join(base, "dst")
	_ = os.MkdirAll(srcRepo, 0755)
	_ = os.MkdirAll(dstRepo, 0755)
	modelDir := makeYsmModelDir(srcRepo, "模型C")

	if err := CopyModelFile(base, filepath.Join(modelDir, "ysm.json"), dstRepo); err != nil {
		t.Fatalf("复制失败: %v", err)
	}
	copied := filepath.Join(dstRepo, "模型C")
	for _, f := range []string{"ysm.json", "main.json", "arm.animation.json", "zh_cn.json", "textures/skin.png"} {
		if _, err := os.Stat(filepath.Join(copied, f)); err != nil {
			t.Fatalf("组内 %s 应整组复制: %v", f, err)
		}
	}
	// 原目录保留
	if _, err := os.Stat(filepath.Join(modelDir, "ysm.json")); err != nil {
		t.Fatal("原模型应保留")
	}
}

func TestCopyModelFile_DirRecursiveCopiesBan(t *testing.T) {
	base := t.TempDir()
	srcRepo := filepath.Join(base, "src")
	dstRepo := filepath.Join(base, "dst")
	_ = os.MkdirAll(srcRepo, 0755)
	_ = os.MkdirAll(dstRepo, 0755)
	modelDir := makeYsmModelDir(srcRepo, "模型D")
	// 禁用标记 ysm.json.ban 应随目录复制
	_ = os.WriteFile(filepath.Join(modelDir, "ysm.json.ban"), []byte("x"), 0644)

	if err := CopyModelFile(base, modelDir, dstRepo); err != nil {
		t.Fatalf("目录复制失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dstRepo, "模型D", "ysm.json.ban")); err != nil {
		t.Fatalf(".ban 状态文件应随目录复制: %v", err)
	}
	// 目标已存在 → 防覆盖报错
	if err := CopyModelFile(base, modelDir, dstRepo); err == nil {
		t.Fatal("重复复制到已存在目标应报错")
	}
}

func TestRenameFile_BlockYsmJson(t *testing.T) {
	dir := t.TempDir()
	modelDir := makeYsmModelDir(dir, "模型E")
	ysmPath := filepath.Join(modelDir, "ysm.json")
	if err := RenameFile(ysmPath, "renamed.json"); err == nil {
		t.Fatal("ysm.json 单文件重命名应被拒绝")
	}
	// 普通文件重命名不受影响
	normal := filepath.Join(modelDir, "main.json")
	if err := RenameFile(normal, "new-main.json"); err != nil {
		t.Fatalf("普通 json 重命名应放行: %v", err)
	}
}

// ====== WriteModelFolder（ADR-038 关联：文件夹型模型整组导入）======

func b64(s string) string {
	return base64.StdEncoding.EncodeToString([]byte(s))
}

func TestWriteModelFolder_Ok(t *testing.T) {
	repo := t.TempDir()
	files := []types.ImportFileItem{
		{RelPath: "ysm.json", Base64: b64(`{"spec":1}`)},
		{RelPath: "main.json", Base64: b64(`{"geometry":{}}`)},
		{RelPath: "arm.animation.json", Base64: b64(`{}`)},
		{RelPath: "zh_cn.json", Base64: b64(`{}`)},
		{RelPath: "textures/skin.png", Base64: b64("PNG")},
	}
	if err := WriteModelFolder(repo, "", "模型A", files); err != nil {
		t.Fatalf("整组导入失败: %v", err)
	}
	for _, f := range []string{"ysm.json", "main.json", "arm.animation.json", "zh_cn.json", "textures/skin.png"} {
		if _, err := os.Stat(filepath.Join(repo, "模型A", f)); err != nil {
			t.Fatalf("组内 %s 应写入: %v", f, err)
		}
	}
	// 子路径层级保留
	if _, err := os.Stat(filepath.Join(repo, "模型A", "textures", "skin.png")); err != nil {
		t.Fatalf("textures 子目录层级应保留: %v", err)
	}
}

func TestWriteModelFolder_MissingSupported(t *testing.T) {
	repo := t.TempDir()
	// 无任何支持文件（只有 main.json 等包内资源）→ 拒绝（防杂物文件夹入仓）
	files := []types.ImportFileItem{
		{RelPath: "main.json", Base64: b64(`{}`)},
		{RelPath: "zh_cn.json", Base64: b64(`{}`)},
	}
	if err := WriteModelFolder(repo, "", "模型B", files); err == nil {
		t.Fatal("无支持文件应拒绝")
	}
	// 空列表 → 拒绝
	if err := WriteModelFolder(repo, "", "模型B2", nil); err == nil {
		t.Fatal("空文件列表应拒绝")
	}
}

func TestWriteModelFolder_PlainFolderWithYsm(t *testing.T) {
	repo := t.TempDir()
	// 普通文件夹（无 ysm.json 清单）装 2 个 ysm → 允许整组入仓（保留层级）
	files := []types.ImportFileItem{
		{RelPath: "模型A.ysm", Base64: b64("YSMBIN")},
		{RelPath: "模型B.ysm", Base64: b64("YSMBIN2")},
		{RelPath: "sub/说明.txt", Base64: b64("note")},
	}
	if err := WriteModelFolder(repo, "", "合集", files); err != nil {
		t.Fatalf("普通文件夹含 ysm 应允许整组导入: %v", err)
	}
	for _, f := range []string{"模型A.ysm", "模型B.ysm", filepath.Join("sub", "说明.txt")} {
		if _, err := os.Stat(filepath.Join(repo, "合集", f)); err != nil {
			t.Fatalf("组内 %s 应写入: %v", f, err)
		}
	}
}

func TestWriteModelFolder_MultiLevelNested(t *testing.T) {
	repo := t.TempDir()
	// 多层嵌套：顶层目录 a 内含 ysm.json + 深层子目录
	files := []types.ImportFileItem{
		{RelPath: "ysm.json", Base64: b64(`{"spec":1}`)},
		{RelPath: "animations/run.animation.json", Base64: b64(`{}`)},
		{RelPath: "textures/char/deep/skin.png", Base64: b64("PNG")},
	}
	if err := WriteModelFolder(repo, "", "模型C", files); err != nil {
		t.Fatalf("多层嵌套整组导入失败: %v", err)
	}
	for _, f := range []string{
		"ysm.json",
		filepath.Join("animations", "run.animation.json"),
		filepath.Join("textures", "char", "deep", "skin.png"),
	} {
		if _, err := os.Stat(filepath.Join(repo, "模型C", f)); err != nil {
			t.Fatalf("嵌套 %s 应写入: %v", f, err)
		}
	}
}

func TestWriteModelFolder_ExistsAndTraversal(t *testing.T) {
	repo := t.TempDir()
	files := []types.ImportFileItem{{RelPath: "ysm.json", Base64: b64(`{}`)}}
	// 目标已存在 → 防覆盖
	if err := WriteModelFolder(repo, "", "模型C", files); err != nil {
		t.Fatal(err)
	}
	if err := WriteModelFolder(repo, "", "模型C", files); err == nil {
		t.Fatal("目标已存在应报错")
	}
	// 路径穿越 → 拒绝
	evil := []types.ImportFileItem{
		{RelPath: "ysm.json", Base64: b64(`{}`)},
		{RelPath: "../evil.json", Base64: b64(`{}`)},
	}
	if err := WriteModelFolder(repo, "", "模型D", evil); err == nil {
		t.Fatal("路径穿越应拒绝")
	}
	// 非法文件夹名 → 拒绝
	if err := WriteModelFolder(repo, "", "a/b", files); err == nil {
		t.Fatal("非法文件夹名应拒绝")
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

// ====== ADR-038 D3.6：删除目录感知（DeleteModelFile） ======

func TestDeleteModelFile_YsmJsonRemovesParentDir(t *testing.T) {
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	ysmPath := filepath.Join(modelDir, "ysm.json")

	if err := DeleteModelFile(base, ysmPath); err != nil {
		t.Fatalf("删除 ysm.json 应成功: %v", err)
	}
	// 整组删除：父目录（含 geometry/animation/语言/textures）应全部消失
	if _, err := os.Stat(modelDir); !os.IsNotExist(err) {
		t.Fatalf("ysm.json 应整组删除父目录, 目录仍存在: %v", err)
	}
}

func TestDeleteModelFile_SingleFile(t *testing.T) {
	dir := t.TempDir()
	fp := filepath.Join(dir, "m.ysm")
	if err := os.WriteFile(fp, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// 非 ysm.json：仅删单文件，父目录保留
	if err := DeleteModelFile(dir, fp); err != nil {
		t.Fatalf("删除单文件应成功: %v", err)
	}
	if _, err := os.Stat(fp); !os.IsNotExist(err) {
		t.Fatal("单文件应被删除")
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("父目录应保留: %v", err)
	}
}

func TestDeleteModelFile_EmptyArgs(t *testing.T) {
	if err := DeleteModelFile("", ""); err == nil {
		t.Fatal("空参数应报错")
	}
}

func TestDeleteModelFile_RootLevelYsmJsonFallsBack(t *testing.T) {
	// 根级 ysm.json（父目录 == 仓库根）：目录提升被守卫拒绝 → 回退单文件删除，
	// 不得 os.RemoveAll 清空仓库，仓库内模型必须保留。
	base := t.TempDir()
	rootYsm := filepath.Join(base, "ysm.json")
	if err := os.WriteFile(rootYsm, []byte(`{"spec":1}`), 0644); err != nil {
		t.Fatal(err)
	}
	// 仓库内放一个真实模型，验证未被误删
	modelDir := makeYsmModelDir(base, "模型A")

	if err := DeleteModelFile(base, rootYsm); err != nil {
		t.Fatalf("根级 ysm.json 应回退单文件删除: %v", err)
	}
	// 根级 ysm.json 本身被删（单文件）
	if _, err := os.Stat(rootYsm); !os.IsNotExist(err) {
		t.Fatalf("根级 ysm.json 应被单文件删除: %v", err)
	}
	// 仓库根与仓库内模型必须保留（未被 RemoveAll 清空）
	if _, err := os.Stat(base); err != nil {
		t.Fatalf("仓库根不应被删除: %v", err)
	}
	if _, err := os.Stat(modelDir); err != nil {
		t.Fatalf("仓库内模型不应被误删: %v", err)
	}
}

// ====== ADR-038 D3.7：Toggle 目录级 .ban（整组禁用） ======

func TestToggleModelEnable_YsmJsonDisablesParentDir(t *testing.T) {
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	ysmPath := filepath.Join(modelDir, "ysm.json")

	// 对 ysm.json 禁用 → 父目录重命名为 .ban（整组）
	enabled, err := ToggleModelEnable(base, ysmPath)
	if err != nil || enabled {
		t.Fatalf("禁用应返回 enabled=false: %v", err)
	}
	bannedDir := modelDir + ".ban"
	if _, err := os.Stat(bannedDir); err != nil {
		t.Fatalf("父目录应重命名为 %s: %v", bannedDir, err)
	}
	// 目录内 ysm.json 路径经 IsFileBanned 应识别为禁用
	bannedYsm := filepath.Join(bannedDir, "ysm.json")
	if !IsFileBanned(bannedYsm) {
		t.Fatal("目录级 .ban 下的 ysm.json 应识别为禁用")
	}

	// 启用：.ban 目录内的 ysm.json 传入 → 父目录还原
	enabled, err = ToggleModelEnable(base, bannedYsm)
	if err != nil || !enabled {
		t.Fatalf("启用应返回 enabled=true: %v", err)
	}
	if _, err := os.Stat(modelDir); err != nil {
		t.Fatalf("原目录应恢复: %v", err)
	}
}

func TestToggleModelEnable_RootLevelYsmJsonFallsBack(t *testing.T) {
	// 根级 ysm.json（父目录 == 仓库根）：不得把仓库根重命名为 .ban
	base := t.TempDir()
	rootYsm := filepath.Join(base, "ysm.json")
	if err := os.WriteFile(rootYsm, []byte(`{"spec":1}`), 0644); err != nil {
		t.Fatal(err)
	}
	modelDir := makeYsmModelDir(base, "模型A")

	// 禁用：应回退到文件级 .ban（ysm.json → ysm.json.ban），仓库根不动
	enabled, err := ToggleModelEnable(base, rootYsm)
	if err != nil || enabled {
		t.Fatalf("禁用应返回 enabled=false: %v", err)
	}
	if _, err := os.Stat(rootYsm + ".ban"); err != nil {
		t.Fatalf("根级 ysm.json 应回退文件级 .ban: %v", err)
	}
	if _, err := os.Stat(base + ".ban"); err == nil {
		t.Fatal("仓库根不应被重命名成 .ban")
	}
	if _, err := os.Stat(modelDir); err != nil {
		t.Fatalf("仓库内模型不应受影响: %v", err)
	}
}

func TestToggleModelEnable_MixedDirEnableSymmetry(t *testing.T) {
	// P2b 修复验证：目录级 .ban 下，非 ysm.json 文件启用应还原父目录（与 IsFileBanned 对称）
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	// 混入一个松散 .ysm（模拟混合内容目录）
	looseYsm := filepath.Join(modelDir, "loose.ysm")
	if err := os.WriteFile(looseYsm, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	// 整组禁用
	if _, err := ToggleModelEnable(base, filepath.Join(modelDir, "ysm.json")); err != nil {
		t.Fatalf("禁用失败: %v", err)
	}
	bannedDir := modelDir + ".ban"
	// 目录内松散 .ysm 应识别为禁用（父目录 .ban）
	bannedLoose := filepath.Join(bannedDir, "loose.ysm")
	if !IsFileBanned(bannedLoose) {
		t.Fatal("目录级 .ban 下的松散 .ysm 应识别为禁用")
	}
	// 启用松散 .ysm → 应还原父目录（整组启用），而非给文件加 .ban
	enabled, err := ToggleModelEnable(base, bannedLoose)
	if err != nil || !enabled {
		t.Fatalf("启用应返回 enabled=true: %v", err)
	}
	if _, err := os.Stat(modelDir); err != nil {
		t.Fatalf("父目录应还原: %v", err)
	}
	// 文件不应被加 .ban 后缀（原路径应存在）
	if _, err := os.Stat(looseYsm); err != nil {
		t.Fatalf("松散 .ysm 不应被重命名: %v", err)
	}
}

func TestIsFileBanned_DirBan(t *testing.T) {
	// 文件级 .ban
	if !IsFileBanned("x.ysm.ban") {
		t.Fatal("文件级 .ban 应识别")
	}
	// 目录级 .ban：父目录名 .ban 结尾
	if !IsFileBanned(filepath.Join("模型A.ban", "ysm.json")) {
		t.Fatal("父目录级 .ban 应识别")
	}
	// 正常路径不误判
	if IsFileBanned(filepath.Join("模型A", "ysm.json")) {
		t.Fatal("正常目录不应误判为禁用")
	}
}

func TestToggleModelEnable_UpperBanSuffix(t *testing.T) {
	// P3 修复验证：大小写不敏感去 .ban 后缀（Windows 上 .BAN 目录也能还原）
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	// 模拟 Windows 大写后缀：目录名改为 .BAN
	bannedDir := modelDir + ".BAN"
	if err := os.Rename(modelDir, bannedDir); err != nil {
		t.Fatal(err)
	}
	// 目录内 ysm.json 路径经 IsFileBanned 应识别为禁用（大小写不敏感）
	bannedYsm := filepath.Join(bannedDir, "ysm.json")
	if !IsFileBanned(bannedYsm) {
		t.Fatal("父目录级 .BAN 应识别为禁用")
	}
	// 启用：.BAN 目录内的 ysm.json 传入 → 父目录还原为原名
	enabled, err := ToggleModelEnable(base, bannedYsm)
	if err != nil || !enabled {
		t.Fatalf("启用应返回 enabled=true: %v", err)
	}
	if _, err := os.Stat(modelDir); err != nil {
		t.Fatalf(".BAN 目录应还原为原名 %s: %v", modelDir, err)
	}
}

func TestDeleteModelFile_OutOfRootRejected(t *testing.T) {
	// P3 修复验证：仓库外路径显式拒绝（不静默降级为单文件删除）
	base := t.TempDir()
	outside := t.TempDir() // 仓库外目录
	ysmPath := filepath.Join(outside, "ysm.json")
	if err := os.WriteFile(ysmPath, []byte(`{"spec":1}`), 0644); err != nil {
		t.Fatal(err)
	}
	// 仓库外的 ysm.json：父目录不在仓库根内 → 显式报错，不得删除
	if err := DeleteModelFile(base, ysmPath); err == nil {
		t.Fatal("仓库外 ysm.json 删除应被拒绝")
	}
	// 文件应保留
	if _, err := os.Stat(ysmPath); err != nil {
		t.Fatalf("仓库外 ysm.json 不应被删除: %v", err)
	}
}
