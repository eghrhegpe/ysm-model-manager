package container

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types/registry"
)

// makeTestZip 构造含条目的 zip 内存字节。
func makeTestZip(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, content := range entries {
		fw, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fw.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestOpenZipBytes_EntriesAndRead(t *testing.T) {
	data := makeTestZip(t, map[string]string{
		"ysm.json":         `{"metadata":{"authors":[]}}`,
		"models/main.json": `{"format_version":"1.12.0"}`,
		"textures/a.png":   "PNG",
	})
	r, err := OpenZipBytes(data, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	entries := r.Entries()
	if len(entries) != 3 {
		t.Fatalf("期望 3 条目, 实际 %d", len(entries))
	}
	// 名称与读取
	found := map[string]bool{}
	for _, e := range entries {
		found[e.Name()] = true
		if e.IsDir() {
			t.Errorf("测试 zip 无目录条目: %s", e.Name())
		}
		rc, err := e.Open()
		if err != nil {
			t.Fatalf("打开 %s: %v", e.Name(), err)
		}
		buf := make([]byte, 32)
		n, _ := rc.Read(buf)
		rc.Close()
		if n == 0 {
			t.Errorf("读取 %s 为空", e.Name())
		}
	}
	for _, want := range []string{"ysm.json", "models/main.json", "textures/a.png"} {
		if !found[want] {
			t.Errorf("缺失条目 %s", want)
		}
	}
}

func TestOpenBytes_UnknownFormat(t *testing.T) {
	// 非 zip/7z 魔数 → Open 按扩展名拒绝；OpenZipBytes 应报错
	if _, err := OpenZipBytes([]byte("not a zip"), 8); err == nil {
		t.Error("非 zip 字节应报错")
	}
}

func TestOpen_UnsupportedExt(t *testing.T) {
	// 临时 .txt 文件：Open 应拒绝（仅 zip/7z/目录）
	dir := t.TempDir()
	p := dir + "/x.txt"
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(p); err == nil {
		t.Error(".txt 不应作为容器打开")
	}
}

// 剥离禁用后缀后分派（c08c62bc P3 回归锁）：ToggleEnable 改名后的 xxx.zip.disabled
// 必须仍按真实容器类型打开，否则指纹核验对禁用容器失效、扫描结果跨 tab 泄漏错类。
func TestOpen_DisableSuffixDispatch(t *testing.T) {
	if got := registry.StripDisableSuffix("a.zip"); got != "a.zip" {
		t.Errorf("无后缀应原样返回: %q", got)
	}
	if got := registry.StripDisableSuffix("a.zip.disabled"); got != "a.zip" {
		t.Errorf(".disabled 应剥离: %q", got)
	}
	if got := registry.StripDisableSuffix("A.ZIP.BAN"); got != "A.ZIP" {
		t.Errorf(".ban 大小写不敏感剥离且保留原名大小写: %q", got)
	}

	data := makeTestZip(t, map[string]string{"ysm.json": `{}`})
	dir := t.TempDir()
	for _, name := range []string{"m.zip.disabled", "m.zip.ban", "M.ZIP.DISABLED"} {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, data, 0644); err != nil {
			t.Fatal(err)
		}
		r, err := Open(p)
		if err != nil {
			t.Fatalf("%s 应按 zip 容器打开: %v", name, err)
		}
		if n := len(r.Entries()); n != 1 {
			t.Errorf("%s 条目数期望 1, 实际 %d", name, n)
		}
		r.Close()
	}

	// 剥离只影响分派：非容器格式 + 禁用后缀仍拒绝；目录 + 禁用后缀仍走目录直读
	txt := dir + "/x.txt.disabled"
	if err := os.WriteFile(txt, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(txt); err == nil {
		t.Error(".txt.disabled 不应作为容器打开")
	}
	sub := dir + "/d.disabled"
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sub+"/e.json", []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	rd, err := Open(sub)
	if err != nil {
		t.Fatalf("目录 + 禁用后缀应走目录直读: %v", err)
	}
	rd.Close()
}

func TestOpenDir_Entries(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "a.json", "{}")
	testutil.CreateTestFile(t, dir, "sub/b.json", "{}")
	r, err := OpenDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	names := map[string]bool{}
	for _, e := range r.Entries() {
		names[e.Name()] = true
	}
	if !names["a.json"] || !names["sub/b.json"] {
		t.Errorf("目录条目缺失: %v", names)
	}
}

// ===== ADR-068 补测：路径打开 / 7z 坏数据 / UncompressedSize64 / 目录条目读取 =====

func TestOpenZipPath_EntriesAndSize(t *testing.T) {
	dir := t.TempDir()
	p := dir + "/pkg.zip"
	zipBytes := makeTestZip(t, map[string]string{
		"a.json": "AAAA",
		"b.json": "BBBBBBBB",
	})
	if err := os.WriteFile(p, zipBytes, 0644); err != nil {
		t.Fatal(err)
	}
	r, err := OpenZipPath(p)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	byName := map[string]Entry{}
	for _, e := range r.Entries() {
		byName[e.Name()] = e
	}
	if len(byName) != 2 {
		t.Fatalf("期望 2 条目, 实际 %d", len(byName))
	}
	// UncompressedSize64 应为条目未压缩大小（zip.File.UncompressedSize64 原值）
	if got := byName["a.json"].UncompressedSize64(); got != 4 {
		t.Errorf("a.json UncompressedSize64 = %d, 期望 4", got)
	}
	if got := byName["b.json"].UncompressedSize64(); got != 8 {
		t.Errorf("b.json UncompressedSize64 = %d, 期望 8", got)
	}
	// 条目可读
	rc, err := byName["a.json"].Open()
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	buf := make([]byte, 4)
	if n, _ := rc.Read(buf); n != 4 || string(buf) != "AAAA" {
		t.Errorf("a.json 读取 = %q, 期望 AAAA", buf)
	}
}

func TestOpen7zBytes_BadData(t *testing.T) {
	// 7z 只读库无写入接口——ADR-068 容器契约的「负面」含义即写能力是设计上缺席
	// （而非遗漏）：只读容器不暴露 Writer，故 7z 的负面测试只能覆盖坏数据路径：
	// 非 7z 魔数 → sevenzip.NewReader 必须报错，不得 panic 或静默返回空容器
	bad := []byte("this is definitely not a 7z archive")
	if _, err := Open7zBytes(bad, int64(len(bad))); err == nil {
		t.Error("非 7z 字节应报错")
	}
	if _, err := Open7zBytes(nil, 0); err == nil {
		t.Error("空字节应报错")
	}
}

func TestOpenDir_NestedDirAndRead(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "root.txt", "ROOT")
	testutil.CreateTestFile(t, dir, "sub/nested.txt", "NESTED")
	r, err := OpenDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	byName := map[string]Entry{}
	var dirEntry *Entry
	for _, e := range r.Entries() {
		byName[e.Name()] = e
		if e.IsDir() {
			dirEntry = &e
		}
	}
	// 嵌套目录条目应存在且 IsDir=true
	if dirEntry == nil {
		t.Fatal("嵌套目录 sub/ 应有目录条目")
	}
	// 文件条目可读取内容
	rc, err := byName["sub/nested.txt"].Open()
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	buf := make([]byte, 16)
	n, _ := rc.Read(buf)
	if n != 6 || string(buf[:n]) != "NESTED" {
		t.Errorf("sub/nested.txt 读取 = %q, 期望 NESTED", buf[:n])
	}
	// UncompressedSize64 = FileInfo.Size 绝对值（目录型返回 0 或负值不应出现）
	if got := byName["root.txt"].UncompressedSize64(); got != 4 {
		t.Errorf("root.txt UncompressedSize64 = %d, 期望 4", got)
	}
}

func TestOpenDir_NotExist(t *testing.T) {
	// openDir 根目录预检：不存在的路径应报错而非静默返回空容器
	if _, err := OpenDir(t.TempDir() + "/nope"); err == nil {
		t.Error("不存在的目录应报错")
	}
}

// ===== ZipMatchesEntries 表驱动直测（此前仅被 types.ZipEntry 检测器间接覆盖）=====

func TestZipMatchesEntries(t *testing.T) {
	dir := t.TempDir()
	zipData := makeTestZip(t, map[string]string{
		"Models/A.JSON": "{}", // 大小写混合条目；match 接收小写名（与 MatchZipEntry 口径一致）
	})
	pZip := dir + "/pkg.zip"
	if err := os.WriteFile(pZip, zipData, 0644); err != nil {
		t.Fatal(err)
	}
	pDisabled := dir + "/pkg.zip.disabled"
	if err := os.WriteFile(pDisabled, zipData, 0644); err != nil {
		t.Fatal(err)
	}
	pBad := dir + "/bad.zip"
	if err := os.WriteFile(pBad, []byte("not a zip"), 0o644); err != nil {
		t.Fatal(err)
	}
	pFake7z := dir + "/fake.7z"
	if err := os.WriteFile(pFake7z, zipData, 0644); err != nil {
		t.Fatal(err)
	}
	matchA := func(string) bool { return true }

	cases := []struct {
		name  string
		path  string
		match func(string) bool
		want  bool
	}{
		{"命中条目（小写匹配）", pZip, func(n string) bool { return n == "models/a.json" }, true},
		{"未命中", pZip, func(n string) bool { return n == "ysm.json" }, false},
		{"条目名小写化后前缀匹配", pZip, func(n string) bool { return strings.HasPrefix(n, "models/") }, true},
		{"禁用后缀仍按 zip 枚举", pDisabled, matchA, true},
		{"非 zip 扩展直接拒绝", pFake7z, matchA, false},
		{"损坏 zip 安全排除", pBad, matchA, false},
		{"路径不存在安全排除", dir + "/ghost.zip", matchA, false},
	}
	for _, tc := range cases {
		if got := ZipMatchesEntries(tc.path, tc.match); got != tc.want {
			t.Errorf("%s: ZipMatchesEntries(%s) = %v, 期望 %v", tc.name, tc.path, got, tc.want)
		}
	}
}

// ===== MatchEntryName / FindEntry：容器扫名收口（avatar matchAvatarZipEntry 契约下沉）=====

func TestMatchEntryName(t *testing.T) {
	cases := []struct {
		name   string
		p      string
		target string
		want   bool
	}{
		{"精确路径命中", "A/B.png", "A/b.png", true},
		{"精确路径大小写", "avatar/alice.png", "Avatar/Alice.PNG", true},
		{"反斜杠归一", `A\b.png`, "a/b.png", true},
		{"sub/ 前缀不误命中精确目标", "sub/avatar/alice.png", "avatar/alice.png", false},
		{"目录级前缀命中", "avatar/a.png", "avatar/", true},
		{"目录级前缀非根子目录", "sub/avatar/a.png", "avatar/", false},
		{"裸名命中任意目录", "x/test.png", "test.png", true},
		{"裸名根级命中", "test.png", "test.png", true},
		{"裸名不含路径分隔", "test.png", "te.png", false},
		{"无命中外体", "avatar/b.png", "avatar/c.png", false},
	}
	for _, tc := range cases {
		got := MatchEntryName(tc.p, tc.target)
		if got != tc.want {
			t.Errorf("MatchEntryName(%q, %q) = %v, 期望 %v", tc.p, tc.target, got, tc.want)
		}
	}
}

func TestFindEntry(t *testing.T) {
	data := makeTestZip(t, map[string]string{
		"Avatar/a.png":         "A",
		"sub/avatar/alice.png": "S", // 隐蔽重复名：精确目标不得误命中
		"models/x.json":        "J",
	})
	r, err := OpenZipBytes(data, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	if e, ok := FindEntry(r, "avatar/a.png"); !ok {
		t.Error("精确路径应命中 avatar/a.png")
	} else if e.Name() != "Avatar/a.png" {
		t.Errorf("命中条目名 = %q, 期望 Avatar/a.png", e.Name())
	}
	if _, ok := FindEntry(r, "a.png"); !ok {
		t.Error("裸名应命中任意目录 a.png")
	}
	if _, ok := FindEntry(r, "avatar/"); !ok {
		t.Error("目录前缀 avatar/ 应命中")
	}
	if _, ok := FindEntry(r, "avatar/alice.png"); ok {
		t.Error("sub/avatar/alice.png 不得被精确目标 avatar/alice.png 命中")
	}
	if _, ok := FindEntry(r, "ghost.json"); ok {
		t.Error("不存在目标应无命中")
	}
}

// FindEntry 跳过目录条目：zip 中显式的目录型条目不作为文件返回。
func TestFindEntry_SkipsDirEntry(t *testing.T) {
	data := makeTestZip(t, map[string]string{"dir/inner.txt": "I"})
	r, err := OpenZipBytes(data, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	e, ok := FindEntry(r, "inner.txt")
	if !ok || e.IsDir() {
		t.Fatalf("FindEntry 应返回非目录条目, ok=%v dir=%v", ok, e != nil && e.IsDir())
	}
}
