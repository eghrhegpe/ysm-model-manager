// ========== 安装 + 回收站 ==========
// 从 app.go 拆分：模型安装/导入/回收站/去重
package app

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/importer"
	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/instance"
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
	err := installer.Install(src, customDir, a.ysmRoot(), a.LinkMode)
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

// SyncCustomToRepo 同步整合包自定义目录到仓库（执行逻辑下沉 go/sync）
func (a *App) SyncCustomToRepo(customDir, repoDir string) (int, error) {
	return ysmsync.SyncCustomToRepo(customDir, repoDir, a.ScanModelEntries, a.logger.Add)
}

func (a *App) ImportModelFile(fileName, base64Data string) error {
	return a.importModelFile(fileName, base64Data, false)
}

// DetectZipType 通过 ZIP 内容检测资源类型（供前端导入路由使用）
func (a *App) DetectZipType(base64Data string) string {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "unknown"
	}
	return importer.DetectZipType(data)
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

// importModelFileWithOptions 导入模型文件（校验+写文件核心下沉 go/importer）
func (a *App) importModelFileWithOptions(fileName, base64Data string, opts importOptions) error {
	return importer.ImportFromBase64(fileName, base64Data, importer.ImportOptions{
		SkipCheck: opts.skipCheck,
		Overwrite: opts.overwrite,
	}, func(rtype string) string {
		dir, _ := a.GetRepoRoot(rtype)
		return dir
	}, a.logger.Add)
}

func (a *App) ImportModelFileTo(fileName, subpath, base64Data string) error {
	return a.importModelFileWithSubpath(fileName, subpath, base64Data, false)
}

func (a *App) ImportModelFileOverwriteTo(fileName, subpath, base64Data string) error {
	return a.importModelFileWithSubpath(fileName, subpath, base64Data, true)
}

func (a *App) importModelFileWithSubpath(fileName, subpath, base64Data string, overwrite bool) error {
	root, _ := a.GetRepoRoot("ysm")
	if root == "" {
		return fmt.Errorf("请先设置文件存储路径")
	}
	ext := strings.ToLower(filepath.Ext(fileName))
	if !types.IsSupportedExt(ext) {
		return types.AppError{Code: "FILE_TYPE_UNSUPPORTED", Operation: "导入模型", SourcePath: fileName, Reason: "不支持的文件格式", Suggestion: "支持格式: " + strings.Join(types.AllExts(), " / ")}
	}
	// ysm 包内 json 白名单：.json 仅允许 ysm.json 入口清单（与 go/importer + go/scanner 对齐，ADR-038 D2）
	if ext == ".json" && !types.IsYsmEntryJSON(filepath.Base(fileName)) {
		return types.AppError{Code: "FILE_TYPE_UNSUPPORTED", Operation: "导入模型", SourcePath: fileName, Reason: "仅支持 ysm.json 清单文件", Suggestion: "YSM 包内 json 资源（geometry/animation/语言文件）不可单独导入，请导入 .ysm/.zip/.7z 或解压目录中的 ysm.json"}
	}
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return types.AppError{Code: "DECODE_FAILED", Operation: "导入模型", Reason: "Base64 解码失败", Suggestion: "文件可能已损坏，请重新下载"}
	}
	// 路径穿越防护（对齐 importer_file.go 契约）：
	// - subpath 允许嵌套目录（folder/sub 保持目录结构），逐段拒绝空/. /.. 段
	// - fileName 拒绝 .. 序列与路径分隔符（仅纯文件名）
	if subpath != "" {
		for _, seg := range strings.Split(strings.ReplaceAll(subpath, "\\", "/"), "/") {
			if seg == "" || seg == "." || seg == ".." {
				return types.AppError{Code: "INVALID_PATH", Operation: "导入模型", SourcePath: subpath, Reason: "非法子目录路径", Suggestion: "子目录仅支持纯目录名层级"}
			}
		}
	}
	if strings.Contains(fileName, "../") || strings.Contains(fileName, "..\\") || strings.HasSuffix(fileName, "..") {
		return types.AppError{Code: "FILENAME_INVALID", Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含路径穿越", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	if strings.ContainsAny(fileName, `\/`) {
		return types.AppError{Code: "FILENAME_INVALID", Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含非法路径分隔符", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	if len(data) > types.MaxImportSize {
		return types.AppError{Code: "FILE_TOO_LARGE", Operation: "导入模型", SourcePath: fileName, Reason: "文件大小超过 500MB 限制", Suggestion: "请压缩文件至 500MB 以内"}
	}
	if len(data) == 0 {
		return types.AppError{Code: "FILE_EMPTY", Operation: "导入模型", SourcePath: fileName, Reason: "文件内容为空", Suggestion: "请检查文件是否损坏"}
	}
	destPath := filepath.Join(root, subpath, fileName)
	destDir := filepath.Dir(destPath)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return types.AppError{Code: "MKDIR_FAILED", Operation: "导入模型", TargetPath: destDir, Reason: "无法创建目标目录", Suggestion: "请检查磁盘权限或空间"}
	}
	if !overwrite {
		if _, err := os.Stat(destPath); err == nil {
			return types.AppError{Code: "FILE_EXISTS", Operation: "导入模型", SourcePath: fileName, Reason: "文件已存在", Suggestion: "如需替换请先删除原文件"}
		}
	}
	// P2 修复（code_review）：subpath 导入路径复用 importer.WriteFileAtomic——原 `os.WriteFile`
	// 直写目标，磁盘满/IO 中断留半截文件且非覆盖模式再次导入命中 FILE_EXISTS 死锁；
	// 与 ImportFromBase64 的原子写入语义保持一致
	return importer.WriteFileAtomic(destPath, data)
}

// ========== 回收站 ==========
func (a *App) MoveToRecycle(src string) error {
	// 尝试所有可能的资源根目录，找到包含 src 的那个
	root := a.findRecycleRoot(src)
	if root == "" {
		root = a.ysmRoot()
	}
	// P2 修复（根级守卫对齐）：src 等于资源根本身时拒绝——findRecycleRoot 对 rel=="."
	// 判命中 + recycle.IsInside 对 path==root 放行 → 整仓库移入 .recycle（可恢复但误操作面大）；
	// fallback 到 ysmRoot 后 Clean 相等同样拒绝。
	// P3 修复（code_review）：EqualFold 大小写不敏感比较（对齐 paths.IsInside 的 Windows 语义，
	// 防大小写不同的根输入绕过守卫）
	if strings.EqualFold(filepath.Clean(src), filepath.Clean(root)) {
		return fmt.Errorf("不能把资源根目录整体移入回收站")
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
		a.ysmRoot(),
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
		if err != nil {
			continue
		}
		// P2 修复：与 isPathInRoot 根拒绝对齐——rel=="."（src 即根）不得判命中，
		// 精确段比较替代裸 HasPrefix（..foo 合法目录不误拒）
		if rel == "." || rel == ".." {
			continue
		}
		sep := string(filepath.Separator)
		if strings.HasPrefix(rel, ".."+sep) {
			continue
		}
		return r
	}
	return ""
}

func (a *App) ClearCustomDir(customDir string) (int, error) {
	customDir = strings.TrimSpace(customDir)
	if customDir == "" {
		return 0, fmt.Errorf("目录为空")
	}
	// P2 修复：补根守卫——原实现对任意 customDir 直接 WalkDir + os.Remove，
	// 可删仓库外任意 .ysm/.zip/.7z（仅限与仓库同名的文件）
	// 根级（customDir == ysmRoot）由 isPathInRoot 的 rel=="." 拒绝覆盖（2026-08-09 P1 修复）——
	// 该函数已拒绝根路径本身，customDir==ysmRoot 时返回「路径超出仓库目录」
	if !a.isPathInRoot(customDir) {
		return 0, fmt.Errorf("路径超出仓库目录")
	}

	repoFiles := a.ScanModelEntries(a.ysmRoot())
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
// 只统计仓库中已有的文件（同 clearInstanceDir 逻辑）
// rtype 为空时统计全部类型，否则只统计指定类型
func (a *App) CountInstanceResources(insName, rtype string) (int, error) {
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
		if rtype != "" && d.RType != rtype {
			continue
		}
		dir := types.FindInstDir(target.VersionDir, d.SubDir, d.RType)
		repoRoot, _ := a.GetRepoRoot(d.RType)
		if repoRoot == "" {
			continue
		}
		total += a.countMatchingInDir(dir, repoRoot)
	}
	return total, nil
}

// ClearInstanceResources 清空指定整合包中已同步的文件
// insName: 整合包名, rtype: 资源类型（空=全部, 非空=只清此类型）
// 返回清除的文件数量。整合包文件是仓库的副本/链接，删除后可从仓库重新推送恢复；
// 实例文件在仓库根内才移回收站，其余直接删除（见 clearInstanceDir）
func (a *App) ClearInstanceResources(insName, rtype string) (int, error) {
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

	// 先统计数量
	total := 0
	for _, d := range types.AllSubDirs() {
		if rtype != "" && d.RType != rtype {
			continue
		}
		dir := types.FindInstDir(target.VersionDir, d.SubDir, d.RType)
		total += a.countInstanceDir(dir)
	}
	if total == 0 {
		return 0, nil
	}
	// 实际删除——每种类型传入对应的仓库根目录用于比对
	for _, d := range types.AllSubDirs() {
		if rtype != "" && d.RType != rtype {
			continue
		}
		dir := types.FindInstDir(target.VersionDir, d.SubDir, d.RType)
		repoRoot, _ := a.GetRepoRoot(d.RType)
		total = a.clearInstanceDir(dir, d.RType, repoRoot)
	}
	return total, nil
}

// countInstanceDir 递归统计指定目录中的文件数（不限扩展名）
func (a *App) countInstanceDir(dir string) int {
	return fsutil.CountFiles(dir, true)
}

// countMatchingInDir 统计实例目录中与仓库同名的文件数（仅用于清空提示）
func (a *App) countMatchingInDir(instDir, repoRoot string) int {
	repoFiles := make(map[string]bool)
	for _, p := range fsutil.WalkAllFiles(repoRoot, true) {
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
func (a *App) clearInstanceDir(dir string, rtype string, repoRoot string) int {
	return recycle.CleanInstanceDir(dir, repoRoot, a.ysmRoot())
}

// DeduplicateCustomDir 按 SHA256 哈希去重（执行逻辑下沉 go/recycle）
func (a *App) DeduplicateCustomDir(customDir string) (int, int, error) {
	customDir = strings.TrimSpace(customDir)
	if customDir == "" {
		return 0, 0, fmt.Errorf("目录为空")
	}

	entries := a.ScanModelEntries(customDir)
	if len(entries) == 0 {
		return 0, 0, nil
	}

	removed, kept := recycle.DeduplicateEntries(entries, a.ysmRoot(), a.logger.Add)
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
	return recycle.Delete(src, a.ysmRoot())
}

func (a *App) EmptyRecycleBin(_ string) (int, error) {
	cfg := a.LoadAppConfig()
	total := 0
	failed := []string{}
	for _, r := range a.allRecycleRoots(cfg) {
		n, err := recycle.Empty(r)
		if err != nil {
			failed = append(failed, r)
			continue
		}
		total += n
	}
	if len(failed) > 0 {
		return total, fmt.Errorf("%d 个资源目录清空失败: %s", len(failed), strings.Join(failed, ", "))
	}
	return total, nil
}

// allRecycleRoots 返回所有配置了路径的资源根目录
// 注意：回收站统一使用 RepoRoot/.recycle，McRoot 等游戏目录不参与回收站管理
func (a *App) allRecycleRoots(cfg types.AppConfig) []string {
	roots := []string{
		a.ysmRoot(),
		cfg.ResourcepackRoot,
		cfg.ShaderpackRoot,
		cfg.SchematicRoot,
		cfg.MmdRoot,
		cfg.VrcRoot,
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
	// 扫描日志带类型标签（YSM），与前端术语一致
	label := "模型"
	if rt := types.RegistryType("ysm"); rt != nil {
		label = rt.Name
	}
	scanFn := func(dir string) []types.ModelEntry { return a.ScanModelEntriesWithLabel(dir, label) }
	return ysmsync.GetInstanceStatus(mcRoot, repoDir, scanFn)
}

// GetResourceInstanceStatus 按资源类型获取整合包同步状态
// repoDir 仅对 YSM 类型生效（其他类型从全局资源目录推导）
func (a *App) GetResourceInstanceStatus(rtype, mcRoot, repoDir string) []types.InstanceStatus {
	if mcRoot == "" || rtype == "" {
		return []types.InstanceStatus{}
	}
	// 扫描日志带类型标签，与前端术语一致
	label := ""
	if rt := types.RegistryType(rtype); rt != nil {
		label = rt.Name
	}
	scanFn := func(dir string) []types.ModelEntry { return a.ScanModelEntriesWithLabel(dir, label) }
	// YSM 走原有逻辑（对比 repo 和 custom 目录）
	if rtype == "ysm" {
		if repoDir == "" {
			repoDir, _ = a.GetRepoRoot("ysm")
		}
		if repoDir == "" {
			return []types.InstanceStatus{}
		}
		results := ysmsync.GetInstanceStatus(mcRoot, repoDir, scanFn)
		for i := range results {
			modsDir := filepath.Join(results[i].CustomDir, "..", "..", "..", "mods")
			results[i].HasMod = ysm.HasModInDir(modsDir, rtype)
		}
		return results
	}

	// 其他资源类型：使用下沉的哈希对比逻辑
	globalDir, _ := a.GetRepoRoot(rtype)
	if globalDir == "" {
		return []types.InstanceStatus{}
	}
	subDir := types.SubDirMap(rtype)
	if subDir == "" {
		return []types.InstanceStatus{}
	}
	return ysmsync.CompareGlobalInstanceHashes(mcRoot, globalDir, subDir, rtype,
		scanFn, ysmsync.ListVersions,
		func(modsDir string) bool { return ysm.HasModInDir(modsDir, rtype) })
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
// relinkDir 按哈希比对重链接实例目录（执行逻辑下沉 go/sync）
func (a *App) relinkDir(customDir, repoRoot, rtype string) (int, error) {
	return ysmsync.RelinkDir(customDir, repoRoot, rtype, a.LinkMode, a.ScanModelEntries, a.logger.Add)
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
		globalDir, _ := a.GetRepoRoot(d.RType)
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
	globalDir, _ := a.GetRepoRoot(rtype)
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
// PushResourceToInstance 推送缺失资源到整合包（执行循环下沉 go/sync）
func (a *App) PushResourceToInstance(rtype, instanceName string) (int, error) {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return 0, fmt.Errorf("请先设置游戏根目录")
	}
	globalDir, _ := a.GetRepoRoot(rtype)
	if globalDir == "" {
		return 0, fmt.Errorf("未设置%s目录", rtype)
	}

	targetDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil {
		return 0, err
	}
	return ysmsync.PushResources(rtype, globalDir, targetDir, a.LinkMode, a.logger.Add)
}

// PullResourceFromInstance 拉取整合包多余资源回仓库（执行循环下沉 go/sync）
func (a *App) PullResourceFromInstance(rtype, instanceName string) (int, error) {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return 0, fmt.Errorf("请先设置游戏根目录")
	}
	globalDir, _ := a.GetRepoRoot(rtype)
	if globalDir == "" {
		return 0, fmt.Errorf("未设置%s目录", rtype)
	}

	targetDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil {
		return 0, err
	}
	return ysmsync.PullResources(rtype, globalDir, targetDir, a.logger.Add)
}

// findInstanceDir 解析整合包实例的资源类型子目录（Push/Pull 共用）
func (a *App) findInstanceDir(rtype, instanceName, mcRoot string) (string, error) {
	instances := a.ListVersionInstances(mcRoot)
	for _, ins := range instances {
		if ins.Name == instanceName {
			subDir := types.SubDirMap(rtype)
			if subDir == "" {
				return "", fmt.Errorf("未知资源类型: %s", rtype)
			}
			return filepath.Join(ins.VersionDir, subDir), nil
		}
	}
	return "", fmt.Errorf("未找到整合包: %s", instanceName)
}

// PullSingleResourceFromInstance 从整合包拉取单个 extra 文件/文件夹到全局仓库
// PullSingleResourceFromInstance 从整合包拉取单个资源（复制核心下沉 go/sync）
func (a *App) PullSingleResourceFromInstance(rtype, srcPath, instanceName string) error {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return fmt.Errorf("请先设置游戏根目录")
	}
	globalDir, _ := a.GetRepoRoot(rtype)
	if globalDir == "" {
		return fmt.Errorf("未设置目录")
	}
	targetDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil {
		return err
	}
	return ysmsync.PullSingleResource(globalDir, targetDir, srcPath)
}

// PushSingleResourceToInstance 推送单个资源到整合包（分派核心下沉 go/sync）
func (a *App) PushSingleResourceToInstance(rtype, instanceName, filePath string) error {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return fmt.Errorf("请先设置游戏根目录")
	}
	globalDir, _ := a.GetRepoRoot(rtype)
	if globalDir == "" {
		return fmt.Errorf("未设置 %s 类型的仓库目录", rtype)
	}
	customDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil {
		return err
	}
	return ysmsync.PushSingleResource(filePath, customDir, globalDir, a.LinkMode, rtype)
}

// ========== 整合包全类型同步状态 ==========

// GetInstanceSyncStatus 获取整合包下所有资源类型的同步状态（扁平列表）
// GetInstanceSyncStatus 整合包同步状态（组装逻辑已下沉 go/instance，此处仅注入依赖）
func (a *App) GetInstanceSyncStatus(instanceName string) string {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return "[]"
	}

	// 加载资源类型注册表
	var registry struct {
		ResourceTypes []instance.ResourceTypeInfo `json:"resourceTypes"`
	}
	if data, err := loadBundledData("resource_types.json"); err == nil {
		_ = json.Unmarshal(data, &registry)
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

	// 收集各资源类型的仓库根目录
	roots := map[string]string{}
	for _, rt := range registry.ResourceTypes {
		roots[rt.ID], _ = a.GetRepoRoot(rt.ID)
	}

	items := instance.BuildSyncItems(targetIns, registry.ResourceTypes, roots)
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
	cfg := a.LoadAppConfig()
	if cfg.LinkMode == mode {
		return nil
	}
	cfg.LinkMode = mode
	if err := a.saveConfig(cfg); err != nil {
		return err
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

func (a *App) AddOpLog(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {
	a.logger.AddOp(op, modelName, sourcePath, targetDir, fileSize, status, errMsg)
}

func (a *App) GetImportLogs() []types.ImportLog {
	return a.logger.GetAll()
}

func (a *App) ClearImportLogs() {
	a.logger.Clear()
}

// GetRuntimeLogs 获取运行时日志（watcher/sync 等标准库 log 输出）
func (a *App) GetRuntimeLogs() []types.RuntimeLog {
	return a.runtimeLogs.GetAll()
}

// ClearRuntimeLogs 清空运行时日志缓冲
func (a *App) ClearRuntimeLogs() {
	a.runtimeLogs.Clear()
}
