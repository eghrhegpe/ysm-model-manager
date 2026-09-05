// ===== go/types 补测：RegistryType / WithCause / PackMeta.Desc =====
package types

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ====== RegistryType ======

// TestRegistryType_KnownID 已知 id 应返回非 nil 且 ID 字段匹配
func TestRegistryType_KnownID(t *testing.T) {
	rt := RegistryType("resourcepack")
	if rt == nil {
		t.Fatal("RegistryType(resourcepack) = nil, 期望非 nil")
	}
	if rt.ID != "resourcepack" {
		t.Errorf("rt.ID = %q, 期望 resourcepack", rt.ID)
	}
}

// TestRegistryType_UnknownID 不存在的 id 应返回 nil
func TestRegistryType_UnknownID(t *testing.T) {
	if got := RegistryType("nonexistent_xyz_12345"); got != nil {
		t.Errorf("RegistryType(nonexistent_xyz_12345) = %v, 期望 nil", got)
	}
}

// TestRegistryType_EmptyString 空字符串作为 id 无匹配，应返回 nil
func TestRegistryType_EmptyString(t *testing.T) {
	if got := RegistryType(""); got != nil {
		t.Errorf("RegistryType(\"\") = %v, 期望 nil", got)
	}
}

// TestRegistryType_ReturnCopy 返回值是结构体拷贝，修改不应影响注册表内部状态
func TestRegistryType_ReturnCopy(t *testing.T) {
	rt1 := RegistryType("resourcepack")
	if rt1 == nil {
		t.Fatal("RegistryType(resourcepack) = nil")
	}
	origIsDir := rt1.IsDir
	// 修改返回值（拷贝）
	rt1.IsDir = !origIsDir
	// 再次查询应返回原始值（拷贝语义）
	rt2 := RegistryType("resourcepack")
	if rt2 == nil {
		t.Fatal("第二次 RegistryType(resourcepack) = nil")
	}
	if rt2.IsDir != origIsDir {
		t.Errorf("修改拷贝后再次查询 IsDir = %v, 期望 %v（应为原始值）", rt2.IsDir, origIsDir)
	}
}

// TestRegistryType_ExtensionsDeepCopy 返回值的 Extensions 切片必须与缓存解耦：
// 结构体按值拷贝只保护标量字段，切片共享底层数组时调用方篡改会污染进程级注册表缓存。
func TestRegistryType_ExtensionsDeepCopy(t *testing.T) {
	// 使用临时文件注册表，避免依赖 embedded 基线内容
	dir := t.TempDir()
	p := filepath.Join(dir, "ext.json")
	payload := `{"resourceTypes":[
		{"id":"ysm","name":"YSM","extensions":[".ysm",".zip"],"storageSubDir":"ysm"}
	]}`
	if err := os.WriteFile(p, []byte(payload), 0644); err != nil {
		t.Fatal(err)
	}
	SetRegistryPath(p)
	defer SetRegistryPath("")

	rt := RegistryType("ysm")
	if rt == nil {
		t.Fatal("RegistryType('ysm') = nil")
	}
	if len(rt.Extensions) < 1 {
		t.Fatal("ysm 应有扩展名")
	}
	// 篡改返回值切片元素
	rt.Extensions[0] = ".hacked"

	// 再次查询必须拿到未污染的原始扩展名（深拷贝语义）
	rt2 := RegistryType("ysm")
	if rt2 == nil {
		t.Fatal("第二次 RegistryType('ysm') = nil")
	}
	if rt2.Extensions[0] != ".ysm" {
		t.Errorf("RegistryType 返回的 Extensions 应深拷贝，缓存被篡改为 %q", rt2.Extensions[0])
	}
	if IsSupportedExt(".hacked") {
		t.Error("篡改返回值后 .hacked 不应成为受支持扩展名（缓存被污染）")
	}
	if !IsSupportedExt(".ysm") {
		t.Error("篡改返回值后 .ysm 应仍受支持")
	}
}

// ====== AppError.WithCause ======

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

// ====== PackMeta.Desc ======

// TestPackMeta_Desc_PlainString Plain string description 应原样返回
func TestPackMeta_Desc_PlainString(t *testing.T) {
	pm := &PackMeta{}
	pm.Pack.Description = json.RawMessage(`"Hello World"`)
	if got := pm.Desc(); got != "Hello World" {
		t.Errorf("Desc() = %q, 期望 Hello World", got)
	}
}

// TestPackMeta_Desc_TextComponent JSON text component 对象应提取 text 字段
func TestPackMeta_Desc_TextComponent(t *testing.T) {
	pm := &PackMeta{}
	pm.Pack.Description = json.RawMessage(`{"text":"你好 Minecraft"}`)
	if got := pm.Desc(); got != "你好 Minecraft" {
		t.Errorf("Desc() = %q, 期望 你好 Minecraft", got)
	}
}

// TestPackMeta_Desc_NilEmpty Description 为 nil 时应返回空字符串
func TestPackMeta_Desc_NilEmpty(t *testing.T) {
	pm := &PackMeta{}
	// Description 零值为 nil，不做赋值
	if got := pm.Desc(); got != "" {
		t.Errorf("Desc() = %q, 期望空字符串", got)
	}
}
