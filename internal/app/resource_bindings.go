package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/dedup"
	"ysm-model-manager/go/fileops"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/importer"
	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/litematic"
	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/repoaudit"
	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

// LoadResourceTypes 加载资源类型注册表（单一事实来源 = go/types.LoadRegistry）
func (a *App) LoadResourceTypes() (*types.ResourceTypeRegistry, error) {
	reg := types.LoadRegistry()
	if reg == nil || len(reg.ResourceTypes) == 0 {
		return nil, fmt.Errorf("资源类型注册表为空")
	}
	return reg, nil
}

// ReadPackMeta 读取资源包信息（pack.mcmeta + pack.png）
func (a *App) ReadPackMeta(path string) (*types.PackMetaView, error) {
	meta, thumb, err := packs.ReadPackMeta(path)
	if err != nil {
		log.Printf("[packs] ReadPackMeta 失败 %s: %v", path, err)
		return nil, err
	}
	view := &types.PackMetaView{
		PackFormat:  meta.Pack.PackFormat,
		Description: meta.Desc(),
		Thumbnail:   thumb,
	}
	if meta.Pack.SupportedFormats != nil {
		view.SupportedFormats = []int{meta.Pack.SupportedFormats.Min, meta.Pack.SupportedFormats.Max}
	}
	if meta.Pack.MinFormat != nil {
		view.MinFormat = []int{meta.Pack.MinFormat.Min, meta.Pack.MinFormat.Max}
	}
	if meta.Pack.MaxFormat != nil {
		view.MaxFormat = []int{meta.Pack.MaxFormat.Min, meta.Pack.MaxFormat.Max}
	}
	return view, nil
}

// ReadShaderpackLang 读取光影包 lang/en_US.lang 提取显示名
func (a *App) ReadShaderpackLang(path string) (types.ShaderpackLang, error) {
	name, entries := packs.ReadShaderpackLangParts(path)
	return types.ShaderpackLang{Name: name, Entries: entries}, nil
}

// ===== Litematica 蓝图/投影绑定 =====

// voxelErrorJSON 体素构建失败的错误 JSON。
// 契约（对齐 dedup FindDuplicateFiles 的 {error} 模式）：成功 → LitematicVoxelData JSON；
// 失败 → {"error": string}。前端 litematic-adapter 按 error 字段区分「解析失败」与
// 「空数据」——不再把失败吞成 "{}"（原契约下用户永远只看到"体素数据为空"，
// 无法分辨是文件格式不支持还是真的没有方块，排查需翻日志）。
func voxelErrorJSON(fnName string, err error) string {
	data, merr := json.Marshal(map[string]string{"error": fmt.Sprintf("%s: %v", fnName, err)})
	if merr != nil {
		return `{"error":"json marshal failed"}`
	}
	return string(data)
}

// buildVoxelData 调用体素构建函数并返回 typed 结果（ADR-143 P1：去 string-JSON）。
func buildVoxelData(tag, fnName, path string, buildFn func(string, int) (*types.LitematicVoxelData, error), maxBlocks int) (*types.LitematicVoxelData, error) {
	data, err := buildFn(path, maxBlocks)
	if err != nil {
		log.Printf("[%s] %s 失败 %s: %v", tag, fnName, path, err)
		return nil, err
	}
	return data, nil
}

// voxelMaxBlocks 从配置读取体素渲染上限，未设置时默认 200000。
func (a *App) voxelMaxBlocks() int {
	cfg := a.LoadAppConfig()
	if cfg.VoxelMaxBlocks > 0 {
		return cfg.VoxelMaxBlocks
	}
	return 200000
}

// GetNbtVoxelData 读取 .nbt 结构文件体素数据
func (a *App) GetNbtVoxelData(path string) (*types.LitematicVoxelData, error) {
	return buildVoxelData("nbt", "BuildNbtVoxelData", path, litematic.BuildNbtVoxelData, a.voxelMaxBlocks())
}

// GetSchematicVoxelData 读取 .schematic 文件体素数据
func (a *App) GetSchematicVoxelData(path string) (*types.LitematicVoxelData, error) {
	return buildVoxelData("schematic", "BuildSchematicVoxelData", path, litematic.BuildSchematicVoxelData, a.voxelMaxBlocks())
}

// ReadSchematic 读取 .schematic 文件基本信息
func (a *App) ReadSchematic(path string) (map[string]interface{}, error) {
	result := litematic.ParseSchematicSummary(path)
	if result == nil {
		return nil, fmt.Errorf("无法解析 schematic")
	}
	return result, nil
}

// ReadNbtStructure 读取 .nbt 结构文件基本信息
func (a *App) ReadNbtStructure(path string) (map[string]interface{}, error) {
	result := litematic.ParseNbtStructure(path)
	if result == nil {
		return nil, fmt.Errorf("无法解析 NBT 结构")
	}
	return result, nil
}

// ReadLitematicMeta 读取投影文件元数据（作者/时间/版本/方块统计/预览图）
func (a *App) ReadLitematicMeta(path string) (*types.LitematicMeta, error) {
	meta, err := litematic.ParseMeta(path)
	if err != nil {
		log.Printf("[litematic] ParseMeta 失败 %s: %v", path, err)
		return nil, err
	}
	return meta, nil
}

// GetLitematicVoxelData 读取投影文件体素数据（按颜色分组的方块位置）
func (a *App) GetLitematicVoxelData(path string) (*types.LitematicVoxelData, error) {
	return buildVoxelData("litematic", "BuildVoxelData", path, litematic.BuildVoxelData, a.voxelMaxBlocks())
}

// Deprecated: 前端已迁移统一入口（前端 0 消费），保留仅为兼容旧绑定面；待发版清理。
// SetVoxelMaxBlocks 设置 3D 体素渲染上限，0=恢复默认 200000
func (a *App) SetVoxelMaxBlocks(limit int) error {
	if limit < 0 || limit > 5_000_000 {
		limit = 0 // 恢复默认；防超大值导致体素全量产出卡顿
	}
	cfg := a.LoadAppConfig()
	cfg.VoxelMaxBlocks = limit
	return a.saveConfig(cfg)
}

// DetectResourceType 检测指定文件的资源类型
func (a *App) DetectResourceType(path string) string {
	// 单源化：registry 直接来自 go/types 内嵌的 resource_types.json
	// （internal/app 复用 types.BundledRegistryJSON 同一 embed），解析失败兜底 LoadRegistry
	registry := types.LoadRegistry()
	return packs.DetectResourceType(path, registry)
}

// GetDefaultRepoRoot 返回平台默认公共仓库根目录（不含类型子目录）。
// Android：固定公共路径（如 /storage/emulated/0/YSM-Model-Manager，授权
// MANAGE_EXTERNAL_STORAGE 后直读，查看器模式）；desktop：空串。
// 供前端 Android 分支「自动定位公共目录」使用（ADR-046 P2）。
// 会尝试 MkdirAll 创建目录；创建后目录仍不可读（未授权）则返回空串，
// 避免前端 toast 假成功（review 修复）。
func (a *App) GetDefaultRepoRoot() string {
	root := defaultRepoRoot()
	if root == "" {
		return ""
	}
	// 尝试创建（查看器模式：定位即创建）；失败不影响返回（可能已存在只读场景）
	_ = os.MkdirAll(root, fsutil.DirPerms)
	// 目录存在且可读才返回（未授权时 os.Open 失败 → 空串，前端走引导）
	if !repoDirAccessible(root) {
		return ""
	}
	return root
}

// GetRepoRoot 根据资源类型返回对应的仓库根目录
func (a *App) GetRepoRoot(rtype string) (string, error) {
	cfg := a.LoadAppConfig()
	// 1. 类型专属覆写
	if root := specificRoot(cfg, rtype); root != "" {
		return root, nil
	}
	subDir := types.GroupStorageRoot(rtype) // ADR-092 两层路由：FilesRoot/{group}/{storageSubDir}
	// 2. FilesRoot + 分组存储子目录
	if cfg.FilesRoot != "" {
		if subDir != "" {
			return filepath.Join(cfg.FilesRoot, subDir), nil
		}
		// 空 rtype 时返回 FilesRoot 根目录，供跨类型搜索使用
		if rtype == "" {
			return cfg.FilesRoot, nil
		}
	}
	// 3. 平台默认公共仓库根（Android：固定路径，授权 MANAGE_EXTERNAL_STORAGE 后直读，
	//    查看器模式；desktop：空串不介入，用户需在设置页配置）。
	//    ⚠️ 仅在目录真实存在且可读时回退——未授权/目录不存在时返回空串，
	//    保留「未配置」信号，让调用方走「请先配置仓库目录」引导而非裸文件错误。
	if root := defaultRepoRoot(); root != "" && repoDirAccessible(root) {
		if subDir != "" {
			return filepath.Join(root, subDir), nil
		}
		return root, nil
	}
	return "", nil
}

// GetAllRepoRoots 遍历所有注册资源类型，返回 rtype → root 映射（供跨类型搜索）。
// 仅返回目录真实存在且可访问的类型；空 root/不存在的目录跳过。
func (a *App) GetAllRepoRoots() map[string]string {
	registry := types.LoadRegistry()
	result := make(map[string]string, len(registry.ResourceTypes))
	for _, rt := range registry.ResourceTypes {
		root, _ := a.GetRepoRoot(rt.ID)
		if root != "" {
			result[rt.ID] = root
		}
	}
	return result
}

// filesRootForSync 返回资源类型的整合包同步基准目录（FilesRoot/{group}/{storageSubDir}）。
// 壳-叶架构已移除：所有类型统一走 GetRepoRoot（语义即 FilesRoot 派生路径）。
func (a *App) filesRootForSync(rtype string) (string, error) {
	return a.GetRepoRoot(rtype)
}

// EnsureStorageDirs 预创建所有注册资源类型的存储子目录
// （FilesRoot/{group}/{storageSubDir}，或各类型专属覆写路径）。
// 修复惰性创建的体感问题：用户指定仓库根路径后期望整棵类型树立即出现在磁盘，
// 而非等到首次导入某类型才逐个 MkdirAll。
// 仅当 GetRepoRoot 返回非空路径才建——空串（未配置/平台默认不可达）跳过，
// 避免在工作目录裸建；已存在目录为 MkdirAll no-op，幂等安全。
func (a *App) EnsureStorageDirs() error {
	registry := types.LoadRegistry()
	if len(registry.ResourceTypes) == 0 {
		return nil
	}
	var firstErr error
	for _, rt := range registry.ResourceTypes {
		root, err := a.GetRepoRoot(rt.ID)
		// 诊断打点：打印每个类型的路由推导，定位"目录扁平散开"问题
		log.Printf("[storage] EnsureStorageDirs: id=%s group=%q sub=%q groupRoot=%q -> filesRoot=%q err=%v",
			rt.ID, rt.Group, rt.StorageSubDir, types.GroupStorageRoot(rt.ID), root, err)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			log.Printf("[storage] GetRepoRoot(%s) 失败，跳过预创建: %v", rt.ID, err)
			continue
		}
		if root == "" {
			// 未配置 / 平台默认不可达：跳过，避免裸建
			continue
		}
		if err := os.MkdirAll(root, fsutil.DirPerms); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			log.Printf("[storage] 预创建目录失败 %s: %v", root, err)
		}
	}
	return firstErr
}

// repoDirAccessible 校验目录真实存在且可读（防未授权/未创建时静默假成功）。
// 与 writableDir 不同：仓库目录只读即可（查看器模式），不做可写性探针。
func repoDirAccessible(dir string) bool {
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return false
	}
	f, err := os.Open(dir)
	if err != nil {
		return false
	}
	_ = f.Close()
	return true
}

// specificRoot 返回资源类型的专属覆写路径。
// ADR-095：从 cfg.CustomRoots map 读取（迁移后唯一事实源）。
// 先查 rtype 自身 key，再查 rt.ConfigFallback（如 vrc → EntityPlayer），都无则返回空串。
func specificRoot(cfg types.AppConfig, rtype string) string {
	if cfg.CustomRoots != nil {
		if root := cfg.CustomRoots[rtype]; root != "" {
			return root
		}
		rt := types.RegistryType(rtype)
		if rt != nil && rt.ConfigFallback != "" {
			if root := cfg.CustomRoots[rt.ConfigFallback]; root != "" {
				return root
			}
		}
	}

	return ""
}

// Deprecated: 前端已迁移统一入口（前端 0 消费），保留仅为兼容旧绑定面；待发版清理。
// ToggleResourcePack 切换资源包的启用/禁用状态（.zip ↔ .zip.disabled）
// 补路径守卫——原实现 os.Rename 对任意路径可重命名（对齐 ToggleModelEnable 经 fileops
// 的 ysmRoot 防护；rename 目标派生自输入路径，越权路径会连带生成越权目标）。
// 额外拒绝 path == 仓库根——IsInside 对「路径等于基准」按设计返回 nil，
// 传入仓库根时 os.Rename(root, root+".disabled") 会把整个仓库移出配置位置（镜像 DeleteModelDir
// 的 rel=="." 拒绝同类输入）
func (a *App) ToggleResourcePack(path string) bool {
	// 根集合与 ToggleEnable 同口径（复用 toggleAllowedRoots：FilesRoot + McRoot +
	// CustomRoots 值）；path==root 显式拒绝（os.Rename 无 fileops 根守卫兜底）
	allowed := false
	for _, root := range a.toggleAllowedRoots() {
		if root == "" {
			continue
		}
		if filepath.Clean(path) == filepath.Clean(root) {
			return false
		}
		if paths.IsInsideResolved(root, path) == nil {
			allowed = true
		}
	}
	if !allowed {
		return false
	}
	disabled := types.IsDisableSuffix(path)
	var src, dst string
	if disabled {
		src = path
		dst = types.StripDisableSuffix(path)
	} else {
		src = path
		dst = path + types.DisableSuffixes[0]
	}
	if _, err := os.Stat(dst); err == nil {
		return false
	}
	if err := os.Rename(src, dst); err != nil {
		return false
	}
	scanner.InvalidatePath(filepath.Dir(path))
	return true
}

// Deprecated: 前端已迁移统一入口（前端 0 消费），保留仅为兼容旧绑定面；待发版清理。
// IsResourcePackEnabled 检查资源包是否启用
func (a *App) IsResourcePackEnabled(path string) bool {
	return !types.IsDisableSuffix(path)
}

// Deprecated: 前端已迁移统一入口（前端 0 消费），保留仅为兼容旧绑定面；待发版清理。
// SelectImportZip 打开文件选择器选取 .zip 文件
func (a *App) SelectImportZip() string {
	path, err := a.app.Dialog.OpenFile().
		SetTitle("选择资源包文件").
		AddFilter("ZIP 资源包", "*.zip").
		PromptForSingleSelection()
	if err != nil {
		return ""
	}
	return path
}

// SelectImportFile 打开文件选择器，按给定扩展名过滤
// filter 格式: "显示名|*.ext1;*.ext2"
func (a *App) SelectImportFile(filter, title string) string {
	dialog := a.app.Dialog.OpenFile()
	if title == "" {
		title = "选择文件"
	}
	dialog = dialog.SetTitle(title)
	if filter != "" {
		parts := strings.SplitN(filter, "|", 2)
		if len(parts) == 2 {
			dialog = dialog.AddFilter(parts[0], parts[1])
		}
	}
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return ""
	}
	return path
}

// SetResourceRoot 设置指定资源类型的自定义根路径（空=恢复默认）
// ADR-095：写入 cfg.CustomRoots[rtype]；删除则清空该 key。
// 不再反射结构体字段，新增资源类型只改 resource_types.json 即可生效。
func (a *App) SetResourceRoot(rtype, path string) error {
	cfg := a.LoadAppConfig()
	if types.RegistryType(rtype) == nil {
		return fmt.Errorf("未知的资源类型: %s", rtype)
	}
	if path != "" {
		abs, err := filepath.Abs(filepath.Clean(path))
		if err != nil {
			return fmt.Errorf("路径异常: %w", err)
		}
		path = abs
	}
	if cfg.CustomRoots == nil {
		cfg.CustomRoots = make(map[string]string)
	}
	cfg.CustomRoots[rtype] = path
	return a.saveConfig(cfg)
}

// ResetResourceRoot 恢复指定资源类型的路径为默认（清空自定义值）
func (a *App) ResetResourceRoot(rtype string) error {
	return a.SetResourceRoot(rtype, "")
}

// saveConfig 写入配置到文件
func (a *App) saveConfig(cfg types.AppConfig) error {
	// roots（FilesRoot/CustomRoots 等）可能变更：失效 isPathInRootOrSelf 的
	// root 解析缓存，防止扫描守卫用过期的根真实路径做 symlink 复核
	clearResolvedRootCache()
	if configDir() == "" {
		// 平台数据根缺失（Android 沙盒不可用等）：fail-fast 报明确错误，
		// 绝不退化为相对路径（CWD=/ 只读 → 无意义的 read-only 报错）
		return errors.New("配置目录不可用：平台数据根缺失（Android 沙盒不可用）")
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	dest := configPath()
	if err := os.MkdirAll(filepath.Dir(dest), fsutil.DirPerms); err != nil {
		return err
	}
	// ADR-044 策略 A：原子写（CreateTemp + rename）——
	// 原 os.WriteFile 直写在磁盘满/IO 中断/崩溃时留半截 JSON，
	// 下次 loadAppConfig 解析失败 → 用户配置静默"丢失"（与 tags 已统一走 WriteFileAtomic）
	if err := fsutil.WriteFileAtomic(dest, data); err != nil {
		return err
	}
	// update in-memory cache
	a.configMu.Lock()
	a.configCache = cfg
	a.configLoaded = true
	a.configMu.Unlock()
	return nil
}

// Deprecated: 前端已迁移统一入口（前端 0 消费），保留仅为兼容旧绑定面；待发版清理。
// ImportResourcePack 使用策略模式导入资源包
func (a *App) ImportResourcePack(srcPath, rtype string) string {
	dstDir, _ := a.GetRepoRoot(rtype)
	if dstDir == "" {
		return "未设置" + rtype + "目录"
	}
	h := importer.Get(rtype)
	if h == nil {
		return fmt.Sprintf("未知的资源类型: %s", rtype)
	}
	return h.Import(srcPath, dstDir)
}

// ImportByType 统一导入入口——根据资源类型自动选择导入策略
func (a *App) ImportByType(rtype, srcPath string) string {
	h := importer.Get(rtype)
	if h == nil {
		return fmt.Sprintf("未找到资源类型 %s 的导入策略", rtype)
	}
	dstDir, _ := a.GetRepoRoot(rtype)
	if dstDir == "" {
		return "未设置" + rtype + "目录"
	}
	return h.Import(srcPath, dstDir)
}

// DeleteResourcePack 删除资源（目录感知，ADR-038 D3.6）：
// 统一入口——根据 rtype.isDir 决定语义：
//
//	isDir=true:  删除文件所在父文件夹（MMD/EntityPlayer 等目录型资源）
//	isDir=false: src 为 ysm.json 时整组删除父目录，否则删除单文件（ysm 等）
//
// 守卫根传类型特定仓库根：防根级 ysm.json 清空整个仓库；
// 路径守卫拒绝 rel=="." 或 rel 含 ".." 前缀的越权路径。
func (a *App) DeleteResourcePack(path, rtype string) error {
	rt := types.RegistryType(rtype)
	if rt != nil && rt.IsDir {
		// 目录型资源：删除父文件夹（合并原 DeleteModelDir 语义）
		root := a.ysmRoot()
		clean := filepath.Clean(filepath.Dir(path))
		// 符号链接解析后校验——防精心构造的链接绕过路径守卫删除仓库外目录
		realClean, errC := filepath.EvalSymlinks(clean)
		if errC != nil {
			// 目标不存在时回退原始路径（允许删除悬空链接）
			realClean = clean
		}
		realRoot, errR := filepath.EvalSymlinks(root)
		if errR != nil {
			realRoot = root
		}
		rel, err := filepath.Rel(realRoot, realClean)
		if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
			return fmt.Errorf("路径超出仓库目录")
		}
		if err := os.RemoveAll(realClean); err != nil {
			return err
		}
	} else {
		// 文件型资源：按 rtype 获取对应仓库根（非 ysm 类型可能在其他根下）
		filesRoot, _ := a.GetRepoRoot(rtype)
		if filesRoot == "" {
			filesRoot = a.ysmRoot()
		}
		if err := fileops.DeleteModelFile(filesRoot, path); err != nil {
			return err
		}
	}
	scanner.InvalidateCache()
	return nil
}

// findDuplicateErrorJSON 返回结构化错误 JSON（绑定契约：DedupGroup[] | {error}）。
// 前端社区诊断按 JSON.parse 后 {error} 字段区分扫描失败与无重复（避免假绿）；
// 使用 json.Marshal 生成，而非 strconv.Quote 拼接（避免手工拼接 JSON 的转义遗漏）。
// 委托 DedupErrorJSON，与 go/types 解析入口保持单一事实源（杜绝双实现漂移）。
func findDuplicateErrorJSON(msg string) string {
	return DedupErrorJSON(msg)
}

// marshalJSON 序列化为紧凑 JSON，失败时返回 fallback（非空串）+ 记录日志。
// 统一替代 data, _ := json.Marshal 模式，避免前端 JSON.parse("") 抛异常而无法定位问题（规律六）。
func marshalJSON(tag string, v interface{}, fallback string) string {
	data, err := json.Marshal(v)
	if err != nil {
		log.Printf("[%s] JSON 序列化失败: %v", tag, err)
		return fallback
	}
	return string(data)
}

// marshalJSONIndent 序列化为缩进 JSON，失败时返回 fallback + 记录日志。
func marshalJSONIndent(tag string, v interface{}, fallback string) string {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		log.Printf("[%s] JSON 序列化失败: %v", tag, err)
		return fallback
	}
	return string(data)
}

// FindDuplicateFiles 扫描目录返回所有重复文件分组。
// 失败 → error（非 {error} 字符串），调用方 catch 即可区分失败与无重复。
func (a *App) FindDuplicateFiles(dir string, configStr ...string) ([]dedup.Group, error) {
	if !a.isPathInRootOrSelf(dir) {
		return nil, fmt.Errorf("路径超出仓库目录")
	}

	// 解析配置（统一入口 go/types.ParseDedupConfig）
	var dedupConfig *types.DedupConfig
	if len(configStr) > 0 {
		cfg, err := types.ParseDedupConfig(configStr[0])
		if err != nil {
			log.Printf("[dedup] 配置解析失败: %v", err)
			return nil, fmt.Errorf("配置解析失败: %w", err)
		}
		dedupConfig = cfg
	}

	groups, err := dedup.FindDuplicateFiles(dir, true, dedupConfig)
	if err != nil {
		log.Printf("[dedup] FindDuplicateFiles 扫描失败: %v", err)
		return nil, err
	}
	return groups, nil
}

// Deprecated: 前端已迁移统一入口（前端 0 消费），保留仅为兼容旧绑定面；待发版清理。
// CountDuplicateFiles 快速统计重复文件数量。
// 契约（见 docs/wails-bindings.md）：成功 → {groups, extra}；失败 → {error: string}。
func (a *App) CountDuplicateFiles(dir string) string {
	if !a.isPathInRootOrSelf(dir) {
		return findDuplicateErrorJSON("路径超出仓库目录")
	}
	groups, extra, err := dedup.CountDuplicates(dir, true)
	if err != nil {
		log.Printf("[dedup] CountDuplicateFiles 扫描失败: %v", err)
		return findDuplicateErrorJSON(err.Error())
	}
	return marshalJSON("CountDuplicateFiles", map[string]int{"groups": groups, "extra": extra}, findDuplicateErrorJSON("JSON 序列化失败"))
}

// InvalidateScanCache 清空扫描缓存，下次扫描获取最新数据（委托 ClearScanCache）
func (a *App) InvalidateScanCache() {
	a.ClearScanCache()
}

// RepoHealthAudit 一键全仓体检（审计 + 去重），返回 typed HealthReport。
// 与 CLI health-report 同源（go/repoaudit 唯一实现），GUI/CLI 双端消双轨。
func (a *App) RepoHealthAudit(dir string) (*repoaudit.HealthReport, error) {
	if dir == "" {
		return nil, fmt.Errorf("请先配置仓库目录")
	}
	if !a.isPathInRootOrSelf(dir) {
		return nil, fmt.Errorf("路径超出仓库目录")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, fmt.Errorf("无法解析路径: %w", err)
	}
	report, err := repoaudit.HealthReportFor(abs)
	if err != nil {
		log.Printf("[repoaudit] 体检失败 %s: %v", abs, err)
		return nil, err
	}
	return &report, nil
}

// RepoHealthAuditAll 全仓库体检：遍历所有已配置资源类型根目录，合并审计结果。
// 无有效目录时返回错误。
func (a *App) RepoHealthAuditAll() (*repoaudit.HealthReport, error) {
	roots := a.GetAllRepoRoots()
	if len(roots) == 0 {
		return nil, fmt.Errorf("请先配置仓库目录")
	}
	type auditResult struct {
		rtype  string
		report repoaudit.HealthReport
		err    error
	}
	results := make([]auditResult, 0, len(roots))
	for rtype, root := range roots {
		rpt, err := repoaudit.HealthReportFor(root)
		results = append(results, auditResult{rtype: rtype, report: rpt, err: err})
	}
	// 合并：资源汇总 + 分数加权 + 警告汇集
	merged := repoaudit.HealthReport{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Directory: "（全仓库）",
		Resources: repoaudit.ResourceSummary{ByType: make(map[string]int)},
	}
	scoreSum := 0
	scoreCount := 0
	for _, r := range results {
		if r.err != nil {
			merged.Warnings = append(merged.Warnings, fmt.Sprintf("[%s] %v", r.rtype, r.err))
			continue
		}
		merged.Resources.TotalFiles += r.report.Resources.TotalFiles
		merged.Resources.TotalSize += r.report.Resources.TotalSize
		for k, v := range r.report.Resources.ByType {
			merged.Resources.ByType[k] += v
		}
		if r.report.Resources.LargestSize > merged.Resources.LargestSize {
			merged.Resources.LargestFile = r.report.Resources.LargestFile
			merged.Resources.LargestSize = r.report.Resources.LargestSize
		}
		merged.Completeness.Checked += r.report.Completeness.Checked
		merged.Completeness.Valid += r.report.Completeness.Valid
		merged.Completeness.Invalid += r.report.Completeness.Invalid
		merged.Dedup.Groups += r.report.Dedup.Groups
		merged.Dedup.ExtraFiles += r.report.Dedup.ExtraFiles
		merged.Dedup.Reclaim += r.report.Dedup.Reclaim
		merged.Warnings = append(merged.Warnings, r.report.Warnings...)
		scoreSum += r.report.Score * r.report.Resources.TotalFiles
		scoreCount += r.report.Resources.TotalFiles
	}
	// 缓存全局唯一（texture_cache），只取一次——取第一个有效结果
	for _, r := range results {
		if r.err == nil {
			merged.Cache = r.report.Cache
			break
		}
	}
	if scoreCount > 0 {
		merged.Score = scoreSum / scoreCount
	}
	if merged.Completeness.Checked > 0 {
		merged.Completeness.Percentage = float64(merged.Completeness.Valid) / float64(merged.Completeness.Checked) * 100
	}
	return &merged, nil
}

// InstallResourceToInstance 将资源文件安装到指定整合包
// rtype: 资源类型（resourcepack/shaderpack 等），srcPath: 源文件路径，instanceName: 整合包名称
func (a *App) InstallResourceToInstance(rtype, srcPath, instanceName string) error {
	cfg := a.LoadAppConfig()
	if err := requireMcRoot(cfg); err != nil {
		return err
	}

	// 查找目标整合包
	instances := a.ListVersionInstances(cfg.McRoot)
	var target *types.VersionInstance
	for i := range instances {
		if instances[i].Name == instanceName {
			target = &instances[i]
			break
		}
	}
	if target == nil {
		return fmt.Errorf("未找到整合包: %s", instanceName)
	}

	// 根据 rtype 确定安装子目录（集中定义在 go/types/extensions.go）
	subDir := types.SubDirMap(rtype)
	if subDir == "" {
		return fmt.Errorf("未知的资源类型: %s", rtype)
	}

	// 目标路径 = 整合包版本目录 + 子目录（ADR-064 锚定：统一走 FindInstDir，
	// 标准目录无该类型文件时兜底扫描——Sable-Schematics 等非标准目录，原直拼
	// schematics 与展示层/拉取层口径不一致）
	dstDir := types.FindInstDir(target.VersionDir, subDir, rtype)

	// 统一走 installer.Install，复用链接模式支持
	globalRoot, _ := a.GetRepoRoot(rtype)

	// 如果源文件父目录 != 全局根目录，说明在子目录中 → 推送整个文件夹
	srcParent := filepath.Dir(srcPath)

	if globalRoot == "" {
		return installer.Install(srcPath, dstDir, globalRoot, a.getLinkMode())
	}

	cleanParent := filepath.Clean(srcParent)
	cleanRoot := filepath.Clean(globalRoot)

	hasPrefix := strings.HasPrefix(strings.ToLower(srcParent), strings.ToLower(globalRoot))

	// YSM(.json) 和 MMD(.pmx/.pmd) 模型可能有子文件夹（含动作/纹理等配套文件）
	// VRM(.vrm) 是自包含格式，单文件即可
	// 目录型行为由注册表 isDir 驱动（EntityPlayer/vrchat-avatar isDir:true）；
	// ysm 注册表 isDir:false，但现状 ysm 需要文件夹级推送（含配套文件），
	// 故显式保留 rtype == "ysm" 维持既有行为不变。
	rt := types.RegistryType(rtype)
	needsFolder := rt != nil && (rt.IsDir || rtype == "ysm")

	if cleanParent != cleanRoot && hasPrefix && needsFolder {
		if err := installer.InstallDir(srcParent, dstDir, globalRoot, a.getLinkMode(), rtype); err != nil {
			// 文件夹级安装失败直接报错：静默降级为单文件会丢配套文件且用户无感知
			return fmt.Errorf("安装目录失败: %w", err)
		}
		return nil
	}

	return installer.Install(srcPath, dstDir, globalRoot, a.getLinkMode())
}
