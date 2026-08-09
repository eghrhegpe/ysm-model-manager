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
		{"operation not permitted", "权限不足"},
		{"open /x: no such file or directory", "文件或目录不存在"},
		{"cannot find file", "文件或目录不存在"},
		{"file is locked by another process", "文件被其他程序占用"},
		{"device or resource busy", "文件被其他程序占用"},
		// P3 补测：EEXIST 归「文件已存在」而非「被占用」（第 10 批回归点）
		{"file exists", "文件已存在"},
		{"file already exists", "文件已存在"},
		// P3 补测：「目录为空」组（含收窄后的完整短语）
		{"directory is empty", "目录为空"},
		{"no files found in directory", "目录为空"},
		{"connection timed out", "连接超时"},
		{"connection refused", "连接被拒绝"},
		{"connection reset by peer", "网络连接中断"},
		{"broken pipe", "网络连接中断"},
		{"network error", "网络连接异常"},
		{"invalid argument", "参数无效"},
		{"no space left on device", "磁盘空间不足"},
		{"unsupported format", "不支持的格式"},
		// P3 补测：限流 vs 打开文件过多分组（第 10 批回归点）
		{"too many requests", "操作过于频繁"},
		{"rate limited", "操作过于频繁"},
		{"too many open files", "打开的文件过多"},
		{"not a directory", "路径不是目录"},
		{"is a directory", "路径是目录"},
	}
	for _, c := range cases {
		got := Friendly(errors.New(c.msg))
		if !strings.Contains(got.Error(), c.want) {
			t.Errorf("Friendly(%q) = %q, 应含 %q", c.msg, got.Error(), c.want)
		}
	}
}

// P3 补测：子串误匹配负例——收窄后的模式不得误伤相邻语义
func TestFriendlyMappings_Negative(t *testing.T) {
	// "no filesystem" 不得误归「目录为空」（裸 "no files" 是它的子串，已收窄）
	got := Friendly(errors.New("no filesystem mounted"))
	if strings.Contains(got.Error(), "目录为空") {
		t.Errorf("no filesystem 不应误分类为目录为空: %q", got.Error())
	}
	if !strings.Contains(got.Error(), "操作失败") {
		t.Errorf("no filesystem 应落兜底前缀: %q", got.Error())
	}
	// "too many levels of symbolic links" 不得误归限流（裸 "too many" 已收窄）
	got2 := Friendly(errors.New("too many levels of symbolic links"))
	if strings.Contains(got2.Error(), "过于频繁") {
		t.Errorf("ELOOP 不应误归限流: %q", got2.Error())
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
