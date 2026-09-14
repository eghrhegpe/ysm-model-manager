//go:build windows

package updater

import (
	"embed"
	"fmt"

	"ysm-model-manager/go/fsutil"
)

//go:embed ysm-updater-helper.exe
var updaterHelper embed.FS

// extractEmbeddedHelper 将内嵌的 ysm-updater-helper.exe 释放到目标路径
// 走 fsutil.WriteFileAtomic（同目录临时文件 + rename 原子落地），与全仓
// 「tmp+rename 原子落地」单一事实源（ADR-044 策略 A）对齐——避免裸 os.WriteFile
// 中途崩溃留半截 helper.exe 被下次 InstallUpdate 误 exec。
func extractEmbeddedHelper(dest string) error {
	data, err := updaterHelper.ReadFile("ysm-updater-helper.exe")
	if err != nil {
		return fmt.Errorf("读取内嵌 helper: %w", err)
	}
	return fsutil.WriteFileAtomic(dest, data)
}
