package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
	"ysm-model-manager/go/types"
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

func TestMainWindowUsesFirstPaintBackground(t *testing.T) {
	options := mainWindowOptions()
	want := application.NewRGB(17, 17, 27)
	if options.BackgroundColour != want {
		t.Fatalf("startup background = %#v, want %#v", options.BackgroundColour, want)
	}
}

func TestMainWindowStaysHiddenUntilFrontendIsReady(t *testing.T) {
	if !mainWindowOptions().Hidden {
		t.Fatal("main window must start hidden so the pre-rendered shell is never visible")
	}
}

// TestMarshalBindingError 钉住 binding 错误序列化契约：
// AppError 的结构化字段必须到达前端 CallError.Cause（前端按 Code 分支），
// 且「被 %w 包装」与「裸返回」两种形态都要覆盖——默认 Wails marshalError
// 对包装形态（*fmt.wrapError 无导出字段）会产出 {}，正是本接线要堵的缺口。
func TestMarshalBindingError(t *testing.T) {
	base := types.AppError{
		Code:       types.ErrIO,
		Operation:  "导入模型",
		SourcePath: "/repo/a.ysm",
		Reason:     "磁盘空间不足",
		Suggestion: "请清理磁盘后重试",
	}

	t.Run("裸 AppError → 结构化字段完整", func(t *testing.T) {
		out := marshalBindingError(base)
		if out == nil {
			t.Fatal("裸 AppError 应被 marshal，不得回落默认")
		}
		var got types.AppError
		if err := json.Unmarshal(out, &got); err != nil {
			t.Fatalf("产出非法 JSON: %v (%s)", err, out)
		}
		if got.Code != base.Code || got.Operation != base.Operation ||
			got.SourcePath != base.SourcePath || got.Reason != base.Reason ||
			got.Suggestion != base.Suggestion {
			t.Fatalf("结构化字段丢失: got %+v, want %+v", got, base)
		}
	})

	t.Run("fmt.Errorf(%w) 包装 AppError → errors.As 穿透，字段仍完整", func(t *testing.T) {
		wrapped := fmt.Errorf("导入失败: %w", base)
		out := marshalBindingError(wrapped)
		if out == nil {
			t.Fatal("包装后的 AppError 应被 errors.As 穿透识别，不得回落默认")
		}
		var got types.AppError
		if err := json.Unmarshal(out, &got); err != nil {
			t.Fatalf("产出非法 JSON: %v (%s)", err, out)
		}
		if got.Code != base.Code || got.Reason != base.Reason {
			t.Fatalf("包装形态结构化字段丢失: got %+v", got)
		}
		// 对照：默认机制对包装形态产出 {}（证明本接线确有必要）
		def, _ := json.Marshal(&wrapped)
		if string(def) != "{}" {
			t.Logf("注意：默认 marshalError 产出 %s（预期 {}，Wails 行为可能已变）", def)
		}
	})

	t.Run("非 AppError → 返回 nil 回落默认机制", func(t *testing.T) {
		if out := marshalBindingError(errors.New("普通错误")); out != nil {
			t.Fatalf("非 AppError 应返回 nil 以回落默认，got %s", out)
		}
	})
}
