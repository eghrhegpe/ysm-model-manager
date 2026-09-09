// ===== go/types 留守域补测：AppError =====
package types

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestAppError_Error(t *testing.T) {
	e := AppError{Code: ErrorCode("X"), Operation: "导入", SourcePath: "/s", Reason: "失败", Suggestion: "重试"}
	msg := e.Error()
	for _, part := range []string{"失败", "导入", "/s", "重试"} {
		if !strings.Contains(msg, part) {
			t.Fatalf("Error() 缺少 %q: %s", part, msg)
		}
	}
	// 空路径不拼接源路径/目标路径段
	e2 := AppError{Code: ErrorCode("Y"), Reason: "r", Operation: "o", Suggestion: "s"}
	got := e2.Error()
	if strings.Contains(got, "源路径") || strings.Contains(got, "目标路径") {
		t.Fatalf("空路径不应拼接: %s", got)
	}
}

// TestAppError_Error_MatchesFixture — 跨语言契约锚点（ADR-207 D2）：
// AppError.Error() 文案钉死共享 fixture（tests/fixtures/apperror-sample.json）。
// 前端 stripAppErrorPaths（utils/base/apperror-text.ts）与 Node 契约测试
// （tests/test_apperror_strip.ts）跑同一 fixture——任一侧文案/正则漂移即双端测试红，
// 同 PR 同步 fixture + Go 文案 + 前端正则。
func TestAppError_Error_MatchesFixture(t *testing.T) {
	data, err := os.ReadFile("../../tests/fixtures/apperror-sample.json")
	if err != nil {
		t.Fatalf("读契约 fixture 失败: %v", err)
	}
	var fx struct {
		WithPaths string `json:"withPaths"`
		NoPaths   string `json:"noPaths"`
	}
	if err := json.Unmarshal(data, &fx); err != nil {
		t.Fatalf("fixture 解析失败: %v", err)
	}

	e := AppError{
		Code:       ErrorCode("IMPORT"),
		Operation:  "导入",
		SourcePath: `C:\Users\x\a.ysm`,
		TargetPath: `C:\Users\y`,
		Reason:     "文件读取失败",
		Suggestion: "检查文件权限",
	}
	if got := e.Error(); got != fx.WithPaths {
		t.Fatalf("Error() 偏离契约 fixture（故意改文案须同步 fixture + 前端 stripAppErrorPaths）:\n got: %s\nwant: %s", got, fx.WithPaths)
	}

	e2 := AppError{Code: ErrorCode("COPY"), Operation: "复制", Reason: "磁盘空间不足", Suggestion: "清理磁盘空间"}
	if got := e2.Error(); got != fx.NoPaths {
		t.Fatalf("Error() 偏离契约 fixture:\n got: %s\nwant: %s", got, fx.NoPaths)
	}
}
