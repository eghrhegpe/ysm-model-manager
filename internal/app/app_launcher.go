// ========== 启动器实例探测（install 域，App 侧委托） ==========
// 逻辑已垂直切分至 internal/app/install（ADR-179 P1）。本文件仅保留 Wails 绑定委托。
package app

import (
	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/app/install"
)

func (a *App) DetectLauncherInstances(launcherDir string) ([]types.LauncherInstance, error) {
	return install.DetectLauncherInstances(launcherDir)
}
