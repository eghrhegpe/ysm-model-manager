// ========== 配置 + 自动更新 + 窗口 + 目录选择 + .minecraft 定位 ==========
// 从 app.go 拆分：配置持久化、自动更新、窗口状态、目录选择、MC 检测
package app

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

func configDir() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "." // 兜底：仅当系统 API 异常，避免崩溃
	}
	// 与 go/logs 的子目录保持一致（YSM-Model-Manager），用户目录下统一管理
	return filepath.Join(dir, "YSM-Model-Manager")
}

func configPath() string {
	return filepath.Join(configDir(), "ysm_config.json")
}

// migrateLegacyConfig 将旧版落在 exe 相对路径（含仓库根）的 ysm_config.json
// 迁移到用户配置目录。仅当新位置不存在、且旧候选之一存在时执行；
// 复制成功后才删除旧文件，失败时保留旧文件不丢数据。
func migrateLegacyConfig() {
	newPath := configPath()
	if _, err := os.Stat(newPath); err == nil {
		return // 已迁移，跳过
	}
	exe, _ := os.Executable()
	candidates := []string{
		filepath.Join(filepath.Dir(exe), "ysm_config.json"),
		filepath.Join(filepath.Dir(exe), "..", "ysm_config.json"),
		filepath.Join(".", "ysm_config.json"),
	}
	for _, p := range candidates {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(newPath), 0o755); err != nil {
			return
		}
		if err := os.WriteFile(newPath, data, 0o644); err != nil {
			return
		}
		_ = os.Remove(p) // 迁移成功，清理旧文件
		return
	}
}

func (a *App) loadAppConfig() {
	migrateLegacyConfig() // 启动期先将旧位置配置迁到用户目录
	data, err := os.ReadFile(configPath())
	if err != nil {
		return
	}
	var cfg types.AppConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return
	}
	// 配置迁移：旧 repoRoot → 新 filesRoot + ysm 子目录
	if cfg.FilesRoot == "" && cfg.RepoRoot != "" {
		cfg.FilesRoot = cfg.RepoRoot
		cfg.RepoRoot = ""
		_ = a.saveConfig(cfg)
	}
	// repoRoot 从 FilesRoot 动态推导，无需手动赋值
	if cfg.LinkMode != "" {
		a.LinkMode = cfg.LinkMode
	}
	// populate config cache
	a.configMu.Lock()
	a.configCache = cfg
	a.configLoaded = true
	a.configMu.Unlock()
}

func (a *App) SaveAppConfig(filesRoot, rpRoot, mcRoot, linkMode, theme string) error {
	validated := mcRoot
	if mcRoot != "" {
		if v, errMsg := a.ValidateMinecraftDir(mcRoot); errMsg == "" {
			validated = v
		}
	}
	oldCfg := a.LoadAppConfig()
	cfg := types.AppConfig{
		FilesRoot:        orDefault(filesRoot, oldCfg.FilesRoot),
		ResourcepackRoot: orDefault(rpRoot, oldCfg.ResourcepackRoot),
		ShaderpackRoot:   oldCfg.ShaderpackRoot,
		SchematicRoot:    oldCfg.SchematicRoot,
		MmdRoot:          oldCfg.MmdRoot,
		VrcRoot:          oldCfg.VrcRoot,
		McRoot:           orDefault(validated, oldCfg.McRoot),
		LinkMode:         orDefault(linkMode, oldCfg.LinkMode),
		Theme:            orDefault(theme, oldCfg.Theme),
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
	return a.saveConfig(cfg)
}

func (a *App) restartWatcher(repoRoot, mcRoot string) {
	if a.watcher != nil {
		a.watcher.Stop()
		a.watcher = nil
	}
	if repoRoot != "" && mcRoot != "" {
		a.watcher = watcher.New(repoRoot, mcRoot, a.ScanModelEntries, a.ClearScanCache)
		if err := a.watcher.Start(); err != nil {
			println("[watcher] 重启失败:", err.Error())
		}
	}
}

func orDefault(val, fallback string) string {
	if val != "" {
		return val
	}
	return fallback
}

func (a *App) LoadAppConfig() types.AppConfig {
	a.configMu.RLock()
	if a.configLoaded {
		defer a.configMu.RUnlock()
		return a.configCache
	}
	a.configMu.RUnlock()

	a.configMu.Lock()
	defer a.configMu.Unlock()
	// double-check after acquiring write lock
	if a.configLoaded {
		return a.configCache
	}
	readJSONFile(configPath(), &a.configCache)
	a.configLoaded = true
	return a.configCache
}

// ========== 自动更新 ==========
// GetSubDirMap 返回资源类型→子目录映射表（前端右键菜单等场景使用）
func (a *App) GetSubDirMap() map[string]string {
	return types.SubDirAll()
}

func (a *App) CurrentVersion() string { return version.Version }

func (a *App) CheckUpdate() (*updater.UpdateInfo, error) {
	return updater.Check(version.Version)
}

func (a *App) DownloadUpdate(url string, expectedHash string) (string, error) {
	return updater.Download(url, expectedHash)
}

func (a *App) ApplyUpdate(zipPath string) error {
	return updater.InstallUpdate(zipPath)
}

func (a *App) DoUpdate(url string, expectedHash string) string {
	zipPath, err := updater.Download(url, expectedHash)
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
	a.app.Quit()
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
	a.saveConfig(cfg)
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
		state.Y = vh * cfg.WinRelY / 100
	}
	if state.X <= 0 && state.Y <= 0 {
		state.X = 100
		state.Y = 100
	}
	return state
}

// ========== 目录选择 ==========
func (a *App) SelectDirectory() (string, error) {
	return a.app.Dialog.OpenFile().
		CanChooseDirectories(true).
		SetTitle("选择目录").
		PromptForSingleSelection()
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
