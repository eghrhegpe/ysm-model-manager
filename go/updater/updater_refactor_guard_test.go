// updater_refactor_guard_test.go — downloadOnce / CheckWithClient 重构护栏特征测试。
//
// 覆盖此前无断言的薄分支（go tool cover -func 实测：downloadOnce 87.5%、
// CheckWithClient 98.1%），失败模式是**静默下载损坏 / 校验绕过 / 半截文件残留**：
//   - downloadOnce 的 Content-Type（HTML 错误页）与 Content-Range（部分响应）拒绝，
//     此前用例一律传空 hash → 命中「下载前拒绝」前置门，HTTP 响应校验分支实际从未执行；
//   - 「哈希可得但无本平台安装包」分支只在 SHA256SUMS 在场时才可达；
//   - 恰好等于 maxDownloadSize 的包必须判成功（LimitReader 恰 N 时的截断语义，
//     ADR-033 的邻接面：不得把「恰好 N」静默当成截断，也不得多读一字节）。
//
// 全部走本地 httptest，零真实网络；落盘临时文件由用例自行清理。
package updater

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
)

// sha256Hex 测试侧哈希（downloadOnce 期望的格式：小写 hex）。
func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// TestCheckWithClient_NoPlatformAssetWithSums 覆盖「哈希可得但无本平台安装包」分支：
// 该分支在 SHA256SUMS 缺席时不可达（先按「无 SHA256SUMS」早退），故必须带 SHA256SUMS。
// 载荷形状：Available=false、Latest 标记新版本、URL/ExpectedHash/ReleaseNotes 一律不填。
func TestCheckWithClient_NoPlatformAssetWithSums(t *testing.T) {
	pattern := assetPattern()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/sums") {
			fmt.Fprintf(w, "%s  %s\n", sha256Hex([]byte("pkg")), pattern)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]Release{
			{TagName: "v2.0.0", Body: "新版说明", Draft: false, Prerelease: false,
				Assets: []ReleaseAsset{
					// 只有他平台包：本平台 asset URL 恒空，但 SHA256SUMS 可得
					{Name: "YSM-Model-Manager_other-platform.zip", BrowserDownloadURL: server.URL + "/dl/other"},
					{Name: "SHA256SUMS", BrowserDownloadURL: server.URL + "/sums"},
				}},
		})
	}))
	defer server.Close()

	info, err := CheckWithClient(server.Client(), server.URL, "1.0.0")
	if err != nil {
		t.Fatalf("CheckWithClient() = %v", err)
	}
	if info.Available {
		t.Fatal("无本平台安装包不应 available")
	}
	if info.Latest != "v2.0.0" {
		t.Errorf("Latest = %q, 期望 v2.0.0", info.Latest)
	}
	if info.Current != "1.0.0" {
		t.Errorf("Current = %q, 期望 1.0.0", info.Current)
	}
	// 该分支直接以 {Current, Latest} 收口：不得泄漏 URL/hash/日志（否则前端会当成可下载）
	if info.URL != "" || info.ExpectedHash != "" || info.SHA256SUMSURL != "" || info.ReleaseNotes != "" {
		t.Errorf("不可更新分支不得填充下载字段: %+v", info)
	}
}

// TestDownloadOnce_RejectsHTMLContentTypeWithValidHash 覆盖 Content-Type 非二进制拒绝分支。
// 传**正确**哈希：若拒绝来自哈希校验则本用例失败——锁定拒绝确因 Content-Type。
func TestDownloadOnce_RejectsHTMLContentTypeWithValidHash(t *testing.T) {
	body := []byte("<html><body>Error 404</body></html>")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(body)
	}))
	defer server.Close()

	path, err := downloadOnce(server.URL+"/pkg.exe", sha256Hex(body), nil)
	if err == nil {
		t.Fatalf("HTML 错误页不得当更新包写入（返回路径 %q）", path)
	}
	if path != "" {
		t.Errorf("失败时不应返回路径, got %q", path)
	}
	if errors.Is(err, ErrHashMismatch) {
		t.Errorf("应因 Content-Type 拒绝、而非走到哈希校验: %v", err)
	}
	if !strings.Contains(err.Error(), "Content-Type 非二进制") {
		t.Errorf("错误应指向 Content-Type, got %v", err)
	}
	if !strings.Contains(err.Error(), "text/html") {
		t.Errorf("错误应回显实际 Content-Type, got %v", err)
	}
}

// TestDownloadOnce_RejectsContentRangeWithValidHash 覆盖 Content-Range 部分响应拒绝分支
// （Content-Type 用 application/octet-stream 绕过 HTML 检查，专打 Content-Range）。
func TestDownloadOnce_RejectsContentRangeWithValidHash(t *testing.T) {
	body := []byte("partial-data")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Range", "bytes 0-9/1000")
		_, _ = w.Write(body)
	}))
	defer server.Close()

	path, err := downloadOnce(server.URL+"/pkg.exe", sha256Hex(body), nil)
	if err == nil {
		t.Fatalf("200+Content-Range 截断包不得被接受（返回路径 %q）", path)
	}
	if errors.Is(err, ErrHashMismatch) {
		t.Errorf("应因部分响应拒绝、而非走到哈希校验: %v", err)
	}
	if !strings.Contains(err.Error(), "部分响应（Content-Range）") {
		t.Errorf("错误应指向 Content-Range, got %v", err)
	}
}

// TestDownloadOnce_HappyPathWritesVerifiedFile 覆盖成功落盘路径：
// 返回的临时文件字节与响应体逐字节相同，且哈希校验通过后才返回路径。
func TestDownloadOnce_HappyPathWritesVerifiedFile(t *testing.T) {
	body := bytes.Repeat([]byte("payload-"), 4096)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(body)
	}))
	defer server.Close()

	path, err := downloadOnce(server.URL+"/pkg.exe", strings.ToUpper(sha256Hex(body)), nil)
	if err != nil {
		t.Fatalf("校验通过应返回临时文件路径: %v", err)
	}
	if path == "" {
		t.Fatal("成功时应返回落盘路径")
	}
	t.Cleanup(func() { _ = os.Remove(path) })

	got, rerr := os.ReadFile(path)
	if rerr != nil {
		t.Fatalf("读取落盘文件: %v", rerr)
	}
	if !bytes.Equal(got, body) {
		t.Errorf("落盘字节数与响应体不符: got %d bytes, want %d", len(got), len(body))
	}
	// 大小写不敏感比对（EqualFold）——大写期望哈希也必须通过
	if sha256Hex(got) != sha256Hex(body) {
		t.Errorf("落盘内容哈希与期望不符")
	}
}

// TestDownloadOnceExactLimitIsNotTruncation 恰好等于上限的包必须判成功：
// io.LimitReader(resp.Body, maxDownloadSize) 在「数据恰好 N 字节」与「被截断到 N 字节」
// 之间不可区分，靠「读到上限后再读 1 字节」的探测区分（ADR-033 的同源坑，勿放大）。
// 本用例要求：恰好 N → 成功且字节数精确；不得把恰好 N 误判为超限。
func TestDownloadOnceExactLimitIsNotTruncation(t *testing.T) {
	oldMax := maxDownloadSize
	maxDownloadSize = 1 << 20
	t.Cleanup(func() { maxDownloadSize = oldMax })

	body := bytes.Repeat([]byte("x"), int(maxDownloadSize)) // 恰好 N 字节
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush() // 先发 header → chunked（无 Content-Length），走 LimitReader 上限路径
		_, _ = w.Write(body)
	}))
	defer server.Close()

	path, err := downloadOnce(server.URL+"/pkg.exe", sha256Hex(body), nil)
	if err != nil {
		t.Fatalf("恰好等于上限的包不得被误判为截断: %v", err)
	}
	t.Cleanup(func() { _ = os.Remove(path) })

	got, rerr := os.ReadFile(path)
	if rerr != nil {
		t.Fatalf("读取落盘文件: %v", rerr)
	}
	if len(got) != len(body) {
		t.Errorf("落盘字节数 = %d, 期望恰好 %d", len(got), len(body))
	}
	if !bytes.Equal(got, body) {
		t.Errorf("落盘内容与响应体不符")
	}
}

// TestDownloadOnce_ProgressCallbacks 进度回调语义：
//   - Content-Length 已知：最后一次回调必为 (total, total)（100% 由写满触发）；
//   - 分块传输（total 未知）：尾块补发一次 (n, 0)，进度条不得停在 0/陈旧字节数。
func TestDownloadOnce_ProgressCallbacks(t *testing.T) {
	body := bytes.Repeat([]byte("y"), 256<<10)

	t.Run("Content-Length 已知收口到 100%", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Length", strconv.Itoa(len(body)))
			_, _ = w.Write(body)
		}))
		defer server.Close()

		var seen []struct{ done, total int64 }
		path, err := downloadOnce(server.URL+"/pkg.exe", sha256Hex(body), func(done, total int64) {
			seen = append(seen, struct{ done, total int64 }{done, total})
		})
		if err != nil {
			t.Fatalf("downloadOnce: %v", err)
		}
		t.Cleanup(func() { _ = os.Remove(path) })

		if len(seen) == 0 {
			t.Fatal("已知长度下载应至少回调一次进度")
		}
		last := seen[len(seen)-1]
		if last.done != int64(len(body)) || last.total != int64(len(body)) {
			t.Errorf("最后一次进度 = (%d, %d), 期望 (%d, %d)", last.done, last.total, len(body), len(body))
		}
		for i, s := range seen {
			if s.total != int64(len(body)) {
				t.Errorf("第 %d 次回调 total = %d, 期望 %d", i, s.total, len(body))
			}
		}
	})

	t.Run("分块传输补发尾块", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/octet-stream")
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
			_, _ = w.Write(body)
		}))
		defer server.Close()

		var seen []struct{ done, total int64 }
		path, err := downloadOnce(server.URL+"/pkg.exe", sha256Hex(body), func(done, total int64) {
			seen = append(seen, struct{ done, total int64 }{done, total})
		})
		if err != nil {
			t.Fatalf("downloadOnce: %v", err)
		}
		t.Cleanup(func() { _ = os.Remove(path) })

		if len(seen) == 0 {
			t.Fatal("分块传输应收口补发一次进度（尾块 < 512KB 节流阈值）")
		}
		last := seen[len(seen)-1]
		if last.done != int64(len(body)) || last.total != 0 {
			t.Errorf("尾块补发 = (%d, %d), 期望 (%d, 0)", last.done, last.total, len(body))
		}
	})
}
