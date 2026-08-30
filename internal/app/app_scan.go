// ========== 批量导出 + 高级搜索 + 模型扫描（薄壳，ADR-003 P2）==========
// 核心扫描/哈希/缓存/作者提取/索引生成已下沉至 go/scanner（纯 Go 可测）；
// 本文件仅保留依赖 App（AnalyzeBedrockModel / tagsStore / AddOpLog）与 GUI 的方法。
package app

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/scanner"
	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
)

// ========== 导出单模型骨骼结构 ==========
// ExportModelStructureJSON 导出单模型骨骼结构
func (a *App) ExportModelStructureJSON(modelPath string) string {
	model := a.AnalyzeBedrockModel(modelPath)
	if model.BoneCount == 0 {
		return "{}"
	}
	type boneInfo struct {
		Name   string     `json:"name"`
		Parent string     `json:"parent,omitempty"`
		Pivot  [3]float64 `json:"pivot"`
		Cubes  int        `json:"cubes"`
		TexIdx int        `json:"texIdx"`
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
		File: filepath.Base(modelPath), BoneCount: model.BoneCount,
		CubeCount: model.CubeCount, TexWidth: model.TexWidth,
		TexHeight: model.TexHeight, TextureCnt: len(model.Textures),
	}
	for _, b := range model.Bones {
		info.Bones = append(info.Bones, boneInfo{
			Name: b.Name, Parent: b.Parent, Pivot: b.Pivot,
			Cubes: len(b.Cubes), TexIdx: 0,
		})
	}
	return marshalJSONIndent("AnalyzeModelDetail", info, "{}")
}

// ========== 高级搜索 ==========
// SearchModels 扫描模型条目后按关键词、骨骼数、立方体数、纹理尺寸范围过滤。
// 并发优化：关键词预过滤后，用 goroutine 池并行 AnalyzeBedrockModel（I/O + CPU 混合型）。
func (a *App) SearchModels(filesRoot string, keyword string, minBones, maxBones, minCubes, maxCubes, minTex, maxTex int) []types.SearchResult {
	entries := a.ScanModelEntries(filesRoot)
	if len(entries) == 0 {
		return nil
	}
	kw := strings.ToLower(strings.TrimSpace(keyword))

	// Phase 1：关键词预过滤（纯内存操作，快速缩小候选集）
	var candidates []types.ModelEntry
	if kw != "" {
		for _, entry := range entries {
			name := strings.ToLower(entry.Name)
			if strings.Contains(name, kw) || strings.Contains(strings.ToLower(entry.Path), kw) {
				candidates = append(candidates, entry)
			}
		}
	} else {
		candidates = entries
	}
	if len(candidates) == 0 {
		return nil
	}

	// Phase 2：并发分析 + 过滤
	if len(candidates) <= 2 {
		return a.searchModelsSequential(candidates, minBones, maxBones, minCubes, maxCubes, minTex, maxTex)
	}
	return a.searchModelsConcurrent(candidates, minBones, maxBones, minCubes, maxCubes, minTex, maxTex)
}

// searchModelsSequential 顺序分析（候选 <= 2 时，goroutine 开销不划算）
func (a *App) searchModelsSequential(entries []types.ModelEntry, minBones, maxBones, minCubes, maxCubes, minTex, maxTex int) []types.SearchResult {
	var results []types.SearchResult
	for _, entry := range entries {
		model := a.AnalyzeBedrockModel(entry.Path)
		if !modelMatchesFilters(model, minBones, maxBones, minCubes, maxCubes, minTex, maxTex) {
			continue
		}
		results = append(results, types.SearchResult{
			Name: entry.Name, Path: entry.Path,
			BoneCount: model.BoneCount, CubeCount: model.CubeCount,
			TexWidth: model.TexWidth, TexHeight: model.TexHeight,
		})
	}
	// 与 searchModelsConcurrent 对齐：候选声明序已稳定，再按 Name 主键排序保证跨路径口径一致。
	sort.SliceStable(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})
	return results
}

// searchModelsConcurrent 并发分析（goroutine 池 + 有序收集结果）
func (a *App) searchModelsConcurrent(entries []types.ModelEntry, minBones, maxBones, minCubes, maxCubes, minTex, maxTex int) []types.SearchResult {
	return runConcurrentAnalyze(len(entries), func(i int) *types.SearchResult {
		entry := entries[i]
		model := a.AnalyzeBedrockModel(entry.Path)
		if !modelMatchesFilters(model, minBones, maxBones, minCubes, maxCubes, minTex, maxTex) {
			return nil
		}
		return &types.SearchResult{
			Name: entry.Name, Path: entry.Path,
			BoneCount: model.BoneCount, CubeCount: model.CubeCount,
			TexWidth: model.TexWidth, TexHeight: model.TexHeight,
		}
	})
}

// modelMatchesFilters 检查模型是否满足所有过滤条件（bone/cube/tex）
func modelMatchesFilters(model types.BedrockModel, minBones, maxBones, minCubes, maxCubes, minTex, maxTex int) bool {
	if model.BoneCount == 0 {
		return false
	}
	if minBones > 0 && model.BoneCount < minBones {
		return false
	}
	if maxBones > 0 && model.BoneCount > maxBones {
		return false
	}
	if minCubes > 0 && model.CubeCount < minCubes {
		return false
	}
	if maxCubes > 0 && model.CubeCount > maxCubes {
		return false
	}
	if minTex > 0 && (model.TexWidth < minTex || model.TexHeight < minTex) {
		return false
	}
	if maxTex > 0 && (model.TexWidth > maxTex || model.TexHeight > maxTex) {
		return false
	}
	return true
}

// runConcurrentAnalyze 并发分析 count 个候选项并确定性排序返回（searchModelsConcurrent /
// SearchAllModels 收敛复用，消除两处 Phase 2 复制）。analyze(i) 完成单项的过滤 + 构建：
// 不满足条件返回 nil 即跳过该项。排序口径：名称主键 + 原始索引兜底，消除 goroutine
// 完成序随机导致的「同输入不同输出」（ADR-119 确定性契约）。
func runConcurrentAnalyze(count int, analyze func(i int) *types.SearchResult) []types.SearchResult {
	workers := runtime.NumCPU()
	if workers < 2 {
		workers = 2
	}
	type indexedResult struct {
		index  int
		result *types.SearchResult
	}
	taskCh := make(chan int, count)
	resultCh := make(chan indexedResult, count)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range taskCh {
				if r := analyze(idx); r != nil {
					resultCh <- indexedResult{index: idx, result: r}
				}
			}
		}()
	}
	for i := range count {
		taskCh <- i
	}
	close(taskCh)
	go func() {
		wg.Wait()
		close(resultCh)
	}()
	// 收集带原始索引的结果（goroutine 完成序随机，index 用于确定性兜底）
	var indexed []indexedResult
	for r := range resultCh {
		if r.result != nil {
			indexed = append(indexed, r)
		}
	}
	// 按名称为主键、原始索引为兜底键稳定排序：
	// 同名不同路径的候选按扫描声明序排列，消除并发完成序导致的「同输入不同输出」。
	sort.SliceStable(indexed, func(i, j int) bool {
		if ni, nj := indexed[i].result.Name, indexed[j].result.Name; ni != nj {
			return ni < nj
		}
		return indexed[i].index < indexed[j].index
	})
	results := make([]types.SearchResult, len(indexed))
	for i, r := range indexed {
		results[i] = *r.result
	}
	return results
}

// SearchAllModels 跨类型搜索：遍历所有已配置资源类型的根目录，并发扫描 + 合并结果。
// allRoots 为 rtype→root 映射（由 GetAllRepoRoots 提供）；每个搜索结果携带 Type 字段。
// 关键词/数值过滤逻辑与 SearchModels 一致，但扫描范围覆盖全部类型。
func (a *App) SearchAllModels(allRoots map[string]string, keyword string, minBones, maxBones, minCubes, maxCubes, minTex, maxTex int) []types.SearchResult {
	if len(allRoots) == 0 {
		return nil
	}
	kw := strings.ToLower(strings.TrimSpace(keyword))

	// 收集所有类型的条目，每个条目携带类型标记。
	// 先按 rtype 排序再迭代：Go map 迭代序随机，直接 range 会让同名跨类型条目
	// 的 index tiebreak 逐次不同（sort.SliceStable by (Name, index) 的兜底键失效）。
	type typedEntry struct {
		entry types.ModelEntry
		rtype string
	}
	var all []typedEntry
	rtypes := make([]string, 0, len(allRoots))
	for rtype := range allRoots {
		rtypes = append(rtypes, rtype)
	}
	sort.Strings(rtypes)
	for _, rtype := range rtypes {
		root := allRoots[rtype]
		// allRoots 来源 GetAllRepoRoots，路径已验证在仓库根内，无需重复守卫；
		// 走 scanModelEntries（无日志薄壳）避免跨类型搜索刷 N 条扫描日志。
		entries := a.scanModelEntries(root)
		for _, e := range entries {
			all = append(all, typedEntry{entry: e, rtype: rtype})
		}
	}
	if len(all) == 0 {
		return nil
	}

	// Phase 1：关键词预过滤
	var candidates []typedEntry
	if kw != "" {
		for _, te := range all {
			name := strings.ToLower(te.entry.Name)
			if strings.Contains(name, kw) || strings.Contains(strings.ToLower(te.entry.Path), kw) {
				candidates = append(candidates, te)
			}
		}
	} else {
		candidates = all
	}
	if len(candidates) == 0 {
		return nil
	}

	// Phase 2：并发分析 + 过滤
	return runConcurrentAnalyze(len(candidates), func(i int) *types.SearchResult {
		te := candidates[i]
		model := a.AnalyzeBedrockModel(te.entry.Path)
		if !modelMatchesFilters(model, minBones, maxBones, minCubes, maxCubes, minTex, maxTex) {
			return nil
		}
		return &types.SearchResult{
			Name: te.entry.Name, Path: te.entry.Path, Type: te.rtype,
			BoneCount: model.BoneCount, CubeCount: model.CubeCount,
			TexWidth: model.TexWidth, TexHeight: model.TexHeight,
		}
	})
}

// ========== 模型扫描（薄壳）==========
// scanModelEntries 扫描核心（无操作日志）：watcher 自动同步等后台路径使用，
// 避免自动化触发刷屏操作日志面板。保持单返回值以兼容 watcher.ScanFunc 契约。
func (a *App) scanModelEntries(dir string) []types.ModelEntry {
	entries, _ := a.scanModelEntriesWithHit(dir)
	return entries
}

// scanModelEntriesWithHit 同 scanModelEntries，但额外返回是否命中 30s 缓存，
// 供 ScanModelEntries 决定是否记录扫描日志（命中缓存不记，避免刷屏）。
func (a *App) scanModelEntriesWithHit(dir string) ([]types.ModelEntry, bool) {
	entries, hit := scanner.ScanEntriesWithHit(strings.TrimSpace(dir))
	// 批量填充 HasTags（利用标签存储的读缓存，不重复读磁盘）
	// 统一走 getTagsStore() 入口——原裸读 a.tagsStore 与 sync.Once 内写入构成数据竞争
	if ts := a.getTagsStore(); ts != nil {
		for i := range entries {
			if tags, _ := ts.GetTags(entries[i].Path); len(tags) > 0 {
				entries[i].HasTags = true
			}
		}
	}
	return entries, hit
}

// ScanModelEntries 用户可见的扫描入口（Wails 绑定），记录操作日志。
// 仅在真正扫盘（缓存未命中）时记日志，30s 内重复访问命中缓存则跳过，避免刷屏。
func (a *App) ScanModelEntries(dir string) []types.ModelEntry {
	// 壳层套路径守卫——与 ListFileNames/ListAllFilePaths
	// 同文件已有守卫对齐；原 ScanModelEntries 未守卫，前端可传 `..`/盘符根把扫描越出
	// 仓库根遍历任意目录（ADR-044③ 路径边界对称范式）。
	// 注意：扫描是只读操作，必须放行仓库根本身（rel==.，整仓扫描是核心场景）；
	// isPathInRoot 的 rel==. 拒绝语义专为 RemoveDir/RenameDir 防整删设计，不可复用。
	if !a.isPathInRootOrSelf(dir) {
		return nil
	}
	entries, hit := a.scanModelEntriesWithHit(dir)
	if !hit {
		a.AddOpLog("scan", fmt.Sprintf("扫描 %d 个文件", len(entries)), dir, "", int64(len(entries)), "success", "")
	}
	return entries
}

// ScanModelEntriesWithLabel 同 ScanModelEntries，但操作日志附带资源类型标签
// （如「资源包」「光影包」「模型」），便于在操作日志面板区分扫描的文件类型。
// 仅在缓存未命中时记日志，避免刷屏。
// 与 ScanModelEntries 共用同一路径守卫——原实现无守卫，
// 前端主扫描入口（loader.ts/app-content/community.ts 等）可传 `..`/盘符根越权遍历，
// 且与 ScanModelEntries 行为不一致（ADR-044③ 路径边界对称范式）。
func (a *App) ScanModelEntriesWithLabel(dir string, label string) []types.ModelEntry {
	if !a.isPathInRootOrSelf(dir) {
		return nil
	}
	entries, hit := a.scanModelEntriesWithHit(dir)
	if !hit {
		msg := fmt.Sprintf("扫描 %d 个文件", len(entries))
		if label != "" {
			msg += " · " + label
		}
		a.AddOpLog("scan", msg, dir, "", int64(len(entries)), "success", "")
	}
	return entries
}

// ScanModelEntriesFiltered 同 ScanModelEntriesWithLabel，但额外按 rtype（+可选 subtype）的 extensions
// 注册表做类型特定扩展名过滤。前端预览菜单切换模型场景用——EntityPlayer 类型需排除
// .vmd/.vpd 动作文件，仅保留 .pmx/.pmd/.zip 模型/容器文件。
//
// subtype 参数：按子类型隔离扩展名（如 EntityPlayer → 只有 .pmx/.pmd/.zip，不含 .vmd/.vpd）。
// subtype 为空时回退到父类型扩展名（壳类型场景）。
// 过滤逻辑：取 types.SupportedExtsForSubtype(rtype, subtype) 白名单，扩展名不匹配的条目直接丢弃。
// rtype 为空或注册表无匹配时退化为 ScanModelEntriesWithLabel 行为（不过滤）。
// 路径守卫与 ScanModelEntries/ScanModelEntriesWithLabel 完全一致。
func (a *App) ScanModelEntriesFiltered(dir string, rtype string, subtype string, label string) []types.ModelEntry {
	a.ensureContainerCache() // 兜底：测试用 repoApp 不经 NewApp 构造时惰性初始化
	if !a.isPathInRootOrSelf(dir) {
		return nil
	}
	entries, hit := a.scanModelEntriesWithHit(dir)
	// 按 rtype（+subtype）扩展名白名单过滤，并填充 Type 字段
	if allowedExts := types.SupportedExtsForSubtype(rtype, subtype); len(allowedExts) > 0 {
		extSet := make(map[string]bool, len(allowedExts))
		for _, e := range allowedExts {
			extSet[strings.ToLower(e)] = true
		}
		registry := types.LoadRegistry()
		filtered := make([]types.ModelEntry, 0, len(entries))
		for _, e := range entries {
			// 与 scanner 同口径：文件级 .disabled/.ban 已由 scanner 恢复为原扩展名
			// （e.Ext）。此处不能用 filepath.Ext(e.Path)——对 ToggleEnable 改名的
			// xxx.zip.disabled 返回 ".disabled" 不在白名单，禁用文件被丢弃 → 仓库树
			// 看不到禁用文件、无法再启用（2026-08-24 修复）。
			ext := strings.ToLower(e.Ext)
			if !extSet[ext] {
				continue
			}
			// 容器扩展名（.zip/.7z）的类型归属不可靠扩展名判定（ADR-067）：
			// 任何类型都可能被打包进容器，扩展名只表示「可能是」，必须打开容器
			// 按内部 ZipEntries 内容指纹核验真实类型，不匹配 rtype 则丢弃。
			// 禁用态容器（.disabled 后缀）同样核验：DetectResourceType/container.Open
			// 已支持剥离禁用后缀判定真实类型（c08c62bc P3 回归——原跳过指纹导致
			// 禁用容器泄漏进所有含 .zip 的 tab 标 Type=rtype）。
			// 非容器扩展名维持扩展名白名单直接收的旧行为。
			if types.IsContainerExt(ext) {
				if detected := a.containerCache.Get(e.Path, registry); detected != rtype {
					continue
				}
			}
			e.Type = rtype
			filtered = append(filtered, e)
		}
		entries = filtered
	}
	if !hit {
		msg := fmt.Sprintf("扫描 %d 个文件", len(entries))
		if label != "" {
			msg += " · " + label
		}
		a.AddOpLog("scan", msg, dir, "", int64(len(entries)), "success", "")
	}
	return entries
}

// ClearScanCache 清除扫描缓存（下载/导入后调用）
func (a *App) ClearScanCache() {
	a.ensureContainerCache() // 兜底：容器指纹缓存组件随扫描缓存一起失效
	scanner.InvalidateCache()
	a.containerCache.Clear() // code review P3：容器指纹随扫描缓存一起失效（下载/导入后）
}

// ListModelAuthors 统计 [作者] 前缀（轻量遍历：只看文件名，不读元数据不算哈希，
// 不占全量扫描缓存——原走 ScanEntries 会陪绑 SHA256，大库下拖慢首屏）
func (a *App) ListModelAuthors() []types.AuthorInfo {
	if a.ysmRoot() == "" {
		return nil
	}
	entries := scanner.ScanEntriesLite(a.ysmRoot())
	return scanner.ListModelAuthors(entries)
}

// GenerateRepoIndex 生成 index.json（含 GitHub Actions workflow 模板）
func (a *App) GenerateRepoIndex(repoPath string) (string, error) {
	if !a.isPathInRootOrSelf(repoPath) {
		return "", fmt.Errorf("路径超出仓库目录")
	}
	return scanner.GenerateRepoIndex(repoPath)
}

// ScanLocalAuthors 扫描所有本地资源目录，从文件名提取作者
// ScanLocalAuthors 扫描本地仓库的作者信息。
// rtype 可选，指定资源类型 ID（如 ysm/maid-model），非空时只扫该类型的作者，
// 避免全类型扫描浪费；空时保持现状（全类型遍历）。
func (a *App) ScanLocalAuthors(rtype string) []types.WorkshopCreator {
	roots := map[string]string{}
	// ADR-064 锚定：遍历注册表而非硬编码 6 类型数组（新增类型自动纳入作者扫描）
	for _, rt := range types.LoadRegistry().ResourceTypes {
		if rtype != "" && rt.ID != rtype {
			continue
		}
		roots[rt.ID], _ = a.GetRepoRoot(rt.ID)
	}
	return scanner.ScanLocalAuthors(roots)
}

func (a *App) ListVersionInstances(mcRoot string) []types.VersionInstance {
	return ysmsync.ListVersions(strings.TrimSpace(mcRoot))
}

func (a *App) GetGlobalCustomDir(mcRoot string) string {
	// ADR-064 锚定：路径走注册表 SubDirMap（原硬编码 config/yes_steve_model/custom，
	// YSM scanDir 变更时此处失联）
	return filepath.Join(mcRoot, types.SubDirMap("ysm"))
}

func (a *App) ListFileNames(dir string) []string {
	// 2026-08-16 修复：原用 isPathInRoot（只认 ysm 根），MMD/VRC 等兄弟类型根（MmdRoot 等）
	// 下的目录被误拒返回 nil → 前端 mmd-adapter 纹理清单空（files=0）→ 模型无贴图纯黑。
	// 改用 isPathInRootOrSelf，与 ReadFileBytes（app_model.go 同源修复）口径一致：
	// 能读的文件就能列（只读遍历，放行根本身安全）；仍拒绝 .. 越权/根外路径。
	if !a.isPathInRootOrSelf(dir) {
		return nil
	}
	files := fsutil.WalkAllFiles(dir, true)
	names := make([]string, len(files))
	for i, p := range files {
		names[i] = filepath.Base(p)
	}
	return names
}

// ListAllFilePaths 递归列出指定目录下的所有文件完整路径（不限制扩展名）
func (a *App) ListAllFilePaths(dir string) []string {
	// 同 ListFileNames 2026-08-16 修复：isPathInRoot 只认 ysm 根，兄弟类型根误拒；
	// 改 isPathInRootOrSelf 与 ReadFileBytes/ScanModelEntries 对称（ADR-044③ 对称范式）
	if !a.isPathInRootOrSelf(dir) {
		return nil
	}
	return fsutil.WalkAllFiles(dir, true)
}

func (a *App) CheckFileExists(path string) bool {
	// 同 ListAllFilePaths 2026-08-16 修复：兄弟类型根（MmdRoot/VrcRoot 等）下文件
	// isPathInRoot 误拒 → 与 ReadFileBytes 口径不对称（能读不能查存在）
	if !a.isPathInRootOrSelf(path) {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

// isPathInRootOrSelf 检查路径是否位于任一合法扫描根内（或其自身）。
// 扫描入口是跨类型通用绑定（前端按 rtype 扫描 resourcepack/shaderpack 等），
// 合法根 = FilesRoot（所有类型根的公共祖先）+ McRoot（整合包实例自定义目录，
// community 诊断/GetInstanceStatus 扫描）+ 各类型专属覆写根。
// 不能像 isPathInRoot 那样以 ysmRoot 为唯一基准——resourcepack 等兄弟类型根
// 相对 ysmRoot 是 ../，会被误拒（code_review 修复）。
// 放行根本身（rel==.，整仓扫描合法）；拒绝 .. 越权、盘符根、其他卷绝对路径。
// 空串守卫：filepath.Clean("") → "."，会被 filepath.Rel 解析为 CWD——
// 若 CWD 恰在配置根内则误判合法。源头拦截，保护全部调用方（defense-in-depth）。
func (a *App) isPathInRootOrSelf(path string) bool {
	if path == "" {
		return false
	}
	cfg := a.LoadAppConfig()
	roots := []string{
		cfg.FilesRoot,
		cfg.McRoot,
		cfg.ResourcepackRoot,
		cfg.ShaderpackRoot,
		cfg.SchematicRoot,
		cfg.LitematicRoot,
		cfg.MmdRoot,
		cfg.VrcRoot,
	}
	// CustomRoots（新机制）：所有已配置的类型专属根自动纳入，
	// 新增类型/自定义根无需同步本函数（旧字段历史兼容保留）
	if cfg.CustomRoots != nil {
		for _, root := range cfg.CustomRoots {
			roots = append(roots, root)
		}
	}
	clean := filepath.Clean(path)
	for _, root := range roots {
		if root == "" {
			continue
		}
		rel, err := filepath.Rel(filepath.Clean(root), clean)
		if err != nil {
			continue // 不同卷/盘符，跳过该根
		}
		if rel == "." {
			return true
		}
		sep := string(filepath.Separator)
		if rel == ".." || strings.HasPrefix(rel, ".."+sep) {
			continue // 越权到该根外，试下一个根
		}
		// 符号链接二次复核（audit P3）：词法 Rel 通过 ≠ 真实落点在根内——
		// 根内出现指向外部的 symlink 时纯词法判定可越权读根外文件。
		// 仅对真实存在的路径复核：Lstat 失败（不存在/断链）无越权读取面，维持词法判定；
		// 且 EvalSymlinks 对不存在路径失败会保留 8.3 短路径原样，与已解析的 root 前缀
		// 比对错位会产生误拒（TestIsPathInRootOrSelf_Boundaries 实测）。
		if _, err := os.Lstat(clean); err == nil && paths.IsInsideResolved(root, clean) != nil {
			continue // 词法在内、真实存在，但解析后越出该根，试下一个根
		}
		return true
	}
	return false
}

// isPathInRoot 检查路径是否在 FilesRoot 内（路径守卫辅助函数）
// 空串守卫：与 isPathInRootOrSelf 同源修复——filepath.Clean("") → "." 解析为 CWD。
func (a *App) isPathInRoot(path string) bool {
	if path == "" {
		return false
	}
	root := a.ysmRoot()
	if root == "" {
		return false
	}
	clean := filepath.Clean(path)
	rel, err := filepath.Rel(root, clean)
	if err != nil {
		return false
	}
	// rel == "." 是根路径本身——RemoveDir/RenameDir 等经此守卫后
	// os.RemoveAll/os.Rename 可整删/整改名 ysm 仓库（与 DeleteModelDir 的 rel=="."
	// 拒绝模式对齐）；原 `!HasPrefix(rel, "..")` 对 "." 放行。
	// 同时修 P3：裸 HasPrefix(rel, "..") 会把根内合法目录 ..foo 误判越权——
	// 用精确段比较（对齐 go/paths 的 rel==".." || HasPrefix(rel, ".."+sep)）
	if rel == "." || rel == ".." {
		return false
	}
	sep := string(filepath.Separator)
	if strings.HasPrefix(rel, ".."+sep) {
		return false
	}
	return true
}

// isDir 路径存在且为目录
func isDir(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}
