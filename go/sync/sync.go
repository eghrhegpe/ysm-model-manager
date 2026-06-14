package sync

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"
)

// ScanFunc 扫描模型（函数类型，由 app.go 注入）
type ScanFunc func(dir string) []types.ModelEntry

// ListVersionsFunc 列出版本实例（函数类型，测试时可注入 mock）
type ListVersionsFunc func(mcRoot string) []types.VersionInstance

// GetInstanceStatus 获取整合包状态（使用真实 ListVersions）
func GetInstanceStatus(mcRoot, repoDir string, scanFn ScanFunc) []types.InstanceStatus {
	return GetInstanceStatusWith(mcRoot, repoDir, scanFn, ListVersions)
}

// GetInstanceStatusWith 可注入的整合包状态获取（测试用）
func GetInstanceStatusWith(mcRoot, repoDir string, scanFn ScanFunc, listFn ListVersionsFunc) []types.InstanceStatus {
	if mcRoot == "" || repoDir == "" {
		return []types.InstanceStatus{}
	}

	repoEntries := scanFn(repoDir)
	repoByHash := make(map[string][]types.ModelEntry)
	for _, e := range repoEntries {
		if e.Hash == "" {
			continue
		}
		// 跳过禁用的模型（.ban），它们不应出现在缺失列表中
		if strings.HasSuffix(strings.ToLower(e.Name), ".ban") {
			continue
		}
		repoByHash[e.Hash] = append(repoByHash[e.Hash], e)
	}

	instances := listFn(mcRoot)
	var results []types.InstanceStatus

	for _, ins := range instances {
		customEntries := scanFn(ins.CustomDir)
		customByHash := make(map[string]bool)
		for _, c := range customEntries {
			if c.Hash != "" {
				customByHash[c.Hash] = true
			}
		}

		status := types.InstanceStatus{
			Name:      ins.Name,
			CustomDir: ins.CustomDir,
			Missing:   []string{},
			Extra:     []string{},
			Disabled:  []string{},
			HasYSM:    ysm.HasYSMMod(filepath.Join(ins.VersionDir, "mods")),
		}

		for hash, entries := range repoByHash {
			if !customByHash[hash] {
				for _, e := range entries {
					status.Missing = append(status.Missing, e.Path)
				}
			}
		}
		// 预构建禁用哈希集合
		bannedHashes := make(map[string]bool)
		for _, re := range repoEntries {
			if strings.HasSuffix(strings.ToLower(re.Name), ".ban") && re.Hash != "" {
				bannedHashes[re.Hash] = true
			}
		}

		for _, c := range customEntries {
			if c.Hash == "" {
				continue
			}
			if bannedHashes[c.Hash] {
				// 仓库已禁用此模型 → 标记为已禁用，不入额外
				name := c.Name
				if strings.HasSuffix(strings.ToLower(name), ".ban") {
					name = name[:len(name)-4]
				}
				status.Disabled = append(status.Disabled, name)
			} else if _, found := repoByHash[c.Hash]; !found {
				// 仓库中没有此哈希 → 额外
				name := c.Name
				if strings.HasSuffix(strings.ToLower(name), ".ban") {
					name = name[:len(name)-4]
				}
				status.Extra = append(status.Extra, name)
			}
		}

		// 收集 custom 目录下每个文件的链接类型
		for _, c := range customEntries {
			linkType := GetLinkType(c.Path)
			fileName := c.Name
			// 去掉 .ban 后缀，方便前端匹配
			if strings.HasSuffix(strings.ToLower(fileName), ".ban") {
				fileName = fileName[:len(fileName)-4]
			}
			status.Files = append(status.Files, types.CustomFileInfo{
				Name:     fileName,
				LinkType: linkType,
			})
		}
		status.Synced = len(status.Files)

		if len(status.Missing) == 0 && len(status.Extra) == 0 {
			status.Status = "complete"
		} else if len(status.Extra) > 0 {
			status.Status = "extra"
		} else {
			status.Status = "missing"
		}
		results = append(results, status)
	}
	return results
}

// SyncToggleStatus 同步启用/禁用状态
func SyncToggleStatus(instanceCustomDir, repoRoot string, scanFn ScanFunc) (int, int, error) {
	repoEntries := scanFn(repoRoot)
	repoHash := make(map[string]bool) // hash → banned
	repoName := make(map[string]bool) // relPath(去.ban) → banned，用于同名不同文件夹的文件
	repoRootClean := strings.ToLower(filepath.Clean(repoRoot)) + string(filepath.Separator)
	for _, e := range repoEntries {
		banned := strings.HasSuffix(strings.ToLower(e.Name), ".ban")
		// 用路径前缀限定：relPath 带至少一级父文件夹，避免跨文件夹撞名
		ePath := strings.ToLower(e.Path)
		if strings.HasPrefix(ePath, repoRootClean) {
			rel := strings.TrimPrefix(ePath, repoRootClean)
			rel = strings.TrimSuffix(rel, ".ban")
			repoName[rel] = banned
		} else {
			// fallback：纯文件名（顶层文件）
			baseName := strings.TrimSuffix(strings.ToLower(e.Name), ".ban")
			repoName[baseName] = banned
		}
		if e.Hash != "" {
			repoHash[e.Hash] = banned
		}
	}
	if len(repoHash) == 0 && len(repoName) == 0 {
		return 0, 0, fmt.Errorf("仓库中未找到模型文件")
	}

	disableCount := 0
	enableCount := 0
	customDirClean := strings.ToLower(filepath.Clean(instanceCustomDir)) + string(filepath.Separator)
	filepath.WalkDir(instanceCustomDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if strings.Contains(strings.ToLower(p), ".recycle") {
			return nil
		}
		actualPath := p
		isCurrentlyBanned := strings.HasSuffix(strings.ToLower(p), ".ban")
		if isCurrentlyBanned {
			actualPath = p[:len(p)-4]
		}
		ext := strings.ToLower(filepath.Ext(actualPath))
		if ext != ".ysm" && ext != ".zip" && ext != ".7z" {
			return nil
		}

		// 先试哈希匹配，再用多级路径匹配，最后 fallback 到纯文件名
		var shouldBeBanned bool
		var matched bool
		hash := computeHash(p)
		if hash != "" {
			shouldBeBanned, matched = repoHash[hash]
		}
		if !matched {
			// 用 relative path 匹配（带文件夹限定）
			pLower := strings.ToLower(p)
			if strings.HasPrefix(pLower, customDirClean) {
				rel := strings.TrimPrefix(pLower, customDirClean)
				rel = strings.TrimSuffix(rel, ".ban")
				shouldBeBanned, matched = repoName[rel]
			}
		}
		if !matched {
			// fallback：纯文件名（旧仓库或同名不同路径的特例）
			baseName := strings.ToLower(filepath.Base(actualPath))
			shouldBeBanned, matched = repoName[baseName]
		}
		if !matched {
			return nil
		}

		if shouldBeBanned && !isCurrentlyBanned {
			newPath := p + ".ban"
			if _, err := os.Stat(newPath); err == nil {
				return nil
			}
			if err := os.Rename(p, newPath); err == nil {
				disableCount++
			} else if isFileLocked(err) {
				// 文件被其他进程锁定（如 Minecraft），跳过
			} else {
				// 其他错误也跳过，不阻塞
			}
		} else if !shouldBeBanned && isCurrentlyBanned {
			newPath := p[:len(p)-4]
			if err := os.Rename(p, newPath); err == nil {
				enableCount++
			} else if isFileLocked(err) {
				// 文件被其他进程锁定（如 Minecraft），跳过
			}
		}
		return nil
	})
	return disableCount, enableCount, nil
}

func ListVersions(mcRoot string) []types.VersionInstance {
	// 1. 自身就是 instances 目录（子目录中含 .minecraft/）
	if HasDotMinecraftSubdirs(mcRoot) {
		return listPrismInstances(mcRoot)
	}
	// 2. PrismLauncher 根目录: {mcRoot}/instances/{name}/.minecraft/
	instancesDir := filepath.Join(mcRoot, "instances")
	if info, err := os.Stat(instancesDir); err == nil && info.IsDir() {
		return listPrismInstances(instancesDir)
	}
	// 3. 标准布局: {mcRoot}/versions/{name}/
	return listVanillaInstances(mcRoot)
}

// HasDotMinecraftSubdirs 检测目录的子目录中是否包含 .minecraft/ 或 minecraft/（用于识别 instances 目录）
func HasDotMinecraftSubdirs(path string) bool {
	ents, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		if findMinecraftDir(filepath.Join(path, e.Name())) != "" {
			return true
		}
	}
	return false
}

// findMinecraftDir 在给定目录下查找 .minecraft 或 minecraft 子目录，返回找到的路径
func findMinecraftDir(parentDir string) string {
	for _, sub := range []string{".minecraft", "minecraft"} {
		p := filepath.Join(parentDir, sub)
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			return p
		}
	}
	return ""
}

// listVanillaInstances 标准 .minecraft/versions/{name}/ 布局
func listVanillaInstances(mcRoot string) []types.VersionInstance {
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

// listPrismInstances PrismLauncher 布局: {instancesDir}/{name}/.minecraft/ 或 minecraft/
func listPrismInstances(instancesDir string) []types.VersionInstance {
	ents, err := os.ReadDir(instancesDir)
	if err != nil {
		return []types.VersionInstance{}
	}
	out := []types.VersionInstance{}
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		// PrismLauncher 实例目录下可能是 .minecraft 或 minecraft（无点）
		mcDir := findMinecraftDir(filepath.Join(instancesDir, name))
		if mcDir == "" {
			continue
		}
		custom := filepath.Join(mcDir, "config", "yes_steve_model", "custom")
		exists := true
		if _, st := os.Stat(custom); os.IsNotExist(st) {
			exists = false
		}
		out = append(out, types.VersionInstance{
			Name:       name,
			VersionDir: mcDir,
			CustomDir:  custom,
			Exists:     exists,
		})
	}
	return out
}

func computeHash(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	io.Copy(h, f)
	return fmt.Sprintf("%x", h.Sum(nil))
}

// SyncResources 对比两个目录的资源文件差异，按文件名匹配
// 用于资源库（材质包/光影包等）的全局 ↔ 整合包同步
// 只统计模型/资源相关扩展名的文件，忽略无关文件
var syncAllowedExts = types.AllExts

func isSyncAllowed(name string) bool {
	low := strings.ToLower(name)
	base := strings.TrimSuffix(low, ".disabled")
	base = strings.TrimSuffix(base, ".ban")
	// .json 只允许 ysm.json（动作/动画文件不应单独扫描推送）
	if strings.HasSuffix(base, ".json") {
		return base == "ysm.json"
	}
	for _, ext := range syncAllowedExts {
		if strings.HasSuffix(base, ext) {
			return true
		}
	}
	return false
}

// isResourcePackFolder 检查目录是否是资源包文件夹（内含 pack.mcmeta）
func isResourcePackFolder(path string) bool {
	_, err := os.Stat(filepath.Join(path, "pack.mcmeta"))
	return err == nil
}

// SyncResources 对比两个目录的资源文件差异，按文件名匹配
// 用于资源库（材质包/光影包等）的全局 ↔ 整合包同步
// 只统计模型/资源相关扩展名的文件，忽略无关文件
func SyncResources(globalDir, instanceDir string) types.ResourceSyncResult {
	result := types.ResourceSyncResult{}

	// 扫描全局目录，收集文件名
	globalFiles := make(map[string]string) // name → path
	filepath.Walk(globalDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			// 资源包文件夹：扫描其本身但不递归
			if path != globalDir && isResourcePackFolder(path) {
				name := strings.ToLower(info.Name())
				globalFiles[name] = path
			}
			return nil
		}
		if !isSyncAllowed(info.Name()) {
			return nil
		}
		name := strings.ToLower(info.Name())
		name = strings.TrimSuffix(name, ".disabled")
		globalFiles[name] = path
		return nil
	})

	// 扫描整合包目录
	instanceFiles := make(map[string]string)
	filepath.Walk(instanceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			// 资源包文件夹：扫描其本身但不递归
			if path != instanceDir && isResourcePackFolder(path) {
				name := strings.ToLower(info.Name())
				instanceFiles[name] = path
			}
			return nil
		}
		if !isSyncAllowed(info.Name()) {
			return nil
		}
		name := strings.ToLower(info.Name())
		name = strings.TrimSuffix(name, ".disabled")
		instanceFiles[name] = path
		return nil
	})

	// 找出 synced / missing / extra
	for name, gPath := range globalFiles {
		if _, exists := instanceFiles[name]; exists {
			result.Synced = append(result.Synced, gPath)
		} else {
			result.Missing = append(result.Missing, gPath)
		}
	}
	for name, iPath := range instanceFiles {
		if _, exists := globalFiles[name]; !exists {
			result.Extra = append(result.Extra, iPath)
		}
	}

	sort.Strings(result.Synced)
	sort.Strings(result.Missing)
	sort.Strings(result.Extra)
	return result
}

// isDirTypeModelFolder 检查一个子目录是否包含 YSM/MMD 模型文件（即文件夹级资源）
// 用于 YSM（ysm.json）和 MMD（.pmx/.pmd）类型的文件夹级同步
func isDirTypeModelFolder(path string, rtype string) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		low := strings.ToLower(e.Name())
		base := strings.TrimSuffix(low, ".ban")
		switch rtype {
		case "ysm":
			if base == "ysm.json" {
				return true
			}
		case "mmd-skin":
			ext := filepath.Ext(base)
			if ext == ".pmx" || ext == ".pmd" {
				return true
			}
		}
	}
	return false
}

// SyncResourcesDirLevel 按文件夹名对比资源（用于 YSM 的 ysm.json 文件夹和 MMD 的 .pmx/.pmd 文件夹）
// 以文件夹名为单位，一个文件夹包含模型文件 + 纹理文件 = 一个整体
// 路径存储：全局侧存全局路径，实例侧存实例路径；missing/extra 都是文件夹路径
func SyncResourcesDirLevel(globalDir, instanceDir, rtype string) types.ResourceSyncResult {
	result := types.ResourceSyncResult{}

	// 扫描全局目录，收集所有包含模型文件的文件夹名
	globalDirs := make(map[string]string) // lowercase folder name → full path
	filepath.Walk(globalDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || !info.IsDir() || path == globalDir {
			return nil
		}
		if isDirTypeModelFolder(path, rtype) {
			name := strings.ToLower(info.Name())
			globalDirs[name] = path
			return filepath.SkipDir // 不递归子文件夹
		}
		return nil
	})

	// 扫描整合包目录，收集所有包含模型文件的文件夹名
	instanceDirs := make(map[string]string)
	filepath.Walk(instanceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || !info.IsDir() || path == instanceDir {
			return nil
		}
		if isDirTypeModelFolder(path, rtype) {
			name := strings.ToLower(info.Name())
			instanceDirs[name] = path
			return filepath.SkipDir
		}
		return nil
	})

	// 找出 synced / missing / extra
	seen := make(map[string]bool)
	for name, gPath := range globalDirs {
		seen[name] = true
		if _, exists := instanceDirs[name]; exists {
			result.Synced = append(result.Synced, gPath)
		} else {
			result.Missing = append(result.Missing, gPath)
		}
	}
	for name, iPath := range instanceDirs {
		if !seen[name] {
			result.Extra = append(result.Extra, iPath)
		}
	}

	sort.Strings(result.Synced)
	sort.Strings(result.Missing)
	sort.Strings(result.Extra)
	return result
}

// SortEntries 鎸夊悕绉版帓搴忔ā鍨嬫潯鐩?
func SortEntries(entries []types.ModelEntry) {
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})
}

// getLinkType 判断文件的链接类型
// GetLinkType 判断文件的链接类型
func GetLinkType(path string) types.LinkType {
	info, err := os.Lstat(path)
	if err != nil {
		return types.LinkUnknown
	}
	// 符号链接
	if info.Mode()&os.ModeSymlink != 0 {
		return types.LinkSym
	}
	// 在 Windows 上判断硬链接：通过 syscall.GetFileInformationByHandle 获取 nlink
	// 如果 nlink > 1，说明是硬链接
	return checkHardLink(path)
}

// isFileLocked 判断错误是否因为文件被其他进程锁定
func isFileLocked(err error) bool {
	if err == nil {
		return false
	}
	// Windows 共享违例 (ERROR_SHARING_VIOLATION)
	// 或权限拒绝 (ERROR_ACCESS_DENIED) — 文件被打开时常见
	if linkErr, ok := err.(*os.LinkError); ok {
		if linkErr.Err != nil {
			msg := strings.ToLower(linkErr.Err.Error())
			if strings.Contains(msg, "sharing") ||
				strings.Contains(msg, "access") ||
				strings.Contains(msg, "used by another process") {
				return true
			}
		}
	}
	return false
}
