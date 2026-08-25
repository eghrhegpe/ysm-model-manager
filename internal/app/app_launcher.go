package app

import (
	"ysm-model-manager/go/launcher"
	"ysm-model-manager/go/types"
)

// DetectLauncherInstances inspects a user-selected HMCL/PCL directory and
// returns the resolved YSM directory for each Minecraft instance.
func (a *App) DetectLauncherInstances(launcherDir string) ([]types.LauncherInstance, error) {
	return launcher.Detect(launcherDir)
}
