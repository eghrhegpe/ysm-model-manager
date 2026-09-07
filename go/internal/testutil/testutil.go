package testutil

import (
	"archive/zip"
	"bytes"
	"log"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"ysm-model-manager/go/types/registry"
)

// WaitForCall 轮询等待计数器大于 0，超时后失败。
// 替代各 test file 里重复的 time.Sleep 循环，统一超时配置。
func WaitForCall(t *testing.T, c *atomic.Int32, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if c.Load() > 0 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("call not received within timeout")
}

// WaitForCallNoSleep 轮询等待而不阻塞（用于 spin-wait 场景）。
// 轮询间隔 10ms，总超时 timeout。
func WaitForCallNoSleep(t *testing.T, c *atomic.Int32, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if c.Load() > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("call not received within timeout")
}

// InjectRootRegistry 读取仓库根 resource_types.json 并注入为测试基线。
// 通过从当前工作目录逐层向上查找 resource_types.json，避免相对路径随包深度变化而断裂。
// 失败仅告警不阻断，由调用方 TestMain 自行兜底。
func InjectRootRegistry(m *testing.M) int {
	// 策略一：从 CWD 逐层向上查找 resource_types.json
	// 这比固定的 ../.. 更健壮，可适配任意深度的包结构
	dir, err := os.Getwd()
	if err != nil {
		dir = "."
	}
	for i := 0; i < 20; i++ {
		rtPath := filepath.Join(dir, "resource_types.json")
		if data, err := os.ReadFile(rtPath); err == nil {
			registry.SetBundledRegistryJSON(data)
			log.Println("[testutil] 已注入测试基线 resource_types.json (CWD 路径)")
			return m.Run()
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break // 已到文件系统根目录
		}
		dir = parent
	}

	// 策略二：回退到旧的相对路径行为（兼容性）
	// 仅在策略一失败时作为兜底，防止因 CWD 不可预测而完全丢失基线
	if data, err := os.ReadFile(filepath.Join("..", "..", "resource_types.json")); err == nil {
		registry.SetBundledRegistryJSON(data)
		log.Println("[testutil] 已注入测试基线 resource_types.json (相对路径回退)")
		return m.Run()
	}

	log.Println("[testutil] 警告：未能找到 resource_types.json，注入测试基线失败——LoadRegistry 相关测试将失去基线")
	return m.Run()
}

// WriteFile 在测试临时目录下创建文件，返回完整路径。
// 替代原有的 CreateTestFile / WriteTestFile，功能更统一。
func WriteFile(t *testing.T, name, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

// WriteZip 创建 ZIP 并写入测试临时目录，返回文件路径。
// 替代原有的 WriteZipFile / MakeZipBytes，统一写入磁盘与内存两种模式。
func WriteZip(t *testing.T, name string, entries map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, name)

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

	if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

// BytesZip 纯内存构造 ZIP，不依赖 testing.T。
// 适合纯算法测试或不想写入磁盘的场景。
func BytesZip(entries map[string]string) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range entries {
		w, err := zw.Create(name)
		if err != nil {
			panic(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			panic(err)
		}
	}
	if err := zw.Close(); err != nil {
		panic(err)
	}
	return buf.Bytes()
}

// ----- 向后兼容包装器（调用新函数，保持旧接口可用） -----

// CreateTestFile 在 dir 下创建 name 文件（自动建父目录），返回完整路径。
// 现已委托 WriteFile（始终使用 t.TempDir），旧签名保持可用，建议改用 WriteFile(t, name, content)。
func CreateTestFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	// 兼容旧行为：如果 dir 不为空则使用旧路径，否则回退到 t.TempDir
	var path string
	if dir != "" {
		path = filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
	} else {
		path = WriteFile(t, name, content)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

// WriteTestFile 向完整路径 path 写入 content（自动建父目录），返回 path。
// 现已委托 WriteFile 语义（写入 t.TempDir），旧签名保持可用，建议改用 WriteFile(t, name, content)。
func WriteTestFile(t *testing.T, path, content string) string {
	t.Helper()
	// 兼容旧行为：直接写入指定路径
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("写文件 %s 失败: %v", path, err)
	}
	return path
}

// MakeZipBytes 构造内存 ZIP（entries: 条目名→内容），返回字节。
// 现已委托 BytesZip（不依赖 testing.T），旧签名保持可用，建议改用 BytesZip(entries)。
func MakeZipBytes(t *testing.T, entries map[string]string) []byte {
	return BytesZip(entries)
}

// WriteTestFileBytes 向完整路径 path 写入 byte data（自动建父目录），返回 path。
// 现已委托 WriteTestFile 语义，旧签名保持可用，建议改用 WriteTestFile(t, path, string(data))。
func WriteTestFileBytes(t *testing.T, path string, data []byte) string {
	return WriteTestFile(t, path, string(data))
}

// WriteZipFile 构造 ZIP 并写入 t.TempDir()/name，返回文件路径。
// 现已委托 WriteZip，旧签名保持可用，建议改用 WriteZip(t, name, entries)。
func WriteZipFile(t *testing.T, name string, entries map[string]string) string {
	return WriteZip(t, name, entries)
}
