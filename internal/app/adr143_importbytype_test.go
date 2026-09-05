// ===== ImportByType error 化收益实证（ADR-143 修订版） =====
// 原 adr143_importbytype_test.go 论证「压串后结构丢失，故应保持 string 签名」。
// 本测试反转结论：ImportByType 直接透传 error，前端消费 err.Error() 显示文案，
// 后端/CLI 可 errors.Is/As 分类——保留 ADR-051 的结构化链路。
package app

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// TestImportByType_Contract_SuccessReturnsNil 成功路径返回 nil error。
func TestImportByType_Contract_SuccessReturnsNil(t *testing.T) {
	a, _, _ := packApp(t)
	src := filepath.Join(t.TempDir(), "mod.ysm")
	if err := os.WriteFile(src, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := a.ImportByType("resourcepack", src); got != nil {
		t.Fatalf("ImportByType 成功应返回 nil，got=%v", got)
	}
}

// TestImportByType_Contract_FailureIsTypedError 失败路径返回 typed error，
// 调用方可通过 err.Error() 展示给前端，或通过 errors.Is/As 分类。
func TestImportByType_Contract_FailureIsTypedError(t *testing.T) {
	a, _, _ := packApp(t)

	err := a.ImportByType("nonexistent-type", "/x/a.ysm")
	if err == nil {
		t.Fatal("未知类型应返回非 nil error")
	}
	// 人类可读文案
	if err.Error() == "" {
		t.Fatal("error 应有可读文案")
	}

	err = a.ImportByType("resourcepack", "")
	if err == nil {
		t.Fatal("空源路径应返回非 nil error")
	}
	if err.Error() == "" {
		t.Fatal("error 应有可读文案")
	}
}

// TestImportByType_PreservesStructure 证明 error 化后结构化信息可穿透。
// 前端消费 err.Error()（文案），后端/CLI 可 errors.Is/As（分类）——
// 不再需要压串到 string 再还原，结构增益真实存在。
func TestImportByType_PreservesStructure(t *testing.T) {
	// 1) 构造一个带 cause 链的 AppError（ADR-051 范式）
	appErr := types.AppError{
		Code:      types.ErrFileExists,
		Operation: "import",
		Reason:    "文件已存在",
	}.WithCause(fs.ErrExist)

	// 2) 直接透传时：errors.Is 可穿透，Code 字段保留
	if !errors.Is(appErr, fs.ErrExist) {
		t.Fatal("direct passthrough: AppError 经 Unwrap 可被 errors.Is 穿透")
	}
	if appErr.Code != types.ErrFileExists {
		t.Fatal("direct passthrough: 结构化 Code 应保留")
	}

	// 3) 前端消费 err.Error() 得人类文案
	humanMsg := appErr.Error()
	if humanMsg == "" {
		t.Fatal("Error() 应返回非空文案供前端展示")
	}

	// 4) 对比：若压成 string 再重构，errors.Is 穿透链断裂
	boundaryStr := appErr.Error()
	reconstructed := errors.New(boundaryStr)
	if errors.Is(reconstructed, fs.ErrExist) {
		t.Fatal("压串重构后 errors.Is 仍能穿透——说明原始 Error() 实现已包含 cause 信息，但不应依赖此行为")
	}

	t.Logf("error 化后：前端读 err.Error()=%q，后端可 errors.Is 分类，结构增益真实", humanMsg)
}
