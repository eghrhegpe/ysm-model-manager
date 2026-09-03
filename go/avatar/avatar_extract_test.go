package avatar

import (
	"strings"
	"testing"
)

// ysmFileFromStr 将字符串按字节构造解码文件条目（ysmDecodedFile.Data 为 []byte
// 直通形态——2026-09 外部锐评 #2 后无 []int 中间形态，纯函数表驱动直接喂 []byte）。
func ysmFileFromStr(path, content string) ysmDecodedFile {
	return ysmDecodedFile{Path: path, Data: []byte(content)}
}

// withTempCache 将 CacheDir 接管到临时目录，避免污染真实用户缓存。
func withTempCache(t *testing.T) {
	t.Helper()
	old := CacheDir
	CacheDir = func() string { return t.TempDir() }
	t.Cleanup(func() { CacheDir = old })
}

// TestExtractAvatarCandidates 验证头像引用候选路径生成（纯函数，零 IO）。
func TestExtractAvatarCandidates(t *testing.T) {
	cases := []struct {
		ref   string
		want  []string
		isNil bool
	}{
		{ref: "", isNil: true},
		{
			ref:  "sdf",
			want: []string{"sdf", "avatar/sdf.png", "avatar/sdf.jpg", "avatar/sdf.jpeg"},
		},
		{
			ref:  "avatar/alice.png",
			want: []string{"avatar/alice.png", "avatar/alice.jpg", "avatar/alice.jpeg"},
		},
	}
	for _, c := range cases {
		got := avatarCandidates(c.ref)
		if c.isNil {
			if got != nil {
				t.Errorf("avatarCandidates(%q)=%v, 期望 nil", c.ref, got)
			}
			continue
		}
		for _, w := range c.want {
			if !contains(got, w) {
				t.Errorf("avatarCandidates(%q) 缺少 %q, 实际 %v", c.ref, w, got)
			}
		}
	}
}

// TestParseYSMJSONAuthors 验证 ysm.json 作者列表解析（纯函数，喂 ysmFile 切片）。
func TestParseYSMJSONAuthors(t *testing.T) {
	json := `{"metadata":{"authors":[{"name":"Alice","avatar":"avatar/alice.png"},{"name":"Bob","avatar":"bob.jpg"}]}}`
	files := []ysmDecodedFile{
		ysmFileFromStr("ysm.json", json),
		ysmFileFromStr("avatar/alice.png", "\x89PNG"),
	}

	authors := parseYSMJSONAuthors(files)
	if len(authors) != 2 {
		t.Fatalf("解析作者数=%d, 期望 2", len(authors))
	}
	if authors[0].Name != "Alice" || authors[0].Avatar != "avatar/alice.png" {
		t.Errorf("authors[0]=%+v, 期望 Alice/avatar/alice.png", authors[0])
	}
	if authors[1].Name != "Bob" || authors[1].Avatar != "bob.jpg" {
		t.Errorf("authors[1]=%+v, 期望 Bob/bob.jpg", authors[1])
	}

	// 无 ysm.json 时返回 nil
	if got := parseYSMJSONAuthors([]ysmDecodedFile{ysmFileFromStr("model.pmx", "x")}); got != nil {
		t.Errorf("无 ysm.json 时解析=%v, 期望 nil", got)
	}
}

// TestMatchAvatarByAuthor 验证按作者名匹配 avatar 字段（纯函数，零 IO）。
func TestMatchAvatarByAuthor(t *testing.T) {
	withTempCache(t)

	json := `{"metadata":{"authors":[{"name":"Alice","avatar":"avatar/alice.png"}]}}`
	files := []ysmDecodedFile{
		ysmFileFromStr("ysm.json", json),
		ysmFileFromStr("avatar/alice.png", "\x89PNG..."),
	}
	authors := parseYSMJSONAuthors(files)

	// 命中：作者存在且头像文件存在 → 返回非空 data URI
	got := matchAvatarByAuthor(files, authors, SafeName("Alice"))
	if got == "" {
		t.Fatal("匹配 Alice 期望非空结果")
	}
	if !strings.HasPrefix(got, "data:") {
		t.Errorf("返回值 %q 应为 data URI", got)
	}

	// 未命中：作者存在但头像文件缺失 → 返回空
	missFiles := []ysmDecodedFile{ysmFileFromStr("ysm.json", json)}
	if got := matchAvatarByAuthor(missFiles, authors, SafeName("Alice")); got != "" {
		t.Errorf("头像缺失时匹配=%q, 期望空", got)
	}
}

// TestExtractFallbackAvatarFromDir 验证降级路径：取 avatar/ 目录第一张图片（纯函数）。
func TestExtractFallbackAvatarFromDir(t *testing.T) {
	withTempCache(t)

	files := []ysmDecodedFile{
		ysmFileFromStr("avatar/face.png", "\x89PNG..."),
		ysmFileFromStr("model.pmx", "binary"),
	}
	if got := extractFallbackAvatarFromDir(files, "Alice"); got == "" {
		t.Fatal("降级路径期望命中 avatar/face.png")
	}

	// 无 avatar/ 目录图片 → 返回空
	noAvatar := []ysmDecodedFile{ysmFileFromStr("model.pmx", "binary")}
	if got := extractFallbackAvatarFromDir(noAvatar, "Alice"); got != "" {
		t.Errorf("无头像时降级=%q, 期望空", got)
	}
}

// TestExtractAvatarURIRouting 验证分发器按扩展名路由且不 panic；
// 缺失文件经 readLimitedModel 返回 error → 各分支确定性降级为 ""（无需 WASM）。
// 注意：extractAvatarFromYSM 的 .ysm 真解码路径依赖 WASM/Node 运行时，
// 属集成测试范畴，本单测不覆盖。
func TestExtractAvatarURIRouting(t *testing.T) {
	cases := []struct {
		path string
	}{
		{"missing.ysm"},
		{"missing.zip"},
		{"missing.7z"},
		{"missing.json"},
		{"readme.txt"},
	}
	for _, c := range cases {
		if got := ExtractAvatarURI(c.path, "Alice"); got != "" {
			t.Errorf("ExtractAvatarURI(%q)=%q, 期望空（缺失文件/未知扩展名）", c.path, got)
		}
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
