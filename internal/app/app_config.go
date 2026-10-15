// ========== 配置 + 自动更新 + 窗口 + 目录选择 + .minecraft 定位 ==========
// 从 app.go 拆分：配置持久化、自动更新、窗口状态、目录选择、MC 检测
package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
	"ysm-model-manager/go/updater"
	"ysm-model-manager/go/version"
	"ysm-model-manager/go/watcher"
	"ysm-model-manager/internal/app/install"
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
	// 测试专用覆盖（见 pathmgr_test.go|setConfigDirForTest）：防 saveConfig 写穿
	// 真实用户配置——TestResolvedRootCache 曾把用户 ysm_config.json 的 filesRoot
	// 覆写成 t.TempDir()（2026-09-26 事故）。生产代码永不置此值。
	if configDirOverride != "" {
		return configDirOverride
	}
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
			log.Printf("[migrate] 迁移目录创建失败: %v", err)
			return
		}
		// 原子写入（ADR-109 §4，与 saveConfig 同口径）：裸 os.WriteFile 中途崩溃会留下
		// 截断 JSON，上方「新位置已存在即跳过」守卫会让损坏配置永久阻断重迁移
		if err := fsutil.WriteFileAtomic(newPath, data); err != nil {
			log.Printf("[migrate] 迁移写盘失败: %v", err)
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
			log.Printf("[loadAppConfig] 读取配置失败: %v", err)
		}
		return
	}
	var cfg types.AppConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		// JSON 损坏时原实现静默 return——configCache 保留零值且
		// configLoaded=true，后续 LoadAppConfig 返回空配置且永不再读取（用户配置"丢失"无报错）
		log.Printf("[loadAppConfig] 配置解析失败: %v ——使用默认配置", err)
		// 不设 configLoaded，让下次 LoadAppConfig 重试（保留原文件供人工修复）
		return
	}
	// 配置迁移逻辑简化：旧 repoRoot 字段已废弃，由 FilesRoot 统一承载
	// ⚠️ 双读路径必须都跑 migrateLegacyConfigFields（锐评 2026-10-15 P2）：
	// 本路径（启动期）此前漏掉了它，而 LoadAppConfig 惰性路径有。后果不是「多读了旧字段」
	// ——是「旧字段值从未被搬进 CustomRoots，却被 clearDeprecatedFields 清零」：
	// 存量升级用户的 ysmRoot=D:/ysm 经启动路径进 cache（CustomRoots=nil），
	// 用户在设置页任意一次保存（哪怕只改主题）就会把它清零且不回填 → specificRoot("ysm")
	// 返回空 → GetRepoRoot 静默回退 FilesRoot 派生路径，用户独立路径彻底丢失。
	// ADR-296 D6 审查② 当时只对称化了 washLinkMode，字段迁移被漏。
	// 现统一走版本门控的 applyConfigMigrations（两路对称，见该函数注释）。
	applyConfigMigrations(&cfg)
	// 加载侧软校验：见 washLinkMode（ADR-296 D6）
	washLinkMode(&cfg)
	if cfg.LinkMode != "" {
		a.install.SyncLinkMode(cfg.LinkMode)
	}
	// populate config cache
	a.configMu.Lock()
	a.configCache = cfg
	a.configLoaded = true
	a.configMu.Unlock()
}

// washLinkMode 就地洗脏 linkMode（ADR-296 D6）：非法值洗为 ""（未设置 = 默认 copy 语义）并记日志，
// 合法值/空串原样保留。loadAppConfig 与 LoadAppConfig 惰性路径**共用**——两路都直填 configCache，
// 任一路漏洗都会让脏值进缓存：前端 `cfgLocal.linkMode || "copy"` 只兜空串，脏值使
// linkSelect.value 匹配不到 option（selectedIndex=-1 显示空白），与 Go 内存快照分叉（对抗审查 D 项）。
// 磁盘原样保留供人工修复——两个读路径都无写盘职责，不在读路径写文件。
func washLinkMode(cfg *types.AppConfig) {
	if cfg.LinkMode != "" && !install.IsValidLinkMode(cfg.LinkMode) {
		log.Printf("[config] 链接模式非法: %q ——洗为默认（copy），磁盘保留原值", cfg.LinkMode)
		cfg.LinkMode = ""
	}
}

// applyConfigMigrations 对读出的配置执行**版本门控**的结构性迁移。
// loadAppConfig 与 LoadAppConfig 惰性路径**必须共用本函数**——两路都直填 configCache，
// 任一路漏跑即复现 8c858c54a 的病灶（旧字段未被搬进 CustomRoots 却被 clearDeprecatedFields 清零，
// 用户存量独立路径在下次任意保存时静默丢失）。
//
// 门控规则（取代旧的"每次读盘都跑 migrateLegacyConfigFields"）：
//   - SchemaVersion < types.SchemaVersion（含 0/缺失的遗留文件）→ 跑字段迁移 + 盖当前版本章。
//   - SchemaVersion >= types.SchemaVersion → 结构已迁移，不再重跑启发式。旧实现每次读盘都
//     重跑，等价于"永远假设文件是旧的"，版本号一旦存在就失去意义。
//
// 与 washLinkMode 的分工：washLinkMode 是**值软校验**（幂等，每读必跑，非法 linkMode 进内存即脏）；
// 本函数是**结构迁移**（一次，盖章后不再重复）。二者不可合并——值校验必须每读跑，
// 结构迁移必须只跑一次。
func applyConfigMigrations(cfg *types.AppConfig) {
	if cfg.SchemaVersion < types.SchemaVersion {
		migrateLegacyConfigFields(cfg)
		cfg.SchemaVersion = types.SchemaVersion
	}
}

// applyPostSaveSideEffects 配置**落盘成功后**的副作用（SaveAppConfig / SaveAppConfigPatch /
// ImportSettingsFromFile 三处共用）。抽成一处的原因：这三段尾部代码曾是逐份手抄的
// 「SyncLinkMode + 根路径变更时 rebuildWatcherAndDirs」，而每加一个写入口就多一份副本、
// 漏一份就复现「设置页已显示新模式、实际链接仍按旧模式直到重启」的陷阱。
//
// 调用方必须在 configWriteMu 锁内、且已 saveConfig 成功后调用（副作用不可逆）。
func (a *App) applyPostSaveSideEffects(oldCfg types.AppConfig, cfg *types.AppConfig) error {
	// 保存成功后同步内存 LinkMode（与 SetLinkMode 同模式）——
	// 原实现写盘后 installer 安装仍用旧链接模式直到重启（GetLinkMode 读 a.LinkMode）
	a.install.SyncLinkMode(cfg.LinkMode)
	// FilesRoot/McRoot 变化后重启 watcher：
	// - 原 restartWatcher 是无调用点死代码，保存后 watcher 仍监听旧目录
	// - 仅当实际变化才重启（防 theme-only/link-mode-only 保存触发全仓 WalkDir）
	// - Start 失败返回 error（原 println 静默会导致 watcher 永久丢失）
	if cfg.FilesRoot != oldCfg.FilesRoot || cfg.McRoot != oldCfg.McRoot {
		return a.rebuildWatcherAndDirs(cfg)
	}
	return nil
}

func (a *App) SaveAppConfig(filesRoot, rpRoot, mcRoot, linkMode, theme, themeAuto string) error {
	// 串行化整段读-改-写（configWriteMu，锐评 2026-10-15 P2）：下方 oldCfg 来自
	// LoadAppConfig 的快照，若与另一写并发，二者会各自把「改前的快照」整份落盘，
	// 后写者静默覆盖前写者的字段。
	a.configWriteMu.Lock()
	defer a.configWriteMu.Unlock()

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
	// 以旧为基（cfg := oldCfg 再覆盖本函数六入参涉及的字段），取代旧「白名单手工构造」：
	// 白名单凡漏列一个字段就在保存时被零值覆盖——历史已两次踩中（VoxelMaxBlocks 曾被重置、
	// 窗口状态曾散落），而 go/types AppConfig 的 8 个运行阈值字段（ScanCacheTTL/DownloadTimeout/
	// LogMax*/PreviewReadLimit/UpdateCheck*）全部不在旧白名单内，用户经 SaveThresholds 设好后
	// 改一次主题即被清零（回退各包默认）。结构性根治「逐字段手抄必漏」（同 SetDownloadMirror/
	// SaveThresholds 的以旧为基模式）。rpRoot 是废弃入参（CustomRoots 承载），不再触碰 oldCfg.CustomRoots。
	// 回归锁 TestSaveAppConfig_PreservesThresholdFields（锐评 2026-10-10）。
	cfg := oldCfg
	cfg.FilesRoot = orDefault(filesRoot, oldCfg.FilesRoot)
	cfg.McRoot = orDefault(validated, oldCfg.McRoot)
	// 净化已自兜底（空参→旧值、脏值→旧值、双脏→""），勿再套 orDefault（审查 ④）
	cfg.LinkMode = install.SanitizeLinkMode(linkMode, oldCfg.LinkMode)
	cfg.Theme = orDefault(theme, oldCfg.Theme)
	// P4 修复：theme-auto 落盘（localStorage 被清理后可从 ysm_config.json 回退）
	cfg.ThemeAuto = orDefault(themeAuto, oldCfg.ThemeAuto)
	// 废弃独立字段清零——旧白名单构造「不拷贝它们」天然达成，以旧为基后必须显式清，
	// 否则启动路径 loadAppConfig（不清废弃字段）留下的 YsmRoot 等会经这次保存重新落盘、
	// 破坏 migrateLegacyConfigFields 的「防双源写入」不变量（值拷贝不含它们 = 与旧构造等价）。
	clearDeprecatedFields(&cfg)
	if err := a.saveConfig(cfg); err != nil {
		return err
	}
	// 落盘后的副作用（SyncLinkMode + 根路径变更时重启 watcher）收拢到
	// applyPostSaveSideEffects，避免每新增一个写入口就手抄一份（ADR-344-d1）
	return a.applyPostSaveSideEffects(oldCfg, &cfg)
}

// SaveAppConfigPatch 部分更新应用配置（锐评 2026-10-15 P1 ③）——**前端唯一推荐入口**。
//
// 与 SaveAppConfig 的分工：SaveAppConfig 保留给六个位置实参的旧调用形态（含 web 端
// 适配器与既有测试），本绑定提供 patch 语义。两者共用同一把 configWriteMu，锁的范围
// 都是「锁内重读 → 改 → 落盘」，故两者互相之间也不会丢字段。
//
// 为什么值得多一个绑定：writeAppConfig 原先在 JS 侧「先 await LoadAppConfig() 再
// await SaveAppConfig(拼好的六元组)」——两个 await 之间让出事件循环，期间任何其它
// 写入口（SaveThresholds / SetDownloadMirror / 另一处 writeAppConfig）改的字段都不在
// 本次快照里，会被这次整份回写静默覆盖（用户改的设置重启后回到旧值，且无任何报错）。
// 把整段搬进一次调用后，TOCTOU 窗口从「两次 IPC 之间的任意长事件循环」收窄为「不存在」。
//
// nil 字段 = 未传，取锁内重读的现值（见 types.AppConfigPatch 的 nil 契约）。
// 校验语义与 SaveAppConfig 同口径：mcRoot 非空必过 ValidateMinecraftDir，
// linkMode 走 SanitizeLinkMode 软校验（非法值回落旧值，不 reject 整个保存——
// 「只想改主题、原样回写 linkMode」是多数调用方，别误伤）。
func (a *App) SaveAppConfigPatch(patch types.AppConfigPatch) error {
	a.configWriteMu.Lock()
	defer a.configWriteMu.Unlock()

	// 锁内重读：这是本绑定存在的全部理由——快照必须在锁内取，才可能与其它写串行
	oldCfg := a.LoadAppConfig()
	cfg := oldCfg

	if patch.FilesRoot != nil {
		cfg.FilesRoot = *patch.FilesRoot
	}
	if patch.McRoot != nil {
		// 校验失败必须返回错误让 binding reject，且**不落盘**——原实现在此静默写入
		// 未校验路径（配置损坏路径静默生效），见 SaveAppConfig 同处注释的踩坑史
		if *patch.McRoot != "" {
			v, errMsg := a.ValidateMinecraftDir(*patch.McRoot)
			if errMsg != "" {
				return fmt.Errorf("游戏目录校验失败: %s", errMsg)
			}
			cfg.McRoot = v
		} else {
			cfg.McRoot = ""
		}
	}
	if patch.LinkMode != nil {
		// SanitizeLinkMode 自兜底：空参→旧值、脏值→旧值（与 SaveAppConfig 同口径）
		cfg.LinkMode = install.SanitizeLinkMode(*patch.LinkMode, oldCfg.LinkMode)
	}
	if patch.Theme != nil {
		cfg.Theme = *patch.Theme
	}
	if patch.ThemeAuto != nil {
		cfg.ThemeAuto = *patch.ThemeAuto
	}
	// 废弃字段清零：以旧为基会把 loadAppConfig 留下的 YsmRoot 等重新落盘，
	// 破坏 migrateLegacyConfigFields 的「防双源写入」不变量（与 SaveAppConfig 同因）
	clearDeprecatedFields(&cfg)

	if err := a.saveConfig(cfg); err != nil {
		return err
	}
	return a.applyPostSaveSideEffects(oldCfg, &cfg)
}

func (a *App) SetDownloadMirror(mirror string) error {
	// 读-改-写事务串行化（configWriteMu，锐评 2026-10-15 P2）：与 SaveAppConfig /
	// SaveThresholds / SetResourceRoot 共享同一把锁，避免镜像源切换把并发写入的
	// 其他字段改前快照冲回旧值。
	a.configWriteMu.Lock()
	defer a.configWriteMu.Unlock()

	cfg := a.LoadAppConfig()
	cfg.Mirror = mirror
	return a.saveConfig(cfg)
}

// SaveThresholds 保存运行阈值配置（ADR-062 §2.3：前端设置页写入入口）。
// 仅更新传入的阈值字段，其余字段从旧配置保留（与 SaveAppConfig 的 orDefault 语义一致）。
// checkIntervalMs / logMaxEntries 传 0 = 重置为各包默认常量（scanner/logs 读取 0=默认）。
func (a *App) SaveThresholds(checkIntervalMs int, logMaxEntries int) error {
	// 读-改-写事务串行化（configWriteMu，锐评 2026-10-15 P2）：同 SetDownloadMirror。
	a.configWriteMu.Lock()
	defer a.configWriteMu.Unlock()

	cfg := a.LoadAppConfig()
	cfg.UpdateCheckIntervalMs = checkIntervalMs
	cfg.LogMaxEntries = logMaxEntries
	return a.saveConfig(cfg)
}

// rebuildWatcherAndDirs 根路径变化后重建 watcher + 预创建存储子目录。
// 拆分为独立函数：saveConfig 只负责写盘+LinkMode同步，watcher重建是副作用清晰的独立操作。
func (a *App) rebuildWatcherAndDirs(cfg *types.AppConfig) error {
	ysmRoot, err := a.GetRepoRoot("ysm")
	if err != nil {
		return fmt.Errorf("GetRepoRoot 失败，watcher 未重启: %w", err)
	}
	if err := a.restartWatcher(ysmRoot, cfg.McRoot); err != nil {
		return err
	}
	// 预创建所有类型存储子目录：用户改根路径后期望整棵类型树立即落在磁盘
	return a.EnsureStorageDirs()
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
		a.watcher.SetOnChange(a.emitRepoFsChanged) // 与 ServiceStartup 同装配（重建实例须重注入）
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
	// 根清单直改须与 saveConfig 同失效（防御纵深）：当前唯一调用点 go/cli/registry
	// 在 dispatch 最早期执行、先于任何缓存预热，现实 staleness 窗口为零；但失效
	// 契约不能依赖调用时序——凡写 configCache 根字段处一律 Clear（allAllowedRoots
	// 与 resolvedRoot 同失效范式，见 app_allowed_roots_cache.go / app_resolved_root_cache.go）。
	a.ensureAllowedRootsCache().Clear()
	a.ensureResolvedRootCache().Clear()
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
	if err := readJSONFile(configPath(), &a.configCache); err != nil {
		// ⚠️ 惰性路径此前**静默** return（锐评 2026-10-15 P2）——configLoaded 保持 false
		// 让下次调用重试（这是对的，app_config_loaded_test.go 锁住），但失败本身零日志，
		// 与启动路径 loadAppConfig 的打日志口径不一致：JSON 损坏时用户在日志面板看不到任何
		// 痕迹（尤其启动路径若也失败，诊断就是彻底盲区）。此处补上，且**仅跳过 NotExist**
		// （文件缺失=首次启动，属正常；启动路径也是这个口径），避免持久缺失时每次调用刷屏。
		if !os.IsNotExist(err) {
			log.Printf("[LoadAppConfig] 读取配置失败: %v ——保留原文件供人工修复", err)
		}
		return a.configCache
	}
	// ADR-095: 将废弃的独立配置字段（YsmRoot/MmdRoot 等）迁移到 CustomRoots map
	// 版本门控：与 loadAppConfig 共用 applyConfigMigrations（两路对称，8c858c54a 病灶）
	applyConfigMigrations(&a.configCache)
	// 惰性路径与 loadAppConfig 同洗脏值（ADR-296 D6 审查 ②：启动 IO 失败后首次调用
	// 走本路径直填 configCache，不洗则脏 linkMode 从旁路漏进前端下拉——两路对称）
	washLinkMode(&a.configCache)
	a.configLoaded = true
	return a.configCache
}

// ========== 自动更新 ==========
// GetSubDirMap 返回资源类型→子目录映射表（前端右键菜单等场景使用）
func (a *App) GetSubDirMap() map[string]string {
	return registry.SubDirAll()
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

// DoUpdate 下载并应用更新。成功时返回 "success"（正常返回）或 os.Exit(0)
// （helper 已在侧等待替换 exe，主进程必须退出）。
// ErrExitRequested 路径仍会 os.Exit：helper 替换 exe 需要主进程先退出，
// 此路径无法避免。手动清理临时文件（os.Exit 会跳过 defer）。
func (a *App) DoUpdate(url string, expectedHash string) (string, error) {
	if !validUpdateURL(url) {
		return "", fmt.Errorf("非法的更新地址")
	}
	exePath, err := updater.DownloadWithProgress(url, expectedHash, func(done, total int64) {
		// 下载进度事件：与前端 download-queue 的 download:progress 同构，多参打包为数组
		a.app.Event.Emit("update:progress", done, total)
	})
	if err != nil {
		return "", err
	}
	if err := updater.InstallUpdate(exePath); err != nil {
		_ = os.Remove(exePath) // 失败路径：手动清理（无 os.Exit）
		if errors.Is(err, updater.ErrExitRequested) {
			// helper 已在侧等待，主进程必须退出以完成 exe 替换。
			// os.Exit 会跳过 defer，故上方已手动 Remove。
			os.Exit(0)
		}
		return "", fmt.Errorf("安装失败: %w", err)
	}
	_ = os.Remove(exePath) // 成功路径（理论上不可达，InstallUpdate 成功恒返 ErrExitRequested）
	return "success", nil
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

// SaveWindowPosition 持久化窗口位置/尺寸与双屏相对坐标（退出时由 app.go|shutdown 调）。
//
// 持 configWriteMu（锐评 2026-10-15 P2 补刀）：本函数是**第 6 个配置写入面**，形态与
// 同族五个一样是「Load→modify→save」，此前唯独它没持锁——退出保存若与任何一次设置
// 保存并发，两边读到同一份快照、整份互冲（用户刚设好的阈值/镜像源被窗口坐标覆盖掉，
// 且本函数只 log 不返回错误 = 双重静默）。持锁范围与同族一致 = 整个 Load→modify→save。
//
// 锁外只做纯计算（getVirtualScreen / safePct）：无配置读写，不必占锁。
// 回归锁 app_window_position_test.go（跨写入面并发 -race + 单线程字段保全）。
func (a *App) SaveWindowPosition(x, y, width, height int) {
	a.configWriteMu.Lock()
	defer a.configWriteMu.Unlock()

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
	// 窗口位置持久化失败不影响本次会话生效，但需落日志（避免静默吞错）
	if err := a.saveConfig(cfg); err != nil {
		log.Printf("[window] 保存窗口位置失败: %v", err)
	}
}

// clampWindowSize 窗口尺寸兜底：<=0 回落默认 1200×800（「未配置」哨兵判据依赖该值），
// 正数但小于最小值（main.go MinWidth/MinHeight 同值 800×600）夹紧到最小值——防配置文件
// 部分损坏或用户怪操作把窗口恢复成 1×1 之类。
func clampWindowSize(w, h int) (int, int) {
	const (
		defaultW   = 1200
		defaultH   = 800
		minWindowW = 800
		minWindowH = 600
	)
	if w <= 0 {
		w = defaultW
	} else if w < minWindowW {
		w = minWindowW
	}
	if h <= 0 {
		h = defaultH
	} else if h < minWindowH {
		h = minWindowH
	}
	return w, h
}

func (a *App) GetWindowPosition() types.WindowState {
	cfg := a.LoadAppConfig()
	state := types.WindowState{
		X:      cfg.WinX,
		Y:      cfg.WinY,
		Width:  cfg.WinW,
		Height: cfg.WinH,
	}
	// 最小窗口尺寸：夹紧「正数但离谱小」的损坏/怪操作配置（main.go MinWidth/MinHeight
	// 同值，两处需同步）。<=0 仍回落默认值——下方「未配置」哨兵判据依赖 1200/800。
	state.Width, state.Height = clampWindowSize(cfg.WinW, cfg.WinH)
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

// configFieldValue 显式映射注册表 ConfigField → AppConfig 字段值。
// 替代反射读：case 分支由编译器校验字段存在，字段改名/删除即编译错误；
// 注册表新增 ConfigField 但未登记映射时显式告警跳过，杜绝静默失效。
func configFieldValue(cfg types.AppConfig, fieldName string) string {
	switch fieldName {
	case "YsmRoot":
		return cfg.YsmRoot
	case "ResourcepackRoot":
		return cfg.ResourcepackRoot
	case "ShaderpackRoot":
		return cfg.ShaderpackRoot
	case "SchematicRoot":
		return cfg.SchematicRoot
	case "LitematicRoot":
		return cfg.LitematicRoot
	case "MmdRoot":
		return cfg.MmdRoot
	case "VrcRoot":
		return cfg.VrcRoot
	default:
		log.Printf("[config-migrate] 警告: 注册表 ConfigField %q 无显式映射, 迁移跳过", fieldName)
		return ""
	}
}

// clearDeprecatedFields 显式清空 AppConfig 中标记为废弃的字段（替代反射 FieldByName）。
// 与 types/config.go 中 Deprecated 注释块对应。
func clearDeprecatedFields(cfg *types.AppConfig) {
	cfg.YsmRoot = ""
	cfg.ResourcepackRoot = ""
	cfg.ShaderpackRoot = ""
	cfg.SchematicRoot = ""
	cfg.LitematicRoot = ""
	cfg.MmdRoot = ""
	cfg.VrcRoot = ""
}

// migrateLegacyConfigFields 将 AppConfig 中已废弃的独立字段迁移到 CustomRoots map。
// 遍历注册表，将 configField 指向的旧字段值（如 YsmRoot, MmdRoot）搬运到 CustomRoots[rtype]，
// 清空旧字段防止双源。仅在首次加载时执行，后续使用 CustomRoots 作为唯一事实源。
func migrateLegacyConfigFields(cfg *types.AppConfig) {
	if cfg.CustomRoots == nil {
		cfg.CustomRoots = make(map[string]string)
	}

	registry := registry.LoadRegistry()
	for _, rt := range registry.ResourceTypes {
		if rt.ConfigField == "" {
			continue
		}

		fieldValue := configFieldValue(*cfg, rt.ConfigField)
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
