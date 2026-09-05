// ===== go/types 留守域补测：AppError =====
package types

import (
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
