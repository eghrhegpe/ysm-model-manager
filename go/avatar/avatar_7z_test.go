package avatar

import (
	"archive/zip"
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// writePNG creates a minimal 1×1 PNG for avatar test fixtures.
func writePNG(c color.RGBA) []byte {
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, c)
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

// TestExtractAvatarURI_From7zFallback verifies .7z avatar/ directory fallback.
// Uses go/geometry/testdata/7z_full.7z which contains avatar\face.png.
func TestExtractAvatarURI_From7zFallback(t *testing.T) {
	withTempCache(t) // 降级路径会 SaveAvatarData 落盘，须重定向缓存目录防污染真实用户缓存
	src := filepath.Join("..", "geometry", "testdata", "7z_full.7z")
	if _, err := os.Stat(src); err != nil {
		t.Skipf("testdata 7z_full.7z not available: %v", err)
	}

	// 7z_full.7z has avatar\face.png and ysm.json (no authors field)
	// Fallback should find avatar/face.png
	result := ExtractAvatarURI(src, SafeName("unknown"))
	testutil.Equal(t, result != "", true, "ExtractAvatarURI returned empty for .7z with avatar/ fallback")
	// 序贯拆分：前一 Equal 失败即 Goexit，消息里的 result 切片才不越界
	testutil.Equal(t, strings.HasPrefix(result, "data:image/"), true, "Expected data:image/ URI, got %s", result[:min(50, len(result))])
}

// TestCacheAvatarsFromModel_7z 批量缓存路径对齐 .7z（R20 审核 P3-4）：
// modelAuthorNames 补 .7z 分支后，含 authors 声明的 7z 模型能按作者批量缓存头像。
// 夹具 go/avatar/testdata/7z_authors.7z 含 ysm.json（authors: testuser →
// avatar/face.png）+ avatar\face.png。
func TestCacheAvatarsFromModel_7z(t *testing.T) {
	src := filepath.Join("testdata", "7z_authors.7z")
	if _, err := os.Stat(src); err != nil {
		t.Skipf("testdata 7z_authors.7z not available: %v", err)
	}
	oldCacheDir := CacheDir
	dir := t.TempDir()
	CacheDir = func() string { return dir }
	t.Cleanup(func() { CacheDir = oldCacheDir })

	CacheAvatarsFromModel(src)

	// 作者 testuser 的头像应已落盘（avatar/face.png）
	cached := filepath.Join(dir, SafeName("testuser")+".png")
	testutil.FileExists(t, cached, ".7z 批量缓存未落盘作者头像 %s", cached)
	// 且读回为 data URI
	uri, err := ReadCachedAvatar("testuser")
	// OR 拆序贯：err 与 HasPrefix 分别断言，uri 对 err!=nil 场景为空串、%q 求值安全
	testutil.NoError(t, err, "ReadCachedAvatar 期望 data URI, got %q", uri)
	testutil.Equal(t, strings.HasPrefix(uri, "data:image/"), true, "ReadCachedAvatar 期望 data URI, got %q", uri)
}
func TestExtractAvatarURI_FromZipFallback(t *testing.T) {
	withTempCache(t) // 降级路径会 SaveAvatarData 落盘，须重定向缓存目录防污染真实用户缓存
	pngData := writePNG(color.RGBA{R: 0, G: 0, B: 255, A: 255})
	ysmJSON := `{"metadata":{"authors":[]}}`

	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)
	for name, data := range map[string][]byte{
		"ysm.json":        []byte(ysmJSON),
		"avatar/face.png": pngData,
		"main.geo.json":   []byte("{}"),
	} {
		f, err := w.Create(name)
		testutil.NoError(t, err, "zip Create %s", name)
		_, err = f.Write(data)
		testutil.NoError(t, err, "zip Write %s", name)
	}
	testutil.NoError(t, w.Close(), "zip Close")

	dir := t.TempDir()
	path := filepath.Join(dir, "test.zip")
	testutil.NoError(t, os.WriteFile(path, buf.Bytes(), 0o644), "WriteFile")

	result := ExtractAvatarURI(path, SafeName("unknown"))
	testutil.Equal(t, result != "", true, "ExtractAvatarURI returned empty for .zip with avatar/ fallback")
	// 序贯拆分：前一 Equal 失败即 Goexit，消息里的 result 切片才不越界
	testutil.Equal(t, strings.HasPrefix(result, "data:image/"), true, "Expected data:image/ URI, got %s", result[:min(50, len(result))])
}

// TestExtractAvatarURI_FromZipNoAvatar verifies .zip without avatar returns empty.
func TestExtractAvatarURI_FromZipNoAvatar(t *testing.T) {
	ysmJSON := `{"metadata":{"authors":[]}}`
	data := makeZip(t, map[string]string{
		"ysm.json":      ysmJSON,
		"main.geo.json": "{}",
		"tex_a.png":     "not-an-avatar",
	})
	dir := t.TempDir()
	path := filepath.Join(dir, "noavatar.zip")
	testutil.NoError(t, os.WriteFile(path, data, 0o644), "WriteFile")

	result := ExtractAvatarURI(path, SafeName("unknown"))
	// min(50, len(result)) 保切片不越界，无条件求值安全
	testutil.Equal(t, result, "", "ExtractAvatarURI should return empty for zip without avatar, got %s", result[:min(50, len(result))])
}
