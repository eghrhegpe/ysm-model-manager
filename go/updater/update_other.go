//go:build !windows

package updater

import (
	"fmt"
	"os"
)

// extractEmbeddedHelper 非 Windows stub：自动更新仅支持 Windows（InstallUpdate 平台守卫），
// 此函数在非 Windows 上不会被调用，返回 ErrNotExist 以防误用
func extractEmbeddedHelper(dest string) error {
	return fmt.Errorf("%w: 自动更新助手仅 Windows 可用", os.ErrNotExist)
}
