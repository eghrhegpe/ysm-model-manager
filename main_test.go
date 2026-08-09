package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCustomJSMiddleware(t *testing.T) {
	// 模拟下游 handler：任何请求到这里说明中间件放行了
	nextCalled := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusOK)
	})

	mw := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/wails/custom.js" {
				w.Header().Set("Content-Type", "application/javascript")
				w.WriteHeader(http.StatusOK)
				w.Write([]byte("// Wails custom.js — empty in desktop mode\n"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}

	t.Run("拦截 /wails/custom.js 返回 200 + JS content-type", func(t *testing.T) {
		req := httptest.NewRequest("HEAD", "/wails/custom.js", nil)
		rec := httptest.NewRecorder()
		mw(next).ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/javascript" {
			t.Errorf("expected application/javascript content-type, got %q", ct)
		}
		if nextCalled {
			t.Error("下游 handler 不应被调用")
		}
	})

	t.Run("其他路径放行到下游 handler", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/index.html", nil)
		rec := httptest.NewRecorder()
		mw(next).ServeHTTP(rec, req)

		if !nextCalled {
			t.Error("下游 handler 应被调用")
		}
	})
}
