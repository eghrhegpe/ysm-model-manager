package app

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strconv"
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

// isBlockedIP 判断 IP 是否为内网/本机形态（SSRF 防护共用）
func isBlockedIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}

// isNumericIPNotation 判断主机名是否为十进制/十六进制整数形态 IP——
// net.ParseIP 不识别「2130706433」（=127.0.0.1）与「0x7f000001」，可绕过字面量 IP 校验。
// 仅当主机名不含点（纯数字整数形态）且能整体解析为数字时才判定；普通域名/含点 IP 不受影响。
func isNumericIPNotation(host string) bool {
	if strings.Contains(host, ".") || host == "" {
		return false
	}
	// 十进制纯数字
	if _, err := strconv.ParseUint(host, 10, 64); err == nil {
		return true
	}
	// 十六进制 0x 前缀
	if strings.HasPrefix(strings.ToLower(host), "0x") {
		if _, err := strconv.ParseUint(host[2:], 16, 64); err == nil {
			return true
		}
	}
	return false
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
	// SSRF 防护（第一层）：仅允许 http/https scheme，拒绝 file:// / ftp:// 等
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		http.Error(w, "Invalid URL scheme", http.StatusBadRequest)
		return
	}
	// SSRF 防护（第二层）：拒绝 loopback/private/link-local 主机
	// （169.254.169.254 metadata、127.0.0.1 本地端口等走 http 也能命中）
	host := parsed.Hostname()
	if host == "" {
		http.Error(w, "Blocked host", http.StatusBadRequest)
		return
	}
	// 技术债 #7：拒绝尾点主机名（"localhost." 与 "localhost" 同义，字面量匹配可绕过）
	if strings.HasSuffix(host, ".") {
		http.Error(w, "Blocked host", http.StatusBadRequest)
		return
	}
	// 技术债 #7：拒绝十进制/十六进制整数形态 IP（2130706433 / 0x7f000001 等——
	// net.ParseIP 不识别，可绕过字面量 IP 校验）
	if isNumericIPNotation(host) {
		http.Error(w, "Blocked host", http.StatusBadRequest)
		return
	}
	if ip := net.ParseIP(host); ip != nil {
		if isBlockedIP(ip) {
			http.Error(w, "Blocked host", http.StatusBadRequest)
			return
		}
	} else if resolved, err := net.LookupHost(host); err == nil {
		// 技术债 #7：非 IP 主机名解析后校验全部结果（DNS rebinding 防御——
		// 主机名可解析到内网 IP，仅查字面量 localhost 会绕过）
		for _, h := range resolved {
			if ip := net.ParseIP(h); ip != nil && isBlockedIP(ip) {
				http.Error(w, "Blocked host", http.StatusBadRequest)
				return
			}
		}
	} else {
		// P3 修复（code_review）：解析失败必须硬阻断（400）——原 fail-open 放行，
		// 且 dial 时 ReverseProxy 独立再解析仍可能命中内网（TOCTOU 双保险缺失）
		http.Error(w, "Blocked host (resolution failed)", http.StatusBadRequest)
		return
	}

	proxy := &httputil.ReverseProxy{
		// P3 修复（code_review）：DialContext 在连接建立时重新解析校验——请求处理期的
		// LookupHost 检查与 dial 是两次独立解析，攻击者可控 DNS 时检查给公网 IP、dial 给
		// 内网 IP（经典 DNS rebinding 序列）即可绕过；dial 期校验堵住该 TOCTOU
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				dialer := &net.Dialer{}
				host, _, err := net.SplitHostPort(addr)
				if err != nil {
					return nil, err
				}
				// 直接 IP：校验形态；主机名：解析后校验全部结果，任一内网即拒绝
				if ip := net.ParseIP(host); ip != nil {
					if isBlockedIP(ip) {
						return nil, fmt.Errorf("blocked host at dial: %s", host)
					}
				} else if resolved, err := net.LookupHost(host); err == nil {
					for _, h := range resolved {
						if ip := net.ParseIP(h); ip != nil && isBlockedIP(ip) {
							return nil, fmt.Errorf("blocked host at dial: %s", host)
						}
					}
				}
				return dialer.DialContext(ctx, network, addr)
			},
		},
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
