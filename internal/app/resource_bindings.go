package app

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"ysm-model-manager/go/dedup"
	"ysm-model-manager/go/fileops"
	"ysm-model-manager/go/importer"
	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/litematic"
	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/types"
)

// LoadResourceTypes 加载资源类型注册表
func (a *App) LoadResourceTypes() string {
	data, err := loadBundledData("resource_types.json")
	if err != nil {
		return "{}"
	}
	return string(data)
}

// ReadPackMeta 读取资源包信息（pack.mcmeta + pack.png）
func (a *App) ReadPackMeta(path string) string {
	meta, thumb, err := packs.ReadPackMeta(path)
	if err != nil {
		log.Printf("[packs] ReadPackMeta 失败 %s: %v", path, err)
		return "{}"
	}
	result := map[string]interface{}{
		"pack_format": meta.Pack.PackFormat,
		"description": meta.Desc(),
		"thumbnail":   thumb,
	}
	if meta.Pack.SupportedFormats != nil {
		result["supported_formats"] = []int{meta.Pack.SupportedFormats.Min, meta.Pack.SupportedFormats.Max}
	}
	if meta.Pack.MinFormat != nil {
		result["min_format"] = []int{meta.Pack.MinFormat.Min, meta.Pack.MinFormat.Max}
	}
	if meta.Pack.MaxFormat != nil {
		result["max_format"] = []int{meta.Pack.MaxFormat.Min, meta.Pack.MaxFormat.Max}
	}
	data, _ := json.Marshal(result)
	return string(data)
}

// ReadShaderpackLang 读取光影包 lang/en_US.lang 提取显示名
func (a *App) ReadShaderpackLang(path string) string {
	return packs.ReadShaderpackLang(path)
}

// ===== Litematica 蓝图/投影绑定 =====

// marshalVoxelData 调用体素构建函数并序列化为 JSON。
func marshalVoxelData(tag, fnName, path string, buildFn func(string, int) (*types.LitematicVoxelData, error), maxBlocks int) string {
	data, err := buildFn(path, maxBlocks)
	if err != nil {
		log.Printf("[%s] %s 失败 %s: %v", tag, fnName, path, err)
		return "{}"
	}
	result, _ := json.Marshal(data)
	return string(result)
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
func (a *App) GetNbtVoxelData(path string) string {
	return marshalVoxelData("nbt", "BuildNbtVoxelData", path, litematic.BuildNbtVoxelData, a.voxelMaxBlocks())
}

// GetSchematicVoxelData 读取 .schematic 文件体素数据
func (a *App) GetSchematicVoxelData(path string) string {
	return marshalVoxelData("schematic", "BuildSchematicVoxelData", path, litematic.BuildSchematicVoxelData, a.voxelMaxBlocks())
}

// ReadSchematic 读取 .schematic 文件基本信息
func (a *App) ReadSchematic(path string) string {
	result := litematic.ParseSchematicSummary(path)
	if result == nil {
		return "{}"
	}
	data, _ := json.Marshal(result)
	return string(data)
}

// ReadNbtStructure 读取 .nbt 结构文件基本信息
func (a *App) ReadNbtStructure(path string) string {
	result := litematic.ParseNbtStructure(path)
	if result == nil {
		return "{}"
	}
	data, _ := json.Marshal(result)
	return string(data)
}

// ReadLitematicMeta 读取投影文件元数据（作者/时间/版本/方块统计/预览图）
func (a *App) ReadLitematicMeta(path string) string {
	meta, err := litematic.ParseMeta(path)
	if err != nil {
		log.Printf("[litematic] ParseMeta 失败 %s: %v", path, err)
		return "{}"
	}
	data, _ := json.Marshal(meta)
	return string(data)
}

// GetLitematicVoxelData 读取投影文件体素数据（按颜色分组的方块位置）
func (a *App) GetLitematicVoxelData(path string) string {
	return marshalVoxelData("litematic", "BuildVoxelData", path, litematic.BuildVoxelData, a.voxelMaxBlocks())
}

// SetVoxelMaxBlocks 设置 3D 体素渲染上限，0=恢复默认 200000
func (a *App) SetVoxelMaxBlocks(limit int) error {
	cfg := a.LoadAppConfig()
	cfg.VoxelMaxBlocks = limit
	return a.saveConfig(cfg)
}

// DetectResourceType 检测指定文件的资源类型
func (a *App) DetectResourceType(path string) string {
	var registry types.ResourceTypeRegistry
	if data, err := loadBundledData("resource_types.json"); err == nil {
		json.Unmarshal(data, &registry)
	}
	return packs.DetectResourceType(path, &registry)
}

// GetDefaultRepoRoot 返回平台默认公共仓库根目录（不含类型子目录）。
// Android：固定公共路径（如 /storage/emulated/0/YSM-Model-Manager，授权
// MANAGE_EXTERNAL_STORAGE 后直读，查看器模式）；desktop：空串。
// 供前端 Android 分支「自动定位公共目录」使用（ADR-046 P2）。
func (a *App) GetDefaultRepoRoot() string {
	return defaultRepoRoot()
}

// GetRepoRoot 根据资源类型返回对应的仓库根目录
func (a *App) GetRepoRoot(rtype string) (string, error) {
	cfg := a.LoadAppConfig()
	// 1. 类型专属覆写
	if root := specificRoot(cfg, rtype); root != "" {
		return root, nil
	}
	subDir := types.StorageSubDir(rtype)
	// 2. FilesRoot + 存储子目录
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
	//    查看器模式；desktop：空串不介入，用户需在设置页配置）
	if root := defaultRepoRoot(); root != "" {
		if subDir != "" {
			return filepath.Join(root, subDir), nil
		}
		return root, nil
	}
	return "", nil
}

// specificRoot 返回资源类型的专属覆写路径，从 resource_types.json 注册表驱动
func specificRoot(cfg types.AppConfig, rtype string) string {
	rt := types.RegistryType(rtype)
	if rt == nil || rt.ConfigField == "" {
		return ""
	}
	v := reflect.ValueOf(cfg)
	if f := v.FieldByName(rt.ConfigField); f.IsValid() && f.String() != "" {
		return f.String()
	}
	if rt.ConfigFallback != "" {
		if f := v.FieldByName(rt.ConfigFallback); f.IsValid() {
			return f.String()
		}
	}
	return ""
}

// ToggleResourcePack 切换资源包的启用/禁用状态（.zip ↔ .zip.disabled）
// P2 修复：补路径守卫——原实现 os.Rename 对任意路径可重命名（对齐 ToggleModelEnable 经 fileops
// 的 ysmRoot 防护；rename 目标派生自输入路径，越权路径会连带生成越权目标）。
// P2 修复（code_review）：额外拒绝 path == 仓库根——IsInside 对「路径等于基准」按设计返回 nil，
// 传入仓库根时 os.Rename(root, root+".disabled") 会把整个仓库移出配置位置（镜像 DeleteModelDir
// 的 rel=="." 拒绝同类输入）
func (a *App) ToggleResourcePack(path string) bool {
	if filepath.Clean(path) == filepath.Clean(a.ysmRoot()) {
		return false
	}
	if err := paths.IsInside(a.ysmRoot(), path); err != nil {
		return false
	}
	disabled := strings.HasSuffix(path, ".disabled")
	var src, dst string
	if disabled {
		src = path
		dst = strings.TrimSuffix(path, ".disabled")
	} else {
		src = path
		dst = path + ".disabled"
	}
	if err := os.Rename(src, dst); err != nil {
		return false
	}
	return true
}

// IsResourcePackEnabled 检查资源包是否启用
func (a *App) IsResourcePackEnabled(path string) bool {
	return !strings.HasSuffix(path, ".disabled")
}

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
// P1 修复：非空入参经 filepath.Abs(filepath.Clean()) 规范化，防止含 .. 或未规范化路径
func (a *App) SetResourceRoot(rtype, path string) error {
	cfg := a.LoadAppConfig()
	if path != "" {
		abs, err := filepath.Abs(filepath.Clean(path))
		if err != nil {
			return fmt.Errorf("路径异常: %v", err)
		}
		path = abs
	}
	switch rtype {
	case "ysm":
		cfg.YsmRoot = path
	case "shaderpack":
		cfg.ShaderpackRoot = path
	case "create-blueprint":
		cfg.SchematicRoot = path
	case "litematic":
		cfg.LitematicRoot = path
	case "mmd-skin":
		cfg.MmdRoot = path
	case "vrchat-avatar":
		cfg.VrcRoot = path
	case "resourcepack":
		cfg.ResourcepackRoot = path
	default:
		return fmt.Errorf("不支持单独设置此类型的路径: %s", rtype)
	}
	return a.saveConfig(cfg)
}

// ResetResourceRoot 恢复指定资源类型的路径为默认（清空自定义值）
func (a *App) ResetResourceRoot(rtype string) error {
	return a.SetResourceRoot(rtype, "")
}

// saveConfig 写入配置到文件
func (a *App) saveConfig(cfg types.AppConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	dest := configPath()
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return err
	}
	if err := os.WriteFile(dest, data, 0644); err != nil {
		return err
	}
	// update in-memory cache
	a.configMu.Lock()
	a.configCache = cfg
	a.configLoaded = true
	a.configMu.Unlock()
	return nil
}

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
// src 为 ysm.json 时整组删除父目录（文件夹型模型），否则删除单文件。
// 统一委托 fileops.DeleteModelFile，消除与 DeleteModelDir 的双轨语义。
// 守卫根传类型特定仓库根（ysm 用 a.ysmRoot()）：防根级 ysm.json 清空整个 ysm 仓库；
// 守卫拒绝时 fileops 内部回退单文件删除。
func (a *App) DeleteResourcePack(path string) error {
	return fileops.DeleteModelFile(a.ysmRoot(), path)
}

// DeleteModelDir 删除文件夹型资源（MMD 模型等），删除文件所在父文件夹
// 路径守卫：限制在 FilesRoot 内，防止删除系统目录
func (a *App) DeleteModelDir(path string) error {
	root := a.ysmRoot()
	clean := filepath.Clean(filepath.Dir(path))
	rel, err := filepath.Rel(root, clean)
	// P1 修复：`rel == "."`（clean 即根目录本身）同样拒绝——原 `strings.HasPrefix(rel, "..")`
	// 对 `"."` 不成立 → 传入仓库根路径时可 `os.RemoveAll` 整删整个 ysm 仓库
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return fmt.Errorf("路径超出仓库目录")
	}
	return os.RemoveAll(clean)
}

// FindDuplicateFiles 扫描目录返回所有重复文件分组（JSON 字符串）
func (a *App) FindDuplicateFiles(dir string) string {
	groups, err := dedup.FindDuplicateFiles(dir, true)
	if err != nil {
		return "[]"
	}
	data, _ := json.Marshal(groups)
	return string(data)
}

// CountDuplicateFiles 快速统计重复文件数量
func (a *App) CountDuplicateFiles(dir string) string {
	groups, extra, err := dedup.CountDuplicates(dir, true)
	if err != nil {
		return `{"groups":0,"extra":0}`
	}
	data, _ := json.Marshal(map[string]int{"groups": groups, "extra": extra})
	return string(data)
}

// InvalidateScanCache 清空扫描缓存，下次扫描获取最新数据（委托 ClearScanCache）
func (a *App) InvalidateScanCache() {
	a.ClearScanCache()
}

// InstallResourceToInstance 将资源文件安装到指定整合包
// rtype: 资源类型（resourcepack/shaderpack 等），srcPath: 源文件路径，instanceName: 整合包名称
func (a *App) InstallResourceToInstance(rtype, srcPath, instanceName string) error {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return fmt.Errorf("请先设置游戏根目录")
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

	// 目标路径 = 整合包版本目录 + 子目录
	dstDir := filepath.Join(target.VersionDir, subDir)

	// 统一走 installer.Install，复用链接模式支持
	globalRoot, _ := a.GetRepoRoot(rtype)

	// 如果源文件父目录 != 全局根目录，说明在子目录中 → 推送整个文件夹
	srcParent := filepath.Dir(srcPath)

	if globalRoot == "" {
		return installer.Install(srcPath, dstDir, globalRoot, a.LinkMode)
	}

	cleanParent := filepath.Clean(srcParent)
	cleanRoot := filepath.Clean(globalRoot)

	hasPrefix := strings.HasPrefix(strings.ToLower(srcParent), strings.ToLower(globalRoot))

	// YSM(.json) 和 MMD(.pmx/.pmd) 模型可能有子文件夹（含动作/纹理等配套文件）
	// VRM(.vrm) 是自包含格式，单文件即可
	needsFolder := rtype == "mmd-skin" || rtype == "ysm"

	if cleanParent != cleanRoot && hasPrefix && needsFolder {
		if err := installer.InstallDir(srcParent, dstDir, globalRoot, a.LinkMode, rtype); err != nil {
			// 文件夹级安装失败直接报错：静默降级为单文件会丢配套文件且用户无感知
			return fmt.Errorf("安装目录失败: %w", err)
		}
		return nil
	}

	return installer.Install(srcPath, dstDir, globalRoot, a.LinkMode)
}
