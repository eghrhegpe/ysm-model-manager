// ===== go/errors 单测（零覆盖包补测）=====
// Friendly：中文错误映射（权限/不存在/占用/网络/磁盘等）+ 中文原样返回 + 未知加前缀
package errors

import (
	"errors"
	"strings"
	"testing"
)

func TestFriendlyNil(t *testing.T) {
	if got := Friendly(nil); got != nil {
		t.Fatalf("Friendly(nil) = %v, 期望 nil", got)
	}
}

func TestFriendlyChinesePassthrough(t *testing.T) {
	orig := errors.New("文件或目录不存在")
	got := Friendly(orig)
	if got != orig {
		t.Fatalf("中文错误应原样返回, got %v", got)
	}
}

func TestFriendlyMappings(t *testing.T) {
	cases := []struct {
		msg  string
		want string
	}{
		{"permission denied: /x", "权限不足"},
		{"open /x: no such file or directory", "文件或目录不存在"},
		{"file is locked by another process", "文件被其他程序占用"},
		{"connection timed out", "连接超时"},
		{"connection refused", "连接被拒绝"},
		{"no space left on device", "磁盘空间不足"},
		{"unsupported format", "不支持的格式"},
	}
	for _, c := range cases {
		got := Friendly(errors.New(c.msg))
		if !strings.Contains(got.Error(), c.want) {
			t.Errorf("Friendly(%q) = %q, 应含 %q", c.msg, got.Error(), c.want)
		}
	}
}

func TestFriendlyUnknownEnglish(t *testing.T) {
	got := Friendly(errors.New("random english error"))
	if !strings.Contains(got.Error(), "操作失败") {
		t.Errorf("未知英文错误应加中文前缀, got %q", got.Error())
	}
}

func TestHasChinese(t *testing.T) {
	if !hasChinese("文件不存在") {
		t.Error("中文应识别")
	}
	if hasChinese("file not found") {
		t.Error("英文不应误判为中文")
	}
	if hasChinese("") {
		t.Error("空串不应含中文")
	}
}
