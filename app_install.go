// ========== 安装 + 回收站 ==========
// 从 app.go 拆分：模型安装/导入/回收站/去重
package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/recycle"
	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"
)

// ========== 安装 ==========
func (a *App) InstallModelFile(src, mcRoot string) (string, error) {
	return installer.InstallToGlobal(src, mcRoot)
}

func (a *App) InstallModelTo(src, customDir string) error {
	err := installer.Install(src, customDir, a.RepoRoot, a.LinkMode)
	if err != nil {
		a.logger.Add(filepath.Base(src), src, customDir, 0, "failed", err.Error())
	} else {
		a.logger.Add(filepath.Base(src), src, customDir, 0, "success", "")
	}
	return err
}

func (a *App) InstallModelWithOverlay(src, customDir string) (string, error) {
	return installer.InstallWithOverlay(src, customDir)
}

func (a *App) SyncCustomToRepo(customDir, repoDir string) (int, error) {
	customDir = strings.TrimSpace(customDir)
	repoDir = strings.TrimSpace(repoDir)
	if customDir == "" || repoDir == "" {
		return 0, fmt.Errorf("参数空")
	}
	srcEntries := a.ScanCustomModels(customDir)
	if len(srcEntries) == 0 {
		return 0, nil
	}

	repoEntries := a.ScanModelEntries(repoDir)
	repoHashes := make(map[string]bool)
	repoNames := make(map[string]bool)
	for _, re := range repoEntries {
		if re.Hash != "" {
			repoHashes[re.Hash] = true
		}
		repoNames[re.Name] = true
	}

	count := 0
	for _, e := range srcEntries {
		if e.Hash != "" && repoHashes[e.Hash] {
			a.logger.Add(e.Name, e.Path, repoDir, 0, "skipped", "仓库已存在同哈希文件，跳过")
			continue
		}
		if repoNames[e.Name] {
			a.logger.Add(e.Name, e.Path, repoDir, 0, "skipped", "仓库已存在同名文件，跳过")
			continue
		}
		rel, _ := filepath.Rel(customDir, e.Path)
		if rel == "" {
			rel = e.Name
		}
		dstPath := filepath.Join(repoDir, rel)
		dstDir := filepath.Dir(dstPath)
		if err := os.MkdirAll(dstDir, 0755); err != nil {
			a.logger.Add(e.Name, e.Path, repoDir, 0, "failed", "创建目录失败: "+err.Error())
			continue
		}
		if _, err := installer.CopyFile(e.Path, dstDir); err != nil {
			a.logger.Add(e.Name, e.Path, repoDir, 0, "failed", "复制失败: "+err.Error())
			continue
		}
		count++
		a.logger.Add(e.Name, e.Path, repoDir, 0, "success", "已复制到仓库")
	}
	return count, nil
}

func (a *App) ImportModelFile(fileName, base64Data string) error {
	return a.importModelFile(fileName, base64Data, false)
}

func (a *App) ImportModelFileSkipCheck(fileName, base64Data string) error {
	return a.importModelFile(fileName, base64Data, true)
}

func (a *App) importModelFile(fileName, base64Data string, skipCheck bool) error {
	return a.importModelFileWithOptions(fileName, base64Data, importOptions{skipCheck: skipCheck})
}

func (a *App) ImportModelFileOverwrite(fileName, base64Data string) error {
	return a.importModelFileWithOptions(fileName, base64Data, importOptions{overwrite: true})
}

type importOptions struct {
	skipCheck bool
	overwrite bool
}

func (a *App) importModelFileWithOptions(fileName, base64Data string, opts importOptions) error {
	// 根据扩展名确定目标仓库
	ext := strings.ToLower(filepath.Ext(fileName))
	rtypes := types.ExtBelongsTo(ext)
	if len(rtypes) == 0 {
		return types.AppError{Code: "FILE_TYPE_UNSUPPORTED", Operation: "导入模型", SourcePath: fileName, Reason: "不支持的文件格式"}
	}
	targetRoot := a.RepoRoot
	// 如果是非 YSM 类型，用 GetRepoRoot 查找对应仓库
	if rtypes[0] != "ysm" {
		targetRoot = a.GetRepoRoot(rtypes[0])
		if targetRoot == "" {
			return fmt.Errorf("请先设置 %s 类型的仓库目录", rtypes[0])
		}
	}
	if targetRoot == "" {
		return fmt.Errorf("请先设置仓库目录")
	}
	if strings.Contains(fileName, "..") || strings.ContainsAny(fileName, "\\/") {
		return types.AppError{Code: "FILENAME_INVALID", Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含非法路径分隔符", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return types.AppError{Code: "DECODE_FAILED", Operation: "导入模型", Reason: "Base64 解码失败", Suggestion: "文件可能已损坏，请重新下载"}
	}
	if len(data) > 500*1024*1024 {
		return types.AppError{Code: "FILE_TOO_LARGE", Operation: "导入模型", SourcePath: fileName, Reason: "文件大小超过 500MB 限制", Suggestion: "请压缩文件至 500MB 以内"}
	}
	if len(data) == 0 {
		return types.AppError{Code: "FILE_EMPTY", Operation: "导入模型", SourcePath: fileName, Reason: "文件内容为空", Suggestion: "请检查文件是否损坏"}
	}
	if !opts.skipCheck && len(data) >= 4 {
		if ext == ".zip" || ext == ".ysm" {
			if data[0] != 0x50 || data[1] != 0x4B || data[2] != 0x03 || data[3] != 0x04 {
				a.logger.Add(fileName, fileName, targetRoot, 0, "warn", "文件头不匹配标准ZIP格式，可能为旧版或非标准YSM文件，已导入")
			}
		} else if ext == ".7z" {
			if data[0] != 0x37 || data[1] != 0x7A || data[2] != 0xBC || data[3] != 0xAF {
				a.logger.Add(fileName, fileName, targetRoot, 0, "warn", "文件头不匹配标准7z格式，已导入")
			}
		}
	}
	destPath := filepath.Join(targetRoot, fileName)
	destDir := filepath.Dir(destPath)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return types.AppError{Code: "MKDIR_FAILED", Operation: "导入模型", TargetPath: destDir, Reason: "无法创建目标目录", Suggestion: "请检查磁盘权限或空间"}
	}
	if !opts.overwrite {
		if _, err := os.Stat(destPath); err == nil {
			return types.AppError{Code: "FILE_EXISTS", Operation: "导入模型", SourcePath: fileName, Reason: "文件已存在", Suggestion: "如需替换请先删除原文件"}
		}
	}
	return os.WriteFile(destPath, data, 0644)
}

func (a *App) ImportModelFileTo(fileName, subpath, base64Data string) error {
	return a.importModelFileWithSubpath(fileName, subpath, base64Data, false)
}

func (a *App) ImportModelFileOverwriteTo(fileName, subpath, base64Data string) error {
	return a.importModelFileWithSubpath(fileName, subpath, base64Data, true)
}

func (a *App) importModelFileWithSubpath(fileName, subpath, base64Data string, overwrite bool) error {
	if a.RepoRoot == "" {
		return fmt.Errorf("请先选择仓库目录")
	}
	ext := strings.ToLower(filepath.Ext(fileName))
	if !types.IsSupportedExt(ext) {
		return types.AppError{Code: "FILE_TYPE_UNSUPPORTED", Operation: "导入模型", SourcePath: fileName, Reason: "不支持的文件格式", Suggestion: "支持格式: " + strings.Join(types.AllExts, " / ")}
	}
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return types.AppError{Code: "DECODE_FAILED", Operation: "导入模型", Reason: "Base64 解码失败", Suggestion: "文件可能已损坏，请重新下载"}
	}
	if len(data) > 500*1024*1024 {
		return types.AppError{Code: "FILE_TOO_LARGE", Operation: "导入模型", SourcePath: fileName, Reason: "文件大小超过 500MB 限制", Suggestion: "请压缩文件至 500MB 以内"}
	}
	if len(data) == 0 {
		return types.AppError{Code: "FILE_EMPTY", Operation: "导入模型", SourcePath: fileName, Reason: "文件内容为空", Suggestion: "请检查文件是否损坏"}
	}
	destPath := filepath.Join(a.RepoRoot, subpath, fileName)
	destDir := filepath.Dir(destPath)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return types.AppError{Code: "MKDIR_FAILED", Operation: "导入模型", TargetPath: destDir, Reason: "无法创建目标目录", Suggestion: "请检查磁盘权限或空间"}
	}
	if !overwrite {
		if _, err := os.Stat(destPath); err == nil {
			return types.AppError{Code: "FILE_EXISTS", Operation: "导入模型", SourcePath: fileName, Reason: "文件已存在", Suggestion: "如需替换请先删除原文件"}
		}
	}
	return os.WriteFile(destPath, data, 0644)
}

// ========== 回收站 ==========
func (a *App) MoveToRecycle(src string) error {
	// 尝试所有可能的资源根目录，找到包含 src 的那个
	root := a.findRecycleRoot(src)
	if root == "" {
		root = a.RepoRoot
	}
	return recycle.Move(src, root)
}

func (a *App) MoveToRecycleEx(src string) (string, string) {
	root := a.findRecycleRoot(src)
	if root == "" {
		return "error", "未找到包含此文件的资源目录"
	}
	res := recycle.MoveEx(src, root)
	return res.Action, res.Reason
}

// findRecycleRoot 查找包含 src 路径的资源根目录（用于多类型回收）
func (a *App) findRecycleRoot(src string) string {
	cfg := a.LoadAppConfig()
	roots := []string{
		a.RepoRoot,
		cfg.ResourcepackRoot,
		cfg.ShaderpackRoot,
		cfg.SchematicRoot,
		cfg.MmdRoot,
		cfg.VrcRoot,
	}
	for _, r := range roots {
		if r == "" {
			continue
		}
		rel, err := filepath.Rel(r, src)
		if err == nil && !strings.HasPrefix(rel, "..") {
			return r
		}
	}
	return ""
}

func (a *App) ClearCustomDir(customDir string) (int, error) {
	customDir = strings.TrimSpace(customDir)
	if customDir == "" {
		return 0, fmt.Errorf("目录为空")
	}

	repoFiles := a.ScanModelEntries(a.RepoRoot)
	repoByName := map[string]types.ModelEntry{}
	for _, e := range repoFiles {
		repoByName[e.Name] = e
	}

	count := 0
	filepath.WalkDir(customDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if strings.ToLower(d.Name()) == ".recycle" {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		actualExt := ext
		if strings.HasSuffix(strings.ToLower(p), ".ban") {
			actualExt = strings.ToLower(filepath.Ext(p[:len(p)-4]))
		}
		if actualExt != ".ysm" && actualExt != ".zip" && actualExt != ".7z" {
			return nil
		}

		fileName := filepath.Base(p)
		lookupName := strings.TrimSuffix(fileName, ".ban")

		_, hasName := repoByName[lookupName]
		if !hasName {
			a.logger.Add(fileName, p, customDir, 0, "skipped", "仓库中无此文件，跳过删除（请先上传到仓库）")
			return nil
		}

		if err := os.Remove(p); err != nil {
			a.logger.Add(fileName, p, customDir, 0, "failed", err.Error())
			return nil
		}
		count++
		a.logger.Add(fileName, p, customDir, 0, "success", "已从整合包删除（仓库保留）")
		return nil
	})
	return count, nil
}

// CountInstanceResources 统计指定整合包中可清空的资源文件数
func (a *App) CountInstanceResources(insName string) (int, error) {
	insName = strings.TrimSpace(insName)
	if insName == "" {
		return 0, fmt.Errorf("整合包名为空")
	}
	cfg := a.LoadAppConfig()
	mcRoot := cfg.McRoot
	if mcRoot == "" {
		return 0, fmt.Errorf("游戏根目录未设置")
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
		total += a.countInstanceDir(filepath.Join(target.VersionDir, d.SubDir))
	}
	return total, nil
}

// ClearInstanceResources 清空指定整合包中所有资源类型的已同步文件（走回收站）
// insName: 整合包名（如 "1.20.1-Forge_47.4.20"）
// 返回清除的文件数量
func (a *App) ClearInstanceResources(insName string) (int, error) {
	insName = strings.TrimSpace(insName)
	if insName == "" {
		return 0, fmt.Errorf("整合包名为空")
	}
	cfg := a.LoadAppConfig()
	mcRoot := cfg.McRoot
	if mcRoot == "" {
		return 0, fmt.Errorf("游戏根目录未设置")
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

	// 遍历所有资源类型的子目录统计文件数
	total := 0
	for _, d := range types.AllSubDirs() {
		dir := filepath.Join(target.VersionDir, d.SubDir)
		total += a.countInstanceDir(dir)
	}
	if total == 0 {
		return 0, nil
	}
	// 实际删除
	for _, d := range types.AllSubDirs() {
		dir := filepath.Join(target.VersionDir, d.SubDir)
		total = a.clearInstanceDir(dir)
	}
	return total, nil
}

// countInstanceDir 递归统计指定目录中可删除的资源文件数
func (a *App) countInstanceDir(dir string) int {
	count := 0
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if !types.IsSupportedExt(ext) {
			return nil
		}
		count++
		return nil
	})
	return count
}

// isResourcePackFolder 检查目录是否是资源包文件夹（内含 pack.mcmeta）
func isResourcePackFolder(path string) bool {
	_, err := os.Stat(filepath.Join(path, "pack.mcmeta"))
	return err == nil
}

// clearInstanceDir 递归删除指定目录中的资源文件及空子目录
func (a *App) clearInstanceDir(dir string) int {
	count := 0
	// 先递归收集所有需要删除的文件
	var targets []string
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if !types.IsSupportedExt(ext) {
			return nil
		}
		targets = append(targets, p)
		return nil
	})
	// 执行删除
	for _, p := range targets {
		if a.RepoRoot != "" && paths.IsInside(a.RepoRoot, p) == nil {
			if err := recycle.Move(p, a.RepoRoot); err != nil {
				continue
			}
		} else {
			if err := os.Remove(p); err != nil {
				continue
			}
		}
		count++
	}
	// 清理空目录（从最深到最浅）
	var dirs []string
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil || !d.IsDir() || p == dir {
			return nil
		}
		dirs = append(dirs, p)
		return nil
	})
	for i := len(dirs) - 1; i >= 0; i-- {
		os.Remove(dirs[i]) // 只删空目录
	}
	return count
}

func (a *App) DeduplicateCustomDir(customDir string) (int, int, error) {
	customDir = strings.TrimSpace(customDir)
	if customDir == "" {
		return 0, 0, fmt.Errorf("目录为空")
	}

	entries := a.ScanModelEntries(customDir)
	if len(entries) == 0 {
		return 0, 0, nil
	}

	hashGroups := make(map[string][]types.ModelEntry)
	for _, e := range entries {
		if e.Hash == "" {
			continue
		}
		hashGroups[e.Hash] = append(hashGroups[e.Hash], e)
	}

	removed, kept := 0, 0
	for _, group := range hashGroups {
		if len(group) <= 1 {
			continue
		}
		// 保留第一个，其余移入回收站
		for _, e := range group[1:] {
			if err := recycle.Move(e.Path, a.RepoRoot); err != nil {
				a.logger.Add(e.Name, e.Path, customDir, 0, "failed", "回收站移动失败: "+err.Error())
				continue
			}
			removed++
		}
		kept++
	}
	return removed, kept, nil
}

func (a *App) ListRecycleBin(_ string) []types.ModelEntry {
	cfg := a.LoadAppConfig()
	roots := a.allRecycleRoots(cfg)
	all := []types.ModelEntry{}
	seen := map[string]bool{}
	for _, r := range roots {
		for _, e := range recycle.List(r) {
			if seen[e.Path] {
				continue
			}
			seen[e.Path] = true
			all = append(all, e)
		}
	}
	return all
}

func (a *App) RestoreFromRecycle(src, repoRoot string) error {
	// 尝试所有根目录恢复
	cfg := a.LoadAppConfig()
	for _, r := range a.allRecycleRoots(cfg) {
		if recycle.New(r).RecycleDir() == "" {
			continue
		}
		if err := recycle.Restore(src, r); err == nil {
			return nil // 找到正确的根目录并恢复
		}
	}
	return recycle.Restore(src, repoRoot) // fallback
}

func (a *App) DeleteFromRecycle(src string) error {
	cfg := a.LoadAppConfig()
	for _, r := range a.allRecycleRoots(cfg) {
		if recycle.New(r).RecycleDir() == "" {
			continue
		}
		if err := recycle.Delete(src, r); err == nil {
			return nil
		}
	}
	return recycle.Delete(src, a.RepoRoot)
}

func (a *App) EmptyRecycleBin(_ string) (int, error) {
	cfg := a.LoadAppConfig()
	total := 0
	for _, r := range a.allRecycleRoots(cfg) {
		n, err := recycle.Empty(r)
		if err == nil {
			total += n
		}
	}
	return total, nil
}

// allRecycleRoots 返回所有配置了路径的资源根目录
func (a *App) allRecycleRoots(cfg types.AppConfig) []string {
	roots := []string{
		a.RepoRoot,
		cfg.ResourcepackRoot,
		cfg.ShaderpackRoot,
		cfg.SchematicRoot,
		cfg.MmdRoot,
		cfg.VrcRoot,
		cfg.McRoot,
	}
	result := []string{}
	for _, r := range roots {
		if r != "" {
			result = append(result, r)
		}
	}
	return result
}

// ========== 状态同步 ==========
func (a *App) GetInstanceStatus(mcRoot, repoDir string) []types.InstanceStatus {
	return ysmsync.GetInstanceStatus(mcRoot, repoDir, a.ScanModelEntries)
}

// GetResourceInstanceStatus 按资源类型获取整合包同步状态
// repoDir 仅对 YSM 类型生效（其他类型从全局资源目录推导）
func (a *App) GetResourceInstanceStatus(rtype, mcRoot, repoDir string) []types.InstanceStatus {
	if mcRoot == "" || rtype == "" {
		return []types.InstanceStatus{}
	}
	// YSM 走原有逻辑（对比 repo 和 custom 目录）
	if rtype == "ysm" {
		if repoDir == "" {
			repoDir = a.GetRepoRoot("ysm")
		}
		if repoDir == "" {
			return []types.InstanceStatus{}
		}
		results := ysmsync.GetInstanceStatus(mcRoot, repoDir, a.ScanModelEntries)
		// 补充 HasMod：CustomDir = {VersionDir}/config/yes_steve_model/custom → 上3层到 VersionDir
		for i := range results {
			modsDir := filepath.Join(results[i].CustomDir, "..", "..", "..", "mods")
			results[i].HasMod = ysm.HasModInDir(modsDir, rtype)
		}
		return results
	}

	// 其他资源类型：对比全局目录和各整合包子目录
	globalDir := a.GetRepoRoot(rtype)
	if globalDir == "" {
		return []types.InstanceStatus{}
	}
	// 扫描全局目录，构建哈希映射
	globalEntries := a.ScanModelEntries(globalDir)
	globalByHash := make(map[string][]types.ModelEntry)
	for _, e := range globalEntries {
		if e.Hash == "" {
			continue
		}
		globalByHash[e.Hash] = append(globalByHash[e.Hash], e)
	}

	instances := a.ListVersionInstances(mcRoot)
	var results []types.InstanceStatus

	// 子目录映射
	subDir := types.SubDirMap(rtype)
	if subDir == "" {
		return []types.InstanceStatus{}
	}

	for _, ins := range instances {
		instDir := filepath.Join(ins.VersionDir, subDir)
		instEntries := a.ScanModelEntries(instDir)
		instByHash := make(map[string]bool)
		for _, c := range instEntries {
			if c.Hash != "" {
				instByHash[c.Hash] = true
			}
		}

		status := types.InstanceStatus{
			Name:      ins.Name,
			CustomDir: instDir,
			Missing:   []string{},
			Extra:     []string{},
			HasMod:    ysm.HasModInDir(filepath.Join(ins.VersionDir, "mods"), rtype),
		}

		for hash, entries := range globalByHash {
			if !instByHash[hash] {
				for _, e := range entries {
					status.Missing = append(status.Missing, e.Path)
				}
			}
		}
		for _, c := range instEntries {
			if c.Hash == "" {
				continue
			}
			if _, found := globalByHash[c.Hash]; !found {
				status.Extra = append(status.Extra, c.Path)
			}
		}
		if len(status.Missing) == 0 && len(status.Extra) == 0 {
			status.Status = "complete"
		} else if len(status.Extra) > 0 {
			status.Status = "extra"
		} else {
			status.Status = "missing"
		}
		// 计算已同步数：整合包中 hash 匹配全局的文件数
		matchedCount := 0
		for _, c := range instEntries {
			if c.Hash != "" && globalByHash[c.Hash] != nil {
				matchedCount++
			}
		}
		status.Synced = matchedCount
		results = append(results, status)
	}
	return results
}

func (a *App) SyncModelToggleStatus(instanceCustomDir, repoRoot string) (int, int, error) {
	return ysmsync.SyncToggleStatus(instanceCustomDir, repoRoot, a.ScanModelEntries)
}

// RelinkCustomDir 重新应用链接模式到指定目录（兼容旧版）
func (a *App) RelinkCustomDir(customDir, repoRoot string) (int, error) {
	// 尝试从 repoRoot 推断 rtype
	rtype := "ysm"
	for _, d := range types.AllSubDirs() {
		if strings.Contains(strings.ToLower(customDir), strings.ToLower(d.SubDir)) {
			rtype = d.RType
			break
		}
	}
	return a.relinkDir(customDir, repoRoot, rtype)
}

// relinkDir 重新应用链接模式到单个目录
// rtype 用于需要文件夹级重新链接的类型（ysm/mmd-skin 等）
func (a *App) relinkDir(customDir, repoRoot, rtype string) (int, error) {
	customDir = strings.TrimSpace(customDir)
	repoRoot = strings.TrimSpace(repoRoot)
	if customDir == "" || repoRoot == "" {
		return 0, fmt.Errorf("参数为空")
	}
	repoEntries := a.ScanModelEntries(repoRoot)
	repoByHash := make(map[string]string)
	for _, e := range repoEntries {
		if e.Hash != "" {
			repoByHash[e.Hash] = e.Path
		}
	}
	customEntries := a.ScanModelEntries(customDir)
	count := 0
	for _, ce := range customEntries {
		if ce.Hash == "" {
			continue
		}
		srcPath, found := repoByHash[ce.Hash]
		if !found {
			continue
		}
		// ysm.json / .pmx / .pmd：使用 InstallDir 重新链接整个文件夹
		ext := strings.ToLower(filepath.Ext(ce.Path))
		baseName := strings.ToLower(filepath.Base(ce.Path))
		baseName = strings.TrimSuffix(baseName, ".ban")
		isDirType := (baseName == "ysm.json" && rtype == "ysm") ||
			(ext == ".pmx" || ext == ".pmd")
		if isDirType {
			srcDir := filepath.Dir(srcPath)
			// ce.Path 已在目标子目录内，父层才是 InstallDir 要写入的基础目录
			dstParent := filepath.Dir(ce.Path)
			// 但 InstallDir 会自动创建 {targetSubDir}，如果 dstParent 已经是模型目录
			// 则会二次嵌套。正确的做法：上一层目录作为 dstDir，让 InstallDir 创建子目录
			dstBase := filepath.Dir(dstParent)
			if err := os.RemoveAll(dstParent); err != nil {
				continue
			}
			if err := installer.InstallDir(srcDir, dstBase, repoRoot, a.LinkMode, rtype); err != nil {
				continue
			}
			count++
			continue
		}
		if err := os.Remove(ce.Path); err != nil {
			continue
		}
		// 传入基础 customDir，让 installer.Install 自行计算相对路径
		if err := installer.Install(srcPath, customDir, repoRoot, a.LinkMode); err != nil {
			continue
		}
		count++
	}
	return count, nil
}

// RelinkAllInstanceResources 重新应用链接模式到整合包所有资源类型目录
func (a *App) RelinkAllInstanceResources(instanceName string) (int, error) {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return 0, fmt.Errorf("请先设置游戏根目录")
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
		instanceDir := filepath.Join(target.VersionDir, d.SubDir)
		if _, err := os.Stat(instanceDir); os.IsNotExist(err) {
			continue
		}
		globalDir := a.GetRepoRoot(d.RType)
		if globalDir == "" {
			continue
		}
		n, _ := a.relinkDir(instanceDir, globalDir, d.RType)
		total += n
	}
	return total, nil
}

// ========== 资源同步 ==========

// SyncResources 获取全局 ↔ 整合包的资源同步状态
func (a *App) SyncResources(rtype, instanceName string) string {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return `{"synced":[],"missing":[],"extra":[]}`
	}
	globalDir := a.GetRepoRoot(rtype)
	if globalDir == "" {
		return `{"synced":[],"missing":[],"extra":[]}`
	}

	// 找整合包
	instances := a.ListVersionInstances(cfg.McRoot)
	var targetDir string
	for _, ins := range instances {
		if ins.Name == instanceName {
			subDir := types.SubDirMap(rtype)
			if subDir == "" {
				return `{"synced":[],"missing":[],"extra":[]}`
			}
			targetDir = filepath.Join(ins.VersionDir, subDir)
			break
		}
	}
	if targetDir == "" {
		return `{"synced":[],"missing":[],"extra":[]}`
	}

	result := ysmsync.SyncResources(globalDir, targetDir)
	data, _ := json.Marshal(result)
	return string(data)
}

// PushResourceToInstance 将全局中缺失的资源推送到整合包
func (a *App) PushResourceToInstance(rtype, instanceName string) (int, error) {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return 0, fmt.Errorf("请先设置游戏根目录")
	}
	globalDir := a.GetRepoRoot(rtype)
	if globalDir == "" {
		return 0, fmt.Errorf("未设置%s目录", rtype)
	}

	instances := a.ListVersionInstances(cfg.McRoot)
	var targetDir string
	for _, ins := range instances {
		if ins.Name == instanceName {
			subDir := types.SubDirMap(rtype)
			if subDir == "" {
				return 0, fmt.Errorf("未知资源类型: %s", rtype)
			}
			targetDir = filepath.Join(ins.VersionDir, subDir)
			break
		}
	}
	if targetDir == "" {
		return 0, fmt.Errorf("未找到整合包: %s", instanceName)
	}

	count := 0

	// YSM(.json) 和 MMD(.pmx/.pmd) 位于子目录中，需文件夹推送
	// 用文件夹级同步检测 missing，然后完整复制整个文件夹（含纹理等配套文件）
	if rtype == "mmd-skin" || rtype == "ysm" {
		dirResult := ysmsync.SyncResourcesDirLevel(globalDir, targetDir, rtype)
		for _, missingDir := range dirResult.Missing {
			if err := installer.InstallDir(missingDir, targetDir, globalDir, a.LinkMode, rtype); err == nil {
				count++
			}
		}
		return count, nil
	}

	// 非文件夹级类型：文件级同步
	result := ysmsync.SyncResources(globalDir, targetDir)
	for _, src := range result.Missing {
		if err := installer.Install(src, targetDir, globalDir, a.LinkMode); err == nil {
			count++
		}
	}
	return count, nil
}

// PullResourceFromInstance 将整合包中多余的资源拉取到全局
func (a *App) PullResourceFromInstance(rtype, instanceName string) (int, error) {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return 0, fmt.Errorf("请先设置游戏根目录")
	}
	globalDir := a.GetRepoRoot(rtype)
	if globalDir == "" {
		return 0, fmt.Errorf("未设置%s目录", rtype)
	}

	instances := a.ListVersionInstances(cfg.McRoot)
	var targetDir string
	for _, ins := range instances {
		if ins.Name == instanceName {
			subDir := types.SubDirMap(rtype)
			if subDir != "" {
				targetDir = filepath.Join(ins.VersionDir, subDir)
			}
			break
		}
	}
	if targetDir == "" {
		return 0, fmt.Errorf("未找到整合包: %s", instanceName)
	}

	// 找出 extra 的文件并复制到全局
	// 对 YSM/MMD 使用文件夹级同步
	var result types.ResourceSyncResult
	if rtype == "ysm" || rtype == "mmd-skin" {
		result = ysmsync.SyncResourcesDirLevel(globalDir, targetDir, rtype)
	} else {
		result = ysmsync.SyncResources(globalDir, targetDir)
	}
	count := 0
	for _, src := range result.Extra {
		// 文件夹级（结果已是文件夹路径），完整复制到全局
		if rtype == "ysm" || rtype == "mmd-skin" {
			folderName := filepath.Base(src)
			dstDir := filepath.Join(globalDir, folderName)
			if err := os.MkdirAll(dstDir, 0755); err != nil {
				continue
			}
			// 复制文件夹内所有文件
			entries, _ := os.ReadDir(src)
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				srcFile := filepath.Join(src, e.Name())
				if err := copyFile(srcFile, filepath.Join(dstDir, e.Name())); err != nil {
					continue
				}
			}
			count++
			continue
		}
		dstDir := filepath.Dir(strings.Replace(src, targetDir, globalDir, 1))
		if err := os.MkdirAll(dstDir, 0755); err != nil {
			continue
		}
		if err := copyFile(src, filepath.Join(dstDir, filepath.Base(src))); err != nil {
			continue
		}
		count++
	}
	return count, nil
}

// PullSingleResourceFromInstance 从整合包拉取单个 extra 文件/文件夹到全局仓库
func (a *App) PullSingleResourceFromInstance(rtype, srcPath, instanceName string) error {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return fmt.Errorf("请先设置游戏根目录")
	}
	globalDir := a.GetRepoRoot(rtype)
	if globalDir == "" {
		return fmt.Errorf("未设置目录")
	}
	instances := a.ListVersionInstances(cfg.McRoot)
	var targetDir string
	for _, ins := range instances {
		if ins.Name == instanceName {
			subDir := types.SubDirMap(rtype)
			if subDir != "" {
				targetDir = filepath.Join(ins.VersionDir, subDir)
			}
			break
		}
	}
	if targetDir == "" {
		return fmt.Errorf("未找到整合包: %s", instanceName)
	}
	// 文件夹级拉取：整体复制文件夹到全局
	fi, stErr := os.Stat(srcPath)
	if stErr == nil && fi.IsDir() {
		folderName := filepath.Base(srcPath)
		dstDir := filepath.Join(globalDir, folderName)
		if err := os.MkdirAll(dstDir, 0755); err != nil {
			return err
		}
		entries, _ := os.ReadDir(srcPath)
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			srcFile := filepath.Join(srcPath, e.Name())
			if err := copyFile(srcFile, filepath.Join(dstDir, e.Name())); err != nil {
				return err
			}
		}
		return nil
	}
	dstDir := filepath.Dir(strings.Replace(srcPath, targetDir, globalDir, 1))
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}
	return copyFile(srcPath, filepath.Join(dstDir, filepath.Base(srcPath)))
}

// PushSingleResourceToInstance 推送单个文件/文件夹到整合包
func (a *App) PushSingleResourceToInstance(rtype, instanceName, filePath string) error {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return fmt.Errorf("请先设置游戏根目录")
	}
	subDir := types.SubDirMap(rtype)
	if subDir == "" {
		return fmt.Errorf("未知资源类型: %s", rtype)
	}
	instances := a.ListVersionInstances(cfg.McRoot)
	for _, ins := range instances {
		if ins.Name == instanceName {
			globalDir := a.GetRepoRoot(rtype)
			if globalDir == "" {
				return fmt.Errorf("未设置 %s 类型的仓库目录", rtype)
			}
			customDir := filepath.Join(ins.VersionDir, subDir)
			// 检查是否是文件夹（YSM json / MMD 的文件夹级资源）
			fi, stErr := os.Stat(filePath)
			if stErr == nil && fi.IsDir() {
				return installer.InstallDir(filePath, customDir, globalDir, a.LinkMode, rtype)
			}
			ext := strings.ToLower(filepath.Ext(filePath))
			if ext == ".json" || ext == ".pmx" || ext == ".pmd" {
				return installer.InstallDir(filepath.Dir(filePath), customDir, globalDir, a.LinkMode, rtype)
			}
			return installer.Install(filePath, customDir, globalDir, a.LinkMode)
		}
	}
	return fmt.Errorf("未找到整合包: %s", instanceName)
}

// ========== 整合包全类型同步状态 ==========

// GetInstanceSyncStatus 获取整合包下所有资源类型的同步状态（扁平列表）
func (a *App) GetInstanceSyncStatus(instanceName string) string {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return "[]"
	}

	// 加载资源类型注册表
	var registry struct {
		ResourceTypes []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			Icon string `json:"icon"`
		} `json:"resourceTypes"`
	}
	if data, err := os.ReadFile("resource_types.json"); err == nil {
		json.Unmarshal(data, &registry)
	}

	// 各资源类型允许的扩展名（防止跨类型混入如 .pmx 出现在 VRC 中）
	extMatch := func(name, rtype string) bool {
		exts := types.SupportedExtsForType(rtype)
		if len(exts) == 0 {
			return true
		}
		low := strings.ToLower(name)
		// 去掉 .disabled/.ban 后缀后再匹配
		base := strings.TrimSuffix(low, ".disabled")
		base = strings.TrimSuffix(base, ".ban")
		// YSM 的 .json 仅允许 ysm.json（其他是动作/动画文件，不应单独展示）
		if rtype == "ysm" && strings.HasSuffix(base, ".json") && base != "ysm.json" {
			return false
		}
		for _, e := range exts {
			if strings.HasSuffix(base, e) {
				return true
			}
		}
		return false
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
		return "[]"
	}

	// 子目录通过集中定义获取
	var items []types.ResourceSyncItem

	for _, rt := range registry.ResourceTypes {
		subDir := types.SubDirMap(rt.ID)
		if subDir == "" {
			continue
		}

		// 全局目录
		globalDir := a.GetRepoRoot(rt.ID)
		if globalDir == "" {
			continue
		}

		// 整合包子目录
		instDir := filepath.Join(targetIns.VersionDir, subDir)

		// 展示用文件级同步（推送时再用文件夹级推送）
		result := ysmsync.SyncResources(globalDir, instDir)

		// 收集大小信息
		sizeOf := func(path string) int64 {
			fi, err := os.Stat(path)
			if err != nil {
				return 0
			}
			return fi.Size()
		}
		for _, p := range result.Synced {
			if !extMatch(filepath.Base(p), rt.ID) {
				continue
			}
			// 检测是否有 .disabled/.ban 后缀标记禁用状态
			lowName := strings.ToLower(filepath.Base(p))
			isDisabled := strings.HasSuffix(lowName, ".disabled") || strings.HasSuffix(lowName, ".ban")
			status := types.SyncStatusSynced
			statusIcon := rt.Icon
			if isDisabled {
				status = types.SyncStatusDisabled
				statusIcon = "⛔"
			}
			items = append(items, types.ResourceSyncItem{
				Path:   p,
				Name:   filepath.Base(p),
				Status: status,
				Type:   rt.ID,
				Icon:   statusIcon,
				Size:   sizeOf(p),
			})
		}
		for _, p := range result.Missing {
			if !extMatch(filepath.Base(p), rt.ID) {
				continue
			}
			items = append(items, types.ResourceSyncItem{
				Path:   p,
				Name:   filepath.Base(p),
				Status: types.SyncStatusMissing,
				Type:   rt.ID,
				Icon:   rt.Icon,
				Size:   sizeOf(p),
			})
		}
		for _, p := range result.Extra {
			if !extMatch(filepath.Base(p), rt.ID) {
				continue
			}
			// 检测是否为硬链接（来自旧仓库的遗留文件）
			status := types.SyncStatusOptional
			icon := rt.Icon
			if ysmsync.GetLinkType(p) == types.LinkHard {
				status = types.SyncStatusLegacy
				icon = "🔗"
			}
			items = append(items, types.ResourceSyncItem{
				Path:   p,
				Name:   filepath.Base(p),
				Status: status,
				Type:   rt.ID,
				Icon:   icon,
				Size:   sizeOf(p),
			})
		}
		// 对于非模型类型（光影包/蓝图/材质包），额外扫描整合包目录中所有未被 SyncResources 覆盖的文件
		// （SyncResources 的 map 去重会丢失同名文件）
		if rt.ID == "shaderpack" || rt.ID == "create-blueprint" || rt.ID == "resourcepack" {
			extraNames := map[string]bool{}
			for _, p := range result.Extra {
				extraNames[strings.ToLower(filepath.Base(p))] = true
			}
			filepath.Walk(instDir, func(path string, info os.FileInfo, err error) error {
				if err != nil {
					return nil
				}
				if info.IsDir() {
					// 资源包文件夹（含 pack.mcmeta）
					if path != instDir && isResourcePackFolder(path) {
						low := strings.ToLower(info.Name())
						if !extraNames[low] {
							items = append(items, types.ResourceSyncItem{
								Path:   path,
								Name:   info.Name(),
								Status: types.SyncStatusOptional,
								Type:   rt.ID,
								Icon:   rt.Icon,
								Size:   0,
							})
						}
					}
					return nil
				}
				low := strings.ToLower(info.Name())
				if !strings.HasSuffix(low, ".zip") && !strings.HasSuffix(low, ".nbt") && !strings.HasSuffix(low, ".schematic") {
					return nil
				}
				if extraNames[low] {
					return nil
				}
				items = append(items, types.ResourceSyncItem{
					Path:   path,
					Name:   info.Name(),
					Status: types.SyncStatusOptional,
					Type:   rt.ID,
					Icon:   rt.Icon,
					Size:   info.Size(),
				})
				return nil
			})
		}
	}

	data, _ := json.Marshal(items)
	return string(data)
}

// ========== YSM 检测 ==========
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

// ========== 链接模式 ==========
func (a *App) SetLinkMode(mode string) error {
	mode = strings.TrimSpace(mode)
	if mode != "symlink" && mode != "hardlink" && mode != "copy" {
		return fmt.Errorf("无效的链接模式: %s", mode)
	}
	a.LinkMode = mode
	return nil
}

func (a *App) GetLinkMode() string {
	return a.LinkMode
}

// ========== 日志 ==========
func (a *App) AddImportLog(modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {
	a.logger.Add(modelName, sourcePath, targetDir, fileSize, status, errMsg)
}

func (a *App) GetImportLogs() []types.ImportLog {
	return a.logger.GetAll()
}

func (a *App) ClearImportLogs() {
	a.logger.Clear()
}
