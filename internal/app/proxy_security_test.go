// ===== proxy 安全剥离分支补测 =====
// 既有 TestRewritePlazaRequest_PreservesInboundPathIgnoresTargetPath 只断言了
// X-Forwarded-For 一项、且 jar 传 nil——rewritePlazaRequest 里其余 6 个转发/安全头
// 剥离分支、cookie 注入分支、UA 设置分支均无覆盖。
//
// 这些分支对应真实安全风险：
//
//	· 转发头伪造（X-Forwarded-For/Host/Proto）——浏览器主动伪造时若不被剥离，
//	  上游会采信伪造来源 IP/主机
//	· 安全头残留（X-Frame-Options/CSP/X-XSS-Protection）——源站下发的安全策略
//	  若被代理原样透传，与前端注入的新策略冲突
//	· cookie 跨域泄漏——jar 命中时必须携带，否则会话丢失
package app

import (
	"context"
	"net/http"
	"net/http/httputil"
	"net/url"
	"testing"

	"ysm-model-manager/internal/testutil"
)

// TestRewritePlazaRequest_StripsForwardedAndSecurityHeaders
// 预置全族转发头 + 安全头，断言 rewritePlazaRequest 全部剥离。
// 转发头若不剥离，浏览器伪造的 X-Forwarded-* 会被上游采信（来源欺骗）；
// 安全头若不剥离，源站策略与前端注入策略会互相污染。
func TestRewritePlazaRequest_StripsForwardedAndSecurityHeaders(t *testing.T) {
	target, err := url.Parse("https://site.example/browse")
	testutil.NoError(t, err, "parse target")
	inbound, err := http.NewRequest("GET", "http://127.0.0.1:39999/assets/foo.js", nil)
	testutil.NoError(t, err, "new request")
	// 模拟浏览器伪造的转发头 + 源站下发的安全头
	for _, h := range []string{
		"X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto",
		"X-Frame-Options", "Content-Security-Policy",
		"Content-Security-Policy-Report-Only", "X-XSS-Protection",
	} {
		inbound.Header.Set(h, "spoofed-value")
	}

	out := inbound.Clone(context.Background())
	rewritePlazaRequest(&httputil.ProxyRequest{In: inbound, Out: out}, target, nil)

	for _, h := range []string{
		"X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto",
		"X-Frame-Options", "Content-Security-Policy",
		"Content-Security-Policy-Report-Only", "X-XSS-Protection",
	} {
		if got := out.Header.Get(h); got != "" {
			t.Errorf("头部 %s 应被剥离，实际残留 %q", h, got)
		}
	}
}

// TestRewritePlazaRequest_AddsCookiesFromJar
// jar 命中同域 cookie 时，rewritePlazaRequest 必须把它加到出站请求，
// 否则代理转发会丢会话。cookie 按出站 URL 的 hostname 取，故用 target 域播种。
func TestRewritePlazaRequest_AddsCookiesFromJar(t *testing.T) {
	target, err := url.Parse("https://site.example/browse")
	testutil.NoError(t, err, "parse target")
	inbound, err := http.NewRequest("GET", "http://127.0.0.1:39999/assets/foo.js", nil)
	testutil.NoError(t, err, "new request")

	jar := newCookieJar()
	jar.SetCookies(target, []*http.Cookie{
		{Name: "session", Value: "abc123"},
		{Name: "theme", Value: "dark"},
	})

	out := inbound.Clone(context.Background())
	rewritePlazaRequest(&httputil.ProxyRequest{In: inbound, Out: out}, target, jar)

	got := map[string]string{}
	for _, c := range out.Cookies() {
		got[c.Name] = c.Value
	}
	if got["session"] != "abc123" {
		t.Errorf("cookie session 应随转发携带，实际 %q (全部: %v)", got["session"], got)
	}
	if got["theme"] != "dark" {
		t.Errorf("cookie theme 应随转发携带，实际 %q", got["theme"])
	}
}

// TestRewritePlazaRequest_NoCookiesWhenJarNil
// jar 为 nil（测试/未初始化会话）时不得 panic，且不注入任何 cookie。
func TestRewritePlazaRequest_NoCookiesWhenJarNil(t *testing.T) {
	target, err := url.Parse("https://site.example/browse")
	testutil.NoError(t, err, "parse target")
	inbound, err := http.NewRequest("GET", "http://127.0.0.1:39999/assets/foo.js", nil)
	testutil.NoError(t, err, "new request")
	// 入站请求本身带 cookie，断言 rewrite 不额外注入（也不清空既有）
	inbound.AddCookie(&http.Cookie{Name: "existing", Value: "kept"})

	out := inbound.Clone(context.Background())
	rewritePlazaRequest(&httputil.ProxyRequest{In: inbound, Out: out}, target, nil)

	found := false
	for _, c := range out.Cookies() {
		if c.Name == "existing" && c.Value == "kept" {
			found = true
		}
	}
	if !found {
		t.Error("入站已有 cookie 不应被 rewrite 清空")
	}
}

// TestRewritePlazaRequest_SetsUserAgent
// rewritePlazaRequest 必须覆写为固定桌面 Chrome UA——否则源站按无 UA 或默认 UA
// 返回移动版/降级内容。
func TestRewritePlazaRequest_SetsUserAgent(t *testing.T) {
	target, err := url.Parse("https://site.example/browse")
	testutil.NoError(t, err, "parse target")
	inbound, err := http.NewRequest("GET", "http://127.0.0.1:39999/", nil)
	testutil.NoError(t, err, "new request")
	inbound.Header.Set("User-Agent", "OldUA/1.0")

	out := inbound.Clone(context.Background())
	rewritePlazaRequest(&httputil.ProxyRequest{In: inbound, Out: out}, target, nil)

	want := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
	if got := out.Header.Get("User-Agent"); got != want {
		t.Errorf("User-Agent 应覆写为固定 Chrome UA，实际 %q", got)
	}
}

// TestRewritePlazaRequest_SyncsHostHeader
// Out.Host 与 Host 头必须同步为 target host，否则 HTTP/1.1 虚主机路由会落到默认站。
func TestRewritePlazaRequest_SyncsHostHeader(t *testing.T) {
	target, err := url.Parse("https://site.example:8443/browse")
	testutil.NoError(t, err, "parse target")
	inbound, err := http.NewRequest("GET", "http://127.0.0.1:39999/", nil)
	testutil.NoError(t, err, "new request")

	out := inbound.Clone(context.Background())
	rewritePlazaRequest(&httputil.ProxyRequest{In: inbound, Out: out}, target, nil)

	if out.Host != "site.example:8443" {
		t.Errorf("Out.Host 应为 site.example:8443，实际 %q", out.Host)
	}
	if got := out.Header.Get("Host"); got != "site.example:8443" {
		t.Errorf("Host 头应同步为 %q，实际 %q", "site.example:8443", got)
	}
}
