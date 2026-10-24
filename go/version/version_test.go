// ===== go/version 单测（ADR-023 L2 补盲区）=====
package version

import (
	"regexp"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// TestVersion_Default 确认未注入时为 dev
func TestVersion_Default(t *testing.T) {
	// 原逻辑倒置恒真——`Version!="dev" && Version!=""` 时外层条件为 false 直接通过，
	// 且内层 `if Version==""` 是分支内死代码，空串也能过测。改为直接断言非空。
	testutil.Equal(t, Version != "", true, "Version 不应为空字符串（默认 dev 或 ldflags 注入值）")
}

// TestVersion_Format 注入版本号后应符合 vX.Y.Z 或 dev 格式
func TestVersion_Format(t *testing.T) {
	// 当前包内 Version 是可变全局，单测无法注入 ldflags；
	// 仅校验默认值格式合法
	v := Version
	testutil.Equal(t, v != "", true, "Version 不应为空")
	// dev 或 vX.Y.Z[-suffix] 格式（P4：真补 $ 锚定——原注释声称锚定但正则未锚，
	// "v1.2.3garbage!" 仍通过；可选后缀保留 "-beta" 类格式）
	// 保留惰性求值原形态：v=="dev" 时短路不编译正则
	ok := v == "dev" || regexp.MustCompile(`^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`).MatchString(v)
	testutil.Equal(t, ok, true, "Version 格式异常: %q", v)
}
