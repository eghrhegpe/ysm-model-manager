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
	"ysm-model-manager/internal/testutil"
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
	// RGB 为全导出字段 struct（== 可比较），布尔化避开 go-cmp 对第三方类型的反射面
	testutil.Equal(t, options.BackgroundColour == want, true, "startup background = %#v, want %#v", options.BackgroundColour, want)
}

func TestMainWindowStaysHiddenUntilFrontendIsReady(t *testing.T) {
	testutil.Equal(t, mainWindowOptions().Hidden, true, "main window must start hidden so the pre-rendered shell is never visible")
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
		testutil.NotNil(t, out, "裸 AppError 应被 marshal，不得回落默认")
		var got types.AppError
		testutil.NoError(t, json.Unmarshal(out, &got), "产出非法 JSON: %s", out)
		// OR 型复合断言拆序贯：逐字段 Equal，失败报告首个失配字段（Equal 失败即弃权）
		testutil.Equal(t, got.Code, base.Code, "结构化字段丢失: Code")
		testutil.Equal(t, got.Operation, base.Operation, "结构化字段丢失: Operation")
		testutil.Equal(t, got.SourcePath, base.SourcePath, "结构化字段丢失: SourcePath")
		testutil.Equal(t, got.Reason, base.Reason, "结构化字段丢失: Reason")
		testutil.Equal(t, got.Suggestion, base.Suggestion, "结构化字段丢失: Suggestion")
	})

	t.Run("fmt.Errorf(%w) 包装 AppError → errors.As 穿透，字段仍完整", func(t *testing.T) {
		wrapped := fmt.Errorf("导入失败: %w", base)
		out := marshalBindingError(wrapped)
		testutil.NotNil(t, out, "包装后的 AppError 应被 errors.As 穿透识别，不得回落默认")
		var got types.AppError
		testutil.NoError(t, json.Unmarshal(out, &got), "产出非法 JSON: %s", out)
		// OR 型复合断言拆序贯：逐字段 Equal，失败报告首个失配字段（Equal 失败即弃权）
		testutil.Equal(t, got.Code, base.Code, "包装形态结构化字段丢失: Code")
		testutil.Equal(t, got.Operation, base.Operation, "包装形态结构化字段丢失: Operation")
		testutil.Equal(t, got.SourcePath, base.SourcePath, "包装形态结构化字段丢失: SourcePath")
		testutil.Equal(t, got.Reason, base.Reason, "包装形态结构化字段丢失: Reason")
		testutil.Equal(t, got.Suggestion, base.Suggestion, "包装形态结构化字段丢失: Suggestion")
	})

	t.Run("非 AppError → 返回 nil 回落默认机制", func(t *testing.T) {
		testutil.Nil(t, marshalBindingError(errors.New("普通错误")), "非 AppError 应返回 nil 以回落默认")
	})
}
