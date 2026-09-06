// ContainsIllegalNameChar 表驱动测试（2026-09-06 扩展：保留设备名 + 尾随点/空格）
// 单一事实源：fileops.CreateDir/RenameDir/RenameFile/folder_import.WriteModelFolder
// 的非法名检测均委托本函数——此处是 Windows 非法文件名的终审防线。
package fsutil

import "testing"

func TestContainsIllegalNameChar(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		// 合法名放行
		{"普通名", "[author]", false},
		{"中文名", "测试作者", false},
		{"中间含点", "v1.2备份", false},
		{"保留名带扩展", "con.tents", true},

		// 非法字符（原有语义）
		{"尖括号", "a<b", true},
		{"冒号", "a:b", true},
		{"问号", "a?b", true},
		{"星号", "a*b", true},
		{"竖线", "a|b", true},
		{"双引号", `a"b`, true},
		// 保留设备名（2026-09-06 扩展：大小写不敏感，含带扩展名变体）
		{"CON", "CON", true},
		{"con小写", "con", true},
		{"CON带扩展", "CON.txt", true},
		{"nul", "NUL", true},
		{"com1", "COM1", true},
		{"lpt9", "LPT9", true},
		{"aux", "Aux", true},
		// 尾随点/空格（2026-09-06 扩展：Windows 静默剥离 → 落点漂移）
		{"尾随点", "author.", true},
		{"尾随空格", "author ", true},
		// 空串合法（调用方自行判空）
		{"空串", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ContainsIllegalNameChar(tt.input); got != tt.want {
				t.Errorf("ContainsIllegalNameChar(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}
