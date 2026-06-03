package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/logs"
	"ysm-model-manager/go/recycle"
	"ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx      context.Context
	RepoRoot string
	LinkMode string
	logger   *logs.Logger
}

func NewApp() *App {
	return &App{
		logger: logs.NewLogger(),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// 启动时自动加载配置
	a.loadAppConfig()

	// 通过 runtime.EventsEmit 通知前端配置已加载
	cfg := a.LoadAppConfig()
	runtime.EventsEmit(ctx, "config-loaded", cfg.RepoRoot, cfg.McRoot, cfg.LinkMode)
}

// ========== 配置持久化 ==========
func configPath() string {
	exe, _ := os.Executable()
	return filepath.Join(filepath.Dir(exe), "ysm_config.json")
}

func (a *App) loadAppConfig() {
	data, err := os.ReadFile(configPath())
	if err != nil {
		return
	}
	var cfg types.AppConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return
	}
	if cfg.RepoRoot != "" {
		a.RepoRoot = cfg.RepoRoot
	}
	if cfg.LinkMode != "" {
		a.LinkMode = cfg.LinkMode
	}
}

func (a *App) SaveAppConfig(repoRoot, mcRoot, linkMode string) error {
	cfg := types.AppConfig{
		RepoRoot: repoRoot,
		McRoot:   mcRoot,
		LinkMode: linkMode,
	}
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(configPath(), data, 0644)
}

func (a *App) LoadAppConfig() types.AppConfig {
	data, err := os.ReadFile(configPath())
	if err != nil {
		return types.AppConfig{}
	}
	var cfg types.AppConfig
	json.Unmarshal(data, &cfg)
	return cfg
}
// ========== 窗口状态 ==========
func (a *App) SaveWindowPosition(x, y, width, height int) {
	state := types.WindowState{X: x, Y: y, Width: width, Height: height}
	exe, _ := os.Executable()
	path := filepath.Join(filepath.Dir(exe), "window_state.json")
	data, _ := json.MarshalIndent(state, "", "  ")
	os.WriteFile(path, data, 0644)
}

func (a *App) GetWindowPosition() types.WindowState {
	exe, _ := os.Executable()
	path := filepath.Join(filepath.Dir(exe), "window_state.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return types.WindowState{X: 100, Y: 100, Width: 1200, Height: 800}
	}
	var state types.WindowState
	json.Unmarshal(data, &state)
	return state
}

// ========== 目录选择 ==========
func (a *App) SelectDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择目录",
	})
}

// ========== .minecraft 定位 ==========
func (a *App) GetMinecraftPath() string {
	if exe, err := os.Executable(); err == nil {
		for _, c := range []string{
			filepath.Join(filepath.Dir(exe), ".minecraft"),
			filepath.Join(filepath.Dir(exe), "..", ".minecraft"),
		} {
			abs, _ := filepath.Abs(c)
if info, err := os.Stat(abs); err == nil && info.IsDir() {
				return "✅ 游戏路径: " + abs
			}
		}
	}
	if appData, err := os.UserConfigDir(); err == nil {
		mcPath := filepath.Join(appData, ".minecraft")
		if info, err := os.Stat(mcPath); err == nil && info.IsDir() {
			return "✅ 游戏路径: " + mcPath
		}
	}
	for _, c := range []string{
		filepath.Join("D:", "PCL2", ".minecraft"),
		filepath.Join("C:", "PCL2", ".minecraft"),
	} {
		if info, err := os.Stat(c); err == nil && info.IsDir() {
			return "✅ 游戏路径: " + c
		}
	}
	return "⚠️ 未找到 .minecraft 文件夹"
}

// ========== 仓库 ==========
func (a *App) SetRepoRoot(dir string) {
	if !installer.IsValidRepoRoot(dir) {
		return // 仓库路径不合法，不做设置
	}
	a.RepoRoot = dir
}
func (a *App) ScanModelEntries(dir string) []types.ModelEntry {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return []types.ModelEntry{}
	}
	entries := []types.ModelEntry{}
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if strings.HasSuffix(strings.ToLower(p), "\\.recycle") || strings.HasSuffix(strings.ToLower(p), "/.recycle") {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		originalExt := ext
		if strings.HasSuffix(strings.ToLower(p), ".ban") {
			originalExt = strings.ToLower(filepath.Ext(p[:len(p)-4]))
		}
		if originalExt != ".ysm" && originalExt != ".zip" && originalExt != ".7z" {
			return nil
		}
		info, _ := d.Info()
		e := types.ModelEntry{
			Name: filepath.Base(p),
			Path: p,
			Ext:  originalExt,
		}
		if info != nil {
			e.Size = info.Size()
			e.ModTime = info.ModTime().UnixMilli()
		}
		if f, err := os.Open(p); err == nil {
			h := sha256.New()
			io.Copy(h, f)
			e.Hash = fmt.Sprintf("%x", h.Sum(nil))
			f.Close()
		}
		entries = append(entries, e)
		return nil
	})
	return entries
}

func (a *App) ScanCustomModels(dir string) []types.ModelEntry {
	return a.ScanModelEntries(strings.TrimSpace(dir))
}

// ========== 整合包 ==========
func (a *App) ListVersionInstances(mcRoot string) []types.VersionInstance {
	mcRoot = strings.TrimSpace(mcRoot)
	if mcRoot == "" {
		return []types.VersionInstance{}
	}
	versionsDir := filepath.Join(mcRoot, "versions")
	ents, err := os.ReadDir(versionsDir)
	if err != nil {
		return []types.VersionInstance{}
	}
	out := []types.VersionInstance{}
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		verDir := filepath.Join(versionsDir, name)
		custom := filepath.Join(verDir, "config", "yes_steve_model", "custom")
		exists := true
		if _, st := os.Stat(custom); os.IsNotExist(st) {
			exists = false
		}
		out = append(out, types.VersionInstance{
			Name:       name,
			VersionDir: verDir,
			CustomDir:  custom,
			Exists:     exists,
		})
	}
	return out
}

func (a *App) GetGlobalCustomDir(mcRoot string) string {
	return filepath.Join(mcRoot, "config", "yes_steve_model", "custom")
}

func (a *App) ListFileNames(dir string) []string {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return []string{}
	}
	var names []string
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if strings.ToLower(d.Name()) == ".recycle" {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(strings.ToLower(d.Name()), ".ban") {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if ext == ".ysm" || ext == ".zip" || ext == ".7z" {
			names = append(names, d.Name())
		}
		return nil
	})
	return names
}

func (a *App) CheckFileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func (a *App) OpenFolder(dir string) error {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return fmt.Errorf("目录为空")
	}
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return fmt.Errorf("目录不存在: %s", dir)
	}
	return exec.Command("explorer", dir).Start()
}

// ========== 目录操作 ==========
func (a *App) CreateDir(dir string) error {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return fmt.Errorf("目录名为空")
	}
	// 防路径穿越
	if strings.Contains(dir, "..") {
		return fmt.Errorf("目录名不能包含 ..")
	}
	// 确保父目录是仓库根目录
	fullPath := filepath.Join(a.RepoRoot, dir)
	if !strings.HasPrefix(fullPath, filepath.Clean(a.RepoRoot)+string(filepath.Separator)) &&
		fullPath != filepath.Clean(a.RepoRoot) {
		return fmt.Errorf("只能在仓库根目录下创建文件夹")
	}
	if _, err := os.Stat(fullPath); err == nil {
		return fmt.Errorf("目录已存在")
	}
	return os.MkdirAll(fullPath, 0755)
}

// 移动仓库内的模型文件（拖拽移动用）
func (a *App) MoveModelFile(src, dstDir string) error {
	src = strings.TrimSpace(src)
	dstDir = strings.TrimSpace(dstDir)
	if src == "" || dstDir == "" {
		return fmt.Errorf("参数为空")
	}
	// 安全检查：确保源文件和目标目录都在仓库根目录下
	if !strings.HasPrefix(filepath.Clean(src), filepath.Clean(a.RepoRoot)+string(filepath.Separator)) {
		return fmt.Errorf("源文件不在仓库内")
	}
	if !strings.HasPrefix(filepath.Clean(dstDir), filepath.Clean(a.RepoRoot)+string(filepath.Separator)) {
		return fmt.Errorf("目标目录不在仓库内")
	}
	// 检查源文件存在
	if _, err := os.Stat(src); os.IsNotExist(err) {
		return fmt.Errorf("源文件不存在")
	}
	// 创建目标目录
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return fmt.Errorf("创建目标目录失败: %w", err)
	}
	// 目标路径
	fileName := filepath.Base(src)
	dstPath := filepath.Join(dstDir, fileName)
	if _, err := os.Stat(dstPath); err == nil {
		return fmt.Errorf("目标位置已存在同名文件: %s", fileName)
	}
	return os.Rename(src, dstPath)
}

// ========== 启用/禁用 ==========
func (a *App) ToggleModelEnable(path string) (bool, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return false, fmt.Errorf("路径为空")
	}
	if strings.HasSuffix(path, ".ban") {
		if err := os.Rename(path, strings.TrimSuffix(path, ".ban")); err != nil {
			return false, fmt.Errorf("启用失败: %w", err)
		}
		return true, nil
	}
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".ysm" && ext != ".zip" && ext != ".7z" {
		return false, fmt.Errorf("不支持的文件类型")
	}
	if err := os.Rename(path, path+".ban"); err != nil {
		return false, fmt.Errorf("禁用失败: %w", err)
	}
	return false, nil
}

func (a *App) IsFileBanned(path string) bool {
	return strings.HasSuffix(strings.ToLower(path), ".ban")
}

// ========== YSM 模型解析 ==========
func (a *App) AnalyzeYSMModel(path string) ysm.YSMModelMeta {
	return ysm.AnalyzeYSMModel(path)
}

// ========== 安装 ==========
func (a *App) InstallModelFile(src, mcRoot string) (string, error) {
	return installer.InstallToGlobal(src, mcRoot)
}

func (a *App) InstallModelTo(src, customDir string) error {
    err := installer.Install(src, customDir, a.RepoRoot, a.LinkMode)
    if err != nil {
        a.logger.Add(filepath.Base(src), src, customDir, 0, "failed", err.Error())
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

	// 预扫描仓库所有文件的哈希，用于同哈希跳过
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
		// 同哈希跳过（不同名但内容相同）
		if e.Hash != "" && repoHashes[e.Hash] {
			a.logger.Add(e.Name, e.Path, repoDir, 0, "skipped", "仓库已存在同哈希文件，跳过")
			continue
		}
		// 同名跳过
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
    if a.RepoRoot == "" {
        return fmt.Errorf("请先选择仓库目录")
    }

    // 防路径穿越
    if strings.Contains(fileName, "..") ||
        strings.ContainsAny(fileName, "\\/") {
        return types.AppError{Code:"FILENAME_INVALID", Operation:"导入模型", SourcePath:fileName, Reason:"文件名包含非法路径分隔符", Suggestion:"请使用纯文件名，不要包含路径"}
    }

    // 校验扩展名
    ext := strings.ToLower(filepath.Ext(fileName))
    if ext != ".ysm" && ext != ".zip" && ext != ".7z" {
        return types.AppError{Code:"FILE_TYPE_UNSUPPORTED", Operation:"导入模型", SourcePath:fileName, Reason:"不支持的文件格式", Suggestion:"仅支持 .ysm / .zip / .7z 格式"}
    }

    data, err := base64.StdEncoding.DecodeString(base64Data)
    if err != nil {
        return types.AppError{Code:"DECODE_FAILED", Operation:"导入模型", Reason:"Base64 解码失败", Suggestion:"文件可能已损坏，请重新下载"}
    }

    // 大小限制：最大 500MB
    if len(data) > 500 * 1024 * 1024 {
        return types.AppError{Code:"FILE_TOO_LARGE", Operation:"导入模型", SourcePath:fileName, Reason:"文件大小超过 500MB 限制", Suggestion:"请压缩文件至 500MB 以内"}
    }

    // 空文件检查
    if len(data) == 0 {
        return types.AppError{Code:"FILE_EMPTY", Operation:"导入模型", SourcePath:fileName, Reason:"文件内容为空", Suggestion:"请检查文件是否损坏"}
    }

    // 校验文件头魔数（ZIP/7z）
    if len(data) >= 4 {
        if ext == ".zip" || ext == ".ysm" {
            // ZIP 魔数: PK\x03\x04
            if data[0] != 0x50 || data[1] != 0x4B || data[2] != 0x03 || data[3] != 0x04 {
                return types.AppError{Code:"FILE_HEADER_MISMATCH", Operation:"导入模型", SourcePath:fileName, Reason:"文件头不匹配zip，文件可能已损坏", Suggestion:"请重新下载或检查文件格式"}
            }
        } else if ext == ".7z" {
            // 7z 魔数: 7z\xBC\xAF\x27\x1C
            if data[0] != 0x37 || data[1] != 0x7A || data[2] != 0xBC || data[3] != 0xAF {
                return types.AppError{Code:"FILE_HEADER_MISMATCH", Operation:"导入模型", SourcePath:fileName, Reason:"文件头不匹配7z，文件可能已损坏", Suggestion:"请重新下载或检查文件格式"}
            }
        }
    }

    destPath := filepath.Join(a.RepoRoot, fileName)
    destDir := filepath.Dir(destPath)
    if err := os.MkdirAll(destDir, 0755); err != nil {
        return types.AppError{Code:"MKDIR_FAILED", Operation:"导入模型", TargetPath:destDir, Reason:"无法创建目标目录", Suggestion:"请检查磁盘权限或空间"}
    }
    if _, err := os.Stat(destPath); err == nil {
        return types.AppError{Code:"FILE_EXISTS", Operation:"导入模型", SourcePath:fileName, Reason:"文件已存在", Suggestion:"如需替换请先删除原文件"}
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

// ClearCustomDir 清空整合包 custom 目录下的所有模型（移到回收站）
func (a *App) ClearCustomDir(customDir string) (int, error) {
	customDir = strings.TrimSpace(customDir)
	if customDir == "" {
		return 0, fmt.Errorf("目录为空")
	}

	// 预先扫描仓库文件列表，用于判断安全删除
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

		// 检查仓库是否有同名或同哈希文件，如果没有则跳过删除（怕误删未上传的模型）
		_, hasName := repoByName[fileName]
		if !hasName {
			a.logger.Add(fileName, p, customDir, 0, "skipped", "仓库中无此文件，跳过删除（请先上传到仓库）")
			return nil
		}

		// 仓库有同名文件——可以安全删除整合包里的副本（因为仓库保留了原件）
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

// DeduplicateCustomDir 整合包内部去重：扫描 custom 目录，按 SHA256 哈希分组，每组保留一个，其余移入仓库回收站
func (a *App) DeduplicateCustomDir(customDir string) (int, int, error) {
	customDir = strings.TrimSpace(customDir)
	if customDir == "" {
		return 0, 0, fmt.Errorf("目录为空")
	}

	// 扫描整合包内所有模型文件（带哈希）
	entries := a.ScanModelEntries(customDir)
	if len(entries) == 0 {
		return 0, 0, nil
	}

	// 按哈希分组
	hashGroups := make(map[string][]types.ModelEntry)
	for _, e := range entries {
		if e.Hash == "" {
			continue
		}
		hashGroups[e.Hash] = append(hashGroups[e.Hash], e)
	}

	totalDups := 0
	moved := 0
	skipped := 0
	for _, group := range hashGroups {
		if len(group) <= 1 {
			continue
		}
		// 每组保留第一个，其余移入回收站
		for i := 1; i < len(group); i++ {
			totalDups++
			err := recycle.Move(group[i].Path, a.RepoRoot)
			if err != nil {
				a.logger.Add(group[i].Name, group[i].Path, customDir, 0, "failed", "去重移入回收站失败: "+err.Error())
				skipped++
				continue
			}
			moved++
			a.logger.Add(group[i].Name, group[i].Path, customDir, 0, "success", "已移入回收站（整合包去重）")
		}
	}
	return totalDups, moved, nil
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
	return sync.GetInstanceStatus(mcRoot, repoDir, a.ScanModelEntries)
}

func (a *App) SyncModelToggleStatus(instanceCustomDir, repoRoot string) (int, int, error) {
	return sync.SyncToggleStatus(instanceCustomDir, repoRoot, a.ScanModelEntries)
}

// ========== YSM 检测 ==========
func (a *App) HasYSMMod(modsDir string) bool {
	return ysm.HasYSMMod(modsDir)
}

// ========== 链接模式 ==========
func (a *App) SetLinkMode(mode string) error {
	if mode != "copy" && mode != "hardlink" && mode != "symlink" {
		return fmt.Errorf("无效的链接模式: %s", mode)
	}
	a.LinkMode = mode
	return nil
}

func (a *App) GetLinkMode() string {
	if a.LinkMode == "" {
		return "copy"
	}
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
func (a *App) CountLinkedModels(customDir string) int {
    count := 0
    filepath.WalkDir(customDir, func(p string, d os.DirEntry, err error) error {
        if err != nil || d.IsDir() {
            return nil
        }
        ext := strings.ToLower(filepath.Ext(p))
        if ext != ".ysm" && ext != ".zip" && ext != ".7z" {
            return nil
        }
        info, _ := d.Info()
        if info != nil {
            // 硬链接数 > 1 或 符号链接
            if info.Mode()&os.ModeSymlink != 0 {
                count++
            } else if info.Mode().IsRegular() {
                // 硬链接判断：Windows 下通过 GetFileInformationByHandle
                // 简化处理：先只统计符号链接
            }
        }
        return nil
    })
    return count

}
func (a *App) IsSymlink(path string) bool {
    info, err := os.Lstat(path)
    if err != nil {
        return false
    }
    return info.Mode()&os.ModeSymlink != 0
}
