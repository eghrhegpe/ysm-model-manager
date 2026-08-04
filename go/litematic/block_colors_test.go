// ===== go/litematic 纯函数单测（ADR-023 L2 补覆盖）=====
package litematic

import (
	"strings"
	"testing"
)

// TestMapColor_Predefined 预定义方块直接命中
func TestMapColor_Predefined(t *testing.T) {
	got := MapColor("stone")
	if got != "#7F7F7F" {
		t.Fatalf("stone 应为 #7F7F7F，实际 %s", got)
	}
	// 命名空间前缀应被剥离
	if MapColor("minecraft:stone") != "#7F7F7F" {
		t.Fatal("minecraft: 前缀应被剥离后命中 stone")
	}
}

// TestMapColor_FuzzyMatch 后缀变体走模糊匹配
func TestMapColor_FuzzyMatch(t *testing.T) {
	// red_sandstone 预定义 → red_sandstone_stairs 剥 _stairs 后命中 red_sandstone 的颜色
	base := MapColor("red_sandstone")
	stairs := MapColor("red_sandstone_stairs")
	if base == "" || stairs == "" {
		t.Fatalf("red_sandstone/stairs 颜色不应为空: base=%q stairs=%q", base, stairs)
	}
	// stairs 不在预定义表，应通过 fuzzyMatch 命中 base 的颜色
	if stairs != base {
		t.Fatalf("red_sandstone_stairs 应模糊匹配到 red_sandstone 颜色 %q，实际 %q", base, stairs)
	}
}

// TestMapColor_HashFallback 未知方块走哈希回退（确定性 + 6 位 hex 格式）
func TestMapColor_HashFallback(t *testing.T) {
	unknown := "totally_unknown_block_xyz"
	c1 := MapColor(unknown)
	c2 := MapColor(unknown)
	if c1 != c2 {
		t.Fatalf("相同输入应确定性返回相同颜色: %q vs %q", c1, c2)
	}
	if !strings.HasPrefix(c1, "#") || len(c1) != 7 {
		t.Fatalf("颜色应为 #RRGGBB 7 字符格式: %q", c1)
	}
	// 不同未知方块哈希颜色应大概率不同
	other := MapColor("another_unknown_block_abc")
	if other == c1 {
		t.Fatalf("两个不同未知方块哈希颜色不应相同: %q", c1)
	}
}

// TestHashColor_Deterministic 哈希颜色对相同输入稳定
func TestHashColor_Deterministic(t *testing.T) {
	if hashColor("test") != hashColor("test") {
		t.Fatal("hashColor 相同输入应返回相同结果")
	}
}

// TestRgbToHex_Clamp rgbToHex 钳位到 [0,255]
func TestRgbToHex_Clamp(t *testing.T) {
	if got := rgbToHex(-10, 300, 128); got != "#00ff80" {
		t.Fatalf("钳位后应为 #00ff80，实际 %s", got)
	}
}
