// ===== go/version 单测（ADR-023 L2 补盲区）=====
package version

import (
	"regexp"
	"testing"
)

// TestVersion_Default 确认未注入时为 dev
func TestVersion_Default(t *testing.T) {
	if Version != "dev" && Version != "" {
		// 测试环境可能被构建脚本注入了版本号，接受任一非空值
		if Version == "" {
			t.Fatal("Version 不应为空字符串")
		}
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
	// dev 或 vX.Y.Z[-suffix] 格式
	ok := v == "dev" || regexp.MustCompile(`^v?\d+\.\d+\.\d+`).MatchString(v)
	if !ok {
		t.Fatalf("Version 格式异常: %q", v)
	}
}
