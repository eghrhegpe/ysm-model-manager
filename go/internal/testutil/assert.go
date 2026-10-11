// 统一断言 helper（ADR-202 刀5）——**纯转发层**（单一事实源翻转，G3 清偿 2026-10-11）。
//
// 实现已上移模块根 internal/testutil（根桥包自足实现 8 个断言函数）：Go
// internal 可见性规则的**方向**是——go/internal/... 只允许 go/ 子树内导入
// （父目录=go/），而 go/... 包（rooted 模块根）**可以**导入根 internal/...
// （父目录=模块根）。故「根包转发 go 包」不可编译（前序实证 not allowed），
// 唯一合法单源形态 = 根侧实现 + go 侧转发。本文件逐函数透传，判据/
// diff/豁免语义与翻转正体（internal/testutil|testutil.go）零分叉——
// 若两侧行为需变更，只改根侧实现，本层永不复制逻辑。
//
// 消费方 import 路径不变（仍 "ysm-model-manager/go/internal/testutil"）：
// 既有 go/ 测试零改动；根 internal/app 测试直接引 "ysm-model-manager/internal/testutil"。
package testutil

import (
	"testing"

	rt "ysm-model-manager/internal/testutil"
)

// NoError 断言 err 为 nil，否则致命失败并附加上下文（透传 rt.NoError）。
func NoError(t *testing.T, err error, msgAndArgs ...any) { rt.NoError(t, err, msgAndArgs...) }

// ErrorContains 断言 err 非 nil 且 Error() 包含 substr（透传 rt.ErrorContains）。
func ErrorContains(t *testing.T, err error, substr string, msgAndArgs ...any) {
	rt.ErrorContains(t, err, substr, msgAndArgs...)
}

// ErrorIs 断言 err 非 nil 且 errors.Is(err, target) 成立（透传 rt.ErrorIs）。
func ErrorIs(t *testing.T, err, target error, msgAndArgs ...any) {
	rt.ErrorIs(t, err, target, msgAndArgs...)
}

// Equal 断言 got == want（go-cmp 深度比较，透传 rt.Equal）。
func Equal[T any](t *testing.T, got, want T, msgAndArgs ...any) {
	rt.Equal(t, got, want, msgAndArgs...)
}

// Nil 断言 v 为 nil（含 typed nil，透传 rt.Nil）。
func Nil(t *testing.T, v any, msgAndArgs ...any) { rt.Nil(t, v, msgAndArgs...) }

// NotNil 断言 v 非 nil（透传 rt.NotNil）。
func NotNil(t *testing.T, v any, msgAndArgs ...any) { rt.NotNil(t, v, msgAndArgs...) }

// FileExists 断言 path 存在（透传 rt.FileExists）。
func FileExists(t *testing.T, path string, msgAndArgs ...any) { rt.FileExists(t, path, msgAndArgs...) }

// FileNotExists 断言 path 不存在（Lstat 口径，透传 rt.FileNotExists）。
func FileNotExists(t *testing.T, path string, msgAndArgs ...any) {
	rt.FileNotExists(t, path, msgAndArgs...)
}
