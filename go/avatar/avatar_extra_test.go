// ===== go/avatar 补测（既有测试未覆盖分支）=====
package avatar

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"ysm-model-manager/go/container"
)

func TestReadFileFromZip_NoMatch(t *testing.T) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, _ := w.Create("other.txt")
	_, _ = f.Write([]byte("x"))
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if got := ReadFileFromZip(zr, "target.png"); got != nil {
		t.Fatalf("目标不存在应 nil: %q", got)
	}
	// 反斜杠路径归一化匹配（Windows 风格 zip 条目）
	w2 := zip.NewWriter(&buf)
	buf.Reset()
	f2, _ := w2.Create(`avatars\a.png`)
	_, _ = f2.Write([]byte("PNG"))
	_ = w2.Close()
	zr2, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if got := ReadFileFromZip(zr2, "avatars/a.png"); string(got) != "PNG" {
		t.Fatalf("反斜杠路径应归一化匹配: %q", string(got))
	}
}

// ===== 工具函数补测 =====

func TestAvatarCandidates(t *testing.T) {
	tests := []struct {
		in   string
		want []string
	}{
		// 空引用 → nil
		{"", nil},
		// 裸文件名：补 avatar/ 前缀 + 标准扩展名变体（每个扩展名先 avatar/ 变体再裸名变体）
		{"sdf", []string{"sdf", "avatar/sdf", "avatar/sdf.png", "sdf.png", "avatar/sdf.jpg", "sdf.jpg", "avatar/sdf.jpeg", "sdf.jpeg"}},
		// 带 avatar/ 前缀：不补裸名变体，只补扩展名变体
		{"avatar/sdf.png", []string{"avatar/sdf.png", "avatar/sdf.png", "avatar/sdf.jpg", "avatar/sdf.jpeg"}},
		// 大小写原样保留（首项即原引用）
		{"Avatar/Face.png", []string{"Avatar/Face.png", "avatar/Face.png", "avatar/Face.jpg", "avatar/Face.jpeg"}},
	}
	for _, tt := range tests {
		if got := avatarCandidates(tt.in); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("avatarCandidates(%q) = %v, 期望 %v", tt.in, got, tt.want)
		}
	}
	// 反斜杠形式（Windows 声明）：首项保留原样，同时有 avatar/ 前缀标准变体
	got := avatarCandidates(`avatar\sdf.png`)
	if got[0] != `avatar\sdf.png` {
		t.Errorf("反斜杠引用首项应原样保留, 得到 %q", got[0])
	}
	found := false
	for _, c := range got {
		if c == "avatar/sdf.png" {
			found = true
		}
	}
	if !found {
		t.Errorf("反斜杠引用应含 avatar/sdf.png 标准变体, 得到 %v", got)
	}
}

func TestLimitedBuffer(t *testing.T) {
	// 未超限：正常写入
	l := &limitedBuffer{max: 10}
	n, err := l.Write([]byte("abc"))
	if n != 3 || err != nil || l.exceeded || l.buf.Len() != 3 {
		t.Fatalf("未超限写入异常: n=%d err=%v exceeded=%v len=%d", n, err, l.exceeded, l.buf.Len())
	}
	// 恰好写满（3+5=8 ≤ 10）：不置 exceeded
	n, err = l.Write([]byte("defgh"))
	if n != 5 || err != nil || l.exceeded || l.buf.Len() != 8 {
		t.Fatalf("恰好写满异常: n=%d err=%v exceeded=%v len=%d", n, err, l.exceeded, l.buf.Len())
	}
	// 超限：丢弃超限部分但返回 len(p)（内存有界），buf 保持上限内
	n, err = l.Write([]byte("xyz"))
	if n != 3 || err != nil || !l.exceeded {
		t.Fatalf("超限写入异常: n=%d err=%v exceeded=%v", n, err, l.exceeded)
	}
	if l.buf.Len() != 8 {
		t.Fatalf("超限后缓冲应保持上限内, len=%d", l.buf.Len())
	}
	// 边界：max=0 时任何写入都视为超限
	l0 := &limitedBuffer{max: 0}
	_, _ = l0.Write([]byte("a"))
	if !l0.exceeded {
		t.Fatal("max=0 时应置 exceeded")
	}
}

// ===== 缓存读写边界补测 =====

func TestReadCachedAvatar_MimeSniff(t *testing.T) {
	old := CacheDir
	dir := t.TempDir()
	CacheDir = func() string { return dir }
	defer func() { CacheDir = old }()

	// JPEG 魔数（FF D8 FF）→ image/jpeg，而非硬编码 image/png
	SaveAvatarData("jpeguser", []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10}, "image/jpeg")
	uri, err := ReadCachedAvatar("jpeguser")
	if err != nil {
		t.Fatalf("ReadCachedAvatar error: %v", err)
	}
	if !strings.HasPrefix(uri, "data:image/jpeg;base64,") {
		t.Errorf("JPEG 头像应嗅探为 image/jpeg, 得到 %q", uri)
	}
	// PNG 魔数（非 JPEG 头）→ image/png
	SaveAvatarData("pnguser", []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A}, "image/png")
	uri, err = ReadCachedAvatar("pnguser")
	if err != nil {
		t.Fatalf("ReadCachedAvatar error: %v", err)
	}
	if !strings.HasPrefix(uri, "data:image/png;base64,") {
		t.Errorf("PNG 头像应保持 image/png, 得到 %q", uri)
	}
}

func TestReadCachedAvatar_IOError(t *testing.T) {
	// 缓存路径被目录占位：读返回 IO 错误（非 IsNotExist）→ 返回错误而非静默空
	old := CacheDir
	dir := t.TempDir()
	CacheDir = func() string { return dir }
	defer func() { CacheDir = old }()
	if err := os.MkdirAll(filepath.Join(dir, "baddir.png"), 0755); err != nil {
		t.Fatal(err)
	}
	uri, err := ReadCachedAvatar("baddir")
	if err == nil {
		t.Fatalf("目录占位缓存应报 IO 错误, 得到 nil 错误 (uri=%q)", uri)
	}
	if uri != "" {
		t.Fatalf("出错时不应返回数据 URI, 得到 %q", uri)
	}
}

func TestSaveAvatarData_CacheDirUnwritable(t *testing.T) {
	// 缓存目录创建失败/原子写失败：仅 log，仍返回 data URI（有意降级，不 panic）
	old := CacheDir
	blocker := filepath.Join(t.TempDir(), "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	CacheDir = func() string { return filepath.Join(blocker, "cache") }
	defer func() { CacheDir = old }()

	uri := SaveAvatarData("u", []byte("data"), "image/png")
	if !strings.HasPrefix(uri, "data:image/png;base64,") {
		t.Fatalf("缓存不可写时应仍返回 data URI, 得到 %q", uri)
	}
}

// ===== ReadFileFromZip / matchAvatarZipEntry 边界补测 =====

// nopWriteCloser 供 zip.RegisterCompressor 注册假压缩器（构造不支持算法的条目）。
type nopWriteCloser struct{ io.Writer }

func (nopWriteCloser) Close() error { return nil }

func TestReadFileFromZip_DirPrefix(t *testing.T) {
	// 目标以 / 结尾（目录级）→ 根下该目录前缀匹配
	data := makeZip(t, map[string]string{"avatar/face.png": "face-data"})
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if got := ReadFileFromZip(zr, "avatar/"); string(got) != "face-data" {
		t.Fatalf("目录级目标应命中 avatar/face.png, 得到 %q", string(got))
	}
}

func TestReadFileFromZip_ExactPathOnly(t *testing.T) {
	// 带路径目标仅精确匹配：sub/avatar/face.png 不得命中 avatar/face.png（P3-3 收紧点）
	data := makeZip(t, map[string]string{"sub/avatar/face.png": "x"})
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if got := ReadFileFromZip(zr, "avatar/face.png"); got != nil {
		t.Fatalf("sub/ 下同名条目不应命中精确路径目标, 得到 %q", string(got))
	}
}

func TestReadFileFromZip_EntryOpenFail(t *testing.T) {
	// 不支持的压缩算法（method 99）：f.Open 失败 → 记录日志并返回 nil（不 panic）
	zip.RegisterCompressor(99, func(w io.Writer) (io.WriteCloser, error) {
		return nopWriteCloser{w}, nil
	})
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	h := &zip.FileHeader{Name: "avatar/x.png", Method: 99}
	f, err := w.CreateHeader(h)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if got := ReadFileFromZip(zr, "avatar/x.png"); got != nil {
		t.Fatalf("算法不支持条目应返回 nil, 得到 %q", string(got))
	}
}

func TestReadFileFromZip_ChecksumCorrupt(t *testing.T) {
	// 存储条目内容被篡改（CRC 不匹配）：读取报错 → nil（zip-bomb/损坏防线）
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	h := &zip.FileHeader{Name: "avatar/c.png", Method: zip.Store}
	f, err := w.CreateHeader(h)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("ABCDEFGH")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	raw := buf.Bytes()
	idx := bytes.Index(raw, []byte("ABCDEFGH"))
	if idx < 0 {
		t.Fatal("构造失败：未找到存储条目内容")
	}
	raw[idx+2] = 'X' // 篡改内容保持长度不变，CRC 校验必然失败
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	if got := ReadFileFromZip(zr, "avatar/c.png"); got != nil {
		t.Fatalf("CRC 损坏条目应返回 nil, 得到 %q", string(got))
	}
}

func TestReadFileFromZip_Oversize(t *testing.T) {
	// 条目解压后超 50MB：超限跳过（防 zip-bomb 解压膨胀 OOM）
	data := makeZip(t, map[string]string{"avatar/big.png": string(make([]byte, (50<<20)+1))})
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if got := ReadFileFromZip(zr, "avatar/big.png"); got != nil {
		t.Fatalf("超限条目应返回 nil, 得到 %d 字节", len(got))
	}
}

// ===== ExtractAvatarURI .json 分支边界补测 =====

// TestExtractAvatarURI_FromJSON_BareName 回归：ysm.json 用裸文件名（"sdf"，无 avatar/
// 前缀无扩展名）声明头像时，解压目录分支应解析到 avatar/sdf.png（与 .zip/.ysm 分支
// avatarCandidates 口径一致），而非读模型根下的 dir/sdf。
func TestExtractAvatarURI_FromJSON_BareName(t *testing.T) {
	old := CacheDir
	CacheDir = func() string { return t.TempDir() }
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "model.json")
	jsonData := `{"metadata":{"authors":[{"name":"张三","avatar":"sdf"}]}}`
	if err := os.WriteFile(jsonPath, []byte(jsonData), 0644); err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Join(dir, "avatar"), 0755)
	if err := os.WriteFile(filepath.Join(dir, "avatar", "sdf.png"), []byte("face-data"), 0644); err != nil {
		t.Fatal(err)
	}

	result := ExtractAvatarURI(jsonPath, "张三")
	if !strings.HasPrefix(result, "data:image/png;base64,") {
		t.Fatalf("裸文件名 avatar 应解析到 avatar/sdf.png 并返回 PNG URI, 得到 %q", result)
	}
}

// TestCacheAvatarsFromJSON_BareName 与上同口径：裸文件名声明应命中 avatar/ 目录并写缓存。
func TestCacheAvatarsFromJSON_BareName(t *testing.T) {
	old := CacheDir
	cacheDir := t.TempDir()
	CacheDir = func() string { return cacheDir }
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "model.json")
	jsonData := `{"metadata":{"authors":[{"name":"张三","avatar":"sdf"}]}}`
	if err := os.WriteFile(jsonPath, []byte(jsonData), 0644); err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Join(dir, "avatar"), 0755)
	if err := os.WriteFile(filepath.Join(dir, "avatar", "sdf.png"), []byte("face-data"), 0644); err != nil {
		t.Fatal(err)
	}

	CacheAvatarsFromJSON(jsonPath)
	if _, err := os.Stat(filepath.Join(cacheDir, "张三.png")); err != nil {
		t.Fatalf("裸文件名 avatar 应写入缓存 张三.png: %v", err)
	}
}

func TestExtractAvatarURI_FromJSON_JPG(t *testing.T) {
	old := CacheDir
	CacheDir = func() string { return t.TempDir() }
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "model.json")
	jsonData := `{"metadata":{"authors":[{"name":"张三","avatar":"avatar/face.jpg"}]}}`
	if err := os.WriteFile(jsonPath, []byte(jsonData), 0644); err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Join(dir, "avatar"), 0755)
	if err := os.WriteFile(filepath.Join(dir, "avatar", "face.jpg"), []byte("jpeg-data"), 0644); err != nil {
		t.Fatal(err)
	}

	result := ExtractAvatarURI(jsonPath, "张三")
	if !strings.HasPrefix(result, "data:image/jpeg;base64,") {
		t.Fatalf("jpg 头像应返回 JPEG URI, 得到 %q", result)
	}
}

func TestExtractAvatarURI_FromJSON_PathTraversal(t *testing.T) {
	// 逃逸路径 avatar/../evil.png 被 isSafeAvatarPath 拒绝 → 空
	old := CacheDir
	CacheDir = func() string { return t.TempDir() }
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "model.json")
	jsonData := `{"metadata":{"authors":[{"name":"张三","avatar":"../evil.png"}]}}`
	if err := os.WriteFile(jsonPath, []byte(jsonData), 0644); err != nil {
		t.Fatal(err)
	}
	// 逃逸目标真实存在（模型目录外）也不得读取
	if err := os.WriteFile(filepath.Join(filepath.Dir(dir), "evil.png"), []byte("evil"), 0644); err != nil {
		t.Fatal(err)
	}

	result := ExtractAvatarURI(jsonPath, "张三")
	if result != "" {
		t.Fatalf("逃逸路径应返回空, 得到 %q", result)
	}
}

func TestExtractAvatarURI_FromJSON_BadJSON(t *testing.T) {
	// ysm.json 内容非法 → authors 为空 → 空
	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "model.json")
	if err := os.WriteFile(jsonPath, []byte("not-json"), 0644); err != nil {
		t.Fatal(err)
	}
	if result := ExtractAvatarURI(jsonPath, "张三"); result != "" {
		t.Fatalf("坏 JSON 应返回空, 得到 %q", result)
	}
}

func TestExtractAvatarURI_FromJSON_MissingFile(t *testing.T) {
	// 模型文件不存在（IsNotExist 静默）→ 空
	dir := t.TempDir()
	if result := ExtractAvatarURI(filepath.Join(dir, "missing.json"), "张三"); result != "" {
		t.Fatalf("不存在的 .json 应返回空, 得到 %q", result)
	}
}

func TestExtractAvatarURI_FromJSON_DirAsFile(t *testing.T) {
	// 读取错误非 IsNotExist（路径被目录占位）→ 补日志并返回空
	dir := t.TempDir()
	modelDir := filepath.Join(dir, "model.json")
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		t.Fatal(err)
	}
	if result := ExtractAvatarURI(modelDir, "张三"); result != "" {
		t.Fatalf("目录占位 .json 应返回空, 得到 %q", result)
	}
}

// ===== ExtractAvatarURI .zip 分支边界补测 =====

func TestExtractAvatarURI_FromZip_JPG(t *testing.T) {
	old := CacheDir
	CacheDir = func() string { return t.TempDir() }
	defer func() { CacheDir = old }()

	ysmJSON := `{"metadata":{"authors":[{"name":"测试用户","avatar":"avatar/face.jpg"}]}}`
	data := makeZip(t, map[string]string{
		"ysm.json":        ysmJSON,
		"avatar/face.jpg": "jpeg-data",
	})
	zipPath := filepath.Join(t.TempDir(), "model.zip")
	if err := os.WriteFile(zipPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	result := ExtractAvatarURI(zipPath, "测试用户")
	if !strings.HasPrefix(result, "data:image/jpeg;base64,") {
		t.Fatalf("zip 内 jpg 头像应返回 JPEG URI, 得到 %q", result)
	}
}

func TestExtractAvatarURI_FromZip_PathTraversal(t *testing.T) {
	// 逃逸 avatar 引用被 isSafeAvatarPath 拒绝 → 空
	ysmJSON := `{"metadata":{"authors":[{"name":"测试用户","avatar":"../evil.png"}]}}`
	data := makeZip(t, map[string]string{"ysm.json": ysmJSON})
	zipPath := filepath.Join(t.TempDir(), "model.zip")
	if err := os.WriteFile(zipPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	if result := ExtractAvatarURI(zipPath, "测试用户"); result != "" {
		t.Fatalf("zip 逃逸路径应返回空, 得到 %q", result)
	}
}

func TestExtractAvatarURI_FromZip_MissingAvatar(t *testing.T) {
	// 作者匹配但 zip 内无对应头像文件 → 降级扫描 avatar/ 目录找到 face.png → 非空
	ysmJSON := `{"metadata":{"authors":[{"name":"测试用户","avatar":"avatar/missing.png"}]}}`
	data := makeZip(t, map[string]string{
		"ysm.json":        ysmJSON,
		"avatar/face.png": "face-data",
	})
	zipPath := filepath.Join(t.TempDir(), "model.zip")
	if err := os.WriteFile(zipPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	result := ExtractAvatarURI(zipPath, "测试用户")
	if result == "" {
		t.Fatal("降级路径应返回降级头像, 得到空")
	}
}

func TestExtractAvatarURI_FromZip_NoYSMJSON(t *testing.T) {
	// zip 内无 ysm.json → authors 为空 → 降级扫描 avatar/ 目录找到 face.png → 非空
	data := makeZip(t, map[string]string{"avatar/face.png": "face-data"})
	zipPath := filepath.Join(t.TempDir(), "model.zip")
	if err := os.WriteFile(zipPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	result := ExtractAvatarURI(zipPath, "测试用户")
	if result == "" {
		t.Fatal("降级路径应返回降级头像, 得到空")
	}
}

func TestExtractAvatarURI_MissingZip(t *testing.T) {
	dir := t.TempDir()
	if result := ExtractAvatarURI(filepath.Join(dir, "missing.zip"), "测试用户"); result != "" {
		t.Fatalf("不存在的 .zip 应返回空, 得到 %q", result)
	}
}

func TestExtractAvatarURI_DirAsYSM(t *testing.T) {
	// .ysm 读取错误非 IsNotExist（目录占位）→ 补日志并返回空
	dir := t.TempDir()
	modelDir := filepath.Join(dir, "model.ysm")
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		t.Fatal(err)
	}
	if result := ExtractAvatarURI(modelDir, "测试用户"); result != "" {
		t.Fatalf("目录占位 .ysm 应返回空, 得到 %q", result)
	}
}

// ===== CacheAvatarsFromJSON 边界补测 =====

func TestCacheAvatarsFromJSON_EdgeCases(t *testing.T) {
	old := CacheDir
	cacheDir := t.TempDir()
	CacheDir = func() string { return cacheDir }
	defer func() { CacheDir = old }()
	dir := t.TempDir()

	// 非 .json 扩展名 → 直接返回
	CacheAvatarsFromJSON(filepath.Join(dir, "m.zip"))

	// 文件不存在 → 静默返回
	CacheAvatarsFromJSON(filepath.Join(dir, "missing.json"))

	// 坏 JSON → log 后返回
	if err := os.WriteFile(filepath.Join(dir, "bad.json"), []byte("not-json"), 0644); err != nil {
		t.Fatal(err)
	}
	CacheAvatarsFromJSON(filepath.Join(dir, "bad.json"))

	// 作者缺 name/avatar 字段 → 跳过
	sparsePath := filepath.Join(dir, "sparse.json")
	if err := os.WriteFile(sparsePath, []byte(`{"metadata":{"authors":[{"avatar":"avatar/a.png"},{"name":"x"}]}}`), 0644); err != nil {
		t.Fatal(err)
	}
	CacheAvatarsFromJSON(sparsePath)
	if _, err := os.Stat(filepath.Join(cacheDir, "x.png")); err == nil {
		t.Fatal("缺 avatar 字段的作者不应写缓存")
	}

	// 逃逸路径 → 跳过且不写缓存
	evilPath := filepath.Join(dir, "evil.json")
	if err := os.WriteFile(evilPath, []byte(`{"metadata":{"authors":[{"name":"eviler","avatar":"../evil.png"}]}}`), 0644); err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Dir(dir), 0755)
	if err := os.WriteFile(filepath.Join(filepath.Dir(dir), "evil.png"), []byte("evil"), 0644); err != nil {
		t.Fatal(err)
	}
	CacheAvatarsFromJSON(evilPath)
	if _, err := os.Stat(filepath.Join(cacheDir, "eviler.png")); err == nil {
		t.Fatal("逃逸路径作者不应写缓存")
	}

	// 已缓存 → 跳过不覆盖
	okDir := filepath.Join(dir, "ok")
	os.MkdirAll(filepath.Join(okDir, "avatar"), 0755)
	jsonPath := filepath.Join(okDir, "model.json")
	if err := os.WriteFile(jsonPath, []byte(`{"metadata":{"authors":[{"name":"alice","avatar":"avatar/face.png"}]}}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(okDir, "avatar", "face.png"), []byte("new-data"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cacheDir, "alice.png"), []byte("old-data"), 0644); err != nil {
		t.Fatal(err)
	}
	CacheAvatarsFromJSON(jsonPath)
	cached, err := os.ReadFile(filepath.Join(cacheDir, "alice.png"))
	if err != nil {
		t.Fatal(err)
	}
	if string(cached) != "old-data" {
		t.Fatalf("已缓存作者不应被覆盖, 得到 %q", string(cached))
	}

	// avatar 文件不存在 → 跳过不写缓存
	missPath := filepath.Join(dir, "miss.json")
	if err := os.WriteFile(missPath, []byte(`{"metadata":{"authors":[{"name":"bob","avatar":"avatar/none.png"}]}}`), 0644); err != nil {
		t.Fatal(err)
	}
	CacheAvatarsFromJSON(missPath)
	if _, err := os.Stat(filepath.Join(cacheDir, "bob.png")); err == nil {
		t.Fatal("avatar 文件不存在的作者不应写缓存")
	}
}

// ===== CacheAvatarsFromModel 补测 =====

func TestCacheAvatarsFromModel_JSON(t *testing.T) {
	// .json → 委托 CacheAvatarsFromJSON
	old := CacheDir
	cacheDir := t.TempDir()
	CacheDir = func() string { return cacheDir }
	defer func() { CacheDir = old }()

	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "model.json")
	if err := os.WriteFile(jsonPath, []byte(`{"metadata":{"authors":[{"name":"张三","avatar":"avatar/face.png"}]}}`), 0644); err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Join(dir, "avatar"), 0755)
	if err := os.WriteFile(filepath.Join(dir, "avatar", "face.png"), []byte("face-data"), 0644); err != nil {
		t.Fatal(err)
	}
	CacheAvatarsFromModel(jsonPath)
	if _, err := os.Stat(filepath.Join(cacheDir, "张三.png")); err != nil {
		t.Fatalf(".json 模型应委托缓存, 张三.png 缺失: %v", err)
	}
}

func TestCacheAvatarsFromModel_Zip(t *testing.T) {
	old := CacheDir
	cacheDir := t.TempDir()
	CacheDir = func() string { return cacheDir }
	defer func() { CacheDir = old }()

	ysmJSON := `{"metadata":{"authors":[{"name":"用户A","avatar":"avatar/face.png"}]}}`
	data := makeZip(t, map[string]string{
		"ysm.json":        ysmJSON,
		"avatar/face.png": "face-data",
	})
	zipPath := filepath.Join(t.TempDir(), "model.zip")
	if err := os.WriteFile(zipPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	CacheAvatarsFromModel(zipPath)
	if _, err := os.Stat(filepath.Join(cacheDir, "用户A.png")); err != nil {
		t.Fatalf(".zip 模型应缓存全部作者头像, 用户A.png 缺失: %v", err)
	}
}

func TestCacheAvatarsFromModel_ZipAlreadyCached(t *testing.T) {
	old := CacheDir
	cacheDir := t.TempDir()
	CacheDir = func() string { return cacheDir }
	defer func() { CacheDir = old }()

	if err := os.WriteFile(filepath.Join(cacheDir, "用户A.png"), []byte("old-data"), 0644); err != nil {
		t.Fatal(err)
	}
	ysmJSON := `{"metadata":{"authors":[{"name":"用户A","avatar":"avatar/face.png"}]}}`
	data := makeZip(t, map[string]string{
		"ysm.json":        ysmJSON,
		"avatar/face.png": "face-data",
	})
	zipPath := filepath.Join(t.TempDir(), "model.zip")
	if err := os.WriteFile(zipPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	CacheAvatarsFromModel(zipPath)
	cached, err := os.ReadFile(filepath.Join(cacheDir, "用户A.png"))
	if err != nil {
		t.Fatal(err)
	}
	if string(cached) != "old-data" {
		t.Fatalf("已缓存作者不应重复提取覆盖, 得到 %q", string(cached))
	}
}

// ===== containerAuthorNames 补测 =====
// 2026-09 外部锐评 #1 重构：modelAuthorNames 退役（其 .json 分支在生产路径本就
// 死代码——CacheAvatarsFromModel 对 .json 直接路由 CacheAvatarsFromJSON，作者名
// 过滤由后者覆盖）；容器作者名解析收敛至 containerAuthorNames(Reader)。
// 坏 zip / 缺失文件 / 未知扩展名等打开期失败由 cacheContainerAvatars 提前拦截
// 返回（CacheAvatarsFromModel 路由测试已覆盖 missing.* 确定性 no-op）。

func TestContainerAuthorNames(t *testing.T) {
	// 正常 + 空名过滤
	data := makeZip(t, map[string]string{
		"ysm.json": `{"metadata":{"authors":[{"name":"用户A"},{"name":"用户B"},{"name":""}]}}`,
	})
	r, err := container.OpenZipBytes(data, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if got := containerAuthorNames(r); !reflect.DeepEqual(got, []string{"用户A", "用户B"}) {
		t.Errorf("容器作者名应过滤空名, 得到 %v", got)
	}

	// 无 ysm.json → nil
	data2 := makeZip(t, map[string]string{"readme.txt": "x"})
	r2, err := container.OpenZipBytes(data2, int64(len(data2)))
	if err != nil {
		t.Fatal(err)
	}
	defer r2.Close()
	if got := containerAuthorNames(r2); got != nil {
		t.Errorf("无 ysm.json 应返回 nil, 得到 %v", got)
	}

	// 坏 JSON → nil
	data3 := makeZip(t, map[string]string{"ysm.json": "not-json"})
	r3, err := container.OpenZipBytes(data3, int64(len(data3)))
	if err != nil {
		t.Fatal(err)
	}
	defer r3.Close()
	if got := containerAuthorNames(r3); got != nil {
		t.Errorf("坏 JSON 应返回 nil, 得到 %v", got)
	}
}

// ===== 受限读取超限补测 =====

func TestReadLimitedAvatar_Oversize(t *testing.T) {
	// 头像文件超 20MB 上限 → 返回错误（防损坏/超大缓存整读内存膨胀）
	big := filepath.Join(t.TempDir(), "big.png")
	if err := os.WriteFile(big, make([]byte, (20<<20)+1), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := readLimitedAvatar(big); err == nil {
		t.Fatal("超 20MB 头像应返回错误")
	}
}

func TestReadLimitedModel_Oversize(t *testing.T) {
	// 模型文件超 50MB 上限 → 返回错误
	big := filepath.Join(t.TempDir(), "big.json")
	if err := os.WriteFile(big, make([]byte, (50<<20)+1), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := readLimitedModel(big); err == nil {
		t.Fatal("超 50MB 模型应返回错误")
	}
}

// makeZip 构造 zip 字节流（map 顺序随机不影响按名匹配）。
func makeZip(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, data := range entries {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte(data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// ===== 并发缓存写入补测（WriteFileAtomic 原子性，-race 验证不竞态截断）=====

// TestSaveAvatarData_Concurrent 并发 SaveAvatarData 同作者：WriteFileAtomic 原子替换
// 不竞态截断（-race 下验证），且最终落盘内容完整可读（非半写残渣）。
func TestSaveAvatarData_Concurrent(t *testing.T) {
	old := CacheDir
	dir := t.TempDir()
	CacheDir = func() string { return dir }
	defer func() { CacheDir = old }()

	const goroutines = 16
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			// 同一 safeName 并发写：WriteFileAtomic 原子替换，不应截断/竞态
			SaveAvatarData("concurrentuser", []byte("fixed-png-bytes"), "image/png")
		}()
	}
	wg.Wait()

	// 验证最终落盘文件完整可读（非半写残渣）
	uri, err := ReadCachedAvatar("concurrentuser")
	if err != nil {
		t.Fatalf("并发写后读取失败: %v", err)
	}
	if !strings.HasPrefix(uri, "data:image/png;base64,") {
		t.Fatalf("并发写后应可读完整 PNG URI, 得到 %q", uri)
	}
}
