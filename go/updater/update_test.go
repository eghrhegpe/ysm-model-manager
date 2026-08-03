package updater

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNormalize(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"v1.2.3", "1.2.3"},
		{"  v1.2.3  ", "1.2.3"},
		{"1.2.3", "1.2.3"},
		{"v1.2.3-beta", "1.2.3-beta"},
		{"v2.0.0", "2.0.0"},
		{"  2.0.0  ", "2.0.0"},
		{"v", ""},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("input=%q", tt.input), func(t *testing.T) {
			result := normalize(tt.input)
			if result != tt.expected {
				t.Errorf("normalize(%q) = %q, 期望 %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestIsNewer(t *testing.T) {
	tests := []struct {
		a        string
		b        string
		expected bool
	}{
		{"1.2.3", "1.2.2", true},
		{"1.2.3", "1.2.3", false},
		{"1.3.0", "1.2.9", true},
		{"1.2", "1.2.3", false},
		{"1.2.3", "1.2", true},
		{"2.0.0", "1.9.9", true},
		{"1.0.0", "2.0.0", false},
		{"1.10.0", "1.9.0", true},
		{"1.2.10", "1.2.9", true},
		{"1.2.0", "1.2.0", false},
		// 脏 tag 防御：vv1.1.0 normalize 后首段 "v1" 非数字 → splitVer 按 0 处理，
		// 恒小于正常版本，绝不误触发更新
		{"v1.1.0", "1.9.3", false},
		{"v1.1.0", "1.0.0", false},
		{"v1.1.0", "v1.1.0", false},
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("%s_vs_%s", tt.a, tt.b), func(t *testing.T) {
			result := isNewer(tt.a, tt.b)
			if result != tt.expected {
				t.Errorf("isNewer(%q, %q) = %v, 期望 %v", tt.a, tt.b, result, tt.expected)
			}
		})
	}
}

func TestSplitVer(t *testing.T) {
	tests := []struct {
		input    string
		expected []int
	}{
		{"1.2.3-beta", []int{1, 2, 3}},
		{"1.2.3+build", []int{1, 2, 3}},
		{"1.a.3", []int{1, 0, 3}},
		{"2", []int{2}},
		{"1.2.3", []int{1, 2, 3}},
		{"1.2", []int{1, 2}},
		{"1.2.3.4", []int{1, 2, 3, 4}},
		{"", []int{0}},
		{"x.y.z", []int{0, 0, 0}},
		// 脏 tag 防御：normalize 只去一个 v（vv1.1.0 → "v1.1.0"）；splitVer 直接处理
		// "vv1.1.0" 时首段 "vv1" Atoi 失败按 0 → [0,1,0]
		{"v1.1.0", []int{0, 1, 0}},
		{"vv1.1.0", []int{0, 1, 0}},
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("input=%q", tt.input), func(t *testing.T) {
			result := splitVer(tt.input)
			if len(result) != len(tt.expected) {
				t.Fatalf("splitVer(%q) 长度 = %d, 期望 %d", tt.input, len(result), len(tt.expected))
			}
			for i := range result {
				if result[i] != tt.expected[i] {
					t.Errorf("splitVer(%q)[%d] = %d, 期望 %d", tt.input, i, result[i], tt.expected[i])
				}
			}
		})
	}
}

func TestFetchExpectedHash(t *testing.T) {
	// 模拟 SHA256SUMS 文件内容
	sumsContent := `abc123def456  YSM-Model-Manager_windows_amd64.zip
fed789cba012 *YSM-Model-Manager_windows_arm64.zip
000000000000  other-file.tar.gz`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(sumsContent))
	}))
	defer server.Close()

	tests := []struct {
		fileName string
		expected string
	}{
		{"YSM-Model-Manager_windows_amd64.zip", "abc123def456"},
		{"YSM-Model-Manager_windows_arm64.zip", "fed789cba012"},
		{"YSM-Model-Manager_linux_amd64.tar.gz", ""},
		{"other-file.tar.gz", "000000000000"},
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("file=%s", tt.fileName), func(t *testing.T) {
			result := fetchExpectedHash(server.URL+"/sums", tt.fileName)
			if result != tt.expected {
				t.Errorf("fetchExpectedHash(..., %q) = %q, 期望 %q", tt.fileName, result, tt.expected)
			}
		})
	}
}

func TestFetchExpectedHash_EmptyResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(""))
	}))
	defer server.Close()

	result := fetchExpectedHash(server.URL+"/sums", "YSM-Model-Manager_windows_amd64.zip")
	if result != "" {
		t.Errorf("空响应应返回空字符串，得到 %q", result)
	}
}

func TestFetchExpectedHash_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	result := fetchExpectedHash(server.URL+"/sums", "YSM-Model-Manager_windows_amd64.zip")
	if result != "" {
		t.Errorf("服务器错误应返回空字符串，得到 %q", result)
	}
}

func TestFetchExpectedHash_InvalidURL(t *testing.T) {
	result := fetchExpectedHash("http://invalid-url-that-does-not-exist.local/sums", "test.zip")
	if result != "" {
		t.Errorf("无效 URL 应返回空字符串，得到 %q", result)
	}
}