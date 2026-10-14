// disabled_counterpart.go：路径「禁用孪生形态」谓词——与 relink_backup.go 同族
// （路径形态判定收在 fsutil，供 go/instance 与 go/sync 共用，禁止各包内联拼后缀）。
// 后缀表归 go/types/registry（单一事实源）；依赖方向 fsutil → registry 无环（registry 不引 fsutil）。
package fsutil

import (
	"os"

	"ysm-model-manager/go/types/registry"
)

// DisabledCounterpart 返回 path 的**禁用孪生路径**：path 本身不存在、而 path+禁用后缀
// （新标准 .disabled 优先、历史 .ban 兼容）存在时返回后者与 true；否则返回 ("", false)。
//
// 用途（ADR-345 D2）：识别「该单元/该夹在实例侧处于禁用态」——dirLevel 单元的实例侧路径
// 是 rel 的盲 join，实例把整夹改名成 X.disabled 后原路径不存在，若不认载体就会把
// 「已禁用」误判成「缺失（待推送）」，进而推送另建同名活跃副本（模型复活 + 同模型两份）。
//
// 语义边界：path 存在时**恒不命中**（活跃路径是当前真值，载体只是历史残留）；
// 仅做存在性判断，不校验是文件还是目录（调用方按自己的语义解释）。
func DisabledCounterpart(path string) (string, bool) {
	if path == "" {
		return "", false
	}
	if _, err := os.Stat(path); err == nil {
		return "", false // 活跃形态存在 → 它是当前真值
	}
	for _, sfx := range registry.DisableSuffixes() {
		if c := path + sfx; c != path {
			if _, err := os.Stat(c); err == nil {
				return c, true
			}
		}
	}
	return "", false
}
