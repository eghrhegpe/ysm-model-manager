//go:build windows

package updater

import (
	"embed"
	"fmt"
	"os"
)

//go:embed ysm-updater-helper.exe
var updaterHelper embed.FS

// extractEmbeddedHelper 将内嵌的 ysm-updater-helper.exe 释放到目标路径
func extractEmbeddedHelper(dest string) error {
	data, err := updaterHelper.ReadFile("ysm-updater-helper.exe")
	if err != nil {
		return fmt.Errorf("读取内嵌 helper: %w", err)
	}
	return os.WriteFile(dest, data, 0755)
}
