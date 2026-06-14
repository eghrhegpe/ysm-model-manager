// ========== 配置 + 自动更新 + 窗口 + 目录选择 + .minecraft 定位 ==========
// 从 app.go 拆分：配置持久化、自动更新、窗口状态、目录选择、MC 检测
package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"ysm-model-manager/go/sync"
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
		// 保留窗口状态（SaveWindowPosition 写入的字段）
		WinX:    oldCfg.WinX,
		WinY:    oldCfg.WinY,
		WinW:    oldCfg.WinW,
		WinH:    oldCfg.WinH,
		WinRelX: oldCfg.WinRelX,
		WinRelY: oldCfg.WinRelY,
		WinScrW: oldCfg.WinScrW,
		WinScrH: oldCfg.WinScrH,
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

// ========== 窗口状态（合并到 ysm_config.json，双屏安全版） ==========

// getVirtualScreen 获取 Windows 虚拟屏幕边界（所有显示器合起来的矩形）
func getVirtualScreen() (x, y, w, h int) {
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("GetSystemMetrics")
	r, _, _ := proc.Call(76) // SM_XVIRTUALSCREEN
	x = int(r)
	r, _, _ = proc.Call(77) // SM_YVIRTUALSCREEN
	y = int(r)
	r, _, _ = proc.Call(78) // SM_CXVIRTUALSCREEN
	w = int(r)
	r, _, _ = proc.Call(79) // SM_CYVIRTUALSCREEN
	h = int(r)
	if w == 0 {
		r, _, _ = proc.Call(0) // SM_CXSCREEN
		w = int(r)
	}
	if h == 0 {
		r, _, _ = proc.Call(1) // SM_CYSCREEN
		h = int(r)
	}
	return
}

func safePct(val, total int) int {
	if total <= 0 {
		return 50
	}
	p := val * 100 / total
	if p < 0 {
		p = 0
	}
	if p > 100 {
		p = 100
	}
	return p
}

func (a *App) SaveWindowPosition(x, y, width, height int) {
	vx, vy, vw, vh := getVirtualScreen()
	cfg := a.LoadAppConfig()
	cfg.WinX = x
	cfg.WinY = y
	cfg.WinW = width
	cfg.WinH = height
	cfg.WinRelX = safePct(x-vx, vw)
	cfg.WinRelY = safePct(y-vy, vh)
	cfg.WinScrW = vw
	cfg.WinScrH = vh
	data, _ := json.MarshalIndent(cfg, "", "  ")
	os.WriteFile(configPath(), data, 0644)
}

func (a *App) GetWindowPosition() types.WindowState {
	cfg := a.LoadAppConfig()
	state := types.WindowState{
		X:      cfg.WinX,
		Y:      cfg.WinY,
		Width:  cfg.WinW,
		Height: cfg.WinH,
	}
	if state.Width <= 0 {
		state.Width = 1200
	}
	if state.Height <= 0 {
		state.Height = 800
	}
	// 检测屏幕是否变化（双屏切换），用相对坐标重算
	_, _, vw, vh := getVirtualScreen()
	if cfg.WinScrW > 0 && cfg.WinScrH > 0 && (cfg.WinScrW != vw || cfg.WinScrH != vh) {
		_, vx, _, _ := getVirtualScreen()
		state.X = vx + vw*cfg.WinRelX/100
		state.Y = vh*cfg.WinRelY/100
	}
	if state.X <= 0 && state.Y <= 0 {
		state.X = 100
		state.Y = 100
	}
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
	// instances 目录（子目录中含 .minecraft/）— 用户直接选择了 PrismLauncher 的 instances 文件夹
	if sync.HasDotMinecraftSubdirs(path) {
		return true
	}
	// PrismLauncher 根目录：包含 instances/ 子目录
	if info, err := os.Stat(filepath.Join(path, "instances")); err == nil && info.IsDir() {
		return true
	}
	markers := []string{"versions", "assets", "launcher_profiles.json", "mods", "config", "prismlauncher.cfg"}
	for _, m := range markers {
		full := filepath.Join(path, m)
		if info, err := os.Stat(full); err == nil {
			if m == "launcher_profiles.json" || m == "prismlauncher.cfg" || info.IsDir() {
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

	// 收集所有可用磁盘（A-Z）
	// 用 GetLogicalDrives 比逐个 os.Stat 更高效，且避免外置硬盘超时
	var drives []string
	for d := 'C'; d <= 'Z'; d++ {
		root := string(d) + ":\\"
		if _, err := os.Stat(root); err == nil {
			drives = append(drives, root)
		}
	}

	// 常见启动器目录名（对各磁盘扫描）
	launcherNames := []string{
		"PCL2", "PCL",
		"HMCL",
		"BakaXL",
		"MC", "Minecraft", "Games\\Minecraft",
		"PrismLauncher", "MultiMC", "PolyMC",
	}
	for _, root := range drives {
		for _, name := range launcherNames {
			// 启动器根目录下的 .minecraft
			add(filepath.Join(root, name, ".minecraft"))
			// PrismLauncher/MultiMC/PolyMC：instances 目录或根目录
			if name == "PrismLauncher" || name == "MultiMC" || name == "PolyMC" {
				add(filepath.Join(root, name, "instances"))
				add(filepath.Join(root, name))
			}
		}
		// 各磁盘根目录的直接 .minecraft 文件夹
		add(filepath.Join(root, ".minecraft"))
	}

	// 也检查常见用户目录下的 PrismLauncher（不一定在盘符根目录）
	if cfgDir, err := os.UserConfigDir(); err == nil {
		add(filepath.Join(cfgDir, "PrismLauncher", "instances"))
	}
	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		// PrismLauncher 安装版在 %LOCALAPPDATA%\Programs\PrismLauncher\
		add(filepath.Join(localAppData, "Programs", "PrismLauncher", "instances"))
		add(filepath.Join(localAppData, "Programs", "PrismLauncher"))
		// MultiMC 安装版
		add(filepath.Join(localAppData, "Programs", "MultiMC", "instances"))
		add(filepath.Join(localAppData, "Programs", "MultiMC"))
	}
	if progData := os.Getenv("ProgramData"); progData != "" {
		add(filepath.Join(progData, "PrismLauncher", "instances"))
	}

	// 扫描常见安装路径下的一级子目录（用户可能把启动器放在 D:\Games\Minecraft\PCL2 而非 D:\PCL2）
	commonBases := []string{
		filepath.Join(os.Getenv("ProgramFiles"), "Minecraft"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Minecraft"),
		"D:\\Games", "D:\\Game", "D:\\Programs",
		"E:\\Games", "E:\\Game",
	}
	for _, base := range commonBases {
		if _, err := os.Stat(base); err != nil {
			continue
		}
		for _, name := range launcherNames {
			add(filepath.Join(base, name, ".minecraft"))
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
	// PrismLauncher：自身是 instances 目录（子目录中含 .minecraft/）
	if sync.HasDotMinecraftSubdirs(abs) {
		return abs, ""
	}
	// PrismLauncher 根目录：包含 instances/ 子目录
	if info, err := os.Stat(filepath.Join(abs, "instances")); err == nil && info.IsDir() {
		return abs, ""
	}
	return "", "未检测到 .minecraft 文件夹。请选择包含 versions/ 或 instances/ 等子目录的游戏目录"
}





