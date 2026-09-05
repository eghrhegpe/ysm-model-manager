package testutil

import (
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// TestCreateTestFile_Basic 验证基础场景：文件存在且内容正确。
func TestCreateTestFile_Basic(t *testing.T) {
	dir := t.TempDir()
	path := CreateTestFile(t, dir, "hello.txt", "hello world")

	// 路径应在 dir 下
	if got := filepath.Dir(path); got != dir {
		t.Fatalf("期望路径目录 %q，得到 %q", dir, got)
	}
	if got := filepath.Base(path); got != "hello.txt" {
		t.Fatalf("期望文件名 hello.txt，得到 %q", got)
	}

	// 文件内容应匹配
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(data); got != "hello world" {
		t.Errorf("期望内容 %q，得到 %q", "hello world", got)
	}
}

// TestCreateTestFile_NestedDir 验证自动创建多级父目录。
func TestCreateTestFile_NestedDir(t *testing.T) {
	dir := t.TempDir()
	deep := filepath.Join(dir, "a", "b", "c")
	path := CreateTestFile(t, deep, "file.txt", "nested")

	// 目录应被自动创建
	if info, err := os.Stat(deep); err != nil {
		t.Fatalf("多级目录应被自动创建: %v", err)
	} else if !info.IsDir() {
		t.Fatal("路径应是目录")
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(data); got != "nested" {
		t.Errorf("期望内容 nested，得到 %q", got)
	}
}

// TestCreateTestFile_EmptyName 验证 name 为空时行为（path = dir，os.WriteFile 写目录会失败）。
// CreateTestFile 内部用 t.Fatal 终止测试；本测试绕过 t.Helper 直接验证该错误路径。
func TestCreateTestFile_EmptyName(t *testing.T) {
	dir := t.TempDir()
	// 直接调用 helper，不经过 t.Helper，以捕获内部 os.WriteFile 返回的错误。
	// 由于 CreateTestFile 使用 t.Fatal，我们需要用 recover 捕获 runtime.Goexit。
	// Go 的 testing.T.Fatal 内部调用 runtime.Goexit()，不能用 recover 捕获，
	// 因此我们直接在子例程外手动模拟相同逻辑来验证错误行为。
	err := func() error {
		path := filepath.Join(dir, "") // = dir
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return err
		}
		return os.WriteFile(path, []byte("content"), 0644)
	}()
	if err == nil {
		t.Fatal("期望写入目录时报错（is a directory）")
	}
	// 用 sentinel 判断错误类别（写入目录 → EISDIR），避免依赖平台错误文本。
	if !errors.Is(err, syscall.EISDIR) {
		t.Fatalf("期望 EISDIR 错误（写入目录），得到: %v", err)
	}
}

// TestCreateTestFile_Overwrite 验证对已存在文件再次创建是原地覆盖（先删后建的反面）：
// 文件不会被删除重建（失败无回滚窗口），内容被截断替换。
func TestCreateTestFile_Overwrite(t *testing.T) {
	dir := t.TempDir()
	name := "cfg.txt"
	CreateTestFile(t, dir, name, "v1")
	CreateTestFile(t, dir, name, "v2-longer")

	path := filepath.Join(dir, name)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(data); got != "v2-longer" {
		t.Errorf("期望覆盖后内容 %q，得到 %q", "v2-longer", got)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !info.Mode().IsRegular() {
		t.Fatalf("期望普通文件，得到 mode %v", info.Mode())
	}
}

// TestCreateTestFile_EmptyContent 验证空内容可创建零字节文件。
func TestCreateTestFile_EmptyContent(t *testing.T) {
	dir := t.TempDir()
	path := CreateTestFile(t, dir, "empty.txt", "")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() != 0 {
		t.Errorf("期望零字节文件，得到 %d 字节", info.Size())
	}
}

// TestMakeZipBytes_NestedEntries 验证带目录前缀的条目名（如 "dir/sub/file.txt"）可正确写入。
func TestMakeZipBytes_NestedEntries(t *testing.T) {
	b := MakeZipBytes(t, map[string]string{"dir/sub/file.txt": "deep"})

	r, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatalf("期望合法 zip: %v", err)
	}
	found := false
	for _, f := range r.File {
		if f.Name != "dir/sub/file.txt" {
			continue
		}
		found = true
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatal(err)
		}
		if got := string(data); got != "deep" {
			t.Errorf("期望内容 deep，得到 %q", got)
		}
	}
	if !found {
		t.Fatal("未找到条目 dir/sub/file.txt")
	}
}

// TestWriteZipFile_EmptyEntries 验证空条目也能写出合法 zip。
func TestWriteZipFile_EmptyEntries(t *testing.T) {
	path := WriteZipFile(t, "empty.zip", map[string]string{})

	r, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("期望能打开 zip: %v", err)
	}
	defer r.Close()
	if got := len(r.File); got != 0 {
		t.Fatalf("期望 0 个条目，得到 %d", got)
	}
}

// TestMakeZipBytes_Empty 空 entries → 得到一个合法的空 zip。
func TestMakeZipBytes_Empty(t *testing.T) {
	b := MakeZipBytes(t, map[string]string{})

	// 非空字节（zip 有 EOCD 记录）
	if len(b) == 0 {
		t.Fatal("期望非空字节")
	}

	// 能作为合法 zip 打开并列出条目
	r, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatalf("期望合法 zip: %v", err)
	}
	if got := len(r.File); got != 0 {
		t.Fatalf("期望 0 个条目，得到 %d", got)
	}
}

// TestMakeZipBytes_SingleEntry 单条目验证名称和内容。
func TestMakeZipBytes_SingleEntry(t *testing.T) {
	b := MakeZipBytes(t, map[string]string{"a.txt": "alpha"})

	r, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatalf("期望合法 zip: %v", err)
	}
	if got := len(r.File); got != 1 {
		t.Fatalf("期望 1 个条目，得到 %d", got)
	}
	f, err := r.Open("a.txt")
	if err != nil {
		t.Fatalf("无法打开条目 a.txt: %v", err)
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(data); got != "alpha" {
		t.Errorf("期望内容 alpha，得到 %q", got)
	}
}

// TestMakeZipBytes_MultiEntry 多条目验证所有条目都在。
func TestMakeZipBytes_MultiEntry(t *testing.T) {
	entries := map[string]string{
		"x.txt": "xx",
		"y.txt": "yy",
		"z.txt": "zz",
	}
	b := MakeZipBytes(t, entries)

	r, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatalf("期望合法 zip: %v", err)
	}
	if got := len(r.File); got != 3 {
		t.Fatalf("期望 3 个条目，得到 %d", got)
	}

	want := map[string]string{"x.txt": "xx", "y.txt": "yy", "z.txt": "zz"}
	for _, f := range r.File {
		wc, ok := want[f.Name]
		if !ok {
			t.Errorf("意外的条目 %q", f.Name)
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("打开 %q 失败: %v", f.Name, err)
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("读取 %q 失败: %v", f.Name, err)
		}
		if got := string(data); got != wc {
			t.Errorf("条目 %q 内容期望 %q，得到 %q", f.Name, wc, got)
		}
	}
}

// TestMakeZipBytes_ReadZip 把结果当 zip 读回来，验证条目可正常读取。
func TestMakeZipBytes_ReadZip(t *testing.T) {
	entries := map[string]string{
		"readme.md": "# Hello\n",
		"data.csv":  "a,b,c\n1,2,3\n",
	}
	b := MakeZipBytes(t, entries)

	// 模拟下游消费：直接传入 zip.NewReader
	r, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatalf("期望合法 zip: %v", err)
	}
	for _, f := range r.File {
		want, ok := entries[f.Name]
		if !ok {
			t.Errorf("意外的条目 %q", f.Name)
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("打开 %q 失败: %v", f.Name, err)
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("读取 %q 失败: %v", f.Name, err)
		}
		if got := string(data); got != want {
			t.Errorf("条目 %q 内容期望 %q，得到 %q", f.Name, want, got)
		}
	}
}

// TestWriteZipFile_CreatedInTempDir 返回路径存在、是 zip、能打开。
func TestWriteZipFile_CreatedInTempDir(t *testing.T) {
	path := WriteZipFile(t, "out.zip", map[string]string{"inside.txt": "yes"})

	// WriteZipFile 内部用 t.TempDir()，路径应在某个子目录（Go 测试并行隔离给 001 等）。
	// 仅需验证：文件存在、是文件、作为 zip 可打开。
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.IsDir() {
		t.Fatal("期望是文件")
	}

	// 作为 zip 可打开
	r, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("期望能打开 zip: %v", err)
	}
	r.Close()
}

// TestWriteZipFile_EntriesValid 把写出的 zip 读回验证内容。
func TestWriteZipFile_EntriesValid(t *testing.T) {
	entries := map[string]string{
		"foo.txt": "foo content",
		"bar.txt": "bar content",
	}
	path := WriteZipFile(t, "pkg.zip", entries)

	r, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("期望能打开 zip: %v", err)
	}
	defer r.Close()

	for _, f := range r.File {
		want, ok := entries[f.Name]
		if !ok {
			t.Errorf("意外的条目 %q", f.Name)
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("打开 %q 失败: %v", f.Name, err)
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("读取 %q 失败: %v", f.Name, err)
		}
		if got := string(data); got != want {
			t.Errorf("条目 %q 内容期望 %q，得到 %q", f.Name, want, got)
		}
	}
}
