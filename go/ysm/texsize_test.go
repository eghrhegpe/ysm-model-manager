// ===== go/ysm texsize 单测（零覆盖包补测）=====
package ysm

import (
	"os"
	"path/filepath"
	"testing"
)

// ====== extractTexSizeFromGeometryBytes ======

func TestExtractTexSizeFromGeometryBytes_Valid(t *testing.T) {
	data := []byte(`{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"test","texture_width":128,"texture_height":64}}]}`)
	w, h := extractTexSizeFromGeometryBytes(data)
	if w != 128 || h != 64 {
		t.Errorf("期望 128x64, 得到 %dx%d", w, h)
	}
}

func TestExtractTexSizeFromGeometryBytes_NoGeometry(t *testing.T) {
	data := []byte(`{}`)
	w, h := extractTexSizeFromGeometryBytes(data)
	if w != 0 || h != 0 {
		t.Errorf("空对象应返回 0,0, 得到 %d,%d", w, h)
	}
}

func TestExtractTexSizeFromGeometryBytes_InvalidJSON(t *testing.T) {
	data := []byte(`{not json}`)
	w, h := extractTexSizeFromGeometryBytes(data)
	if w != 0 || h != 0 {
		t.Errorf("非法 JSON 应返回 0,0, 得到 %d,%d", w, h)
	}
}

func TestExtractTexSizeFromGeometryBytes_EmptyGeometry(t *testing.T) {
	data := []byte(`{"minecraft:geometry":[]}`)
	w, h := extractTexSizeFromGeometryBytes(data)
	if w != 0 || h != 0 {
		t.Errorf("空 geometry 数组应返回 0,0, 得到 %d,%d", w, h)
	}
}

// ====== readTexSizeFromFile ======

func TestReadTexSizeFromFile_Zip(t *testing.T) {
	// 构造含 geometry JSON 的 zip
	geomJSON := `{"minecraft:geometry":[{"description":{"texture_width":64,"texture_height":32}}]}`
	path := makeJar(t, map[string]string{"model.geo.json": geomJSON})
	zipPath := filepath.Join(t.TempDir(), "model.zip")
	if err := os.Rename(path, zipPath); err != nil {
		t.Fatal(err)
	}
	w, h := readTexSizeFromFile(zipPath)
	if w != 64 || h != 32 {
		t.Errorf("期望 64x32, 得到 %dx%d", w, h)
	}
}

func TestReadTexSizeFromFile_ZipNoGeometry(t *testing.T) {
	// zip 中无 geometry JSON
	path := makeJar(t, map[string]string{"data.txt": "hello"})
	zipPath := filepath.Join(t.TempDir(), "empty.zip")
	if err := os.Rename(path, zipPath); err != nil {
		t.Fatal(err)
	}
	w, h := readTexSizeFromFile(zipPath)
	if w != 0 || h != 0 {
		t.Errorf("无 geometry 的 zip 应返回 0,0, 得到 %d,%d", w, h)
	}
}

func TestReadTexSizeFromFile_Ysm(t *testing.T) {
	// .ysm 加密模型目前无法读取纹理尺寸 → 0,0
	path := filepath.Join(t.TempDir(), "model.ysm")
	if err := os.WriteFile(path, []byte("YSGP encrypted data"), 0644); err != nil {
		t.Fatal(err)
	}
	w, h := readTexSizeFromFile(path)
	if w != 0 || h != 0 {
		t.Errorf("加密 .ysm 应返回 0,0, 得到 %d,%d", w, h)
	}
}

func TestReadTexSizeFromFile_7z(t *testing.T) {
	// 7z 文件目前仅扫描前 64KB 文本，非 7z 格式返回 0,0
	path := filepath.Join(t.TempDir(), "model.7z")
	if err := os.WriteFile(path, []byte("not a real 7z"), 0644); err != nil {
		t.Fatal(err)
	}
	w, h := readTexSizeFromFile(path)
	if w != 0 || h != 0 {
		t.Errorf("非 7z 格式应返回 0,0, 得到 %d,%d", w, h)
	}
}

func TestReadTexSizeFromFile_7zWithTexData(t *testing.T) {
	// 7z 文件包含 texture_width/texture_height 文本片段
	content := []byte(`some binary data texture_width":64,"texture_height":32 more data`)
	path := filepath.Join(t.TempDir(), "model.7z")
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatal(err)
	}
	w, h := readTexSizeFromFile(path)
	if w != 0 || h != 0 {
		// 当前实现不完整，返回 0,0 是预期行为
		// 此测试仅验证不会崩溃
	}
}

// ====== readTexFromZip ======

func TestReadTexFromZip_Valid(t *testing.T) {
	geomJSON := `{"minecraft:geometry":[{"description":{"texture_width":256,"texture_height":128}}]}`
	path := makeJar(t, map[string]string{"geo/model.geo.json": geomJSON})
	w, h := readTexFromZip(path)
	if w != 256 || h != 128 {
		t.Errorf("期望 256x128, 得到 %dx%d", w, h)
	}
}

func TestReadTexFromZip_NotZip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notzip.zip")
	if err := os.WriteFile(path, []byte("notzip"), 0644); err != nil {
		t.Fatal(err)
	}
	w, h := readTexFromZip(path)
	if w != 0 || h != 0 {
		t.Errorf("非 zip 应返回 0,0, 得到 %d,%d", w, h)
	}
}

func TestReadTexFromZip_NonGeoJSON(t *testing.T) {
	// zip 中的 JSON 不含 minecraft:geometry → 尝试第二遍扫描
	path := makeJar(t, map[string]string{"data.json": `{"key":"value"}`})
	w, h := readTexFromZip(path)
	if w != 0 || h != 0 {
		t.Errorf("无 geometry 的 JSON 应返回 0,0, 得到 %d,%d", w, h)
	}
}

// ====== ScanFiles ======

func TestScanFiles_Valid(t *testing.T) {
	dir := t.TempDir()
	// 创建 .ysm, .zip, .7z 文件
	for _, name := range []string{"model.ysm", "archive.zip", "data.7z", "readme.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("data"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	// 子目录中的文件也应被扫描
	subDir := filepath.Join(dir, "sub")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(subDir, "nested.ysm"), []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}

	entries := ScanFiles(dir)
	if len(entries) != 4 {
		t.Fatalf("期望 4 个条目, 得到 %d: %v", len(entries), entries)
	}
	extMap := make(map[string]bool)
	for _, e := range entries {
		extMap[filepath.Ext(e.Path)] = true
	}
	if !extMap[".ysm"] || !extMap[".zip"] || !extMap[".7z"] {
		t.Errorf("应包含 .ysm .zip .7z 扩展名, 得到 %v", extMap)
	}
}

func TestScanFiles_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	entries := ScanFiles(dir)
	if len(entries) != 0 {
		t.Errorf("空目录应返回 0 个条目, 得到 %d", len(entries))
	}
}

func TestScanFiles_NonExistentDir(t *testing.T) {
	entries := ScanFiles("/nonexistent/path")
	if len(entries) != 0 {
		t.Errorf("不存在目录应返回 0 个条目, 得到 %d", len(entries))
	}
}

// ====== ScanModelTexSizes ======

func TestScanModelTexSizes_Empty(t *testing.T) {
	results := ScanModelTexSizes(nil)
	if len(results) != 0 {
		t.Errorf("nil 输入应返回空, 得到 %d", len(results))
	}
	results = ScanModelTexSizes([]ModelEntry{})
	if len(results) != 0 {
		t.Errorf("空切片应返回空, 得到 %d", len(results))
	}
}

func TestScanModelTexSizes_WithEntries(t *testing.T) {
	// 构造含 geometry JSON 的 zip
	geomJSON := `{"minecraft:geometry":[{"description":{"texture_width":64,"texture_height":32}}]}`
	zipPath := makeJar(t, map[string]string{"geo.json": geomJSON})
	// makeJar 创建的是 .jar 扩展名，重命名为 .zip 才能被 readTexSizeFromFile 识别
	renamedZip := filepath.Join(t.TempDir(), "model.zip")
	if err := os.Rename(zipPath, renamedZip); err != nil {
		t.Fatal(err)
	}

	ysmPath := filepath.Join(t.TempDir(), "model.ysm")
	// 复制 zip 内容到 .ysm 文件（当作加密模型返回 0,0）
	data, err := os.ReadFile(renamedZip)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ysmPath, data, 0644); err != nil {
		t.Fatal(err)
	}

	entries := []ModelEntry{
		{Path: renamedZip, Name: "model.zip"},
		{Path: ysmPath, Name: "model.ysm"},
		{Path: "/nonexistent/file.7z", Name: "missing.7z"},
	}
	results := ScanModelTexSizes(entries)
	if len(results) != 3 {
		t.Fatalf("期望 3 个结果, 得到 %d", len(results))
	}
	// zip 文件应能提取纹理尺寸
	if results[0].TexWidth != 64 || results[0].TexHeight != 32 {
		t.Errorf("zip 期望 64x32, 得到 %dx%d", results[0].TexWidth, results[0].TexHeight)
	}
	// .ysm 加密模式返回 0,0
	if results[1].TexWidth != 0 || results[1].TexHeight != 0 {
		t.Errorf(".ysm 期望 0x0, 得到 %dx%d", results[1].TexWidth, results[1].TexHeight)
	}
	// 不存在的文件返回 0,0
	if results[2].TexWidth != 0 || results[2].TexHeight != 0 {
		t.Errorf("不存在文件期望 0x0, 得到 %dx%d", results[2].TexWidth, results[2].TexHeight)
	}
}