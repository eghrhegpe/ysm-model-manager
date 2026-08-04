package app

import (
	"os"
	"path/filepath"
)

// loadBundledData 读取随附数据文件，按以下优先级解析，彻底摆脱对当前工作目录（cwd）的依赖：
//  1. exe 同级目录       —— 便携部署 / updater 热更后的最新副本；
//  2. exe 上级目录       —— dev 模式下 exe 在 bin/，bin/.. 即仓库根，命中源码中的最新文件；
//  3. 编译期嵌入的基线   —— 由 SetEmbedded 注入的 resourceFS，保证任何环境都能读到正确数据。
//
// 仅当三者皆失败时返回错误（正常情况下嵌入基线必定命中）。
func loadBundledData(name string) ([]byte, error) {
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		for _, cand := range []string{
			filepath.Join(exeDir, name),
			filepath.Join(exeDir, "..", name),
		} {
			if b, err := os.ReadFile(cand); err == nil {
				return b, nil
			}
		}
	}
	// resourceFS 为零值时 ReadFile 返回错误（等价于未注入），由调用方处理。
	return resourceFS.ReadFile(name)
}
