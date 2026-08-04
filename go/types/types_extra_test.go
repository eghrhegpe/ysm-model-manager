// ===== go/types 补测（registry_test 未覆盖分支）=====
package types

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFindInstDir_StandardDir(t *testing.T) {
	versionDir := t.TempDir()
	standard := filepath.Join(versionDir, "resourcepacks")
	if err := os.MkdirAll(standard, 0755); err != nil {
		t.Fatal(err)
	}
	if got := FindInstDir(versionDir, "resourcepacks", "resourcepack"); got != standard {
		t.Fatalf("标准目录应直接返回: %s vs %s", got, standard)
	}
}

func TestFindInstDir_FallbackScan(t *testing.T) {
	versionDir := t.TempDir()
	// 无标准目录；创建含 .zip 文件的子目录（resourcepack 支持 .zip）
	other := filepath.Join(versionDir, "custompacks")
	if err := os.MkdirAll(other, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(other, "pack.zip"), []byte("x"), 0644)
	got := FindInstDir(versionDir, "resourcepacks", "resourcepack")
	if got != other {
		t.Fatalf("应 fallback 到含 .zip 的子目录: %s vs %s", got, other)
	}
}

func TestFindInstDir_NoMatch(t *testing.T) {
	versionDir := t.TempDir()
	got := FindInstDir(versionDir, "resourcepacks", "resourcepack")
	if got != filepath.Join(versionDir, "resourcepacks") {
		t.Fatalf("无匹配应返回标准路径: %s", got)
	}
}

func TestAppError_Error(t *testing.T) {
	e := AppError{Code: "X", Operation: "导入", SourcePath: "/s", Reason: "失败", Suggestion: "重试"}
	msg := e.Error()
	for _, part := range []string{"失败", "导入", "/s", "重试"} {
		if !strings.Contains(msg, part) {
			t.Fatalf("Error() 缺少 %q: %s", part, msg)
		}
	}
	// 空路径不拼接源路径/目标路径段
	e2 := AppError{Code: "Y", Reason: "r", Operation: "o", Suggestion: "s"}
	got := e2.Error()
	if strings.Contains(got, "源路径") || strings.Contains(got, "目标路径") {
		t.Fatalf("空路径不应拼接: %s", got)
	}
}

func TestFormatRange_UnmarshalJSON(t *testing.T) {
	cases := []struct {
		in       string
		min, max int
	}{
		{`15`, 15, 15},     // 单 int
		{`[15]`, 15, 15},   // 单元素数组
		{`[1, 15]`, 1, 15}, // 双元素数组
		{`{"min_inclusive": 3, "max_inclusive": 5}`, 3, 5}, // 对象格式
	}
	for _, c := range cases {
		var fr FormatRange
		if err := json.Unmarshal([]byte(c.in), &fr); err != nil {
			t.Fatalf("解析 %s 失败: %v", c.in, err)
		}
		if fr.Min != c.min || fr.Max != c.max {
			t.Fatalf("解析 %s 得 %d/%d，期望 %d/%d", c.in, fr.Min, fr.Max, c.min, c.max)
		}
	}
	// 无效格式 → 报错
	var fr FormatRange
	if err := json.Unmarshal([]byte(`"invalid"`), &fr); err == nil {
		t.Fatal("无效格式应报错")
	}
}
