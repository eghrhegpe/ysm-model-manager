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
	"ysm-model-manager/go/recycle"
	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
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
	if a.RepoRoot == "" {
		return fmt.Errorf("请先选择仓库目录")
	}
	if strings.Contains(fileName, "..") || strings.ContainsAny(fileName, "\\/") {
		return types.AppError{Code: "FILENAME_INVALID", Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含非法路径分隔符", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	ext := strings.ToLower(filepath.Ext(fileName))
	if ext != ".ysm" && ext != ".zip" && ext != ".7z" {
		return types.AppError{Code: "FILE_TYPE_UNSUPPORTED", Operation: "导入模型", SourcePath: fileName, Reason: "不支持的文件格式", Suggestion: "仅支持 .ysm / .zip / .7z 格式"}
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
	if !skipCheck && len(data) >= 4 {
		if ext == ".zip" || ext == ".ysm" {
			if data[0] != 0x50 || data[1] != 0x4B || data[2] != 0x03 || data[3] != 0x04 {
				a.logger.Add(fileName, fileName, a.RepoRoot, 0, "warn", "文件头不匹配标准ZIP格式，可能为旧版或非标准YSM文件，已导入")
			}
		} else if ext == ".7z" {
			if data[0] != 0x37 || data[1] != 0x7A || data[2] != 0xBC || data[3] != 0xAF {
				a.logger.Add(fileName, fileName, a.RepoRoot, 0, "warn", "文件头不匹配标准7z格式，已导入")
			}
		}
	}
	destPath := filepath.Join(a.RepoRoot, fileName)
	destDir := filepath.Dir(destPath)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return types.AppError{Code: "MKDIR_FAILED", Operation: "导入模型", TargetPath: destDir, Reason: "无法创建目标目录", Suggestion: "请检查磁盘权限或空间"}
	}
	if _, err := os.Stat(destPath); err == nil {
		return types.AppError{Code: "FILE_EXISTS", Operation: "导入模型", SourcePath: fileName, Reason: "文件已存在", Suggestion: "如需替换请先删除原文件"}
	}
	return os.WriteFile(destPath, data, 0644)
}

func (a *App) ImportModelFileOverwrite(fileName, base64Data string) error {
	if a.RepoRoot == "" {
		return fmt.Errorf("请先选择仓库目录")
	}
	if strings.Contains(fileName, "..") || strings.ContainsAny(fileName, "\\/") {
		return types.AppError{Code: "FILENAME_INVALID", Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含非法路径分隔符", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	ext := strings.ToLower(filepath.Ext(fileName))
	if ext != ".ysm" && ext != ".zip" && ext != ".7z" {
		return types.AppError{Code: "FILE_TYPE_UNSUPPORTED", Operation: "导入模型", SourcePath: fileName, Reason: "不支持的文件格式", Suggestion: "仅支持 .ysm / .zip / .7z 格式"}
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
	destPath := filepath.Join(a.RepoRoot, fileName)
	destDir := filepath.Dir(destPath)
	os.MkdirAll(destDir, 0755)
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
	if ext != ".ysm" && ext != ".zip" && ext != ".7z" {
		return types.AppError{Code: "FILE_TYPE_UNSUPPORTED", Operation: "导入模型", SourcePath: fileName, Reason: "不支持的文件格式", Suggestion: "仅支持 .ysm / .zip / .7z 格式"}
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
	return recycle.Move(src, a.RepoRoot)
}

func (a *App) MoveToRecycleEx(src string) (string, string) {
	if a.RepoRoot == "" {
		return "error", "仓库根目录未设置"
	}
	res := recycle.MoveEx(src, a.RepoRoot)
	return res.Action, res.Reason
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

func (a *App) ListRecycleBin(repoRoot string) []types.ModelEntry {
	return recycle.List(repoRoot)
}

func (a *App) RestoreFromRecycle(src, repoRoot string) error {
	return recycle.Restore(src, repoRoot)
}

func (a *App) DeleteFromRecycle(src string) error {
	return recycle.Delete(src, a.RepoRoot)
}

func (a *App) EmptyRecycleBin(repoRoot string) (int, error) {
	return recycle.Empty(repoRoot)
}

// ========== 状态同步 ==========
func (a *App) GetInstanceStatus(mcRoot, repoDir string) []types.InstanceStatus {
	return ysmsync.GetInstanceStatus(mcRoot, repoDir, a.ScanModelEntries)
}

func (a *App) SyncModelToggleStatus(instanceCustomDir, repoRoot string) (int, int, error) {
	return ysmsync.SyncToggleStatus(instanceCustomDir, repoRoot, a.ScanModelEntries)
}

func (a *App) RelinkCustomDir(customDir, repoRoot string) (int, error) {
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
		if err := os.Remove(ce.Path); err != nil {
			continue
		}
		if err := installer.Install(srcPath, filepath.Dir(ce.Path), repoRoot, a.LinkMode); err != nil {
			continue
		}
		count++
	}
	return count, nil
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
			// 根据资源类型拼接子目录
			var subDir string
			switch rtype {
			case "resourcepack":
				subDir = "resourcepacks"
			case "shaderpack":
				subDir = "shaderpacks"
			case "create-blueprint":
				subDir = "schematics"
			case "mmd-skin":
				subDir = "3d-skin/EntityPlayer"
			case "vrchat-avatar":
				subDir = "vrchat-avatars"
			default:
				subDir = ""
			}
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
			var subDir string
			switch rtype {
			case "resourcepack":
				subDir = "resourcepacks"
			case "shaderpack":
				subDir = "shaderpacks"
			case "create-blueprint":
				subDir = "schematics"
			case "mmd-skin":
				subDir = "3d-skin/EntityPlayer"
			case "vrchat-avatar":
				subDir = "vrchat-avatars"
			default:
				subDir = ""
			}
			if subDir != "" {
				targetDir = filepath.Join(ins.VersionDir, subDir)
			}
			break
		}
	}
	if targetDir == "" {
		return 0, fmt.Errorf("未找到整合包: %s", instanceName)
	}

	// 找出 missing 的文件并复制
	result := ysmsync.SyncResources(globalDir, targetDir)
	count := 0
	for _, src := range result.Missing {
		dstDir := filepath.Dir(strings.Replace(src, globalDir, targetDir, 1))
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
			var subDir string
			switch rtype {
			case "resourcepack":
				subDir = "resourcepacks"
			case "shaderpack":
				subDir = "shaderpacks"
			case "create-blueprint":
				subDir = "schematics"
			case "mmd-skin":
				subDir = "3d-skin/EntityPlayer"
			case "vrchat-avatar":
				subDir = "vrchat-avatars"
			default:
				subDir = ""
			}
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
	result := ysmsync.SyncResources(globalDir, targetDir)
	count := 0
	for _, src := range result.Extra {
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
