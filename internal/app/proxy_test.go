package app

import (
	"net/http"
	"net/url"
	"testing"
)

func TestIsBlockedIP(t *testing.T) {
	tests := []struct {
		host    string
		blocked bool
	}{
		{"127.0.0.1", true},
		{"10.0.0.1", true},
		{"192.168.1.1", true},
		{"172.16.0.1", true},
		{"169.254.1.1", true},
		{"8.8.8.8", false},
		{"1.1.1.1", false},
		{"104.16.0.1", false},
		{"", false},    // empty = not an IP, passed through to dial guard
		{"abc", false}, // not an IP, passed through to dial guard
		{"::1", true},  // IPv6 loopback
	}
	for _, tt := range tests {
		got := isBlockedIP(tt.host)
		if got != tt.blocked {
			t.Errorf("isBlockedIP(%q) = %v, want %v", tt.host, got, tt.blocked)
		}
	}
}

func TestSanitizeLocation(t *testing.T) {
	tests := []struct {
		name       string
		loc        string
		proxyBase  string
		targetHost string
		want       string
	}{
		{
			name:       "relative path",
			loc:        "/download/123.zip",
			proxyBase:  "http://127.0.0.1:8080/",
			targetHost: "example.com",
			want:       "http://127.0.0.1:8080/download/123.zip",
		},
		{
			name:       "absolute same host",
			loc:        "https://example.com/download/123.zip",
			proxyBase:  "http://127.0.0.1:8080/",
			targetHost: "example.com",
			want:       "http://127.0.0.1:8080/download/123.zip",
		},
		{
			name:       "absolute different host",
			loc:        "https://other.com/download/123.zip",
			proxyBase:  "http://127.0.0.1:8080/",
			targetHost: "example.com",
			want:       "https://other.com/download/123.zip",
		},
	}
	for _, tt := range tests {
		got := sanitizeLocation(tt.loc, tt.proxyBase, tt.targetHost)
		if got != tt.want {
			t.Errorf("sanitizeLocation(%q, %q, %q) = %q, want %q", tt.loc, tt.proxyBase, tt.targetHost, got, tt.want)
		}
	}
}

func TestIsWebSocketUpgrade(t *testing.T) {
	tests := []struct {
		name   string
		header http.Header
		want   bool
	}{
		{
			name:   "websocket upgrade",
			header: http.Header{"Upgrade": []string{"websocket"}},
			want:   true,
		},
		{
			name:   "no upgrade",
			header: http.Header{"Content-Type": []string{"text/html"}},
			want:   false,
		},
		{
			name:   "case insensitive",
			header: http.Header{"Upgrade": []string{"WebSocket"}},
			want:   true,
		},
	}
	for _, tt := range tests {
		r := &http.Request{Header: tt.header}
		got := isWebSocketUpgrade(r)
		if got != tt.want {
			t.Errorf("isWebSocketUpgrade(%s) = %v, want %v", tt.name, got, tt.want)
		}
	}
}

func TestCookieJar(t *testing.T) {
	jar := newCookieJar()
	u, _ := url.Parse("https://example.com/test")

	// Set cookies
	jar.SetCookies(u, []*http.Cookie{
		{Name: "session", Value: "abc123", Domain: "example.com"},
		{Name: "lang", Value: "ja", Domain: "example.com"},
	})

	// Get cookies
	cookies := jar.Cookies(u)
	if len(cookies) != 2 {
		t.Errorf("expected 2 cookies, got %d", len(cookies))
	}

	// Update existing cookie
	jar.SetCookies(u, []*http.Cookie{
		{Name: "session", Value: "new_value", Domain: "example.com"},
	})
	cookies = jar.Cookies(u)
	if len(cookies) != 2 {
		t.Errorf("expected 2 cookies after update, got %d", len(cookies))
	}
	for _, c := range cookies {
		if c.Name == "session" && c.Value != "new_value" {
			t.Errorf("session cookie not updated: got %q, want %q", c.Value, "new_value")
		}
	}

	// Different domain
	u2, _ := url.Parse("https://other.com/test")
	cookies2 := jar.Cookies(u2)
	if len(cookies2) != 0 {
		t.Errorf("expected 0 cookies for other domain, got %d", len(cookies2))
	}
}

func TestCookiesString(t *testing.T) {
	jar := newCookieJar()
	u, _ := url.Parse("https://example.com/test")

	// Empty
	if s := jar.cookiesString(u); s != "" {
		t.Errorf("expected empty string, got %q", s)
	}

	// With cookies
	jar.SetCookies(u, []*http.Cookie{
		{Name: "a", Value: "1", Domain: "example.com"},
		{Name: "b", Value: "2", Domain: "example.com"},
	})
	s := jar.cookiesString(u)
	if s == "" {
		t.Error("expected non-empty cookie string")
	}
}

func TestGetEffectiveTLDPlusOne(t *testing.T) {
	tests := []struct {
		host string
		want string
	}{
		{"www.example.com", "example.com"},
		{"sub.example.co.jp", "example.co.jp"},
		{"localhost", "localhost"},
	}
	for _, tt := range tests {
		got := getEffectiveTLDPlusOne(tt.host)
		if got != tt.want {
			t.Errorf("getEffectiveTLDPlusOne(%q) = %q, want %q", tt.host, got, tt.want)
		}
	}
}

func TestIsIPAddress(t *testing.T) {
	tests := []struct {
		host string
		want bool
	}{
		{"127.0.0.1", true},
		{"example.com", false},
		{"::1", true},
		{"[::1]:8080", false},
	}
	for _, tt := range tests {
		got := isIPAddress(tt.host)
		if got != tt.want {
			t.Errorf("isIPAddress(%q) = %v, want %v", tt.host, got, tt.want)
		}
	}
}

func TestStripCSPFrameAncestors(t *testing.T) {
	tests := []struct {
		name         string
		input        string
		expectExists bool // whether CSP header should still exist after stripping
	}{
		{"single directive", "frame-ancestors 'none';", false},
		{"mixed directives", "default-src 'self'; frame-ancestors 'self';", true},
		{"no frame-ancestors", "default-src 'self'", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := http.Header{}
			h.Set("Content-Security-Policy", tt.input)
			stripCSPFrameAncestors(h)
			_, exists := h["Content-Security-Policy"]
			if exists != tt.expectExists {
				t.Errorf("stripCSPFrameAncestors: header exists=%v, want exists=%v", exists, tt.expectExists)
			}
		})
	}
}

func TestNewSSRFTransport(t *testing.T) {
	tr := newSSRFTransport()
	if tr == nil {
		t.Fatal("expected non-nil transport")
	}
	if tr.TLSClientConfig == nil {
		t.Error("expected non-nil TLSClientConfig")
	}
	if tr.TLSClientConfig.InsecureSkipVerify {
		t.Error("InsecureSkipVerify should be false")
	}
}

func TestProxyServerKeyEquality(t *testing.T) {
	k1 := proxyServerKey{host: "example.com"}
	k2 := proxyServerKey{host: "example.com"}
	k3 := proxyServerKey{host: "other.com"}

	if k1 != k2 {
		t.Error("expected equal keys")
	}
	if k1 == k3 {
		t.Error("expected different keys")
	}
}

func TestAppStartProxyInvalidURL(t *testing.T) {
	a := &App{}
	_, err := a.startProxy("://invalid")
	if err == nil {
		t.Error("expected error for invalid URL")
	}
}

func TestAppStartProxyUnsupportedScheme(t *testing.T) {
	a := &App{}
	_, err := a.startProxy("ftp://example.com")
	if err == nil {
		t.Error("expected error for unsupported scheme")
	}
}

func TestAppStartProxyBlockedTarget(t *testing.T) {
	a := &App{}
	_, err := a.startProxy("http://127.0.0.1:8080/secret")
	if err == nil {
		t.Error("expected error for loopback target")
	}
}

func TestAppStopProxyNoSessions(t *testing.T) {
	a := &App{}
	// Should not panic
	a.stopProxy("http://example.com")
}

func TestAppStopProxyNonexistentSession(t *testing.T) {
	a := &App{proxySessions: make(map[proxyServerKey]*proxySession)}
	// Should not panic
	a.stopProxy("http://nonexistent.example.com")
}

func TestIsSameSiteNavigation(t *testing.T) {
	tests := []struct {
		name         string
		target       string
		current      string
		wantSameSite bool
	}{
		{"same site", "https://example.com/page1", "https://example.com/page2", true},
		{"same site www", "https://www.example.com/page", "https://example.com/page", true},
		{"different site", "https://example.com/page", "https://other.com/page", false},
	}
	for _, tt := range tests {
		got := isSameSiteNavigation(tt.target, tt.current)
		if got != tt.wantSameSite {
			t.Errorf("isSameSiteNavigation(%s, %s) = %v, want %v", tt.target, tt.current, got, tt.wantSameSite)
		}
	}
}

func TestNewCookieJar(t *testing.T) {
	jar := newCookieJar()
	if jar == nil {
		t.Fatal("expected non-nil jar")
	}
	if jar.store == nil {
		t.Error("expected non-nil store")
	}
}

func TestSSRFTransportCreation(t *testing.T) {
	tr := newSSRFTransport()
	if tr.DialContext == nil {
		t.Error("DialContext should not be nil")
	}
}

func TestProxySessionCreation(t *testing.T) {
	session := &proxySession{
		jar:       newCookieJar(),
		transport: newSSRFTransport(),
	}
	if session.jar == nil {
		t.Error("expected non-nil jar")
	}
	if session.transport == nil {
		t.Error("expected non-nil transport")
	}
	if session.obsolete {
		t.Error("expected obsolete=false")
	}
}

func TestAppPlazaWindowNotInitialized(t *testing.T) {
	a := &App{}
	err := a.NavigatePlazaWindow("http://example.com", false)
	if err == nil {
		t.Error("expected error when plaza window not initialized")
	}
}

func TestAppClosePlazaWindowNil(t *testing.T) {
	a := &App{}
	err := a.ClosePlazaWindow()
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestPlazaNavigationMethodsNilWindow(t *testing.T) {
	a := &App{}
	methods := []struct {
		name string
		fn   func() error
	}{
		{"PlazaGoBack", a.PlazaGoBack},
		{"PlazaGoForward", a.PlazaGoForward},
		{"PlazaReload", a.PlazaReload},
		{"PlazaZoomIn", a.PlazaZoomIn},
		{"PlazaZoomOut", a.PlazaZoomOut},
		{"PlazaZoomReset", a.PlazaZoomReset},
	}
	for _, m := range methods {
		err := m.fn()
		if err != nil {
			t.Errorf("%s: expected nil error, got %v", m.name, err)
		}
	}
}

func TestPlazaWindowExistsFalse(t *testing.T) {
	a := &App{}
	if a.plazaWindowExists() {
		t.Error("expected false when no window")
	}
}

func TestProxySessionsMapCreation(t *testing.T) {
	a := &App{}
	a.stopProxy("http://example.com")
	// Should not panic, proxySessions should be nil initially
}

func TestCookieJarEmptyString(t *testing.T) {
	jar := newCookieJar()
	u, _ := url.Parse("https://example.com")
	s := jar.cookiesString(u)
	if s != "" {
		t.Errorf("expected empty string, got %q", s)
	}
}

func TestGetProxyPort(t *testing.T) {
	a := &App{proxySessions: make(map[proxyServerKey]*proxySession)}
	key := proxyServerKey{host: "example.com"}
	if port := a.getProxyPort(key); port != "0" {
		t.Errorf("missing session: expected '0', got %q", port)
	}
	a.proxySessions[key] = &proxySession{port: 43210}
	if port := a.getProxyPort(key); port != "43210" {
		t.Errorf("existing session: expected '43210', got %q", port)
	}
}

func TestAddHTTPServer(t *testing.T) {
	a := &App{}
	srv := &http.Server{}
	a.addHTTPServer(srv)
	if len(a.httpServers) != 1 {
		t.Errorf("expected 1 server, got %d", len(a.httpServers))
	}
}

func TestIsIPAddressEmpty(t *testing.T) {
	if isIPAddress("") {
		t.Error("expected false for empty string")
	}
}

func TestIsBlockedIPDomain(t *testing.T) {
	// 域名不是 IP，不被 isBlockedIP 拦截（安全性由 ssrfGuardDial 做 DNS 解析后校验）
	if isBlockedIP("bowlroll.net") {
		t.Error("domain name should not be blocked by isBlockedIP")
	}
	if isBlockedIP("example.com") {
		t.Error("domain name should not be blocked by isBlockedIP")
	}
}

func TestGetEffectiveTLDPlusOneInvalid(t *testing.T) {
	// Invalid TLD should return the host itself
	got := getEffectiveTLDPlusOne("not-a-valid-domain")
	if got == "" {
		t.Error("expected non-empty result")
	}
}

func TestSanitizeLocationEmpty(t *testing.T) {
	got := sanitizeLocation("", "http://127.0.0.1:8080/", "example.com")
	if got == "" {
		t.Error("expected non-empty result")
	}
}

func TestIsSameSiteNavigationInvalidURLs(t *testing.T) {
	got := isSameSiteNavigation("://invalid", "://also-invalid")
	if got {
		t.Error("expected false for invalid URLs")
	}
}

func TestProxyPortKeyEquality(t *testing.T) {
	k1 := proxyServerKey{host: "a.com"}
	k2 := proxyServerKey{host: "b.com"}
	if k1 == k2 {
		t.Error("expected different keys")
	}
}

func TestProxySessionObsoleteDefault(t *testing.T) {
	s := &proxySession{
		jar:       newCookieJar(),
		transport: newSSRFTransport(),
	}
	if s.obsolete {
		t.Error("expected obsolete=false by default")
	}
}

func TestIsWebSocketUpgradeNilHeader(t *testing.T) {
	r := &http.Request{}
	if isWebSocketUpgrade(r) {
		t.Error("expected false for nil header")
	}
}

func TestSanitizeLocationRelativePath(t *testing.T) {
	got := sanitizeLocation("/page?q=1", "http://127.0.0.1:8080/", "example.com")
	if got != "http://127.0.0.1:8080/page?q=1" {
		t.Errorf("unexpected result: %q", got)
	}
}

func TestSanitizeLocationAbsoluteDifferentHost(t *testing.T) {
	got := sanitizeLocation("https://other.com/path", "http://127.0.0.1:8080/", "example.com")
	if got != "https://other.com/path" {
		t.Errorf("unexpected result: %q", got)
	}
}

func TestSanitizeLocationEmptyProxyBase(t *testing.T) {
	got := sanitizeLocation("/test", "", "example.com")
	if got != "/test" {
		t.Errorf("unexpected result: %q", got)
	}
}

func TestCookieJarMultipleDomains(t *testing.T) {
	jar := newCookieJar()
	u1, _ := url.Parse("https://a.com")
	u2, _ := url.Parse("https://b.com")

	jar.SetCookies(u1, []*http.Cookie{{Name: "a", Value: "1", Domain: "a.com"}})
	jar.SetCookies(u2, []*http.Cookie{{Name: "b", Value: "2", Domain: "b.com"}})

	c1 := jar.Cookies(u1)
	c2 := jar.Cookies(u2)

	if len(c1) != 1 || c1[0].Name != "a" {
		t.Error("wrong cookies for a.com")
	}
	if len(c2) != 1 || c2[0].Name != "b" {
		t.Error("wrong cookies for b.com")
	}
}

func TestProxyKeyFromURL(t *testing.T) {
	u, _ := url.Parse("https://example.com/path?q=1")
	key := proxyServerKey{host: u.Hostname()}
	if key.host != "example.com" {
		t.Errorf("expected 'example.com', got %q", key.host)
	}
}

func TestIsBlockedIPLocalhost(t *testing.T) {
	// "localhost" 是域名，isBlockedIP 不拦截（交由 ssrfGuardDial）
	if isBlockedIP("localhost") {
		t.Error("isBlockedIP should not block hostname 'localhost'")
	}
}

func TestIsBlockedHostLocalhost(t *testing.T) {
	// isBlockedHost 会解析 localhost → 127.0.0.1 并拦截
	if !isBlockedHost("localhost") {
		t.Error("isBlockedHost should block 'localhost'")
	}
}

func TestIsBlockedIPPublic(t *testing.T) {
	if isBlockedIP("8.8.8.8") {
		t.Error("public IP should not be blocked")
	}
}

func TestCookieJarConcurrentAccess(t *testing.T) {
	// cookieJar 非并发安全（无锁），此测试验证并发场景下不 panic，
	// 并用 -race 运行来检测潜在 data race。
	// 不加 t.Parallel()：避免与其他测试共享状态时放大 race 窗口。
	jar := newCookieJar()
	u, _ := url.Parse("https://example.com")

	done := make(chan struct{}, 20)

	// Concurrent writes
	for i := 0; i < 10; i++ {
		go func() {
			defer func() { done <- struct{}{} }()
			jar.SetCookies(u, []*http.Cookie{{Name: "test", Value: "val", Domain: "example.com"}})
		}()
	}

	// Concurrent reads
	for i := 0; i < 10; i++ {
		go func() {
			defer func() { done <- struct{}{} }()
			_ = jar.Cookies(u)
		}()
	}

	// 等所有 goroutine 结束（不检查最终一致性，只验证不 panic）
	for i := 0; i < 20; i++ {
		<-done
	}
}

func TestAppPlazaWindowExistsNil(t *testing.T) {
	a := &App{}
	if a.plazaWindowExists() {
		t.Error("expected false")
	}
}

// P2 补测：startProxy 成功路径 + stopProxy 起→停闭环。
// startProxy 绑定本地回环随机端口（不产生对外请求），用公开域名构造即可离线运行
func TestStartStopProxy_Lifecycle(t *testing.T) {
	a := &App{}
	target := "http://example.com/"

	proxyURL, err := a.startProxy(target)
	if err != nil {
		t.Fatalf("startProxy 失败: %v", err)
	}
	if proxyURL == "" {
		t.Fatal("startProxy 应返回非空 URL")
	}

	key := proxyServerKey{host: "example.com"}
	a.proxyMu.Lock()
	session, ok := a.proxySessions[key]
	a.proxyMu.Unlock()
	if !ok {
		t.Fatal("proxySessions 应含该 host 条目")
	}
	if session.port <= 0 {
		t.Fatalf("proxy port 应 > 0，实际 %d", session.port)
	}

	a.stopProxy(target)
	a.proxyMu.Lock()
	left := len(a.proxySessions)
	a.proxyMu.Unlock()
	if left != 0 {
		t.Fatalf("stopProxy 后 proxySessions 应为空，实际 %d 条", left)
	}
	if port := a.getProxyPort(key); port != "0" {
		t.Fatalf("stopProxy 后 getProxyPort 应返回 0，实际 %q", port)
	}
}
