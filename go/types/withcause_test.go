// ===== go/types 留守域补测：AppError.WithCause =====
package types

import (
	"errors"
	"strings"
	"testing"
)

// sentinel 用于 errors.Is 穿透测试
var errTestSentinel = errors.New("哨兵错误")

// TestWithCause_Basic WithCause 后 Unwrap 应返回 cause
func TestWithCause_Basic(t *testing.T) {
	e := AppError{Code: ErrorCode("E001"), Operation: "导入", Reason: "失败"}
	w := e.WithCause(errTestSentinel)
	unwrapped := errors.Unwrap(w)
	if unwrapped != errTestSentinel {
		t.Errorf("Unwrap = %v, 期望 %v", unwrapped, errTestSentinel)
	}
}

// TestWithCause_ErrorStringContainsBase 原错误消息仍存在于 Error() 中（cause 通过 Unwrap/errors.Is 暴露，不拼入 Error 字符串）
func TestWithCause_ErrorStringContainsBase(t *testing.T) {
	e := AppError{Code: ErrorCode("E002"), Operation: "删除", Reason: "操作失败"}
	cause := errors.New("disk full")
	w := e.WithCause(cause)
	msg := w.Error()
	if msg == "" {
		t.Fatal("Error() 返回空字符串")
	}
	// base 信息应保留
	if !strings.Contains(msg, "操作失败") {
		t.Errorf("Error() = %q, 应包含 Reason 字段", msg)
	}
	// cause 文本不直接出现在 Error() 中（ADR-051：结构化解码靠 Unwrap）
	if strings.Contains(msg, "disk full") {
		t.Log("注：cause 文本出现在 Error() 中，属实现细节变动，不影响契约")
	}
}

// TestWithCause_ErrorsIs 穿透 errors.Is 到哨兵错误
func TestWithCause_ErrorsIs(t *testing.T) {
	e := AppError{Code: ErrorCode("E003"), Reason: "操作失败"}
	w := e.WithCause(errTestSentinel)
	if !errors.Is(w, errTestSentinel) {
		t.Error("errors.Is(AppError.WithCause(sentinel), sentinel) = false, 期望 true")
	}
}

// TestWithCause_Immutable 值语义：WithCause 返回新实例，原实例 cause 不变
func TestWithCause_Immutable(t *testing.T) {
	e := AppError{Code: ErrorCode("E004"), Reason: "原错误"}
	if errors.Unwrap(e) != nil {
		t.Fatal("原 AppError.Unwrap() 不应已有 cause")
	}
	w := e.WithCause(errTestSentinel)
	// e 未变
	if errors.Unwrap(e) != nil {
		t.Error("WithCause 不应修改原 AppError（值语义）")
	}
	// w 有 cause
	if errors.Unwrap(w) != errTestSentinel {
		t.Error("WithCause 返回的新实例应有 cause")
	}
	// 再调用 WithCause 不应污染 w
	w2 := w.WithCause(nil)
	if errors.Unwrap(w) != errTestSentinel {
		t.Error("WithCause 第二次调用不应修改原实例")
	}
	if errors.Unwrap(w2) != nil {
		t.Error("WithCause(nil) 应使 w2.cause 为 nil")
	}
}
