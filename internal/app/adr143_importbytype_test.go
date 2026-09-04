// ===== ADR-143 / ADR-051 交叉验证：ImportByType 边界契约与 error 化收益实证 =====
// 本文件不改动任何生产代码，仅用测试固化两条架构结论，供人类架构师在「兄弟会话反复折腾
// ImportByType 是否该 error 化」的争论中作为可运行证据：
//
//	① ADR-143 把 ImportByType 列入「真字符串档」白名单是成立的（非 JSON、成功空串）；
//	② 「方案 A：内部 Handler.Import error 化 + 边界 err.Error() 转 string」的结构化收益
//	   是虚假的——压串后 errors.Is / AppError.Code 全部不可恢复（ADR-051 已判定）。
package app

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// looksLikeJSON 判断一段文本是否可整体解析为 JSON（ADR-143 §2 红线：string 承载 JSON 才违规）。
func looksLikeJSON(s string) bool {
	var dummy any
	return json.Unmarshal([]byte(s), &dummy) == nil
}

// TestImportByType_Contract_SuccessReturnsEmptyString 证明成功路径返回空串。
// 这是全仓唯一生产消费方 frontend/src/views/app-tree/toolbar-events.ts
// `if (errMsg)` 判失败的契约基础，也是 ADR-143 允许其保持 string 签名的前提。
func TestImportByType_Contract_SuccessReturnsEmptyString(t *testing.T) {
	a, _, _ := packApp(t) // packApp 已配置 ResourcepackRoot
	src := filepath.Join(t.TempDir(), "mod.ysm")
	if err := os.WriteFile(src, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := a.ImportByType("resourcepack", src); got != "" {
		t.Fatalf("ImportByType 成功应返回空串，got=%q", got)
	}
}

// TestImportByType_Contract_FailureIsPlainTextNotJSON 证明失败结果是人类可读纯文本、
// 而非 JSON 字符串。这正是 ADR-143 §2.5 治理闸（binding-check.ts 白名单）允许其返回
// string 的前提：违规的是「string 承载 JSON」，ImportByType 是「真字符串档」。
func TestImportByType_Contract_FailureIsPlainTextNotJSON(t *testing.T) {
	a, _, _ := packApp(t)

	unknown := a.ImportByType("nonexistent-type", "/x/a.ysm")
	if unknown == "" {
		t.Fatal("未知类型应返回非空错误文案")
	}
	if looksLikeJSON(unknown) {
		t.Fatalf("ImportByType 失败结果不应是 JSON 字符串（ADR-143 红线），got=%q", unknown)
	}

	empty := a.ImportByType("resourcepack", "")
	if empty == "" {
		t.Fatal("空源路径应返回非空错误文案")
	}
	if looksLikeJSON(empty) {
		t.Fatalf("ImportByType 失败结果不应是 JSON 字符串，got=%q", empty)
	}
}

// TestImportByType_ErrorizeBoundaryLosesStructure 实证「方案 A」的结构化收益是虚假的。
//
// 模拟 importer 内部已 error 化、产出结构化 AppError（ADR-051 范式），其 Unwrap 可被
// errors.Is 穿透；但 ImportByType 边界必须把 error 压成 string 给前端（前端仅 `if (errMsg)`
// 判失败，无 errors.Is 消费点）。压串后：
//   - errors.Is 不再能穿透（丢失底层 errno / 哨兵判定）；
//   - AppError.Code 字段随 Error() 文本化彻底丢失（types.go:220 Error() 不输出 Code）。
//
// 结论：error 化内部 Handler.Import 不会带来任何结构增益；若要保留结构，唯一途径是改签名为
// (bool, error)——而这正是 ADR-143 §2.5 治理闸 + 「已知遗留」明确禁止的。故方案 A 不应做。
func TestImportByType_ErrorizeBoundaryLosesStructure(t *testing.T) {
	// 1) 假设 importer 内部已 error 化，产出结构化 AppError（ADR-051 范式）
	appErr := types.AppError{
		Code:      types.ErrFileExists,
		Operation: "import",
		Reason:    "文件已存在",
	}.WithCause(fs.ErrExist)

	// 2) ADR-051 工作态：errors.Is 可经 Unwrap 穿透分类
	if !errors.Is(appErr, fs.ErrExist) {
		t.Fatal("ADR-051 预期：AppError 经 Unwrap 可被 errors.Is 穿透")
	}
	if appErr.Code != types.ErrFileExists {
		t.Fatal("结构化 Code 应保留")
	}

	// 3) ImportByType 边界：err.Error() 压成 string 给前端（受当前 string 签名约束）
	boundaryStr := appErr.Error()
	reconstructed := errors.New(boundaryStr)

	// 4) 压串后结构全部丢失
	if errors.Is(reconstructed, fs.ErrExist) {
		t.Fatal("压串后 errors.Is 不应再能穿透——证明边界 string 化破坏 ADR-051 分类链路")
	}
	if strings.Contains(boundaryStr, "FILE_EXISTS") {
		t.Fatal("AppError.Error() 不应内联 Code 文本；若内联，前端也只能子串匹配（ADR-051 禁止的反模式）")
	}
	t.Logf("边界 string = %q —— 仅含人类文案，Code/errno 均不可恢复，印证 error 化内部无结构增益", boundaryStr)
}
