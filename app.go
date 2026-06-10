package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/logs"
	"ysm-model-manager/go/recycle"
	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/threejs"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/updater"
	"ysm-model-manager/go/version"
	"ysm-model-manager/go/watcher"
	"ysm-model-manager/go/ysm"

	"github.com/bodgit/sevenzip"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx      context.Context
	RepoRoot string
	LinkMode string
	logger   *logs.Logger
	watcher  *watcher.Watcher
	queue    *DownloadQueue
}

// DownloadTask 下载队列任务
type DownloadTask struct {
	URL     string `json:"url"`
	SaveDir string `json:"saveDir"`
	Name    string `json:"name"` // 显示用
	Size    int64  `json:"size"`
}

// DownloadQueue 串行下载队列
type DownloadQueue struct {
	app       *App
	tasks     []DownloadTask
	mu        sync.Mutex
	running   bool
	cancelled bool
	cancel    chan struct{}
}

func NewDownloadQueue(a *App) *DownloadQueue {
	return &DownloadQueue{app: a, cancel: make(chan struct{})}
}

// EnqueueDownloads 添加下载任务
func (a *App) EnqueueDownloads(tasks []DownloadTask) error {
	if len(tasks) == 0 {
		return nil
	}
	a.queue.mu.Lock()
	a.queue.tasks = append(a.queue.tasks, tasks...)
	total := len(a.queue.tasks)
	a.queue.mu.Unlock()
	runtime.EventsEmit(a.ctx, "queue:status", "enqueued", total, "")
	if !a.queue.running {
		go a.queue.process()
	}
	return nil
}

// CancelQueue 取消队列
func (a *App) CancelQueue() {
	a.queue.mu.Lock()
	defer a.queue.mu.Unlock()
	a.queue.cancelled = true
	if a.queue.running {
		close(a.queue.cancel)
		a.queue.cancel = make(chan struct{})
	}
	a.queue.tasks = nil
	a.queue.running = false
	runtime.EventsEmit(a.ctx, "queue:status", "cancelled", 0, "")
}

// QueueStatus 当前队列状态
func (a *App) QueueStatus() (int, bool) {
	a.queue.mu.Lock()
	defer a.queue.mu.Unlock()
	return len(a.queue.tasks), a.queue.running
}

func (q *DownloadQueue) process() {
	q.mu.Lock()
	q.running = true
	q.mu.Unlock()

	defer func() {
		q.mu.Lock()
		q.running = false
		cancelled := q.cancelled
		q.mu.Unlock()
		if !cancelled {
			runtime.EventsEmit(q.app.ctx, "queue:status", "done", 0, "")
		}
	}()

	for {
		q.mu.Lock()
		if len(q.tasks) == 0 {
			q.mu.Unlock()
			return
		}
		task := q.tasks[0]
		q.tasks = q.tasks[1:]
		remaining := len(q.tasks)
		q.mu.Unlock()

		runtime.EventsEmit(q.app.ctx, "queue:file-start", task.Name, remaining+1, remaining)

		// 下载
		_, err := q.app.downloadFileWithQueue(task.URL, task.SaveDir)
		if err != nil {
			runtime.EventsEmit(q.app.ctx, "queue:file-done", task.Name, "fail", err.Error())
		} else {
			runtime.EventsEmit(q.app.ctx, "queue:file-done", task.Name, "ok", "")
		}

		select {
		case <-q.cancel:
			return
		default:
		}
	}
}

// downloadFileWithQueue 下载单文件（含镜像回退 + 进度推送）
func (a *App) downloadFileWithQueue(rawURL, saveDir string) (string, error) {
	if err := os.MkdirAll(saveDir, 0755); err != nil {
		return "", err
	}
	// 从 raw URL 提取路径和仓库信息
	relPath := ""
	repoPath := ""
	if idx := strings.Index(rawURL, "/main/"); idx > 0 {
		relPath = rawURL[idx+6:]
		raw := rawURL
		if strings.HasPrefix(raw, "https://raw.githubusercontent.com/") {
			parts := strings.SplitN(raw[len("https://raw.githubusercontent.com/"):], "/", 3)
			if len(parts) >= 2 {
				repoPath = parts[0] + "/" + parts[1]
			}
		}
	}
	if relPath == "" {
		relPath = filepath.Base(rawURL)
	}
	relPath = strings.ReplaceAll(relPath, "/", string(filepath.Separator))
	savePath := filepath.Join(saveDir, relPath)
	if err := os.MkdirAll(filepath.Dir(savePath), 0755); err != nil {
		return "", err
	}

	// 读镜像配置决定顺序
	mirror := a.LoadAppConfig().Mirror
	type src struct {
		url  string
		kind string
	}
	sources := []src{{rawURL, "raw"}}
	if repoPath != "" {
		jsdURL := "https://cdn.jsdelivr.net/gh/" + repoPath + "@main/" + strings.ReplaceAll(relPath, "\\", "/")
		sources = append(sources, src{jsdURL, "jsd"})
		apiURL := "https://api.github.com/repos/" + repoPath + "/contents/" + strings.ReplaceAll(relPath, "\\", "/")
		sources = append(sources, src{apiURL, "api"})
	}
	if mirror == "jsdelivr" && len(sources) >= 3 {
		sources[0], sources[1] = sources[1], sources[0]
	} else if mirror == "githubapi" && len(sources) >= 3 {
		sources[0], sources[2] = sources[2], sources[0]
	}

	var lastErr error
	for _, s := range sources {
		var err error
		if s.kind == "api" {
			err = a.downloadFromAPI(s.url, savePath)
		} else {
			err = a.downloadFile(s.url, savePath)
		}
		if err == nil {
			return savePath, nil
		}
		lastErr = err
	}
	return "", fmt.Errorf("所有源均失败: %s", lastErr)
}

func NewApp() *App {
	a := &App{
		logger: logs.NewLogger(),
	}
	a.queue = NewDownloadQueue(a)
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// 启动时自动加载配置
	a.loadAppConfig()

	// 恢复窗口位置
	pos := a.GetWindowPosition()
	if pos.Width > 0 && pos.Height > 0 {
		runtime.WindowSetSize(ctx, pos.Width, pos.Height)
		runtime.WindowSetPosition(ctx, pos.X, pos.Y)
	}

	// 确保配置文件存在（如果被删除则重建）
	cfg := a.LoadAppConfig()
	needsWrite := false
	if _, err := os.Stat(configPath()); os.IsNotExist(err) {
		// 配置文件不存在 → 创建默认文件
		needsWrite = true
	}
	if cfg.McRoot == "" {
		paths := scanMinecraftDirs()
		if len(paths) > 0 {
			cfg.McRoot = paths[0]
			needsWrite = true
		}
	}
	if cfg.RepoRoot == "" && a.RepoRoot != "" {
		cfg.RepoRoot = a.RepoRoot
		needsWrite = true
	}
	if needsWrite {
		if data, err := json.MarshalIndent(cfg, "", "  "); err == nil {
			os.WriteFile(configPath(), data, 0644)
			if cfg.McRoot != "" {
				println("[startup] 配置文件已创建/更新, mcRoot:", cfg.McRoot)
			}
		}
	}

	runtime.EventsEmit(ctx, "config-loaded", cfg.RepoRoot, cfg.McRoot, cfg.LinkMode)

	// 启动文件监听器（自动同步启用/禁用状态到整合包）
	if cfg.RepoRoot != "" && cfg.McRoot != "" {
		a.watcher = watcher.New(cfg.RepoRoot, cfg.McRoot, a.ScanModelEntries)
		if err := a.watcher.Start(); err != nil {
			println("[startup] 文件监听器启动失败:", err.Error())
		}
	}
}

func (a *App) shutdown(ctx context.Context) {
	defer func() { recover() }() // 关闭时可能取不到窗口尺寸
	if a.watcher != nil {
		a.watcher.Stop()
	}
	x, y := runtime.WindowGetPosition(ctx)
	w, h := runtime.WindowGetSize(ctx)
	a.SaveWindowPosition(x, y, w, h)
}

// ========== 配置持久化 ==========
// findConfigFile 依次尝试给定路径，返回第一个存在的文件
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

func configPath() string {
	exe, _ := os.Executable()
	return findConfigFile(
		filepath.Join(filepath.Dir(exe), "ysm_config.json"),
		filepath.Join(filepath.Dir(exe), "..", "ysm_config.json"),
		filepath.Join(".", "ysm_config.json"),
	)
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

func (a *App) SaveAppConfig(repoRoot, mcRoot, linkMode, theme string) error {
	// 无论校验是否通过，先保存配置（防止因校验失败导致文件无法创建）
	// mcRoot 校验放在前端做提示即可，不阻塞保存
	cfg := types.AppConfig{
		RepoRoot: repoRoot,
		McRoot:   mcRoot,
		LinkMode: linkMode,
		Theme:    theme,
		Mirror:   a.LoadAppConfig().Mirror,
	}
	data, _ := json.MarshalIndent(cfg, "", "  ")
	err := os.WriteFile(configPath(), data, 0644)
	if err == nil {
		// 校验通过才启动 watcher
		if mcRoot != "" {
			if validated, errMsg := a.ValidateMinecraftDir(mcRoot); errMsg == "" {
				a.restartWatcher(repoRoot, validated)
			}
		} else {
			a.restartWatcher(repoRoot, "")
		}
	}
	return err
}

// SetDownloadMirror 单独设置下载镜像源
func (a *App) SetDownloadMirror(mirror string) error {
	cfg := a.LoadAppConfig()
	cfg.Mirror = mirror
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(configPath(), data, 0644)
}

// restartWatcher 重启文件监听器
func (a *App) restartWatcher(repoRoot, mcRoot string) {
	if a.watcher != nil {
		a.watcher.Stop()
		a.watcher = nil
	}
	if repoRoot != "" && mcRoot != "" {
		a.watcher = watcher.New(repoRoot, mcRoot, a.ScanModelEntries)
		if err := a.watcher.Start(); err != nil {
			println("[watcher] 重启失败:", err.Error())
		}
	}
}

func (a *App) LoadAppConfig() types.AppConfig {
	var cfg types.AppConfig
	readJSONFile(configPath(), &cfg)
	return cfg
}

// ========== 创意工坊站点配置 ==========
func workshopSitesPath() string {
	exe, _ := os.Executable()
	return findConfigFile(
		filepath.Join(filepath.Dir(exe), "workshop_sites.json"),
		filepath.Join(filepath.Dir(exe), "..", "workshop_sites.json"),
		"workshop_sites.json",
	)
}

// readJSONFile 读取 JSON 文件，自动跳过 UTF-8 BOM
func readJSONFile(path string, v interface{}) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	return json.Unmarshal(data, v)
}

func (a *App) LoadWorkshopSites() []types.WorkshopSite {
	var sites []types.WorkshopSite
	if err := readJSONFile(workshopSitesPath(), &sites); err != nil {
		return defaultWorkshopSites()
	}
	return sites
}

func (a *App) SaveWorkshopSites(sites []types.WorkshopSite) error {
	data, err := json.MarshalIndent(sites, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(workshopSitesPath(), data, 0644)
}

func defaultWorkshopSites() []types.WorkshopSite {
	return []types.WorkshopSite{
		{
			ID: "bilibili", Icon: "📺", Label: "B站", URL: "https://www.bilibili.com/",
			Desc: "搜索模型创作者和模型展示", Group: "search",
			SearchURL: "https://search.bilibili.com/all?keyword={{q}}",
			PresetSearches: []types.WorkshopPresetSearch{
				{Label: "免费模型", Q: "ysm模型免费分享"},
				{Label: "付费模型", Q: "ysm模型展示"},
			},
		},
		{
			ID: "afdian", Icon: "❤️", Label: "爱发电", URL: "https://afdian.com/",
			Desc: "赞助创作者平台", Group: "search",
			SearchURL: "https://afdian.com/search?q={{q}}",
			PresetSearches: []types.WorkshopPresetSearch{
				{Label: "作者搜索", Q: "碎de帆"},
				{Label: "付费模型", Q: "YSM"},
			},
		},
		{
			ID: "github", Icon: "🐙", Label: "GitHub", URL: "https://github.com/",
			Desc: "免费模型仓库（前置）", Group: "repo",
			SearchURL: "https://github.com/search?q={{q}}",
		},
		{
			ID: "mcmod", Icon: "📖", Label: "MC百科", URL: "https://www.mcmod.cn/",
			Desc: "模组与模型百科", Group: "browse",
		},
		{
			ID: "curseforge", Icon: "🔥", Label: "CurseForge", URL: "https://www.curseforge.com/minecraft",
			Desc: "全球 MC 资源站（无法下载YSM）", Group: "browse",
		},
		{
			ID: "modrinth", Icon: "💎", Label: "Modrinth", URL: "https://modrinth.com/",
			Desc: "开源 MC 平台（无法下载YSM）", Group: "browse",
		},
	}
}

// ========== 创意工坊创作者配置（单文件 + 标签）==========
func workshopCreatorsPath() string {
	exe, _ := os.Executable()
	return findConfigFile(
		filepath.Join(filepath.Dir(exe), "workshop_creators.json"),
		filepath.Join(filepath.Dir(exe), "..", "workshop_creators.json"),
		"workshop_creators.json",
	)
}

func (a *App) LoadWorkshopCreators() []types.WorkshopCreator {
	var list []types.WorkshopCreator
	if err := readJSONFile(workshopCreatorsPath(), &list); err != nil {
		return nil
	}
	return list
}

func (a *App) SaveWorkshopCreators(list []types.WorkshopCreator) error {
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(workshopCreatorsPath(), data, 0644)
}

// ResetWorkshopConfigs 重置创意工坊配置为默认值
func (a *App) ResetWorkshopConfigs() ([]types.WorkshopSite, error) {
	sites := defaultWorkshopSites()
	data, _ := json.MarshalIndent(sites, "", "  ")
	if err := os.WriteFile(workshopSitesPath(), data, 0644); err != nil {
		return nil, err
	}
	// 清空创作者文件夹
	os.Remove(workshopCreatorsPath())
	return sites, nil
}

// ========== CSV 导出/导入（创意工坊）==========

// ExportWorkshopSitesCSV 导出站点配置为 CSV（返回文本）
func (a *App) ExportWorkshopSitesCSV() (string, error) {
	sites := a.LoadWorkshopSites()
	var buf strings.Builder
	w := csv.NewWriter(&buf)
	w.Write([]string{"id", "icon", "label", "url", "desc", "group", "searchUrl"})
	for _, s := range sites {
		w.Write([]string{s.ID, s.Icon, s.Label, s.URL, s.Desc, s.Group, s.SearchURL})
	}
	w.Flush()
	return buf.String(), w.Error()
}

// ExportWorkshopSitesJSONFile 导出站点配置为 JSON 到 exe 同目录
func (a *App) ExportWorkshopSitesJSONFile() (string, error) {
	sites := a.LoadWorkshopSites()
	data, err := json.MarshalIndent(sites, "", "  ")
	if err != nil {
		return "", err
	}
	path := workshopSitesPath()
	if err := os.WriteFile(path, data, 0644); err != nil {
		return "", err
	}
	return path, nil
}

// ImportWorkshopSitesJSONFile 从 exe 同目录的 JSON 文件导入站点配置
func (a *App) ImportWorkshopSitesJSONFile() (int, error) {
	path := workshopSitesPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, fmt.Errorf("未找到 JSON 文件: %w", err)
	}
	var sites []types.WorkshopSite
	if err := json.Unmarshal(data, &sites); err != nil {
		return 0, err
	}
	return len(sites), a.SaveWorkshopSites(sites)
}

// ImportWorkshopSitesCSV 从 CSV 文本导入站点配置
func (a *App) ImportWorkshopSitesCSV(csvContent string) error {
	r := csv.NewReader(strings.NewReader(csvContent))
	rows, err := r.ReadAll()
	if err != nil {
		return err
	}
	if len(rows) < 2 {
		return fmt.Errorf("CSV 为空或只有表头")
	}
	var sites []types.WorkshopSite
	for _, row := range rows[1:] {
		if len(row) < 6 {
			continue
		}
		s := types.WorkshopSite{
			ID:    row[0],
			Icon:  row[1],
			Label: row[2],
			URL:   row[3],
			Desc:  row[4],
			Group: row[5],
		}
		if len(row) > 6 {
			s.SearchURL = row[6]
		}
		sites = append(sites, s)
	}
	return a.SaveWorkshopSites(sites)
}

// ExportWorkshopCreatorsJSONFile 导出创作者配置为 JSON（写入独立文件到 exe 同目录）
func (a *App) ExportWorkshopCreatorsJSONFile() (string, error) {
	if err := a.SaveWorkshopCreators(a.LoadWorkshopCreators()); err != nil {
		return "", err
	}
	return workshopCreatorsPath(), nil
}

// BackupWorkshopCreators 备份创作者配置
func (a *App) BackupWorkshopCreators() (string, error) {
	path := workshopCreatorsPath()
	bakPath := path + "." + time.Now().Format("20060102-150405") + ".bak"
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(bakPath, data, 0644); err != nil {
		return "", err
	}
	return bakPath, nil
}

// MergeWorkshopCreatorsFromJSON 合并导入（局部更新，按 name 去重）
func (a *App) MergeWorkshopCreatorsFromJSON(jsonContent string) (int, int, error) {
	var imported []types.WorkshopCreator
	if err := json.Unmarshal([]byte(jsonContent), &imported); err != nil {
		return 0, 0, err
	}
	a.BackupWorkshopCreators()
	existing := a.LoadWorkshopCreators()
	existMap := map[string]int{}
	for i, cr := range existing {
		existMap[cr.Name] = i
	}
	added, updated := 0, 0
	for _, cr := range imported {
		if idx, ok := existMap[cr.Name]; ok {
			existing[idx].Desc = cr.Desc
			if cr.Type != "" { existing[idx].Type = cr.Type }
			updated++
		} else {
			existing = append(existing, cr)
			existMap[cr.Name] = len(existing) - 1
			added++
		}
	}
	return added, updated, a.SaveWorkshopCreators(existing)
}

// ReplaceWorkshopCreatorsFromJSON 覆盖导入（先备份再完全替换）
func (a *App) ReplaceWorkshopCreatorsFromJSON(jsonContent string) (int, error) {
	a.BackupWorkshopCreators()
	var imported []types.WorkshopCreator
	if err := json.Unmarshal([]byte(jsonContent), &imported); err != nil {
		return 0, err
	}
	return len(imported), a.SaveWorkshopCreators(imported)
}

// ========== 自动更新 ==========

// CurrentVersion 返回当前版本号
func (a *App) CurrentVersion() string {
	return version.Version
}

// CheckUpdate 检查 GitHub 是否有新版本
func (a *App) CheckUpdate() (*updater.UpdateInfo, error) {
	return updater.Check(version.Version)
}

// DownloadUpdate 下载更新包，返回临时 zip 路径
func (a *App) DownloadUpdate(url string) (string, error) {
	return updater.Download(url)
}

// ApplyUpdate 应用更新（解压 + 启动 updater.bat + 退出）
func (a *App) ApplyUpdate(zipPath string) error {
	return updater.ApplyUpdate(zipPath)
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
	var state types.WindowState
	state.X = 100
	state.Y = 100
	state.Width = 1200
	state.Height = 800
	readJSONFile(path, &state)
	return state
}

// ========== 目录选择 ==========
func (a *App) SelectDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择目录",
	})
}

// ========== .minecraft 定位 ==========

// isLikelyMinecraftDir 检查目录是否包含 .minecraft 的特征文件和子目录
func isLikelyMinecraftDir(path string) bool {
	markers := []string{
		"versions",
		"assets",
		"launcher_profiles.json",
	}
	for _, m := range markers {
		full := filepath.Join(path, m)
		if info, err := os.Stat(full); err == nil {
			if m == "launcher_profiles.json" || info.IsDir() {
				return true
			}
		}
	}
	return false
}

// scanMinecraftDirs 扫描常见位置，返回找到的所有 .minecraft 目录
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

	// 1. 可执行文件同目录
	if exe, err := os.Executable(); err == nil {
		add(filepath.Join(filepath.Dir(exe), ".minecraft"))
		add(filepath.Join(filepath.Dir(exe), "..", ".minecraft"))
	}

	// 2. %%APPDATA%%/.minecraft（官方启动器默认位置）
	if appData, err := os.UserConfigDir(); err == nil {
		add(filepath.Join(appData, ".minecraft"))
	}

	// 3. 常见启动器/用户目录
	commonPaths := []string{
		filepath.Join("D:", "PCL2", ".minecraft"),
		filepath.Join("C:", "PCL2", ".minecraft"),
		filepath.Join("E:", "PCL2", ".minecraft"),
		filepath.Join("D:", "PCL", ".minecraft"),
		filepath.Join("C:", "PCL", ".minecraft"),
		filepath.Join("D:", "MC", ".minecraft"),
		filepath.Join("C:", "MC", ".minecraft"),
		filepath.Join("D:", "Minecraft", ".minecraft"),
		filepath.Join("C:", "Minecraft", ".minecraft"),
		filepath.Join("D:", "Games", "Minecraft", ".minecraft"),
	}
	for _, c := range commonPaths {
		add(c)
	}

	return found
}

func (a *App) GetMinecraftPaths() []string {
	return scanMinecraftDirs()
}

// ValidateMinecraftDir 验证并自动修正 MC 目录
// 如果用户选了 PCL2 的父目录，自动补全 .minecraft 子目录
func (a *App) ValidateMinecraftDir(dir string) (string, string) {
	if dir == "" {
		return "", "请选择游戏目录"
	}
	abs, err := filepath.Abs(filepath.Clean(dir))
	if err != nil {
		return "", "路径格式错误"
	}
	// 直接检查
	if isLikelyMinecraftDir(abs) {
		return abs, ""
	}
	// 检查 .minecraft 子目录
	sub := filepath.Join(abs, ".minecraft")
	if info, err := os.Stat(sub); err == nil && info.IsDir() && isLikelyMinecraftDir(sub) {
		return sub, ""
	}
	// 检查 versions 子目录（有时 .minecraft 内容直接在启动器目录下）
	if info, err := os.Stat(filepath.Join(abs, "versions")); err == nil && info.IsDir() {
		return abs, ""
	}
	return "", "未检测到 .minecraft 文件夹。请选择包含 versions/ 等子目录的 .minecraft 文件夹"
}

// ========== 批量导出骨骼结构 ==========
func (a *App) ExportBoneStructures(repoRoot string) (string, error) {
	entries := a.ScanModelEntries(repoRoot)
	if len(entries) == 0 {
		return "", fmt.Errorf("仓库中没有模型文件")
	}

	var lines []string
	lines = append(lines, "YSM Model Manager — 骨骼结构批量导出")
	lines = append(lines, fmt.Sprintf("仓库: %s", repoRoot))
	lines = append(lines, fmt.Sprintf("文件总数: %d", len(entries)))
	lines = append(lines, fmt.Sprintf("导出时间: %s", time.Now().Format("2006-01-02 15:04:05")))
	lines = append(lines, "")
	lines = append(lines, "="+strings.Repeat("=", 78))
	lines = append(lines, "")

	totalBones := 0
	totalCubes := 0
	parsedCount := 0
	failCount := 0

	for i, entry := range entries {
		model := a.AnalyzeBedrockModel(entry.Path)
		relPath := entry.Name
		lines = append(lines, fmt.Sprintf("[%d/%d] %s", i+1, len(entries), relPath))

		if model.BoneCount > 0 {
			parsedCount++
			totalBones += model.BoneCount
			totalCubes += model.CubeCount
			lines = append(lines, fmt.Sprintf("  🦴 骨骼: %d  |  📦 立方体: %d  |  📐 纹理: %dx%d",
				model.BoneCount, model.CubeCount, model.TexWidth, model.TexHeight))

			// 骨骼层级
			for _, b := range model.Bones {
				cs := len(b.Cubes)
				if cs > 0 {
					lines = append(lines, fmt.Sprintf("  ├─ %s (%d 方)", b.Name, cs))
				} else {
					lines = append(lines, fmt.Sprintf("  ├─ %s (结构骨骼)", b.Name))
				}
			}
		} else {
			failCount++
			lines = append(lines, "  ⚠️ 未解析到骨骼数据")
		}
		lines = append(lines, "")
	}

	lines = append(lines, "="+strings.Repeat("=", 78))
	lines = append(lines, "")
	lines = append(lines, fmt.Sprintf("✅ 成功解析: %d / %d", parsedCount, len(entries)))
	lines = append(lines, fmt.Sprintf("❌ 解析失败: %d", failCount))
	lines = append(lines, fmt.Sprintf("🦴 骨骼总数: %d", totalBones))
	lines = append(lines, fmt.Sprintf("📦 立方体总数: %d", totalCubes))
	lines = append(lines, "")
	lines = append(lines, "--- 生成完毕 ---")

	return strings.Join(lines, "\n"), nil
}

// ExportModelStructureJSON 导出单模型骨骼结构（JSON 格式，含父子关系、坐标、纹理索引）
func (a *App) ExportModelStructureJSON(modelPath string) string {
	model := a.AnalyzeBedrockModel(modelPath)
	if model.BoneCount == 0 {
		return "{}"
	}
	type boneInfo struct {
		Name     string    `json:"name"`
		Parent   string    `json:"parent,omitempty"`
		Pivot    [3]float64 `json:"pivot"`
		Cubes    int       `json:"cubes"`
		TexIdx   int       `json:"texIdx"`
	}
	type modelInfo struct {
		File       string     `json:"file"`
		BoneCount  int        `json:"boneCount"`
		CubeCount  int        `json:"cubeCount"`
		TexWidth   int        `json:"texWidth"`
		TexHeight  int        `json:"texHeight"`
		TextureCnt int        `json:"textureCount"`
		Bones      []boneInfo `json:"bones"`
	}
	info := modelInfo{
		File:       filepath.Base(modelPath),
		BoneCount:  model.BoneCount,
		CubeCount:  model.CubeCount,
		TexWidth:   model.TexWidth,
		TexHeight:  model.TexHeight,
		TextureCnt: len(model.Textures),
	}
	for _, b := range model.Bones {
		info.Bones = append(info.Bones, boneInfo{
			Name:   b.Name,
			Parent: b.Parent,
			Pivot:  b.Pivot,
			Cubes:  len(b.Cubes),
			TexIdx: 0,
		})
	}
	data, _ := json.MarshalIndent(info, "", "  ")
	return string(data)
}

// ========== 高级搜索 ==========
func (a *App) SearchModels(repoRoot string, keyword string, minBones, maxBones, minCubes, maxCubes, minTex, maxTex int) []types.SearchResult {
	entries := a.ScanModelEntries(repoRoot)
	if len(entries) == 0 {
		return nil
	}

	var results []types.SearchResult
	kw := strings.ToLower(strings.TrimSpace(keyword))

	for _, entry := range entries {
		if kw != "" {
			name := strings.ToLower(entry.Name)
			if !strings.Contains(name, kw) && !strings.Contains(strings.ToLower(entry.Path), kw) {
				continue
			}
		}

		model := a.AnalyzeBedrockModel(entry.Path)
		if model.BoneCount == 0 {
			continue
		}

		if minBones > 0 && model.BoneCount < minBones { continue }
		if maxBones > 0 && model.BoneCount > maxBones { continue }
		if minCubes > 0 && model.CubeCount < minCubes { continue }
		if maxCubes > 0 && model.CubeCount > maxCubes { continue }
		if minTex > 0 && (model.TexWidth < minTex || model.TexHeight < minTex) { continue }
		if maxTex > 0 && (model.TexWidth > maxTex || model.TexHeight > maxTex) { continue }

		results = append(results, types.SearchResult{
			Name:      entry.Name,
			Path:      entry.Path,
			BoneCount: model.BoneCount,
			CubeCount: model.CubeCount,
			TexWidth:  model.TexWidth,
			TexHeight: model.TexHeight,
		})
	}
	return results
}

func (a *App) SetRepoRoot(dir string) {
	if !installer.IsValidRepoRoot(dir) {
		return // 仓库路径不合法，不做设置
	}
	a.RepoRoot = dir
}

// GenerateRepoIndex 扫描仓库目录，生成 index.json（供 GitHub 模型仓库使用）
// 格式：[{ name, path, size }]
func (a *App) GenerateRepoIndex(repoPath string) (string, error) {
	entries := a.ScanModelEntries(repoPath)
	type indexEntry struct {
		Name string `json:"name"`
		Path string `json:"path"`
		Size int64  `json:"size"`
		Hash string `json:"hash,omitempty"`
	}
	var list []indexEntry
	for _, e := range entries {
		relPath := e.Path
		if strings.HasPrefix(relPath, repoPath) {
			relPath = strings.TrimPrefix(relPath, repoPath)
			relPath = strings.TrimPrefix(relPath, "\\")
			relPath = strings.TrimPrefix(relPath, "/")
		}
		list = append(list, indexEntry{
			Name: e.Name,
			Path: relPath,
			Size: e.Size,
			Hash: e.Hash,
		})
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return "", err
	}
	indexPath := filepath.Join(repoPath, "index.json")
	if err := os.WriteFile(indexPath, data, 0644); err != nil {
		return "", err
	}

	// 同时生成 GitHub Action 工作流
	workflowDir := filepath.Join(repoPath, ".github", "workflows")
	if err := os.MkdirAll(workflowDir, 0755); err == nil {
		workflowPath := filepath.Join(workflowDir, "generate-index.yml")
		// 检查是否已存在，存在则跳过
		if _, err := os.Stat(workflowPath); os.IsNotExist(err) {
			workflowContent := `name: Generate index.json
on:
  push:
    branches: [main]
    paths:
      - "**.ysm"
      - "**.zip"
      - "**.7z"
  workflow_dispatch:
permissions:
  contents: write
jobs:
  generate-index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: 生成 index.json
        run: |
          cat > genindex.go << 'GOEOF'
          package main
          import (
            "crypto/sha256"
            "encoding/json"
            "fmt"
            "io"
            "os"
            "path/filepath"
            "strings"
          )
          type entry struct {
            Name string ` + "`json:\"name\"`" + `
            Path string ` + "`json:\"path\"`" + `
            Size int64  ` + "`json:\"size\"`" + `
            Hash string ` + "`json:\"hash,omitempty\"`" + `
          }
          func main() {
            repoPath := "."
            var list []entry
            filepath.WalkDir(repoPath, func(p string, d os.DirEntry, err error) error {
              if err != nil || d.IsDir() { return nil }
              ext := strings.ToLower(filepath.Ext(p))
              if ext != ".ysm" && ext != ".zip" && ext != ".7z" { return nil }
              if strings.Contains(p, "/.github") { return nil }
              rel, _ := filepath.Rel(repoPath, p)
              rel = strings.ReplaceAll(rel, "\\", "/")
              fi, _ := d.Info()
              size := int64(0)
              if fi != nil { size = fi.Size() }
              hashStr := ""
              if f, err := os.Open(p); err == nil {
                h := sha256.New()
                io.Copy(h, f)
                hashStr = fmt.Sprintf("%x", h.Sum(nil))
                f.Close()
              }
              list = append(list, entry{Name: d.Name(), Path: rel, Size: size, Hash: hashStr})
              return nil
            })
            data, _ := json.MarshalIndent(list, "", "  ")
            os.WriteFile("index.json", data, 0644)
            fmt.Printf("✅ 已生成 index.json，共 %d 个模型\\n", len(list))
          }
          GOEOF
          go run genindex.go
          rm genindex.go
      - name: 提交更新
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add index.json
          if git diff --cached --quiet; then
            echo "index.json 无变化，跳过提交"
          else
            git commit -m ":arrows_counterclockwise: 自动更新 index.json"
            git push
          fi
`
			os.WriteFile(workflowPath, []byte(workflowContent), 0644)
		}
	}

	return indexPath, nil
}

// DownloadFromGitHub 从 GitHub Raw 下载文件到本地目录
// progressReader 包装 io.Reader，下载时通过 Wails EventsEmit 推送进度
type progressReader struct {
	reader     io.Reader
	total      int64
	downloaded int64
	lastPct    int
	onProgress func(downloaded, total int64)
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.reader.Read(p)
	pr.downloaded += int64(n)
	if pr.total > 0 {
		pct := int(pr.downloaded * 100 / pr.total)
		if pct > pr.lastPct {
			pr.lastPct = pct
			if pr.onProgress != nil {
				pr.onProgress(pr.downloaded, pr.total)
			}
		}
	} else if n > 0 && pr.onProgress != nil {
		// 没有 Content-Length 时每 256KB 汇报一次
		kb := pr.downloaded / 256 / 1024
		if kb > int64(pr.lastPct) {
			pr.lastPct = int(kb)
			pr.onProgress(pr.downloaded, pr.downloaded)
		}
	}
	return n, err
}

func (a *App) DownloadFromGitHub(rawURL string, saveDir string) (string, error) {
	return a.downloadFileWithQueue(rawURL, saveDir)
}

// downloadFile 从 URL 下载文件到本地（流式 256KB 分块 + 每块 emit）
func (a *App) downloadFile(url, savePath string) error {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	out, err := os.Create(savePath)
	if err != nil {
		return err
	}
	defer out.Close()

	total := resp.ContentLength
	buf := make([]byte, 256*1024)
	var written int64
	var lastEmitBytes int64
	lastEmitTime := time.Now()
	tinyFile := total > 0 && total <= 100*1024 // <100KB 极速通道

	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := out.Write(buf[:n]); writeErr != nil {
				return writeErr
			}
			written += int64(n)
			// 极速通道：小文件每写必发
			if tinyFile {
				if total > 0 {
					runtime.EventsEmit(a.ctx, "download:progress", written, total)
				}
			} else if written-lastEmitBytes > 256*1024 || time.Since(lastEmitTime) > 200*time.Millisecond {
				if total > 0 {
					runtime.EventsEmit(a.ctx, "download:progress", written, total)
				} else {
					runtime.EventsEmit(a.ctx, "download:progress", written, written)
				}
				lastEmitBytes = written
				lastEmitTime = time.Now()
			}
		}
		if readErr != nil {
			break
		}
	}
	// 最终确保 100%
	if total > 0 {
		runtime.EventsEmit(a.ctx, "download:progress", total, total)
	} else {
		runtime.EventsEmit(a.ctx, "download:progress", written, written)
	}
	return nil
}

// downloadFromAPI 通过 GitHub API 下载（base64 解码）
func (a *App) downloadFromAPI(apiURL, savePath string) error {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(apiURL)
	if err != nil {
		return fmt.Errorf("连接失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var data struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return fmt.Errorf("解析失败: %w", err)
	}
	if data.Encoding != "base64" || data.Content == "" {
		return fmt.Errorf("非 base64 响应")
	}
	decoded, err := base64.StdEncoding.DecodeString(data.Content)
	if err != nil {
		return fmt.Errorf("base64 解码失败: %w", err)
	}
	out, err := os.Create(savePath)
	if err != nil {
		return err
	}
	defer out.Close()

	total := int64(len(decoded))
	chunkSize := 256 * 1024
	var written int64
	var lastEmitBytes int64
	lastEmitTime := time.Now()
	tinyFile := total <= 100*1024 // <100KB 极速通道

	for written < total {
		end := written + int64(chunkSize)
		if end > total {
			end = total
		}
		n, err := out.Write(decoded[written:end])
		if err != nil {
			return err
		}
		written += int64(n)
		if tinyFile {
			// 极速通道：小文件每写必发
			runtime.EventsEmit(a.ctx, "download:progress", written, total)
		} else if written-lastEmitBytes > 256*1024 || time.Since(lastEmitTime) > 200*time.Millisecond {
			runtime.EventsEmit(a.ctx, "download:progress", written, total)
			lastEmitBytes = written
			lastEmitTime = time.Now()
		}
	}
	runtime.EventsEmit(a.ctx, "download:progress", total, total)
	return nil
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

// ListModelAuthors 扫描仓库，提取所有唯一作者名
func (a *App) ListModelAuthors() []string {
	if a.RepoRoot == "" {
		return nil
	}
	entries := a.ScanModelEntries(a.RepoRoot)
	seen := map[string]bool{}
	var result []string
	for _, e := range entries {
		name := e.Name
		// 移除 .ban 后缀
		if strings.HasSuffix(strings.ToLower(name), ".ban") {
			name = name[:len(name)-4]
		}
		// 提取 [Author]
		if strings.HasPrefix(name, "[") {
			if idx := strings.Index(name, "]"); idx > 0 {
				author := name[1:idx]
				if author != "" && !seen[author] {
					seen[author] = true
					result = append(result, author)
				}
			}
		}
	}
	return result
}

// ========== 整合包 ==========
func (a *App) ListVersionInstances(mcRoot string) []types.VersionInstance {
	return ysmsync.ListVersions(strings.TrimSpace(mcRoot))
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
	// 相对路径 → 拼接仓库根目录
	if !filepath.IsAbs(dir) {
		dir = filepath.Join(a.RepoRoot, dir)
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
	// 绝对路径直接使用，相对路径拼接仓库根目录
	var fullPath string
	if filepath.IsAbs(dir) {
		fullPath = filepath.Clean(dir)
	} else {
		fullPath = filepath.Join(a.RepoRoot, dir)
	}
	// 安全检查：必须在仓库根目录内
	if !strings.HasPrefix(fullPath, filepath.Clean(a.RepoRoot)+string(filepath.Separator)) &&
		fullPath != filepath.Clean(a.RepoRoot) {
		return fmt.Errorf("只能在仓库根目录下创建文件夹")
	}
	if _, err := os.Stat(fullPath); err == nil {
		return fmt.Errorf("目录已存在")
	}
	return os.MkdirAll(fullPath, 0755)
}

// RenameDir 重命名仓库内的文件夹
func (a *App) RenameDir(oldPath, newName string) error {
	oldPath = strings.TrimSpace(oldPath)
	newName = strings.TrimSpace(newName)
	if oldPath == "" || newName == "" {
		return fmt.Errorf("参数为空")
	}
	if strings.Contains(newName, "..") || strings.ContainsAny(newName, "\\/") {
		return fmt.Errorf("名称不能包含路径分隔符")
	}
	// 确保在仓库根目录下
	if !strings.HasPrefix(filepath.Clean(oldPath), filepath.Clean(a.RepoRoot)+string(filepath.Separator)) {
		return fmt.Errorf("只能在仓库根目录下操作")
	}
	newPath := filepath.Join(filepath.Dir(oldPath), newName)
	if _, err := os.Stat(newPath); err == nil {
		return fmt.Errorf("目标名称已存在")
	}
	return os.Rename(oldPath, newPath)
}

// RemoveDir 删除空文件夹（回收站用）
func (a *App) RemoveDir(dir string) error {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return fmt.Errorf("目录名为空")
	}
	return os.Remove(dir)
}

// RenameFile 重命名仓库内的模型文件
func (a *App) RenameFile(oldPath, newName string) error {
	oldPath = strings.TrimSpace(oldPath)
	newName = strings.TrimSpace(newName)
	if oldPath == "" || newName == "" {
		return fmt.Errorf("参数为空")
	}
	// 防路径穿越
	if strings.Contains(newName, "..") || strings.ContainsAny(newName, "\\/") {
		return fmt.Errorf("名称不能包含路径分隔符")
	}
	if !strings.HasPrefix(filepath.Clean(oldPath), filepath.Clean(a.RepoRoot)+string(filepath.Separator)) {
		return fmt.Errorf("只能在仓库根目录下操作")
	}
	newPath := filepath.Join(filepath.Dir(oldPath), newName)
	if _, err := os.Stat(newPath); err == nil {
		return fmt.Errorf("目标文件名已存在")
	}
	return os.Rename(oldPath, newPath)
}

// FindPreviewImage 给定模型文件路径，在同目录查找同名图片（.png/.jpg/.jpeg/.webp/.gif），返回 base64 数据 URI
func (a *App) FindPreviewImage(modelPath string) string {
	dir := filepath.Dir(modelPath)
	base := filepath.Base(modelPath)
	// 去掉模型后缀
	for _, ext := range []string{".ysm", ".zip", ".7z", ".YSM", ".ZIP", ".7Z"} {
		if strings.HasSuffix(base, ext) {
			base = base[:len(base)-len(ext)]
			break
		}
	}
	exts := []string{".png", ".jpg", ".jpeg", ".webp", ".gif", ".PNG", ".JPG", ".JPEG", ".WEBP", ".GIF"}
	for _, ext := range exts {
		imgPath := filepath.Join(dir, base+ext)
		data, err := os.ReadFile(imgPath)
		if err != nil {
			continue
		}
		mime := "image/" + strings.TrimPrefix(strings.ToLower(ext), ".")
		if strings.HasSuffix(strings.ToLower(ext), "jpg") || strings.HasSuffix(strings.ToLower(ext), "jpeg") {
			mime = "image/jpeg"
		}
		b64 := base64.StdEncoding.EncodeToString(data)
		return "data:" + mime + ";base64," + b64
	}
	return ""
}

// ExtractPreviewTexture 从 zip/7z/ysm 压缩包中提取第一张 .png 纹理，返回 base64 data URI
func (a *App) ExtractPreviewTexture(modelPath string) string {
	ext := strings.ToLower(filepath.Ext(modelPath))
	data, err := os.ReadFile(modelPath)
	if err != nil {
		return ""
	}

	var pngData []byte
	if ext == ".zip" || ext == ".ysm" {
		pngData = extractPNGFromZip(data, int64(len(data)))
	} else if ext == ".7z" {
		pngData = extractPNGFrom7z(data, int64(len(data)))
	}

	// .ysm 是 YSGP 二进制格式，zip 提取失败时走 YSMParser
	if len(pngData) == 0 && ext == ".ysm" {
		pngData = a.extractTextureViaYSM(modelPath)
	}

	if len(pngData) == 0 {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngData)
}

// extractTextureViaYSM 用 YSMParser 解码 .ysm 并提取第一张纹理
func (a *App) extractTextureViaYSM(modelPath string) []byte {
	parserPath := findYSMParser()
	if parserPath == "" {
		return nil
	}
	tmpDir, err := os.MkdirTemp("", "ysm-tex-*")
	if err != nil {
		return nil
	}
	defer os.RemoveAll(tmpDir)

	inDir := filepath.Join(tmpDir, "input")
	outDir := filepath.Join(tmpDir, "output")
	os.MkdirAll(inDir, 0755)
	os.MkdirAll(outDir, 0755)

	ysmCopy := filepath.Join(inDir, filepath.Base(modelPath))
	if err := copyFile(modelPath, ysmCopy); err != nil {
		return nil
	}

	cmd := exec.Command(parserPath, "-i", inDir, "-o", outDir)
	if err := cmd.Run(); err != nil {
		return nil
	}

	var png []byte
	filepath.WalkDir(outDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || png != nil {
			return nil
		}
		low := strings.ToLower(p)
		if strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg") {
			png, _ = os.ReadFile(p)
		}
		return nil
	})
	return png
}

// GetPackInfo 读取文件夹中的 ysm-pack.json，找 ysm-pack.png 返回 base64
func (a *App) GetPackInfo(dirPath string) types.PackInfo {
	dirPath = strings.TrimSpace(dirPath)
	// 相对路径 → 拼接仓库根目录（树中文件夹可能是相对路径）
	if !filepath.IsAbs(dirPath) && a.RepoRoot != "" {
		dirPath = filepath.Join(a.RepoRoot, dirPath)
	}
	absPath, err := filepath.Abs(filepath.FromSlash(dirPath))
	if err != nil {
		return types.PackInfo{}
	}
	jsonPath := filepath.Join(absPath, "ysm-pack.json")
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return types.PackInfo{}
	}
	// 去掉 UTF-8 BOM
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	var raw struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Lang        map[string]struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		} `json:"lang"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return types.PackInfo{}
	}
	info := types.PackInfo{
		Name:        raw.Name,
		Description: raw.Description,
	}
	// 优先中文
	if l, ok := raw.Lang["zh_cn"]; ok {
		if l.Name != "" {
			info.Name = l.Name
		}
		if l.Description != "" {
			info.Description = l.Description
		}
	}
	// 读取 ysm-pack.png
	imgPath := filepath.Join(absPath, "ysm-pack.png")
	if imgData, err := os.ReadFile(imgPath); err == nil {
		info.ImageBase64 = "data:image/png;base64," + base64.StdEncoding.EncodeToString(imgData)
	}
	return info
}

func extractPNGFromZip(data []byte, size int64) []byte {
	reader, err := zip.NewReader(bytes.NewReader(data), size)
	if err != nil {
		return nil
	}
	for _, f := range reader.File {
		if strings.HasSuffix(strings.ToLower(f.Name), ".png") && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf, err := io.ReadAll(rc)
			rc.Close()
			if err == nil && len(buf) > 0 {
				return buf
			}
		}
	}
	return nil
}

func extractPNGFrom7z(data []byte, size int64) []byte {
	reader, err := sevenzip.NewReader(bytes.NewReader(data), size)
	if err != nil {
		return nil
	}
	for _, f := range reader.File {
		if strings.HasSuffix(strings.ToLower(f.Name), ".png") && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf, err := io.ReadAll(rc)
			rc.Close()
			if err == nil && len(buf) > 0 {
				return buf
			}
		}
	}
	return nil
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

// ExtractYsmSummary 提取 YSM 模型的标准摘要（供右侧面板和 AI 搜索消费）
func (a *App) ExtractYsmSummary(path string) ysm.YsmSummary {
	summary, err := ysm.ExtractYsmSummary(path)
	if err != nil {
		summary = ysm.YsmSummary{
			Schema: "ysm-summary/v1",
			Source: filepath.Base(path),
		}
	}
	return summary
}

// ExtractYSMHeader 读取 YSM 文件的文本头部元数据（适用于加密和非加密模型）
func (a *App) ExtractYSMHeader(path string) ysm.YSMHeader {
	return ysm.AnalyzeYSMHeader(path)
}

// ExtractYSMHeaderFromBase64 从 base64 数据解析 YSM 头部（导入流程使用，文件未保存到磁盘）
func (a *App) ExtractYSMHeaderFromBase64(base64Data string) ysm.YSMHeader {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return ysm.YSMHeader{}
	}
	return ysm.AnalyzeYSMHeaderFromBytes(data)
}

// SavePreviewTempFile 将 base64 数据保存到临时文件，返回路径（用于导入流程的模型预览）
func (a *App) SavePreviewTempFile(base64Data string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", err
	}
	tmpDir := filepath.Join(os.TempDir(), "ysm-preview")
	os.MkdirAll(tmpDir, 0755)
	tmpFile, err := os.CreateTemp(tmpDir, "preview-*.ysm")
	if err != nil {
		return "", err
	}
	defer tmpFile.Close()
	_, err = tmpFile.Write(data)
	if err != nil {
		return "", err
	}
	return tmpFile.Name(), nil
}

// ReadFileBytes 读取文件返回字节数组（供前端 WASM 解码使用）
func (a *App) ReadFileBytes(path string) []byte {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return data
}

// AnalyzeBedrockModel 打开模型包（zip/7z/ysm），解析几何体提取骨骼结构
func (a *App) AnalyzeBedrockModel(modelPath string) types.BedrockModel {
	ext := strings.ToLower(filepath.Ext(modelPath))

	// .ysm 由前端 WASM 解码，Go 端仅保留 CLI fallback
	if ext == ".ysm" {
		return a.runYSMParserOnFile(modelPath)
	}

	data, err := os.ReadFile(modelPath)
	if err != nil {
		return types.BedrockModel{}
	}
	var geoJSON *types.BedrockModel
	var texData [][]byte
	var animJSONs []string

	if ext == ".zip" {
		geoJSON, texData, animJSONs = parseBedrockFromZip(data, int64(len(data)))
	} else if ext == ".7z" {
		geoJSON, texData = parseBedrockFrom7z(data, int64(len(data)))
	}

	// zip/7z 内没有 minecraft:geometry → 也可能是 YSM 模型打包成 zip，尝试 YSMParser
	if geoJSON == nil && (ext == ".zip" || ext == ".7z") {
		g := a.runYSMParserOnFile(modelPath)
		geoJSON = &g
	}

	if geoJSON == nil {
		return types.BedrockModel{}
	}
	// 收集所有纹理
	var textures []string
	for _, td := range texData {
		if len(td) > 0 {
			textures = append(textures, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(td))
		}
	}
	if len(textures) > 0 {
		geoJSON.Texture = textures[0]
		geoJSON.Textures = textures
	}
	if len(animJSONs) > 0 {
		geoJSON.Animations = animJSONs
	}
	return *geoJSON
}

// findYSMParser 查找 YSMParser.exe：exe 同目录 → 工作目录 → PATH
func findYSMParser() string {
	if exe, err := os.Executable(); err == nil {
		if p := filepath.Join(filepath.Dir(exe), "YSMParser.exe"); fileExists(p) {
			return p
		}
	}
	if wd, err := os.Getwd(); err == nil {
		if p := filepath.Join(wd, "YSMParser.exe"); fileExists(p) {
			return p
		}
	}
	if p, err := exec.LookPath("YSMParser.exe"); err == nil {
		return p
	}
	if p, err := exec.LookPath("YSMParser"); err == nil {
		return p
	}
	return ""
}

// GetModel3DSpec 生成 Three.js 可直接消费的 JSON spec（基于 YSMViewer 算法）
func (a *App) GetModel3DSpec(modelPath string) string {
	model := a.AnalyzeBedrockModel(modelPath)

	spec, err := threejs.Build(model)
	if err != nil {
		return "{}"
	}
	return spec
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// runYSMParserOnFile 调用 YSMParser CLI 解码 .ysm/.zip 文件并提取几何体
func (a *App) runYSMParserOnFile(modelPath string) types.BedrockModel {
	parserPath := findYSMParser()
	if parserPath == "" {
		// 尝试 Node.js + WASM 方式解码
		if data, err := os.ReadFile(modelPath); err == nil {
			if m := decodeYSMViaNodeJS(data); m != nil {
				return *m
			}
		}
		return types.BedrockModel{}
	}

	tmpDir, err := os.MkdirTemp("", "ysm-parser-*")
	if err != nil {
		return types.BedrockModel{}
	}
	defer os.RemoveAll(tmpDir)

	inDir := filepath.Join(tmpDir, "input")
	outDir := filepath.Join(tmpDir, "output")
	os.MkdirAll(inDir, 0755)
	os.MkdirAll(outDir, 0755)

	ysmCopy := filepath.Join(inDir, filepath.Base(modelPath))
	if err := copyFile(modelPath, ysmCopy); err != nil {
		return types.BedrockModel{}
	}

	cmd := exec.Command(parserPath, "-i", inDir, "-o", outDir)
	if err := cmd.Run(); err != nil {
		return types.BedrockModel{}
	}

	var merged *types.BedrockModel
	filepath.WalkDir(outDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(strings.ToLower(p), ".json") {
			return nil
		}
		if strings.HasSuffix(p, "ysm.json") {
			return nil
		}
		data, rErr := os.ReadFile(p)
		if rErr != nil {
			return nil
		}
		if g := parseBedrockGeometry(data); g != nil {
			if merged == nil {
				merged = g
			} else {
				// 合并该 geometry 的 bones 到主模型
				merged.Bones = append(merged.Bones, g.Bones...)
				merged.BoneCount += g.BoneCount
				merged.CubeCount += g.CubeCount
				if g.TexWidth > merged.TexWidth {
					merged.TexWidth = g.TexWidth
				}
				if g.TexHeight > merged.TexHeight {
					merged.TexHeight = g.TexHeight
				}
			}
		}
		return nil
	})

	if merged == nil {
		return types.BedrockModel{}
	}

	filepath.WalkDir(outDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || merged.Texture != "" {
			return nil
		}
		low := strings.ToLower(p)
		if strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg") {
			if data, rErr := os.ReadFile(p); rErr == nil && len(data) > 0 {
				mime := "image/png"
				if strings.HasSuffix(low, ".jpg") {
					mime = "image/jpeg"
				}
				merged.Texture = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
			}
		}
		return nil
	})

	return *merged
}

// copyFile 复制文件
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func parseBedrockFromZip(data []byte, size int64) (*types.BedrockModel, [][]byte, []string) {
	reader, err := zip.NewReader(bytes.NewReader(data), size)
	if err != nil {
		return nil, nil, nil
	}
	var geo *types.BedrockModel
	var pngs [][]byte
	var pngNames []string
	var defaultTex string
	var animJSONs []string

	for _, f := range reader.File {
		low := strings.ToLower(f.Name)
		if strings.HasSuffix(low, ".json") && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf, _ := io.ReadAll(rc)
			rc.Close()

			if strings.Contains(low, "ysm.json") {
				var ysm struct {
					Properties struct {
						DefaultTexture string `json:"default_texture"`
					} `json:"properties"`
				}
				if json.Unmarshal(buf, &ysm) == nil {
					defaultTex = ysm.Properties.DefaultTexture
				}
				continue
			}

			// 收集动画 JSON
			if strings.Contains(low, "animation") || strings.Contains(low, "controller") {
				if len(buf) > 10 {
					animJSONs = append(animJSONs, string(buf))
				}
				continue
			}

			g := parseBedrockGeometry(buf)
			if g == nil || g.BoneCount == 0 {
				continue
			}
			if geo == nil {
				geo = g
			} else {
				// 全追加（同名骨骼由 threejs.Build 去重，保留首次层级）
				geo.Bones = append(geo.Bones, g.Bones...)
				geo.BoneCount += g.BoneCount
				geo.CubeCount += g.CubeCount
				// 保留最大纹理尺寸（部分几何文件声明 32×32，实际纹理大得多）
				if g.TexWidth > geo.TexWidth {
					geo.TexWidth = g.TexWidth
				}
				if g.TexHeight > geo.TexHeight {
					geo.TexHeight = g.TexHeight
				}
			}
		}
		if (strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && !f.FileInfo().IsDir() && !strings.Contains(low, "avatar/") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			data, _ := io.ReadAll(rc)
			rc.Close()
			if len(data) > 0 {
				name := f.Name
				if idx := strings.LastIndex(name, "/"); idx >= 0 { name = name[idx+1:] }
				if idx := strings.LastIndex(name, "\\"); idx >= 0 { name = name[idx+1:] }
				name = strings.TrimSuffix(name, ".png")
				name = strings.TrimSuffix(name, ".jpg")
				pngNames = append(pngNames, name)
				pngs = append(pngs, data)
			}
		}
	}
	// 默认纹理排到第一
	if defaultTex != "" && len(pngs) > 1 {
		for i, n := range pngNames {
			if n == defaultTex && i > 0 {
				pngs[0], pngs[i] = pngs[i], pngs[0]
				pngNames[0], pngNames[i] = pngNames[i], pngNames[0]
				break
			}
		}
	}
	return geo, pngs, animJSONs
}

func parseBedrockFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte) {
	reader, err := sevenzip.NewReader(bytes.NewReader(data), size)
	if err != nil {
		return nil, nil
	}
	var geo *types.BedrockModel
	var pngs [][]byte
	for _, f := range reader.File {
		low := strings.ToLower(f.Name)
		if strings.HasSuffix(low, ".json") && !strings.Contains(low, "ysm.json") && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf, _ := io.ReadAll(rc)
			rc.Close()
			g := parseBedrockGeometry(buf)
			if g == nil || g.BoneCount == 0 {
				continue
			}
			if geo == nil {
				geo = g
			} else {
				// 全追加（同名骨骼由 threejs.Build 去重，保留首次层级）
				geo.Bones = append(geo.Bones, g.Bones...)
				geo.BoneCount += g.BoneCount
				geo.CubeCount += g.CubeCount
				// 保留最大纹理尺寸（部分几何文件声明 32×32，实际纹理大得多）
				if g.TexWidth > geo.TexWidth {
					geo.TexWidth = g.TexWidth
				}
				if g.TexHeight > geo.TexHeight {
					geo.TexHeight = g.TexHeight
				}
			}
		}
		if (strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && !f.FileInfo().IsDir() && !strings.Contains(low, "avatar/") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			data, _ := io.ReadAll(rc)
			rc.Close()
			if len(data) > 0 {
				pngs = append(pngs, data)
			}
		}
	}
	return geo, pngs
}

func parseBedrockGeometry(data []byte) *types.BedrockModel {
	var raw struct {
		FormatVersion string `json:"format_version"`
		Geometry      []struct {
			Description struct {
				Identifier       string  `json:"identifier"`
				TextureWidth     float64 `json:"texture_width"`
				TextureHeight    float64 `json:"texture_height"`
			} `json:"description"`
			Bones []struct {
				Name   string        `json:"name"`
				Parent string        `json:"parent,omitempty"`
				Pivot  [3]float64    `json:"pivot"`
				Rotation json.RawMessage `json:"rotation,omitempty"`
				Cubes []struct {
					Origin   [3]float64     `json:"origin"`
					Size     [3]float64     `json:"size"`
					Pivot    [3]float64     `json:"pivot,omitempty"`
					UV       json.RawMessage `json:"uv,omitempty"`
					Rotation json.RawMessage `json:"rotation,omitempty"`
				} `json:"cubes"`
			} `json:"bones"`
		} `json:"minecraft:geometry"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}
	if len(raw.Geometry) == 0 {
		return nil
	}
	g := raw.Geometry[0]
	model := &types.BedrockModel{
		Format:    raw.FormatVersion,
		TexWidth:  int(g.Description.TextureWidth),
		TexHeight: int(g.Description.TextureHeight),
	}
	var cubeTotal int
	for _, b := range g.Bones {
		cubes := make([]types.Cube2D, 0, len(b.Cubes))
		for _, c := range b.Cubes {
			var uv [2]float64
			var faceUV string
			var rot [3]float64
			if len(c.UV) > 0 {
				uvStr := string(c.UV)
				if len(uvStr) > 0 && uvStr[0] == '{' {
					faceUV = uvStr
				} else {
					json.Unmarshal(c.UV, &uv)
				}
			}
			if len(c.Rotation) > 0 {
				json.Unmarshal(c.Rotation, &rot)
			}
			cubes = append(cubes, types.Cube2D{
				Origin:   c.Origin,
				Size:     c.Size,
				Pivot:    c.Pivot,
				UV:       uv,
				FaceUV:   faceUV,
				Rotation: rot,
			})
		}
		var boneRot [3]float64
		if len(b.Rotation) > 0 {
			json.Unmarshal(b.Rotation, &boneRot)
		}
		model.Bones = append(model.Bones, types.Bone2D{
			Name:   b.Name,
			Parent: b.Parent,
			Pivot:  b.Pivot,
			Rotation: boneRot,
			Cubes:  cubes,
		})
		cubeTotal += len(cubes)
	}
	model.BoneCount = len(g.Bones)
	model.CubeCount = cubeTotal
	return model
}

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
	return a.importModelFile(fileName, base64Data, false)
}

// ImportModelFileSkipCheck 导入模型文件，跳过文件头校验（用于已知安全但头损坏的文件）
func (a *App) ImportModelFileSkipCheck(fileName, base64Data string) error {
	return a.importModelFile(fileName, base64Data, true)
}

// importModelFile 导入模型文件，skipCheck=true 跳过 ZIP/7z 魔数校验
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
	// 校验文件头魔数（ZIP/7z），不一致时仅提示警告，不阻止导入
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

// ImportModelFileOverwrite 导入并覆盖已存在的文件
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

// ImportModelFileTo 导入模型文件到子目录（保持文件夹结构）
func (a *App) ImportModelFileTo(fileName, subpath, base64Data string) error {
	return a.importModelFileWithSubpath(fileName, subpath, base64Data, false)
}

// ImportModelFileOverwriteTo 导入并覆盖子目录下的文件
func (a *App) ImportModelFileOverwriteTo(fileName, subpath, base64Data string) error {
	return a.importModelFileWithSubpath(fileName, subpath, base64Data, true)
}

// importModelFileWithSubpath 导入模型到子目录
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
		// 去掉 .ban 后缀再匹配
		lookupName := strings.TrimSuffix(fileName, ".ban")

		// 检查仓库是否有同名或同哈希文件，如果没有则跳过删除（怕误删未上传的模型）
		_, hasName := repoByName[lookupName]
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
	return ysmsync.GetInstanceStatus(mcRoot, repoDir, a.ScanModelEntries)
}

func (a *App) SyncModelToggleStatus(instanceCustomDir, repoRoot string) (int, int, error) {
	return ysmsync.SyncToggleStatus(instanceCustomDir, repoRoot, a.ScanModelEntries)
}

// RelinkCustomDir 重新链接整合包 custom 目录下的已有模型（切换链接模式后用）
func (a *App) RelinkCustomDir(customDir, repoRoot string) (int, error) {
	customDir = strings.TrimSpace(customDir)
	repoRoot = strings.TrimSpace(repoRoot)
	if customDir == "" || repoRoot == "" {
		return 0, fmt.Errorf("参数为空")
	}

	// 扫描仓库文件，建立 hash→路径 映射
	repoEntries := a.ScanModelEntries(repoRoot)
	repoByHash := make(map[string]string)
	for _, e := range repoEntries {
		if e.Hash != "" {
			repoByHash[e.Hash] = e.Path
		}
	}

	// 扫描 custom 目录
	customEntries := a.ScanModelEntries(customDir)
	count := 0

	for _, ce := range customEntries {
		if ce.Hash == "" {
			continue
		}
		srcPath, found := repoByHash[ce.Hash]
		if !found {
			continue // 仓库无此文件，跳过
		}
		// 删除已有文件
		if err := os.Remove(ce.Path); err != nil {
			continue
		}
		// 用当前链接模式重新安装
		if err := installer.Install(srcPath, customDir, repoRoot, a.LinkMode); err != nil {
			continue
		}
		count++
	}
	return count, nil
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
