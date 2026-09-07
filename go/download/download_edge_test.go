// ===== download 包 0% 覆盖函数补测（downloadTimeout / 配置源收敛 go/config / NewWithClient / FromGitHubAPIWithChecksum）=====
package download

import (
	"context"
	"crypto/sha256"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"ysm-model-manager/go/config"
	"ysm-model-manager/go/types"
)

func TestDownloadTimeout_Injected(t *testing.T) {
	config.Set(nil)
	defer config.Set(nil)

	// 注入自定义配置
	called := false
	config.Set(func() types.AppConfig {
		called = true
		return types.AppConfig{DownloadTimeoutSec: 42}
	})
	// 触发 downloadTimeout 读取注入值
	timeout := downloadTimeout()
	if timeout.Seconds() != 42 {
		t.Errorf("downloadTimeout() = %v, 期望 42s", timeout)
	}
	if !called {
		t.Error("注入的 provider 未被调用")
	}

	// 复位为未注入回退默认值
	config.Set(nil)
	timeout = downloadTimeout()
	if timeout != defaultTimeout {
		t.Errorf("config.Set(nil) 后 downloadTimeout() = %v, 期望默认值 %v", timeout, defaultTimeout)
	}
}

func TestDownloadTimeout_ZeroValueFallback(t *testing.T) {
	config.Set(nil)
	defer config.Set(nil)

	// 注入返回零值 AppConfig（DownloadTimeoutSec=0）→ 回退默认
	config.Set(func() types.AppConfig {
		return types.AppConfig{}
	})
	timeout := downloadTimeout()
	if timeout != defaultTimeout {
		t.Errorf("零值 AppConfig 应回退默认超时, got %v", timeout)
	}
	config.Set(nil)
}

func TestNewWithClient(t *testing.T) {
	customClient := &http.Client{Timeout: 0}
	d := NewWithClient(customClient)
	if d == nil {
		t.Fatal("NewWithClient 返回 nil")
	}
	// httpClient() 应返回注入的 client
	client := d.httpClient()
	if client != customClient {
		t.Error("NewWithClient 注入的 client 未被 httpClient() 返回")
	}
}

func TestNew_DefaultTimeout(t *testing.T) {
	// 确保无注入时 New() 使用默认超时
	config.Set(nil)
	defer config.Set(nil)
	d := New()
	if d == nil {
		t.Fatal("New 返回 nil")
	}
	if d.timeout != defaultTimeout {
		t.Errorf("New() timeout = %v, 期望 %v", d.timeout, defaultTimeout)
	}
}

func TestFromGitHubAPIWithChecksum_OK(t *testing.T) {
	body := []byte("checksum me")
	sum := sha256.Sum256(body)
	expectedHash := sum[:]

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Write(body)
	}))
	defer server.Close()

	d := NewWithClient(server.Client())
	dir := t.TempDir()
	savePath := dir + "/out.bin"

	err := d.FromGitHubAPIWithChecksum(context.Background(), server.URL, savePath, nil, expectedHash)
	if err != nil {
		t.Fatalf("FromGitHubAPIWithChecksum 失败: %v", err)
	}
	data, err := os.ReadFile(savePath)
	if err != nil || string(data) != "checksum me" {
		t.Fatalf("内容不符: %q %v", string(data), err)
	}
}

func TestFromGitHubAPIWithChecksum_Mismatch(t *testing.T) {
	body := []byte("checksum me")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Write(body)
	}))
	defer server.Close()

	d := NewWithClient(server.Client())
	dir := t.TempDir()
	savePath := dir + "/out.bin"

	err := d.FromGitHubAPIWithChecksum(context.Background(), server.URL, savePath, nil, make([]byte, 32))
	if err == nil {
		t.Fatal("checksum 不匹配应报错")
	}
}
