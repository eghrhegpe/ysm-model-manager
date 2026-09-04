// ========== 启动器实例探测（install 域） ==========
// 从 app_launcher.go 垂直切分而来（ADR-179 P1）；纯函数转发，无 App 状态依赖。
package install

import (
	"ysm-model-manager/go/launcher"
	"ysm-model-manager/go/types"
)

// DetectLauncherInstances 探测用户选择的 HMCL/PCL 目录，返回各 Minecraft 实例解析出的 YSM 目录。
func DetectLauncherInstances(launcherDir string) ([]types.LauncherInstance, error) {
	return launcher.Detect(launcherDir)
}
