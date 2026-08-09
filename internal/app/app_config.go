// ========== 配置 + 自动更新 + 窗口 + 目录选择 + .minecraft 定位 ==========
// 从 app.go 拆分：配置持久化、自动更新、窗口状态、目录选择、MC 检测
package app

import (
	"encoding/json"
	"fmt"
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

// GetConfigPath 返回应用配置文件路径（跨平台：Windows %APPDATA%，Linux ~/.config，macOS ~/Library/Application Support）
// 供前端 UI 展示，避免硬编码 Windows 路径
func (a *App) GetConfigPath() string {
	return configPath()
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
	oldCfg := a.LoadAppConfig()
	// P4 修复：校验失败时 validated 置空 → 下方 orDefault 回退 oldCfg.McRoot——
	// 原实现校验失败 errMsg 被丢弃、未校验的 mcRoot 原样写入（配置损坏路径静默生效）
	validated := mcRoot
	if mcRoot != "" {
		if v, errMsg := a.ValidateMinecraftDir(mcRoot); errMsg == "" {
			validated = v
		} else {
			validated = ""
		}
	}
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
		// P2 修复：VoxelMaxBlocks 从 oldCfg 拷贝——原手工构造漏带该字段，
		// 保存任何设置都会把用户体素上限重置为 0（默认 200000）
		VoxelMaxBlocks: oldCfg.VoxelMaxBlocks,
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
	if err := a.saveConfig(cfg); err != nil {
		return err
	}
	// 技术债 #4：保存成功后同步内存 LinkMode（与 SetLinkMode 同模式）——
	// 原实现写盘后 installer 安装仍用旧链接模式直到重启（GetLinkMode 读 a.LinkMode）
	a.LinkMode = cfg.LinkMode
	// 技术债 #4：FilesRoot/McRoot 变化后重启 watcher——原 restartWatcher 是无调用点死代码，
	// 保存后 watcher 仍监听旧目录（文件变更不再触发自动同步）；saveConfig 已更新 configCache，
	// 故 GetRepoRoot 返回新 FilesRoot 推导的 ysm 根。
	// P3 修复（code_review）：仅当 ysm root 或 McRoot 实际变化才重启——原无条件重启使
	// theme-only/link-mode-only 保存（前端 settings 每次保存都调）拆除重建 watcher（全仓
	// WalkDir 同步 + 自动同步窗口）；Start 失败返回错误而非 println 静默假成功
	rootChanged := cfg.FilesRoot != oldCfg.FilesRoot || cfg.McRoot != oldCfg.McRoot
	if rootChanged {
		if ysmRoot, err := a.GetRepoRoot("ysm"); err == nil {
			if err := a.restartWatcher(ysmRoot, cfg.McRoot); err != nil {
				return err
			}
		}
	}
	return nil
}

func (a *App) SetDownloadMirror(mirror string) error {
	cfg := a.LoadAppConfig()
	cfg.Mirror = mirror
	return a.saveConfig(cfg)
}

func (a *App) restartWatcher(repoRoot, mcRoot string) error {
	if a.watcher != nil {
		a.watcher.Stop()
		a.watcher = nil
	}
	if repoRoot != "" && mcRoot != "" {
		a.watcher = watcher.New(repoRoot, mcRoot, a.scanModelEntries, a.ClearScanCache)
		if err := a.watcher.Start(); err != nil {
			// P3 修复（code_review）：Start 失败必须向上传播——原 println 静默 + SaveAppConfig
			// 返回 nil，旧 watcher 已停而新 watcher 未起 → 自动同步静默永久丢失（假成功）
			return fmt.Errorf("重启文件监听失败: %w", err)
		}
	}
	return nil
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
		_, vx, vy, _ := getVirtualScreen()
		state.X = vx + vw*cfg.WinRelX/100
		// P4 修复：Y 漏加 vy——多屏上下排布时相对坐标重算缺虚拟屏 Y 偏移，
		// 窗口位置整体上移 vy 像素（X 侧一直有 vx，Y 侧对称补齐）
		state.Y = vy + vh*cfg.WinRelY/100
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

	// 平台专属启动器路径扫描（盘符/环境变量/XDG/Apple 标准路径）
	scanMinecraftDirsPlatform(add)

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
