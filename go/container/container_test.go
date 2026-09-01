package container

import (
	"archive/zip"
	"bytes"
	"os"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
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
	if err := writeFile(p, "x"); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(p); err == nil {
		t.Error(".txt 不应作为容器打开")
	}
}

// 剥离禁用后缀后分派（c08c62bc P3 回归锁）：ToggleEnable 改名后的 xxx.zip.disabled
// 必须仍按真实容器类型打开，否则指纹核验对禁用容器失效、扫描结果跨 tab 泄漏错类。
func TestOpen_DisableSuffixDispatch(t *testing.T) {
	if got := types.StripDisableSuffix("a.zip"); got != "a.zip" {
		t.Errorf("无后缀应原样返回: %q", got)
	}
	if got := types.StripDisableSuffix("a.zip.disabled"); got != "a.zip" {
		t.Errorf(".disabled 应剥离: %q", got)
	}
	if got := types.StripDisableSuffix("A.ZIP.BAN"); got != "A.ZIP" {
		t.Errorf(".ban 大小写不敏感剥离且保留原名大小写: %q", got)
	}

	data := makeTestZip(t, map[string]string{"ysm.json": `{}`})
	dir := t.TempDir()
	for _, name := range []string{"m.zip.disabled", "m.zip.ban", "M.ZIP.DISABLED"} {
		p := dir + "/" + name
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
	if err := writeFile(txt, "x"); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(txt); err == nil {
		t.Error(".txt.disabled 不应作为容器打开")
	}
	sub := dir + "/d.disabled"
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	if err := writeFile(sub+"/e.json", "{}"); err != nil {
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
	if err := writeFile(dir+"/a.json", "{}"); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir+"/sub", 0755); err != nil {
		t.Fatal(err)
	}
	if err := writeFile(dir+"/sub/b.json", "{}"); err != nil {
		t.Fatal(err)
	}
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

func writeFile(p, content string) error {
	return os.WriteFile(p, []byte(content), 0644)
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
	// 7z 只读库无 Writer（ADR-068 负面），仅能覆盖坏数据路径：
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
	if err := writeFile(dir+"/root.txt", "ROOT"); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir+"/sub", 0755); err != nil {
		t.Fatal(err)
	}
	if err := writeFile(dir+"/sub/nested.txt", "NESTED"); err != nil {
		t.Fatal(err)
	}
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
	if err := writeFile(pBad, "not a zip"); err != nil {
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
