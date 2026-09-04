// Package testutil 提供跨包复用的 Go 单元测试辅助函数。
package testutil

import (
	"archive/zip"
	"bytes"
	"log"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// InjectRootRegistry 读取仓库根 resource_types.json 注入为 types 包测试基线。
// 供各包 main_test.go 的 TestMain 调用——commit 11bfca3b 删除 go/types 的 CWD
// 相对回退后（生产走 root embed 注入、测试须显式注入），9+ 个包各自复制同构
// TestMain 造成 jscpd 重复债务，收敛为本 helper（各包 TestMain 仅剩薄壳）。
// 失败仅告警不阻断（LoadRegistry 相关测试将失去基线，由该包测试自身兜底暴露）。
func InjectRootRegistry(m *testing.M) {
	if data, err := os.ReadFile(filepath.Join("..", "..", "resource_types.json")); err == nil {
		types.SetBundledRegistryJSON(data)
	} else {
		log.Printf("[testutil] 注入测试基线失败: %v（LoadRegistry 相关测试将失去基线）", err)
	}
	os.Exit(m.Run())
}

// CreateTestFile 在 dir 下创建 name 文件（自动建父目录），返回完整路径。
// 统一 3 个包各自实现的同名 helper（dedup/fsutil/recycle）。
func CreateTestFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

// MakeZipBytes 构造内存 ZIP（entries: 条目名→内容），返回字节。
// 统一 geometry/packs/ysm 五个包各自的 makeZipBytes/makeJar/writeZip 变体。
func MakeZipBytes(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// WriteZipFile 构造 ZIP 并写入 t.TempDir()/name，返回文件路径。
func WriteZipFile(t *testing.T, name string, entries map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, MakeZipBytes(t, entries), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}
