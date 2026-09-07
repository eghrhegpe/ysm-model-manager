package app

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/net/publicsuffix"
)

// isCGNAT 判断 IPv4 是否落在 CGNAT 共享地址段 100.64.0.0/10（RFC 6598）：
// net.IP.IsPrivate 不覆盖该段，原 80 行逐段前缀黑名单（100.64.~100.127.）
// 收敛为单条字节判断（首字节 100 且次字节 64..127）。
// 其余私网/保留段（loopback/private/link-local/unspecified/multicast）
// 由调用方 Is* 系列方法原生覆盖，无需字符串前缀表。
func isCGNAT(ip net.IP) bool {
	ip4 := ip.To4()
	return ip4 != nil && ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127
}

type proxySession struct {
	jar           *cookieJar
	obsolete      bool
	transport     *http.Transport
	lastForwarded string
	port          int
	server        *http.Server
	mu            sync.Mutex
}

type proxyServerKey struct{ host string }

// isBlockedIP 检查给定字符串是否为已知私网/保留 IP。
// 非 IP 字符串（如域名 "bowlroll.net"）返回 false——域名安全性由 ssrfGuardDial 逐连接解析后校验。
func isBlockedIP(host string) bool {
	ip := net.ParseIP(host)
	if ip == nil {
		// 域名不是 IP，交给 ssrfGuardDial 做 DNS 解析后拦截
		return false
	}
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() || ip.IsPrivate() || ip.IsMulticast() {
		return true
	}
	if isCGNAT(ip) {
		return true
	}
	return false
}

// isBlockedHost 在 isBlockedIP 基础上，对域名做快速 DNS 解析拦截
// （用于 startProxy URL 层预检，避免启动代理后请求才发现 blocked）。
func isBlockedHost(host string) bool {
	if isBlockedIP(host) {
		return true
	}
	// 域名快速解析，检查 A 记录是否命中私网
	resolver := &net.Resolver{}
	ips, err := resolver.LookupIPAddr(context.Background(), host)
	if err != nil || len(ips) == 0 {
		// 解析失败或无记录——不拦截，交给 dial 阶段处理
		return false
	}
	for _, ipAddr := range ips {
		if isBlockedIP(ipAddr.IP.String()) {
			return true
		}
	}
	return false
}

func ssrfGuardDial(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	resolver := &net.Resolver{}
	ips, err := resolver.LookupIPAddr(ctx, host)
	if err != nil || len(ips) == 0 {
		return nil, fmt.Errorf("ssrf: no A record for %s", host)
	}
	for _, ipAddr := range ips {
		if isBlockedIP(ipAddr.IP.String()) {
			return nil, fmt.Errorf("ssrf: blocked IP %s for host %s", ipAddr.IP, host)
		}
	}
	dialer := &net.Dialer{}
	conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
	if err != nil {
		return nil, err
	}
	return conn, nil
}

func newSSRFTransport() *http.Transport {
	return &http.Transport{
		DialContext:           ssrfGuardDial,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		TLSClientConfig:       &tls.Config{InsecureSkipVerify: false},
		DisableKeepAlives:     false,
	}
}

type cookieJar struct {
	mu    sync.Mutex
	store map[string][]*http.Cookie
}

func newCookieJar() *cookieJar {
	return &cookieJar{store: make(map[string][]*http.Cookie)}
}

func (j *cookieJar) SetCookies(u *url.URL, cookies []*http.Cookie) {
	j.mu.Lock()
	defer j.mu.Unlock()
	dom := u.Hostname()
	if j.store[dom] == nil {
		j.store[dom] = make([]*http.Cookie, 0)
	}
	for _, c := range cookies {
		replaced := false
		for i, existing := range j.store[dom] {
			if existing.Name == c.Name && existing.Domain == c.Domain {
				j.store[dom][i] = c
				replaced = true
				break
			}
		}
		if !replaced {
			j.store[dom] = append(j.store[dom], c)
		}
	}
}

func (j *cookieJar) Cookies(u *url.URL) []*http.Cookie {
	j.mu.Lock()
	defer j.mu.Unlock()
	dom := u.Hostname()
	return append([]*http.Cookie(nil), j.store[dom]...)
}

func (j *cookieJar) cookiesString(u *url.URL) string {
	cookies := j.Cookies(u)
	if len(cookies) == 0 {
		return ""
	}
	parts := make([]string, 0, len(cookies))
	for _, c := range cookies {
		parts = append(parts, c.Name+"="+c.Value)
	}
	return strings.Join(parts, "; ")
}

func sanitizeLocation(loc, proxyBase, targetHost string) string {
	u, err := url.Parse(loc)
	if err != nil {
		return loc
	}
	if u.Host == "" || u.Host == targetHost {
		u.Host = ""
		u.Scheme = ""
		path := u.String()
		if len(path) > 0 && path[0] == '/' && len(proxyBase) > 0 && proxyBase[len(proxyBase)-1] == '/' {
			path = path[1:]
		}
		return proxyBase + path
	}
	return loc
}

func isWebSocketUpgrade(r *http.Request) bool {
	for _, v := range r.Header["Upgrade"] {
		if strings.EqualFold(strings.TrimSpace(v), "websocket") {
			return true
		}
	}
	return false
}

// ssrfDial atomic.Value 保护：测试替换为直连假上游（ssrfGuardDial 拦回环，测试无法走真实现）
var ssrfDial = atomic.Value{}

func init() {
	ssrfDial.Store(func(ctx context.Context, network, addr string) (net.Conn, error) {
		return ssrfGuardDial(ctx, network, addr)
	})
}

// getSSRFDial 获取当前 ssrfDial 函数（atomic.Value 保护）
func getSSRFDial() func(ctx context.Context, network, addr string) (net.Conn, error) {
	return ssrfDial.Load().(func(ctx context.Context, network, addr string) (net.Conn, error))
}

// setSSRFDial 替换 ssrfDial 函数（测试注入用，atomic.Value 保护）
func setSSRFDial(fn func(ctx context.Context, network, addr string) (net.Conn, error)) {
	ssrfDial.Store(fn)
}

func proxyWebSocket(ctx context.Context, target *url.URL, w http.ResponseWriter, r *http.Request) error {
	wsPort := target.Port()
	if wsPort == "" {
		if target.Scheme == "https" {
			wsPort = "443"
		} else {
			wsPort = "80"
		}
	}
	targetConn, err := getSSRFDial()(ctx, "tcp", net.JoinHostPort(target.Hostname(), wsPort))
	if err != nil {
		return err
	}
	defer targetConn.Close()

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		return errors.New("websocket: ResponseWriter does not implement http.Hijacker")
	}
	clientConn, _, err := hijacker.Hijack()
	if err != nil {
		return err
	}
	defer clientConn.Close()

	if tc, ok := targetConn.(*tls.Conn); ok {
		if err := tc.Handshake(); err != nil {
			return err
		}
	}

	reqHeader := make([]byte, 0, 4096)
	reqHeader = append(reqHeader, []byte(r.Method+" "+r.RequestURI+" HTTP/1.1\r\n")...)
	reqHeader = append(reqHeader, []byte("Host: "+target.Host+"\r\n")...)
	for k, vv := range r.Header {
		for _, v := range vv {
			reqHeader = append(reqHeader, []byte(k+": "+v+"\r\n")...)
		}
	}
	reqHeader = append(reqHeader, "\r\n"...)
	if _, err := targetConn.Write(reqHeader); err != nil {
		return err
	}

	done := make(chan struct{}, 2)
	go func() {
		io.Copy(targetConn, clientConn)
		done <- struct{}{}
	}()
	go func() {
		io.Copy(clientConn, targetConn)
		done <- struct{}{}
	}()
	// 两个方向都要等待：原 <-done 只收一次，另一拷贝 goroutine 靠 defer Close
	// 间接唤醒——若上游不主动断，该 goroutine 与连接资源泄漏至会话结束
	<-done
	// 任一向已断开：显式关闭两侧连接，唤醒仍在阻塞的另一方向 io.Copy
	_ = clientConn.Close()
	_ = targetConn.Close()
	<-done
	return nil
}

func (a *App) startProxy(target string) (string, error) {
	u, err := url.Parse(target)
	if err != nil {
		return "", fmt.Errorf("invalid target URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("unsupported scheme: %s", u.Scheme)
	}

	// SSRF guard: block private/loopback IPs at URL level
	host := u.Hostname()
	if isBlockedHost(host) {
		return "", fmt.Errorf("ssrf: blocked target host %s", host)
	}

	key := proxyServerKey{host: u.Hostname()}
	a.proxyMu.Lock()
	if a.proxySessions == nil {
		a.proxySessions = make(map[proxyServerKey]*proxySession)
	}
	if existing, ok := a.proxySessions[key]; ok && !existing.obsolete {
		existing.mu.Lock()
		existing.obsolete = true
		existing.transport.CloseIdleConnections()
		existing.mu.Unlock()
		if srv := existing.server; srv != nil {
			_ = srv.Close()
		}
	}
	a.proxyMu.Unlock()

	session := &proxySession{
		jar:       newCookieJar(),
		transport: newSSRFTransport(),
	}

	rp := &httputil.ReverseProxy{
		Director: func(r *http.Request) {
			r.URL.Scheme = u.Scheme
			r.URL.Host = u.Host
			r.Host = u.Host
			r.Header.Set("Host", u.Host)
			r.Header.Del("X-Frame-Options")
			r.Header.Del("Content-Security-Policy")
			r.Header.Del("Content-Security-Policy-Report-Only")
			r.Header.Del("X-XSS-Protection")
			r.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
			cookies := session.jar.Cookies(r.URL)
			if len(cookies) > 0 {
				for _, c := range cookies {
					r.AddCookie(c)
				}
			}
		},
		Transport: session.transport,
		ModifyResponse: func(r *http.Response) error {
			r.Header.Del("X-Frame-Options")
			r.Header.Del("Content-Security-Policy")
			if loc := r.Header.Get("Location"); loc != "" {
				proxyBase := "http://127.0.0.1:" + a.getProxyPort(key) + "/"
				r.Header.Set("Location", sanitizeLocation(loc, proxyBase, u.Host))
			}
			setCookies := r.Cookies()
			if len(setCookies) > 0 {
				session.jar.SetCookies(r.Request.URL, setCookies)
			}
			session.mu.Lock()
			session.lastForwarded = r.Request.URL.String()
			session.mu.Unlock()
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("[proxy] error proxying to %s: %v", target, err)
			http.Error(w, "Proxy Error: "+err.Error(), http.StatusBadGateway)
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if isWebSocketUpgrade(r) {
			if err := proxyWebSocket(r.Context(), u, w, r); err != nil {
				log.Printf("[proxy] websocket error: %v", err)
				http.Error(w, "WebSocket Error", http.StatusInternalServerError)
			}
			return
		}
		rp.ServeHTTP(w, r)
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", fmt.Errorf("failed to listen: %w", err)
	}
	actualPort := listener.Addr().(*net.TCPAddr).Port
	srv := &http.Server{Handler: mux}
	session.port = actualPort
	session.server = srv
	a.addHTTPServer(srv)
	go func() {
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Printf("[proxy] server error: %v", err)
		}
	}()

	a.proxyMu.Lock()
	a.proxySessions[key] = session
	a.proxyMu.Unlock()
	proxyURL := fmt.Sprintf("http://127.0.0.1:%d/", actualPort)
	log.Printf("[proxy] started on :%d -> %s", actualPort, target)
	return proxyURL, nil
}

func (a *App) stopProxy(target string) {
	a.proxyMu.Lock()
	defer a.proxyMu.Unlock()
	if a.proxySessions == nil {
		return
	}
	u, err := url.Parse(target)
	if err != nil {
		return
	}
	key := proxyServerKey{host: u.Hostname()}
	session, ok := a.proxySessions[key]
	if !ok {
		return
	}
	session.mu.Lock()
	session.obsolete = true
	session.transport.CloseIdleConnections()
	session.mu.Unlock()
	if srv := session.server; srv != nil {
		_ = srv.Close()
	}
	delete(a.proxySessions, key)
	log.Printf("[proxy] stopped for %s", target)
}

func (a *App) getProxyPort(key proxyServerKey) string {
	a.proxyMu.Lock()
	defer a.proxyMu.Unlock()
	if session, ok := a.proxySessions[key]; ok && !session.obsolete {
		return strconv.Itoa(session.port)
	}
	return "0"
}

func (a *App) addHTTPServer(srv *http.Server) {
	a.proxyMu.Lock()
	defer a.proxyMu.Unlock()
	a.httpServers = append(a.httpServers, srv)
}

func isIPAddress(host string) bool {
	return net.ParseIP(host) != nil
}

func getEffectiveTLDPlusOne(host string) string {
	tldPlusOne, err := publicsuffix.EffectiveTLDPlusOne(host)
	if err != nil {
		return host
	}
	return tldPlusOne
}

func isSameSiteNavigation(targetURL, currentURL string) bool {
	t, err := url.Parse(targetURL)
	if err != nil {
		return false
	}
	c, err := url.Parse(currentURL)
	if err != nil {
		return false
	}
	return getEffectiveTLDPlusOne(t.Hostname()) == getEffectiveTLDPlusOne(c.Hostname())
}

var _cspCleanRe = regexp.MustCompile(`(?i)frame-ancestors\s+[^;]+;?`)

func stripCSPFrameAncestors(header http.Header) {
	for k, vv := range header {
		if strings.EqualFold(k, "Content-Security-Policy") {
			cleaned := make([]string, 0, len(vv))
			for _, v := range vv {
				stripped := _cspCleanRe.ReplaceAllString(v, "")
				stripped = strings.TrimSpace(stripped)
				if stripped != "" {
					cleaned = append(cleaned, stripped)
				}
			}
			if len(cleaned) == 0 {
				delete(header, k)
			} else {
				header[k] = cleaned
			}
		}
	}
}
