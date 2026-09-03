// ========== 实例管理（拆分自 app_install.go）==========
// 从 app_install.go 拆分：实例相关函数
package app

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/instance"
	"ysm-model-manager/go/recycle"
	"ysm-model-manager/go/scanner"
	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"
)

// CountInstanceResources 统计指定整合包中可清空的资源文件数
// 只统计仓库中已有的文件（同 clearInstanceDir 逻辑）
// rtype 为空时统计全部类型，否则只统计指定类型
func (a *App) CountInstanceResources(insName, rtype string) (int, error) {
	insName = strings.TrimSpace(insName)
	if insName == "" {
		return 0, fmt.Errorf("整合包名为空")
	}
	cfg := a.LoadAppConfig()
	mcRoot := cfg.McRoot
	if err := requireMcRoot(cfg); err != nil {
		return 0, err
	}
	instances := a.ListVersionInstances(mcRoot)
	var target *types.VersionInstance
	for i, ins := range instances {
		if ins.Name == insName {
			target = &instances[i]
			break
		}
	}
	if target == nil {
		return 0, fmt.Errorf("未找到整合包: %s", insName)
	}
	total := 0
	for _, d := range types.AllSubDirs() {
		if rtype != "" && d.RType != rtype {
			continue
		}
		dir := types.FindInstDir(target.VersionDir, d.SubDir, d.RType)
		filesRoot, _ := a.GetRepoRoot(d.RType)
		if filesRoot == "" {
			continue
		}
		total += a.countMatchingInDir(dir, filesRoot)
	}
	return total, nil
}

// ClearInstanceResources 清空指定整合包中已同步的文件
// insName: 整合包名, rtype: 资源类型（空=全部, 非空=只清此类型）
// 返回清除的文件数量。整合包文件是仓库的副本/链接，删除后可从仓库重新推送恢复；
// 实例文件在仓库根内才移回收站，其余直接删除（见 clearInstanceDir）
func (a *App) ClearInstanceResources(insName, rtype string) (int, error) {
	// 删除/回收整合包子目录文件 = 对实例目录做 Rename/Remove，与安装、同步
	// （SyncToggleStatus 阶段 2）并发操作同一批文件 → 统一纳入 InstallLock 互斥（共享单锁闭环）
	installer.InstallLock.Lock()
	defer installer.InstallLock.Unlock()
	insName = strings.TrimSpace(insName)
	if insName == "" {
		return 0, fmt.Errorf("整合包名为空")
	}
	cfg := a.LoadAppConfig()
	mcRoot := cfg.McRoot
	if err := requireMcRoot(cfg); err != nil {
		return 0, err
	}
	instances := a.ListVersionInstances(mcRoot)
	var target *types.VersionInstance
	for i, ins := range instances {
		if ins.Name == insName {
			target = &instances[i]
			break
		}
	}
	if target == nil {
		return 0, fmt.Errorf("未找到整合包: %s", insName)
	}

	// 先统计数量
	scanned := 0
	for _, d := range types.AllSubDirs() {
		if rtype != "" && d.RType != rtype {
			continue
		}
		dir := types.FindInstDir(target.VersionDir, d.SubDir, d.RType)
		scanned += a.countInstanceDir(dir)
	}
	if scanned == 0 {
		return 0, nil
	}
	// 实际删除——每种类型传入对应的仓库根目录用于比对
	removed := 0
	for _, d := range types.AllSubDirs() {
		if rtype != "" && d.RType != rtype {
			continue
		}
		dir := types.FindInstDir(target.VersionDir, d.SubDir, d.RType)
		filesRoot, _ := a.GetRepoRoot(d.RType)
		removed += a.clearInstanceDir(dir, d.RType, filesRoot)
	}
	scanner.InvalidateCache()
	return removed, nil
}

// countInstanceDir 递归统计指定目录中的文件数（不限扩展名）
func (a *App) countInstanceDir(dir string) int {
	return fsutil.CountFiles(dir, true)
}

// countMatchingInDir 统计实例目录中与仓库同名的文件数（仅用于清空提示）
func (a *App) countMatchingInDir(instDir, filesRoot string) int {
	repoFiles := make(map[string]bool)
	for _, p := range fsutil.WalkAllFiles(filesRoot, true) {
		repoFiles[strings.ToLower(filepath.Base(p))] = true
	}
	count := 0
	for _, p := range fsutil.WalkAllFiles(instDir, true) {
		if repoFiles[strings.ToLower(filepath.Base(p))] {
			count++
		}
	}
	return count
}

// isResourcePackFolder 检查目录是否是资源包文件夹（内含 pack.mcmeta）
func isResourcePackFolder(path string) bool {
	_, err := os.Stat(filepath.Join(path, "pack.mcmeta"))
	return err == nil
}

// clearInstanceDir 只删除仓库中已有的文件，跳过整合包自带的资源
// 整合包的 resourcepacks/ 等子目录中可能有用户自己安装的、仓库没有的资源包，保留不动
// clearInstanceDir 清理整合包子目录中仓库已有的文件（执行逻辑下沉 go/recycle）
func (a *App) clearInstanceDir(dir string, rtype string, filesRoot string) int {
	return recycle.RemoveRepoDuplicates(dir, filesRoot, a.ysmRoot(), a.logger.Add)
}

// ========== 状态同步 ==========
// GetInstanceStatus 获取整合包状态（按资源类型限定路径）
// rtype: 资源类型 ID，用于解析特定子目录；为空时使用 ins.CustomDir（向后兼容）
func (a *App) GetInstanceStatus(mcRoot, repoDir, rtype string) []types.InstanceStatus {
	// 扫描日志带类型标签，与前端术语一致
	label := "模型"
	if rt := types.RegistryType(rtype); rt != nil {
		label = rt.Name
	}
	scanFn := func(dir string) []types.ModelEntry { return a.ScanModelEntriesWithLabel(dir, label) }
	return ysmsync.GetInstanceStatus(mcRoot, repoDir, rtype, scanFn)
}

// GetResourceInstanceStatus 按资源类型获取整合包同步状态
// 统一走 GetInstanceStatus 路径，通过 rtype 限定实例侧扫描子目录 + 仓库侧扩展名过滤
func (a *App) GetResourceInstanceStatus(rtype, mcRoot, repoDir string) []types.InstanceStatus {
	if mcRoot == "" || rtype == "" {
		return []types.InstanceStatus{}
	}

	// 扫描日志带类型标签，与前端术语一致
	label := ""
	if rt := types.RegistryType(rtype); rt != nil {
		label = rt.Name
	}

	// 按资源类型扩展名过滤的 scanFn：仓库侧只收集本类型文件
	typeExts := types.SupportedExtsForType(rtype)
	extSet := make(map[string]bool, len(typeExts))
	for _, e := range typeExts {
		extSet[strings.ToLower(e)] = true
	}

	scanFn := func(dir string) []types.ModelEntry {
		all := a.ScanModelEntriesWithLabel(dir, label)
		if len(extSet) == 0 {
			return all
		}
		// 仅保留本类型扩展名的文件（排除 .recycle 等已由 ScanModelEntries 处理的情况）
		// 使用 e.Ext（scanner 已从去 .ban/.disabled 后的路径计算），避免 filepath.Ext(e.Name) 把 .ban 当扩展名
		filtered := make([]types.ModelEntry, 0, len(all))
		for _, e := range all {
			if extSet[strings.ToLower(e.Ext)] {
				filtered = append(filtered, e)
			}
		}
		return filtered
	}

	// 统一走 GetInstanceStatus：rtype 限定实例侧扫描子目录
	if repoDir == "" {
		repoDir, _ = a.GetRepoRoot(rtype)
	}
	if repoDir == "" {
		return []types.InstanceStatus{}
	}

	results := ysmsync.GetInstanceStatus(mcRoot, repoDir, rtype, scanFn)

	// 补充 HasMod 检测：检查整合包的 mods 目录是否包含指定类型的模组
	if len(results) > 0 {
		instances := a.ListVersionInstances(mcRoot)
		insMap := make(map[string]*types.VersionInstance)
		for i := range instances {
			insMap[instances[i].Name] = &instances[i]
		}
		for i := range results {
			if ins, ok := insMap[results[i].Name]; ok {
				modsDir := filepath.Join(ins.VersionDir, "mods")
				results[i].HasMod = ysm.HasModInDir(modsDir, rtype)
			}
		}
	}

	return results
}

func (a *App) SyncModelToggleStatus(instanceCustomDir, filesRoot string) (int, int, error) {
	n1, n2, err := ysmsync.SyncToggleStatus(instanceCustomDir, filesRoot, a.ScanModelEntries)
	// 启禁同步会改实例侧文件名，但当前不走 scanner 失效；这里显式清同步结果缓存，
	// 否则新增的 30s 同步结果缓存会让整合包页继续展示旧启禁状态。
	instance.InvalidateSyncItemsCache()
	ysmsync.InvalidateSyncScanCaches()
	return n1, n2, err
}

// relinkDir 重新应用链接模式到单个目录
// rtype 用于需要文件夹级重新链接的类型（ysm/EntityPlayer 等）
// relinkDir 按哈希比对重链接实例目录（执行逻辑下沉 go/sync）
func (a *App) relinkDir(customDir, filesRoot, rtype string) (int, error) {
	return ysmsync.RelinkDir(customDir, filesRoot, rtype, a.getLinkMode(), a.ScanModelEntries, a.logger.Add)
}

// RelinkAllInstanceResources 重新应用链接模式到整合包所有资源类型目录
func (a *App) RelinkAllInstanceResources(instanceName string) (int, error) {
	cfg := a.LoadAppConfig()
	if err := requireMcRoot(cfg); err != nil {
		return 0, err
	}
	instances := a.ListVersionInstances(cfg.McRoot)
	var target *types.VersionInstance
	for i, ins := range instances {
		if ins.Name == instanceName {
			target = &instances[i]
			break
		}
	}
	if target == nil {
		return 0, fmt.Errorf("未找到整合包: %s", instanceName)
	}
	total := 0
	for _, d := range types.AllSubDirs() {
		// ADR-064 锚定：统一走 FindInstDir（标准目录无该类型文件时兜底扫描），
		// 否则 Sable-Schematics 等非标准目录里的蓝图不会参与重链接
		instanceDir := types.FindInstDir(target.VersionDir, d.SubDir, d.RType)
		if _, err := os.Stat(instanceDir); os.IsNotExist(err) {
			continue
		}
		globalDir, _ := a.GetRepoRoot(d.RType)
		if globalDir == "" {
			continue
		}
		n, err := a.relinkDir(instanceDir, globalDir, d.RType)
		if err != nil {
			// 部分目录已重链接——同样需失效缓存，防陈旧缓存"复活"
			scanner.InvalidateCache()
			return total, fmt.Errorf("重链接 %s 失败: %w", d.RType, err)
		}
		total += n
	}
	// 重链接会增删实例目录文件——失效扫描缓存（实例目录在扫描范围内，GetInstanceStatus 走扫描）
	scanner.InvalidateCache()
	return total, nil
}

// ========== 资源同步 ==========

// SyncResources 获取全局 ↔ 整合包的资源同步状态
func (a *App) SyncResources(rtype, instanceName string) (types.ResourceSyncResult, error) {
	cfg := a.LoadAppConfig()
	empty := types.ResourceSyncResult{}
	if cfg.McRoot == "" {
		return empty, fmt.Errorf("未配置游戏根目录")
	}
	globalDir, _ := a.filesRootForSync(rtype)
	if globalDir == "" {
		return empty, fmt.Errorf("未设置%s目录", rtype)
	}

	// 找整合包
	instances := a.ListVersionInstances(cfg.McRoot)
	var targetDir string
	for _, ins := range instances {
		if ins.Name == instanceName {
			subDir := types.SubDirMap(rtype)
			if subDir == "" {
				return empty, fmt.Errorf("未知资源类型: %s", rtype)
			}
			// 与展示层同口径：FindInstDir 标准目录无该类型文件时兜底扫描
			// （Sable-Schematics 等非标准目录；原直拼 schematics 与此 binding
			// 的展示结果不一致）
			targetDir = types.FindInstDir(ins.VersionDir, subDir, rtype)
			break
		}
	}
	if targetDir == "" {
		return empty, fmt.Errorf("未找到整合包: %s", instanceName)
	}

	// ADR-064 审核修复：原未传 rtype → IsResourceAllowed 全扩展集过滤返回跨类型条目；
	// 传 rtype 保持与同步管理器同口径（虽然前端当前不消费此 binding，防未来埋雷）
	result := ysmsync.SyncResources(globalDir, targetDir, rtype)
	return result, nil
}

// PushResourceToInstance 将全局中缺失的资源推送到整合包
// PushResourceToInstance 推送缺失资源到整合包（执行循环下沉 go/sync）
func (a *App) PushResourceToInstance(rtype, instanceName string) (int, error) {
	cfg := a.LoadAppConfig()
	if err := requireMcRoot(cfg); err != nil {
		return 0, err
	}
	globalDir, _ := a.filesRootForSync(rtype)
	if globalDir == "" {
		return 0, fmt.Errorf("未设置%s目录", rtype)
	}

	targetDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil {
		return 0, err
	}
	n, opErr := ysmsync.PushResources(rtype, globalDir, targetDir, a.getLinkMode(), a.logger.Add)
	// 推送会改实例目录；该入口当前不走 scanner.InvalidateCache，显式清同步结果缓存。
	instance.InvalidateSyncItemsCache()
	ysmsync.InvalidateSyncScanCaches()
	return n, opErr
}

// PullResourceFromInstance 拉取整合包多余资源回仓库（执行循环下沉 go/sync）
func (a *App) PullResourceFromInstance(rtype, instanceName string) (int, error) {
	cfg := a.LoadAppConfig()
	if err := requireMcRoot(cfg); err != nil {
		return 0, err
	}
	globalDir, _ := a.filesRootForSync(rtype)
	if globalDir == "" {
		return 0, fmt.Errorf("未设置%s目录", rtype)
	}

	targetDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil {
		return 0, err
	}
	n, opErr := ysmsync.PullResources(rtype, globalDir, targetDir, a.logger.Add)
	// 拉取会改全局仓库目录；该入口当前不走 scanner.InvalidateCache，显式清同步结果缓存。
	instance.InvalidateSyncItemsCache()
	ysmsync.InvalidateSyncScanCaches()
	return n, opErr
}

// findInstanceDir 解析整合包实例的资源类型子目录（Push/Pull 共用）
// ADR-064 审核修复：原 filepath.Join 直拼标准子目录，与展示层 BuildSyncItems
// 的 types.FindInstDir（标准目录无该类型文件时兜底扫描）口径不一致——
// Sable-Schematics 场景下展示显示 Sable-Schematics 条目、操作却指向空 schematics，
// mapSrcToGlobal 报"路径不在目标目录内"。统一走 FindInstDir。
func (a *App) findInstanceDir(rtype, instanceName, mcRoot string) (string, error) {
	instances := a.ListVersionInstances(mcRoot)
	for _, ins := range instances {
		if ins.Name == instanceName {
			subDir := types.SubDirMap(rtype)
			if subDir == "" {
				return "", fmt.Errorf("未知资源类型: %s", rtype)
			}
			return types.FindInstDir(ins.VersionDir, subDir, rtype), nil
		}
	}
	return "", fmt.Errorf("未找到整合包: %s", instanceName)
}

// PullSingleResourceFromInstance 从整合包拉取单个 extra 文件/文件夹到全局仓库
// PullSingleResourceFromInstance 从整合包拉取单个资源（复制核心下沉 go/sync）
func (a *App) PullSingleResourceFromInstance(rtype, srcPath, instanceName string) error {
	cfg := a.LoadAppConfig()
	if err := requireMcRoot(cfg); err != nil {
		return err
	}
	globalDir, _ := a.filesRootForSync(rtype)
	if globalDir == "" {
		return fmt.Errorf("未设置目录")
	}
	targetDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil {
		return err
	}
	opErr := ysmsync.PullSingleResource(globalDir, targetDir, srcPath)
	// 拉取单条会改全局仓库；显式清同步结果缓存（保持单文件操作后立即刷新）。
	instance.InvalidateSyncItemsCache()
	ysmsync.InvalidateSyncScanCaches()
	return opErr
}

// PushSingleResourceToInstance 推送单个资源到整合包（分派核心下沉 go/sync）
func (a *App) PushSingleResourceToInstance(rtype, instanceName, filePath string) error {
	cfg := a.LoadAppConfig()
	if err := requireMcRoot(cfg); err != nil {
		return err
	}
	globalDir, _ := a.filesRootForSync(rtype)
	if globalDir == "" {
		return fmt.Errorf("未设置 %s 类型的仓库目录", rtype)
	}
	customDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil {
		return err
	}
	opErr := ysmsync.PushSingleResource(filePath, customDir, globalDir, a.getLinkMode(), rtype)
	// 推送单条会改实例目录；显式清同步结果缓存（保持单文件操作后立即刷新）。
	instance.InvalidateSyncItemsCache()
	ysmsync.InvalidateSyncScanCaches()
	return opErr
}

// ========== 整合包同步目录解析（可见性） ==========

// globalRootSuspicious 判断仓库侧基准目录是否「疑似过宽」——即用户把类型专属根
// 配成了 Minecraft 实例根 / FilesRoot 总根这类宽目录。此类配置会让目录级同步
// 递归扫整棵树并按扩展名过滤，其他资源的 .nbt/.zip 等会混入本类型列表。
// 探测用轻量目录名特征（mods/config/saves/resourcepacks/shaderpacks，
// 或 FilesRoot 下的 minecraft-mod/schematics 子路径），不做全量递归扫描。
func globalRootSuspicious(dir string) bool {
	if dir == "" {
		return false
	}
	for _, marker := range []string{"mods", "config", "saves", "resourcepacks", "shaderpacks"} {
		if fi, err := os.Stat(filepath.Join(dir, marker)); err == nil && fi.IsDir() {
			return true
		}
	}
	// FilesRoot 总根特征：minecraft-mod 分组下含 schematics 子目录
	if fi, err := os.Stat(filepath.Join(dir, "minecraft-mod", "schematics")); err == nil && fi.IsDir() {
		return true
	}
	return false
}

// GetSyncScanDirs 返回指定资源类型在指定整合包中「实际同步使用的目录对」。
//   - global：仓库侧基准目录（GetRepoRoot 结果）
//   - instance：实例侧实际扫描目录（types.FindInstDir 结果，可能因兜底命中非标准目录）
//   - warningCode：仓库侧目录疑似过宽时的结构化告警码（"scan_dir_wide"，空串=正常）
//   - warningParams：告警参数（label=类型名、dir=过宽目录、subDir=建议专属子目录）；
//     显示文案由前端按 i18n 组装，后端不吐拼好的中文（避免 en/ja 用户看到中文警告）
//
// 用途：让前端同步页展示“到底从哪个文件夹扫”，尤其兜底命中 Sable-Schematics 时用户可见。
// 不触发全量扫描，仅做目录解析 + 标准目录存在性/证据检查，体感轻量。
func (a *App) GetSyncScanDirs(rtype, instanceName string) (types.SyncScanDirs, error) {
	cfg := a.LoadAppConfig()
	empty := types.SyncScanDirs{WarningParams: map[string]string{}}
	if cfg.McRoot == "" {
		return empty, fmt.Errorf("未配置游戏根目录")
	}
	globalDir, _ := a.filesRootForSync(rtype)
	warningCode := ""
	warningParams := map[string]string{}
	if globalRootSuspicious(globalDir) {
		rt := types.RegistryType(rtype)
		label := rtype
		if rt != nil {
			label = rt.Name
		}
		warningCode = "scan_dir_wide"
		warningParams = map[string]string{
			"label":  label,
			"dir":    globalDir,
			"subDir": types.StorageSubDir(rtype),
		}
	}
	instanceDir := ""
	for _, ins := range a.ListVersionInstances(cfg.McRoot) {
		if ins.Name == instanceName {
			if subDir := types.SubDirMap(rtype); subDir != "" {
				instanceDir = types.FindInstDir(ins.VersionDir, subDir, rtype)
			}
			break
		}
	}
	return types.SyncScanDirs{
		Global:        globalDir,
		Instance:      instanceDir,
		WarningCode:   warningCode,
		WarningParams: warningParams,
	}, nil
}

// ========== 整合包全类型同步状态 ==========

// GetInstanceSyncStatus 整合包同步状态（组装逻辑已下沉 go/instance，此处仅注入依赖）
func (a *App) GetInstanceSyncStatus(instanceName string, subtype string, rtype string) ([]types.ResourceSyncItem, error) {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return nil, fmt.Errorf("未配置游戏根目录")
	}

	// 加载资源类型注册表
	var registry struct {
		ResourceTypes []instance.ResourceTypeInfo `json:"resourceTypes"`
	}
	if data := types.BundledRegistryJSON(); len(data) > 0 {
		// json.Unmarshal 忽略 err——内嵌 resource_types.json 损坏时 registry 为空、
		// 同步页静默显示空；显式 log + 回退 LoadRegistry，与 Go 其它路径行为一致
		if uerr := json.Unmarshal(data, &registry); uerr != nil {
			log.Printf("[app] resource_types.json 解析失败: %v, 回退嵌入基线", uerr)
			if rt := types.LoadRegistry(); rt != nil {
				registry.ResourceTypes = make([]instance.ResourceTypeInfo, 0, len(rt.ResourceTypes))
				for _, r := range rt.ResourceTypes {
					registry.ResourceTypes = append(registry.ResourceTypes, instance.ResourceTypeInfo{
						ID: r.ID, Name: r.Name, Icon: r.Icon,
					})
				}
			}
		}
	}

	// rtype 路径限定：非空时只保留该类型，避免扫不存在的其他类型目录
	if rtype != "" {
		filtered := registry.ResourceTypes[:0]
		for _, rt := range registry.ResourceTypes {
			if rt.ID == rtype {
				filtered = append(filtered, rt)
				break
			}
		}
		registry.ResourceTypes = filtered
	}

	// 找整合包目录
	instances := a.ListVersionInstances(cfg.McRoot)
	var targetIns *types.VersionInstance
	for i, ins := range instances {
		if ins.Name == instanceName {
			targetIns = &instances[i]
			break
		}
	}
	if targetIns == nil {
		return nil, fmt.Errorf("未找到整合包: %s", instanceName)
	}

	// 收集各资源类型的仓库根目录（同步基准：subDirGrouping 类型用 group 根，与仓库树对齐）
	roots := map[string]string{}
	for _, rt := range registry.ResourceTypes {
		roots[rt.ID], _ = a.filesRootForSync(rt.ID)
	}

	items := instance.BuildSyncItems(targetIns, registry.ResourceTypes, roots, subtype)
	return items, nil
}

// ========== YSM 检测 ==========
// HasYSMMod 检测实例 mods 目录是否包含 YSM 模组（整合包卡片 mod 徽标用）。
// 注意（R23 P4-1）："ysm" 子串匹配刻意宽松（覆盖 Yes_Steve_Model/ysm 官方 jar 变体），
// mods 目录语境下误判面小；若未来引入非 YSM 但含 ysm 子串的 mod，需收紧为段匹配。
func (a *App) HasYSMMod(modsDir string) bool {
	entries, err := os.ReadDir(modsDir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		low := strings.ToLower(e.Name())
		if strings.Contains(low, "yes_steve_model") || strings.Contains(low, "ysm") {
			return true
		}
	}
	return false
}
