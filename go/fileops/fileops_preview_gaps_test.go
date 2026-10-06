package fileops

// ===== ExtractPreviewTexture 补测：候选目录跳过 / 空候选继续 / 禁用后缀大小写 =====
// 覆盖此前无断言的路径：
//   - textures/ 内混入「名字像 PNG 的子目录」与普通文件时必须跳过，再回退同目录 PNG
//   - 首个 .png 候选是空文件时不得就此放弃（继续尝试后续候选）
//   - .ysm 走注入解码器**命中纹理**的成功路径（原仅覆盖未注入降级）
//   - 大写禁用后缀（.ZIP.DISABLED）仍可预览——剥离仅用于扩展名判定，读取仍用原始路径
//   - .7z 读取失败（文件不存在）的 data==nil 分支

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/ysm"
)

// 期望的 data URI 构造（与生产同口径：标准 base64 + image/png）
func wantPNGDataURI(png []byte) string {
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
}

// textures/ 内的子目录（即便名字以 .png 结尾）必须跳过；无可用 PNG 时回退同目录 PNG。
func TestExtractPreviewTexture_JSONTexturesSkipsSubdirAndFallsBack(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "model.json"), []byte(`{}`), 0644); err != nil {
		t.Fatal(err)
	}
	texDir := filepath.Join(dir, "textures")
	if err := os.MkdirAll(texDir, 0755); err != nil {
		t.Fatal(err)
	}
	// 名字以 .png 结尾的**目录**：不得被当作纹理读取（IsDir 跳过）
	if err := os.MkdirAll(filepath.Join(texDir, "sub.png"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(texDir, "layer.txt"), []byte("not png"), 0644); err != nil {
		t.Fatal(err)
	}
	// 同目录 PNG 作为回退命中
	const payload = "FALLBACK"
	if err := os.WriteFile(filepath.Join(dir, "preview.png"), []byte(payload), 0644); err != nil {
		t.Fatal(err)
	}

	got := ExtractPreviewTexture(filepath.Join(dir, "model.json"))
	if want := wantPNGDataURI([]byte(payload)); got != want {
		t.Fatalf("应跳过子目录并回退同目录 PNG\n got=%q\nwant=%q", got, want)
	}
}

// 首个 .png 候选为空文件时必须继续搜索后续候选。
func TestExtractPreviewTexture_JSONSkipsEmptyPNGAndContinues(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "model.json"), []byte(`{}`), 0644); err != nil {
		t.Fatal(err)
	}
	texDir := filepath.Join(dir, "textures")
	if err := os.MkdirAll(texDir, 0755); err != nil {
		t.Fatal(err)
	}
	// ReadDir 升序 → aaa.png 先被读到；空文件不得中断搜索
	if err := os.WriteFile(filepath.Join(texDir, "aaa.png"), nil, 0644); err != nil {
		t.Fatal(err)
	}
	const payload = "REAL"
	if err := os.WriteFile(filepath.Join(texDir, "bbb.png"), []byte(payload), 0644); err != nil {
		t.Fatal(err)
	}

	got := ExtractPreviewTexture(filepath.Join(dir, "model.json"))
	if want := wantPNGDataURI([]byte(payload)); got != want {
		t.Fatalf("空 PNG 候选必须跳过并继续搜索\n got=%q\nwant=%q", got, want)
	}
}

// .ysm 注入解码器命中纹理 → 走通「提取成功」路径（原仅覆盖未注入的降级路径）。
func TestExtractPreviewTexture_YSMSuccessViaInjectedDecoder(t *testing.T) {
	png := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}
	ysm.SetDecoder(func([]byte) []ysm.DecodedFile {
		return []ysm.DecodedFile{
			{Path: "output/geo/main.json", Data: []byte(`{"minecraft:geometry":[]}`)},
			{Path: "output/textures/skin.png", Data: png},
		}
	})
	t.Cleanup(func() { ysm.SetDecoder(nil) })

	path := filepath.Join(t.TempDir(), "model.ysm")
	if err := os.WriteFile(path, []byte("YSGP\x00test"), 0644); err != nil {
		t.Fatal(err)
	}
	if got, want := ExtractPreviewTexture(path), wantPNGDataURI(png); got != want {
		t.Fatalf(".ysm 解码命中纹理应产出 data URI\n got=%q\nwant=%q", got, want)
	}
}

// 大写禁用后缀：剥离仅用于**扩展名判定**，读取必须回原始磁盘路径。
func TestExtractPreviewTexture_UpperDisabledSuffixStillPreviews(t *testing.T) {
	dir := t.TempDir()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, err := w.Create("preview.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("PNGDATA123")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "model.ZIP.DISABLED")
	if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	got := ExtractPreviewTexture(path)
	// 原始路径仍指向同一文件（Windows 大小写不敏感；POSIX 上我们写的正是该名字）
	if !strings.HasPrefix(got, "data:image/png;base64,") {
		t.Fatalf("大写禁用后缀应仍可预览（剥离仅用于扩展名判定），got %q", got)
	}
}

// .7z 读取失败（文件不存在）→ data==nil 分支返回空。
func TestExtractPreviewTexture_Missing7zReturnsEmpty(t *testing.T) {
	got := ExtractPreviewTexture(filepath.Join(t.TempDir(), "absent.7z"))
	if got != "" {
		t.Fatalf("不存在的 .7z 应返回空，got %q", got)
	}
}
