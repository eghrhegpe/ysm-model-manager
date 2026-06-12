// ========== 配置 + 自动更新 + 窗口 + 目录选择 + .minecraft 定位 ==========
// 从 app.go 拆分：配置持久化、自动更新、窗口状态、目录选择、MC 检测
package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/updater"
	"ysm-model-manager/go/version"
	"ysm-model-manager/go/watcher"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ========== 配置持久化 ==========
func findConfigFile(candidates ...string) string {
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	if len(candidates) > 0 {
		return candidates[0]
	}
	return ""
}

func configPath() string {
	exe, _ := os.Executable()
	return findConfigFile(
		filepath.Join(filepath.Dir(exe), "ysm_config.json"),
		filepath.Join(filepath.Dir(exe), "..", "ysm_config.json"),
		filepath.Join(".", "ysm_config.json"),
	)
}

func (a *App) loadAppConfig() {
	data, err := os.ReadFile(configPath())
	if err != nil {
		return
	}
	var cfg types.AppConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return
	}
	if cfg.RepoRoot != "" {
		a.RepoRoot = cfg.RepoRoot
	}
	if cfg.LinkMode != "" {
		a.LinkMode = cfg.LinkMode
	}
}

func (a *App) SaveAppConfig(repoRoot, rpRoot, mcRoot, linkMode, theme string) error {
	validated := mcRoot
	if mcRoot != "" {
		if v, errMsg := a.ValidateMinecraftDir(mcRoot); errMsg == "" {
			validated = v
		}
	}
	oldCfg := a.LoadAppConfig()
	cfg := types.AppConfig{
		RepoRoot:         repoRoot,
		ResourcepackRoot: rpRoot,
		ShaderpackRoot:   oldCfg.ShaderpackRoot,
		SchematicRoot:    oldCfg.SchematicRoot,
		MmdRoot:          oldCfg.MmdRoot,
		VrcRoot:          oldCfg.VrcRoot,
		McRoot:           validated,
		LinkMode:         linkMode,
		Theme:            theme,
		Mirror:           oldCfg.Mirror,
	}
	return a.saveConfig(cfg)
}

func (a *App) SetDownloadMirror(mirror string) error {
	cfg := a.LoadAppConfig()
	cfg.Mirror = mirror
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(configPath(), data, 0644)
}

func (a *App) restartWatcher(repoRoot, mcRoot string) {
	if a.watcher != nil {
		a.watcher.Stop()
		a.watcher = nil
	}
	if repoRoot != "" && mcRoot != "" {
		a.watcher = watcher.New(repoRoot, mcRoot, a.ScanModelEntries)
		if err := a.watcher.Start(); err != nil {
			println("[watcher] 重启失败:", err.Error())
		}
	}
}

func (a *App) LoadAppConfig() types.AppConfig {
	var cfg types.AppConfig
	readJSONFile(configPath(), &cfg)
	return cfg
}

// ========== 自动更新 ==========
func (a *App) CurrentVersion() string { return version.Version }

func (a *App) CheckUpdate() (*updater.UpdateInfo, error) {
	return updater.Check(version.Version)
}

func (a *App) DownloadUpdate(url string) (string, error) {
	return updater.Download(url)
}

func (a *App) ApplyUpdate(zipPath string) error {
	return updater.InstallUpdate(zipPath)
}

func (a *App) DoUpdate(url string) string {
	zipPath, err := updater.Download(url)
	if err != nil {
		return "下载失败: " + err.Error()
	}
	defer os.Remove(zipPath)
	if err := updater.InstallUpdate(zipPath); err != nil {
		return "安装失败: " + err.Error()
	}
	return "success"
}

func (a *App) RestartApplication() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe)
	if err := cmd.Start(); err != nil {
		return err
	}
	runtime.Quit(a.ctx)
	return nil
}

// ========== 窗口状态 ==========
func (a *App) SaveWindowPosition(x, y, width, height int) {
	state := types.WindowState{X: x, Y: y, Width: width, Height: height}
	exe, _ := os.Executable()
	path := filepath.Join(filepath.Dir(exe), "window_state.json")
	data, _ := json.MarshalIndent(state, "", "  ")
	os.WriteFile(path, data, 0644)
}

func (a *App) GetWindowPosition() types.WindowState {
	exe, _ := os.Executable()
	path := filepath.Join(filepath.Dir(exe), "window_state.json")
	var state types.WindowState
	state.X = 100
	state.Y = 100
	state.Width = 1200
	state.Height = 800
	readJSONFile(path, &state)
	return state
}

// ========== 目录选择 ==========
func (a *App) SelectDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择目录",
	})
}

// ========== .minecraft 定位 ==========
func isLikelyMinecraftDir(path string) bool {
	markers := []string{"versions", "assets", "launcher_profiles.json", "mods", "config"}
	for _, m := range markers {
		full := filepath.Join(path, m)
		if info, err := os.Stat(full); err == nil {
			if m == "launcher_profiles.json" || info.IsDir() {
				return true
			}
		}
	}
	return false
}

func scanMinecraftDirs() []string {
	var found []string
	seen := map[string]bool{}
	add := func(p string) {
		abs, err := filepath.Abs(p)
		if err != nil {
			return
		}
		abs = filepath.Clean(abs)
		if seen[abs] {
			return
		}
		seen[abs] = true
		if info, err := os.Stat(abs); err == nil && info.IsDir() && isLikelyMinecraftDir(abs) {
			found = append(found, abs)
		}
	}

	if exe, err := os.Executable(); err == nil {
		add(filepath.Join(filepath.Dir(exe), ".minecraft"))
		add(filepath.Join(filepath.Dir(exe), "..", ".minecraft"))
	}
	if appData, err := os.UserConfigDir(); err == nil {
		add(filepath.Join(appData, ".minecraft"))
	}

	commonPaths := []string{
		"D:\\PCL2\\.minecraft", "C:\\PCL2\\.minecraft", "E:\\PCL2\\.minecraft",
		"D:\\PCL\\.minecraft", "C:\\PCL\\.minecraft",
		"D:\\MC\\.minecraft", "C:\\MC\\.minecraft",
		"D:\\Minecraft\\.minecraft", "C:\\Minecraft\\.minecraft",
		"D:\\Games\\Minecraft\\.minecraft",
		"D:\\HMCL\\.minecraft", "C:\\HMCL\\.minecraft",
		"D:\\BakaXL\\.minecraft", "C:\\BakaXL\\.minecraft",
	}
	for _, c := range commonPaths {
		add(c)
	}

	launcherDirs := []string{
		"D:\\PCL2", "C:\\PCL2", "E:\\PCL2",
		"D:\\PCL", "C:\\PCL", "D:\\HMCL", "C:\\HMCL",
		"D:\\BakaXL", "C:\\BakaXL", "D:\\MC", "C:\\MC",
	}
	for _, dir := range launcherDirs {
		mcPath := filepath.Join(dir, ".minecraft")
		if _, err := os.Stat(mcPath); err == nil {
			abs, _ := filepath.Abs(mcPath)
			abs = filepath.Clean(abs)
			if !seen[abs] {
				seen[abs] = true
				found = append(found, abs)
			}
		}
	}
	return found
}

func (a *App) GetMinecraftPaths() []string { return scanMinecraftDirs() }

func (a *App) ValidateMinecraftDir(dir string) (string, string) {
	if dir == "" {
		return "", "请选择游戏目录"
	}
	abs, err := filepath.Abs(filepath.Clean(dir))
	if err != nil {
		return "", "路径格式错误"
	}
	if isLikelyMinecraftDir(abs) {
		return abs, ""
	}
	sub := filepath.Join(abs, ".minecraft")
	if info, err := os.Stat(sub); err == nil && info.IsDir() && isLikelyMinecraftDir(sub) {
		return sub, ""
	}
	if info, err := os.Stat(filepath.Join(abs, "versions")); err == nil && info.IsDir() {
		return abs, ""
	}
	return "", "未检测到 .minecraft 文件夹。请选择包含 versions/ 等子目录的 .minecraft 文件夹"
}





