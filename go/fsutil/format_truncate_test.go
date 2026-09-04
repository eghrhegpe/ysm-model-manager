package fsutil

import "testing"

// ===== TruncateWidth（cli 表格列宽语义：省略号 "…" 占 1 个宽度预算）=====

func TestTruncateWidth_Short(t *testing.T) {
	if got := TruncateWidth("hello", 10); got != "hello" {
		t.Errorf("TruncateWidth('hello', 10) = %q, want 'hello'", got)
	}
}

func TestTruncateWidth_Exact(t *testing.T) {
	if got := TruncateWidth("hello", 5); got != "hello" {
		t.Errorf("TruncateWidth('hello', 5) = %q, want 'hello'", got)
	}
}

func TestTruncateWidth_Long(t *testing.T) {
	if got := TruncateWidth("abcdef", 4); got != "abc…" {
		t.Errorf("TruncateWidth('abcdef', 4) = %q, want 'abc…'", got)
	}
}

func TestTruncateWidth_RuneAware(t *testing.T) {
	cases := []struct {
		in    string
		width int
		want  string
	}{
		{"模型", 5, "模型"},      // 6 字节但 2 rune，宽 5 不截断（rune 计数）
		{"模型管理器", 4, "模型管…"}, // 5 rune 超宽 4 → 取 3 rune + 省略号
		{"abc", 5, "abc"},    // ASCII 不超宽
		{"", 3, ""},
	}
	for _, c := range cases {
		if got := TruncateWidth(c.in, c.width); got != c.want {
			t.Errorf("TruncateWidth(%q, %d) = %q, 期望 %q", c.in, c.width, got, c.want)
		}
	}
}

// 原 cli 私有版 width=0 会 panic（runes[:-1]）；收编版防御 width<=0 返回空串（无半截）
func TestTruncateWidth_NonPositive(t *testing.T) {
	if got := TruncateWidth("hello", 0); got != "" {
		t.Errorf("TruncateWidth('hello', 0) = %q, want ''（防御非正宽度不 panic）", got)
	}
	if got := TruncateWidth("hello", -1); got != "" {
		t.Errorf("TruncateWidth('hello', -1) = %q, want ''", got)
	}
}

func TestTruncateWidth_WidthOne(t *testing.T) {
	if got := TruncateWidth("hello", 1); got != "…" {
		t.Errorf("TruncateWidth('hello', 1) = %q, want '…'（仅省略号占位）", got)
	}
}

// ===== TruncateLimit（ysm Tips 上限语义：省略号 "..." 追加超出预算）=====

func TestTruncateLimit_Short(t *testing.T) {
	if got := TruncateLimit("hello", 10); got != "hello" {
		t.Errorf("TruncateLimit('hello', 10) = %q, want 'hello'", got)
	}
}

func TestTruncateLimit_Exact(t *testing.T) {
	if got := TruncateLimit("hello", 5); got != "hello" {
		t.Errorf("TruncateLimit('hello', 5) = %q, want 'hello'", got)
	}
}

func TestTruncateLimit_Long(t *testing.T) {
	if got := TruncateLimit("hello world", 5); got != "hello..." {
		t.Errorf("TruncateLimit('hello world', 5) = %q, want 'hello...'", got)
	}
}

func TestTruncateLimit_Empty(t *testing.T) {
	if got := TruncateLimit("", 5); got != "" {
		t.Errorf("TruncateLimit('', 5) = %q, want ''", got)
	}
}

func TestTruncateLimit_ZeroLimit(t *testing.T) {
	if got := TruncateLimit("hello", 0); got != "..." {
		t.Errorf("TruncateLimit('hello', 0) = %q, want '...'", got)
	}
}

func TestTruncateLimit_RuneCount(t *testing.T) {
	s := "中中中中中" // 5 rune
	if got := TruncateLimit(s, 3); got != "中中中..." {
		t.Errorf("TruncateLimit(%q, 3) = %q, want '中中中...'（按 rune 截断不切半）", s, got)
	}
}

// 防御：负数 limit 与 0 同义（截空 + 省略号），不 panic
func TestTruncateLimit_NegativeLimit(t *testing.T) {
	if got := TruncateLimit("hello", -1); got != "..." {
		t.Errorf("TruncateLimit('hello', -1) = %q, want '...'", got)
	}
}
