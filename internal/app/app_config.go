// ========== 配置 + 自动更新 + 窗口 + 目录选择 + .minecraft 定位 ==========
// 从 app.go 拆分：配置持久化、自动更新、窗口状态、目录选择、MC 检测
package app

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"

	"ysm-model-manager/go/fsutil"
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
	// 平台差异收敛：桌面 os.UserConfigDir() / Android 沙盒（PathManager，ADR-046 P2）
	dir := appDataRoot()
	// 与 go/logs 的子目录保持一致（YSM-Model-Manager），用户目录下统一管理
	if dir == "" {
		// 平台数据根缺失（Android 沙盒注入缺失等）：绝不低于为相对路径——
		// filepath.Join("", "YSM-Model-Manager") = "YSM-Model-Manager"，在
		// CWD=/ 只读根上 MkdirAll 静默报 read-only（P1 审核：不静默降级为 "."）。
		// 空串让调用方（saveConfig/logs.NewLogger）fail-fast 报明确错误。
		return ""
	}
	return filepath.Join(dir, "YSM-Model-Manager")
}

func configPath() string {
	dir := configDir()
	if dir == "" {
		return "" // 平台数据根缺失：不生成相对路径（configDir 守卫，见 TestConfigDir_NoRelativeFallback）
	}
	return filepath.Join(dir, "ysm_config.json")
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
	if newPath == "" || newPath == "ysm_config.json" {
		return // 平台数据根缺失：无目标位置，跳过迁移（避免相对路径）
	}
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
			println("[migrate] 迁移目录创建失败:", err.Error())
			return
		}
		// 原子写入（ADR-109 §4，与 saveConfig 同口径）：裸 os.WriteFile 中途崩溃会留下
		// 截断 JSON，上方「新位置已存在即跳过」守卫会让损坏配置永久阻断重迁移
		if err := fsutil.WriteFileAtomic(newPath, data); err != nil {
			println("[migrate] 迁移写盘失败:", err.Error())
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
		// 配置文件不存在属正常（首次启动），其余错误值得记录
		if !os.IsNotExist(err) {
			println("[loadAppConfig] 读取配置失败:", err.Error())
		}
		return
	}
	var cfg types.AppConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		// JSON 损坏时原实现静默 return——configCache 保留零值且
		// configLoaded=true，后续 LoadAppConfig 返回空配置且永不再读取（用户配置"丢失"无报错）
		println("[loadAppConfig] 配置解析失败:", err.Error(), "——使用默认配置")
		// 不设 configLoaded，让下次 LoadAppConfig 重试（保留原文件供人工修复）
		return
	}
	// 配置迁移逻辑简化：旧 repoRoot 字段已废弃，由 FilesRoot 统一承载
	if cfg.LinkMode != "" {
		a.linkModeMu.Lock()
		a.LinkMode = cfg.LinkMode
		a.linkModeMu.Unlock()
	}
	// populate config cache
	a.configMu.Lock()
	a.configCache = cfg
	a.configLoaded = true
	a.configMu.Unlock()
}

func (a *App) SaveAppConfig(filesRoot, rpRoot, mcRoot, linkMode, theme string) error {
	oldCfg := a.LoadAppConfig()
	// 校验失败时 validated 置空 → 下方 orDefault 回退 oldCfg.McRoot——
	// 原实现校验失败 errMsg 被丢弃、未校验的 mcRoot 原样写入（配置损坏路径静默生效）。
	// 不得静默回退并返回 nil（假成功）——回退旧值但 SaveAppConfig
	// 返回 nil 会使前端发成功 toast、内存 cfg.mcRoot 更新为新路径而磁盘保留旧路径（UI/磁盘
	// 分叉、重启后设置静默消失）。校验失败必须返回错误让 Wails binding reject；
	// 注意 v1.3.2 历史约束（写盘前返回错误阻塞配置创建）——此处 fallback 写盘已就绪，
	// 返回错误不重蹈覆辙
	validated := mcRoot
	if mcRoot != "" {
		if v, errMsg := a.ValidateMinecraftDir(mcRoot); errMsg == "" {
			validated = v
		} else {
			return fmt.Errorf("游戏目录校验失败: %s", errMsg)
		}
	}
	cfg := types.AppConfig{
		FilesRoot:   orDefault(filesRoot, oldCfg.FilesRoot),
		CustomRoots: oldCfg.CustomRoots, // 保留自定义根目录映射
		McRoot:      orDefault(validated, oldCfg.McRoot),
		LinkMode:    orDefault(linkMode, oldCfg.LinkMode),
		Theme:       orDefault(theme, oldCfg.Theme),
		Mirror:      oldCfg.Mirror,
		// VoxelMaxBlocks 从 oldCfg 拷贝——原手工构造漏带该字段，
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
	a.linkModeMu.Lock()
	a.LinkMode = cfg.LinkMode
	a.linkModeMu.Unlock()
	// 技术债 #4：FilesRoot/McRoot 变化后重启 watcher——原 restartWatcher 是无调用点死代码，
	// 保存后 watcher 仍监听旧目录（文件变更不再触发自动同步）；saveConfig 已更新 configCache，
	// 故 GetRepoRoot 返回新 FilesRoot 推导的 ysm 根。
	// 仅当 ysm root 或 McRoot 实际变化才重启——原无条件重启使
	// theme-only/link-mode-only 保存（前端 settings 每次保存都调）拆除重建 watcher（全仓
	// WalkDir 同步 + 自动同步窗口）；Start 失败返回错误而非 println 静默假成功
	rootChanged := cfg.FilesRoot != oldCfg.FilesRoot || cfg.McRoot != oldCfg.McRoot
	if rootChanged {
		// GetRepoRoot 失败时原实现静默跳过——watcher 已 Stop
		// 新 watcher 未起，自动同步永久丢失且 SaveAppConfig 假成功；改返回 error
		ysmRoot, err := a.GetRepoRoot("ysm")
		if err != nil {
			return fmt.Errorf("GetRepoRoot 失败，watcher 未重启: %w", err)
		}
		if err := a.restartWatcher(ysmRoot, cfg.McRoot); err != nil {
			return err
		}
		// 预创建所有类型存储子目录：用户改根路径后期望整棵类型树立即落在磁盘
		if err := a.EnsureStorageDirs(); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) SetDownloadMirror(mirror string) error {
	cfg := a.LoadAppConfig()
	cfg.Mirror = mirror
	return a.saveConfig(cfg)
}

// SaveThresholds 保存运行阈值配置（ADR-062 §2.3：前端设置页写入入口）。
// 仅更新传入的阈值字段，其余字段从旧配置保留（与 SaveAppConfig 的 orDefault 语义一致）。
// checkIntervalMs / logMaxEntries 传 0 = 重置为各包默认常量（scanner/logs 读取 0=默认）。
func (a *App) SaveThresholds(checkIntervalMs int, logMaxEntries int) error {
	cfg := a.LoadAppConfig()
	cfg.UpdateCheckIntervalMs = checkIntervalMs
	cfg.LogMaxEntries = logMaxEntries
	return a.saveConfig(cfg)
}

func (a *App) restartWatcher(filesRoot, mcRoot string) error {
	a.watcherMu.Lock()
	defer a.watcherMu.Unlock()
	if a.watcher != nil {
		a.watcher.Stop()
		a.watcher = nil
	}
	if filesRoot != "" && mcRoot != "" {
		a.watcher = watcher.New(filesRoot, mcRoot, a.scanModelEntries, a.ClearScanCache)
		if err := a.watcher.Start(); err != nil {
			// Start 失败必须向上传播——原 println 静默 + SaveAppConfig
			// 返回 nil，旧 watcher 已停而新 watcher 未起 → 自动同步静默永久丢失（假成功）
			return fmt.Errorf("重启文件监听失败: %w", err)
		}
	}
	return nil
}

// SetSessionFilesRoot CLI 会话级覆写 FilesRoot（仅内存，不落盘）。
// 背景（审核 #4 CLI 写穿）：原 DispatchCommand 经 SaveAppConfig 初始化配置，
// CLI 的 --files-root 是一次性会话参数（临时目录/测试沙盒），落盘会永久改写
// 真实用户配置的仓库根（GUI 下次启动静默指向被污染路径）。改为仅覆写内存
// configCache：本次命令内 LoadAppConfig 可见，磁盘零副作用；其余配置字段
// （Mirror/LinkMode 等）仍从真实配置读取，GUI 配置以设置页 SaveAppConfig
// 为唯一写入口。
func (a *App) SetSessionFilesRoot(filesRoot string) {
	a.LoadAppConfig() // 确保已从磁盘加载（含 double-check，避免覆盖后丢真实字段）
	a.configMu.Lock()
	defer a.configMu.Unlock()
	a.configCache.FilesRoot = filesRoot
	a.configLoaded = true
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
	// ADR-095: 将废弃的独立配置字段（YsmRoot/MmdRoot 等）迁移到 CustomRoots map
	migrateLegacyConfigFields(&a.configCache)
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

// validUpdateURL 更新下载地址白名单校验（DoUpdate 是 Wails binding，
// 任意 webview JS 可传入任意 URL → 内网 SSRF / 恶意 exe 装盘；
// 仅放行 https + GitHub 系域名。
// 域名匹配必须锚定完整二级域（github.com / *.githubusercontent.com 等），
// 不可用 HasSuffix——"evil-github.com" 会绕过纯后缀匹配。）
func validUpdateURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	if u.Scheme != "https" {
		return false
	}
	h := strings.ToLower(u.Host)
	return h == "github.com" ||
		h == "www.github.com" ||
		h == "raw.githubusercontent.com" ||
		h == "objects.githubusercontent.com" ||
		strings.HasSuffix(h, ".githubusercontent.com") ||
		h == "ghfast.top" ||
		h == "gh-proxy.com"
}

func (a *App) DoUpdate(url string, expectedHash string) string {
	if !validUpdateURL(url) {
		return "下载失败: 非法的更新地址"
	}
	exePath, err := updater.DownloadWithProgress(url, expectedHash, func(done, total int64) {
		// 下载进度事件：与前端 download-queue 的 download:progress 同构，多参打包为数组
		a.app.Event.Emit("update:progress", done, total)
	})
	if err != nil {
		return "下载失败: " + err.Error()
	}
	defer os.Remove(exePath)
	if err := updater.InstallUpdate(exePath); err != nil {
		return "安装失败: " + err.Error()
	}
	return "success"
}

func (a *App) RestartApplication() error {
	// ADR-047 平台守卫：Android 进程模型不同（Activity 生命周期），
	// os.Executable + exec.Command 重启链不适用，明确拒绝
	if runtime.GOOS == "android" {
		return fmt.Errorf("RestartApplication: Android 不支持进程重启，请手动重新打开应用")
	}
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
// getVirtualScreen 已按平台拆分：screen_windows.go（user32 双屏）/ screen_other.go（非 Windows 零值）

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
		// Y 漏加 vy——多屏上下排布时相对坐标重算缺虚拟屏 Y 偏移，
		// 窗口位置整体上移 vy 像素（X 侧一直有 vx，Y 侧对称补齐）
		state.Y = vy + vh*cfg.WinRelY/100
	}
	// `state.X <= 0 && state.Y <= 0` 把主屏左上角合法 0,0
	// 误判为未配置——改用 WinW/WinH 未配置标志判据（truthiness 吞合法值，ADR-044②）
	if state.Width == 1200 && state.Height == 800 && cfg.WinX == 0 && cfg.WinY == 0 && cfg.WinW == 0 {
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
	// 统一走 PathManager——桌面 os.UserConfigDir() / Android 沙盒，
	// 不再直调系统 API 造成与 config/logs 落点分叉
	if appData := appDataRoot(); appData != "" {
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

// ========== 配置迁移（ADR-095）==========

// getConfigFieldByReflection 通过反射读取 AppConfig 中指定字段的值
func getConfigFieldByReflection(cfg types.AppConfig, fieldName string) string {
	v := reflect.ValueOf(cfg)
	f := v.FieldByName(fieldName)
	if !f.IsValid() {
		return ""
	}
	if f.Kind() == reflect.String {
		return f.String()
	}
	return ""
}

// clearDeprecatedFields 清空 AppConfig 中标记为废弃的字段
func clearDeprecatedFields(cfg *types.AppConfig) {
	v := reflect.ValueOf(cfg).Elem()
	// 与 types/config.go 中 Deprecated 注释块对应
	deprecatedFields := []string{
		"YsmRoot", "ResourcepackRoot", "ShaderpackRoot", "SchematicRoot",
		"LitematicRoot", "MmdRoot", "VrcRoot",
	}
	for _, fieldName := range deprecatedFields {
		f := v.FieldByName(fieldName)
		if f.IsValid() && f.CanSet() && f.Kind() == reflect.String {
			f.SetString("")
		}
	}
}

// migrateLegacyConfigFields 将 AppConfig 中已废弃的独立字段迁移到 CustomRoots map。
// 遍历注册表，将 configField 指向的旧字段值（如 YsmRoot, MmdRoot）搬运到 CustomRoots[rtype]，
// 清空旧字段防止双源。仅在首次加载时执行，后续使用 CustomRoots 作为唯一事实源。
func migrateLegacyConfigFields(cfg *types.AppConfig) {
	if cfg.CustomRoots == nil {
		cfg.CustomRoots = make(map[string]string)
	}

	registry := types.LoadRegistry()
	for _, rt := range registry.ResourceTypes {
		if rt.ConfigField == "" {
			continue
		}

		fieldValue := getConfigFieldByReflection(*cfg, rt.ConfigField)
		if fieldValue == "" {
			continue
		}

		if _, exists := cfg.CustomRoots[rt.ID]; !exists {
			cfg.CustomRoots[rt.ID] = fieldValue
			log.Printf("[config-migrate] 迁移 %s: %s -> CustomRoots[%s]", rt.ConfigField, fieldValue, rt.ID)
		}
	}

	// 迁移后清空废弃字段，防止双源写入
	clearDeprecatedFields(cfg)
}
