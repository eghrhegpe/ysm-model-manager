package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// coopCoepHeaderCases 表驱动：COOP/COEP 两头的注入断言共用 setup（httptest recorder +
// 单层 handler 透传），避免 on/off 两个测试复制同一份 recorder/request 样板。
var coopCoepHeaderCases = []struct {
	name    string
	header  string
	wantOff string // 非 mpr 构建（默认）：不注入 → 空
	wantOn  string // mpr 构建（-tags mpr）：注入固定值
}{
	{"COOP", "Cross-Origin-Opener-Policy", "", "same-origin"},
	{"COEP", "Cross-Origin-Embedder-Policy", "", "require-corp"},
}

// serveThroughCoopCoep 用 httptest recorder 走一遍 CoopCoepMiddleware（单层 handler），
// 返回响应头。on/off 两测试共用，消除重复 setup。
func serveThroughCoopCoep() http.Header {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mw := CoopCoepMiddleware(next)
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	return rec.Header()
}

// TestCoopCoepMiddlewareOff：非 mpr 构建（默认）→ 不注入 COOP/COEP（透传，零额外语义）。
func TestCoopCoepMiddlewareOff(t *testing.T) {
	if coopCoepEnabled {
		t.Skip("mpr build tag set; skipping off test")
	}
	for _, c := range coopCoepHeaderCases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			if got := serveThroughCoopCoep().Get(c.header); got != c.wantOff {
				t.Errorf("off: expected no %s header, got %q", c.header, got)
			}
		})
	}
}

// TestCoopCoepMiddlewareOn：mpr 构建（-tags mpr）→ 注入 COOP/COEP 解锁 SharedArrayBuffer。
// Run with: go test -tags mpr ./internal/app/ -run TestCoopCoepMiddlewareOn
func TestCoopCoepMiddlewareOn(t *testing.T) {
	if !coopCoepEnabled {
		t.Skip("mpr build tag not set; skipping on test")
	}
	for _, c := range coopCoepHeaderCases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			if got := serveThroughCoopCoep().Get(c.header); got != c.wantOn {
				t.Errorf("on: expected %s=%q, got %q", c.header, c.wantOn, got)
			}
		})
	}
}
