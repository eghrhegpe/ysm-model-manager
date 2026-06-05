package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
	"sync"
)

var (
	proxyServer  *http.Server
	proxyMu      sync.Mutex
	proxyRunning bool
)

// StartProxy 启动本地反代服务器（127.0.0.1 仅本机可访问）
func (a *App) StartProxy(port int) error {
	proxyMu.Lock()
	defer proxyMu.Unlock()

	if proxyRunning {
		return nil
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/proxy", handleProxy)

	proxyServer = &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", port),
		Handler: mux,
	}

	proxyRunning = true
	go proxyServer.ListenAndServe()
	return nil
}

// StopProxy 关闭反代服务器
func (a *App) StopProxy() error {
	proxyMu.Lock()
	defer proxyMu.Unlock()

	if !proxyRunning {
		return nil
	}
	proxyRunning = false
	if proxyServer != nil {
		return proxyServer.Close()
	}
	return nil
}

// IsProxyRunning 检查代理是否运行中
func (a *App) IsProxyRunning() bool {
	proxyMu.Lock()
	defer proxyMu.Unlock()
	return proxyRunning
}

func handleProxy(w http.ResponseWriter, r *http.Request) {
	targetURL := r.URL.Query().Get("url")
	if targetURL == "" {
		http.Error(w, "Missing url parameter", http.StatusBadRequest)
		return
	}

	parsed, err := url.Parse(targetURL)
	if err != nil {
		http.Error(w, "Invalid URL", http.StatusBadRequest)
		return
	}
	// 补齐 scheme
	if parsed.Scheme == "" {
		parsed.Scheme = "https"
	}

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL = parsed
			req.Host = parsed.Host
			req.Header.Del("X-Forwarded-For")
			// 模拟常见浏览器 User-Agent
			req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
		},
		ModifyResponse: func(resp *http.Response) error {
			// 删除阻止 iframe 嵌入的响应头
			resp.Header.Del("X-Frame-Options")
			// 处理 CSP 中的 frame-ancestors
			csp := resp.Header.Get("Content-Security-Policy")
			if csp != "" {
				var newParts []string
				for _, part := range strings.Split(csp, ";") {
					trimmed := strings.TrimSpace(part)
					if !strings.HasPrefix(trimmed, "frame-ancestors") {
						newParts = append(newParts, trimmed)
					}
				}
				if len(newParts) > 0 {
					resp.Header.Set("Content-Security-Policy", strings.Join(newParts, "; "))
				} else {
					resp.Header.Del("Content-Security-Policy")
				}
			}

			// 改写 HTML 中的相对路径为绝对路径
			ct := resp.Header.Get("Content-Type")
			if strings.HasPrefix(ct, "text/html") {
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					return err
				}
				resp.Body.Close()
				rewritten := rewriteRelativeURLs(string(body), parsed)
				resp.Body = io.NopCloser(bytes.NewBufferString(rewritten))
				resp.ContentLength = int64(len(rewritten))
			}
			return nil
		},
	}

	proxy.ServeHTTP(w, r)
}

// rewriteRelativeURLs 将 HTML 中的相对路径改写为绝对路径
func rewriteRelativeURLs(html string, base *url.URL) string {
	baseStr := base.Scheme + "://" + base.Host

	// 匹配常见属性中的路径，在回调中判断是否为相对路径
	attrs := []string{`href`, `src`, `action`, `data-src`, `poster`}
	for _, attr := range attrs {
		// 匹配 attr="..."，只捕获值部分
		pattern := regexp.MustCompile(`(` + attr + `\s*=\s*")([^"]+)(")`)
		html = pattern.ReplaceAllStringFunc(html, func(match string) string {
			sub := pattern.FindStringSubmatch(match)
			if len(sub) < 4 {
				return match
			}
			prefix, path, suffix := sub[1], sub[2], sub[3]

			// 跳过绝对路径、协议链接、锚点、JS、data URI
			if isAbsolute(path) {
				return match
			}

			if strings.HasPrefix(path, "/") {
				return prefix + baseStr + path + suffix
			}
			// 相对路径：补上当前路径的目录部分
			dir := base.Path
			if idx := strings.LastIndex(dir, "/"); idx > 0 {
				dir = dir[:idx]
			} else {
				dir = ""
			}
			return prefix + baseStr + dir + "/" + path + suffix
		})
	}

	// 处理 <img srcset="..."> 和类似的逗号分隔 URL 列表
	html = rewriteSrcset(html, baseStr)

	return html
}

// isAbsolute 判断路径是否为绝对/外部链接，无需改写
func isAbsolute(path string) bool {
	return strings.HasPrefix(path, "http://") ||
		strings.HasPrefix(path, "https://") ||
		strings.HasPrefix(path, "//") ||
		strings.HasPrefix(path, "data:") ||
		strings.HasPrefix(path, "javascript:") ||
		strings.HasPrefix(path, "mailto:") ||
		strings.HasPrefix(path, "#") ||
		strings.HasPrefix(path, "about:")
}

// rewriteSrcset 处理 srcset 属性中的相对路径
func rewriteSrcset(html string, base string) string {
	re := regexp.MustCompile(`srcset\s*=\s*"([^"]+)"`)
	return re.ReplaceAllStringFunc(html, func(match string) string {
		sub := re.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		parts := strings.Split(sub[1], ",")
		for i, part := range parts {
			part = strings.TrimSpace(part)
			if strings.HasPrefix(part, "http://") || strings.HasPrefix(part, "https://") || strings.HasPrefix(part, "//") || strings.HasPrefix(part, "data:") {
				continue
			}
			if strings.HasPrefix(part, "/") {
				parts[i] = base + part
			} else {
				parts[i] = base + "/" + part
			}
		}
		return `srcset="` + strings.Join(parts, ", ") + `"`
	})
}
