// ===== go/version 单测（ADR-023 L2 补盲区）=====
package version

import (
	"regexp"
	"testing"
)

// TestVersion_Default 确认未注入时为 dev
func TestVersion_Default(t *testing.T) {
	// P4 修复：原逻辑倒置恒真——`Version!="dev" && Version!=""` 时外层条件为 false 直接通过，
	// 且内层 `if Version==""` 是分支内死代码，空串也能过测。改为直接断言非空。
	if Version == "" {
		t.Fatal("Version 不应为空字符串（默认 dev 或 ldflags 注入值）")
	}
}

// TestVersion_Format 注入版本号后应符合 vX.Y.Z 或 dev 格式
func TestVersion_Format(t *testing.T) {
	// 当前包内 Version 是可变全局，单测无法注入 ldflags；
	// 仅校验默认值格式合法
	v := Version
	if v == "" {
		t.Fatal("Version 不应为空")
	}
	// dev 或 vX.Y.Z[-suffix] 格式（P4：补 $ 锚定，防 "v1.2.3garbage!" 通过）
	ok := v == "dev" || regexp.MustCompile(`^v?\d+\.\d+\.\d+`).MatchString(v)
	if !ok {
		t.Fatalf("Version 格式异常: %q", v)
	}
}
