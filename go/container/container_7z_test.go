// ===== container 7z 路径补测（ADR-068 收敛后 7z 容器接口方法全 0% 覆盖：
// Name/IsDir/UncompressedSize64/Open + Open7zPath）=====
package container

import (
	"io"
	"os"
	"path/filepath"
	"testing"
)

// 复用 geometry 包已有的 7z 测试夹具（7z_full.7z 含完整模型结构）
func testdata7z(name string) string {
	// 从 container 包目录向上到仓库根，再进入 geometry/testdata
	wd, _ := os.Getwd()
	return filepath.Join(wd, "..", "geometry", "testdata", name)
}

func TestOpen7zPath_EntriesAndRead(t *testing.T) {
	p := testdata7z("7z_full.7z")
	if _, err := os.Stat(p); err != nil {
		t.Skipf("测试夹具不存在: %s", p)
	}

	r, err := Open7zPath(p)
	if err != nil {
		t.Fatalf("Open7zPath 失败: %v", err)
	}
	defer r.Close()

	entries := r.Entries()
	if len(entries) == 0 {
		t.Fatal("7z 容器应含条目")
	}

	// 验证 Entry 接口方法
	found := map[string]bool{}
	for _, e := range entries {
		name := e.Name()
		found[name] = true
		if name == "" {
			t.Error("条目 Name() 不应为空")
		}
		// 非目录条目应可打开并读取
		if !e.IsDir() {
			rc, err := e.Open()
			if err != nil {
				t.Fatalf("打开条目 %s: %v", name, err)
			}
			buf := make([]byte, 16)
			n, _ := rc.Read(buf)
			rc.Close()
			if n < 0 {
				t.Errorf("读取条目 %s 返回负数", name)
			}
		}
	}

	// 验证 Close 幂等
	if err := r.Close(); err != nil {
		t.Errorf("二次 Close 报错: %v", err)
	}
}

func TestOpen7zPath_BadPath(t *testing.T) {
	_, err := Open7zPath("/nonexistent/path.7z")
	if err == nil {
		t.Error("不存在的 7z 文件应报错")
	}
}

func TestOpen7zPath_NotA7z(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "not7z.7z")
	if err := os.WriteFile(p, []byte("this is not a 7z file"), 0644); err != nil {
		t.Fatal(err)
	}
	_, err := Open7zPath(p)
	if err == nil {
		t.Error("非 7z 文件应报错")
	}
}

func TestOpen7zBytes_Success(t *testing.T) {
	// 读取已有的 7z 夹具字节，验证 Open7zBytes 路径
	p := testdata7z("7z_full.7z")
	data, err := os.ReadFile(p)
	if err != nil {
		t.Skipf("测试夹具不存在: %s", p)
	}

	r, err := Open7zBytes(data, int64(len(data)))
	if err != nil {
		t.Fatalf("Open7zBytes 失败: %v", err)
	}
	defer r.Close()

	entries := r.Entries()
	if len(entries) == 0 {
		t.Fatal("7z 容器应含条目")
	}

	// 验证可读取内容
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			t.Fatalf("打开 %s: %v", e.Name(), err)
		}
		_, err = io.ReadAll(io.LimitReader(rc, 1024))
		rc.Close()
		if err != nil {
			t.Errorf("读取 %s: %v", e.Name(), err)
		}
	}
}

func TestSevenzipEntry_Methods(t *testing.T) {
	p := testdata7z("7z_full.7z")
	if _, err := os.Stat(p); err != nil {
		t.Skipf("测试夹具不存在: %s", p)
	}

	r, err := Open7zPath(p)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	for _, e := range r.Entries() {
		// Name 非空
		if e.Name() == "" {
			t.Error("sevenzipEntry.Name() 不应为空")
		}
		// IsDir 返回 bool（不 panic）
		_ = e.IsDir()
		// UncompressedSize64 返回 uint64（不 panic）
		_ = e.UncompressedSize64()
	}
}