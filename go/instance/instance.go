// ===== 整合包实例同步状态组装（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 GetInstanceSyncStatus 提取组装逻辑；
// 纯 Go 逻辑，无 Wails runtime 依赖；McRoot/注册表/仓库根目录由薄壳注入。
package instance

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/scanner"
	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
)

// ResourceTypeInfo 资源类型注册表条目（BuildSyncItems 需要的字段）
type ResourceTypeInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
}

// ===== 同步结果缓存（TTL 跟随 scanner.EffectiveCacheTTL，默认 30s）=====
// 背景：仓库树复用 scanner 30s 缓存后已经“正常 30 秒后刷新”；但整合包 BuildSyncItems
// 仍有 file-level SyncResources、maid-model 嵌套回退 Walk、实例侧 DiffFolderContents
// 等多条路径每次 stats:refresh 都会重新走盘。这里在最终结果上再叠一层短 TTL 缓存，
// 让整合包页也在同一刷新周期内走缓存；真实数据变更由 scanner 失效钩子 + 显式失效清理。
var syncItemsCache sync.Map // string → *syncItemsCacheEntry

type syncItemsCacheEntry struct {
	items     []types.ResourceSyncItem
	expiresAt time.Time
}

var registerHookOnce sync.Once

// RegisterInvalidationHook 把同步结果缓存挂到 scanner 失效钩子上。
// 原为包内隐式 init 注册（导入即产生跨包副作用，单测隔离与依赖追溯靠注释记忆），
// 改为 app 层启动时显式调用；内部 sync.Once 保证幂等，可安全重复调用。
func RegisterInvalidationHook() {
	registerHookOnce.Do(func() {
		scanner.OnCacheInvalidated(InvalidateSyncItemsCache)
	})
}

// InvalidateSyncItemsCache 清空全部整合包同步结果缓存。
// 由 scanner 失效钩子自动调用；单文件 push/pull 等不走 scanner 失效的入口需显式调用。
func InvalidateSyncItemsCache() {
	syncItemsCache.Range(func(key, _ interface{}) bool {
		syncItemsCache.Delete(key)
		return true
	})
}

// buildSyncItemsKey 仅供当前 BuildSyncItems 函数体实际依赖的输入做缓存键：
// 目前只读 ins.Name / ins.VersionDir / subtype / filesRoots / rtypes。
// 若未来函数体开始消费 ins.CustomDir、ins.Exists 等字段，必须同步加进 key，
// 否则会静默命中旧同步结果缓存。
func buildSyncItemsKey(ins *types.VersionInstance, rtypes []ResourceTypeInfo, filesRoots map[string]string, subtype string) string {
	var b strings.Builder
	b.WriteString(ins.Name)
	b.WriteByte(0)
	b.WriteString(ins.VersionDir)
	b.WriteByte(0)
	b.WriteString(subtype)
	b.WriteByte(0)
	rootKeys := make([]string, 0, len(filesRoots))
	for k := range filesRoots {
		rootKeys = append(rootKeys, k)
	}
	sort.Strings(rootKeys)
	for _, k := range rootKeys {
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(filesRoots[k])
		b.WriteByte(0)
	}
	for _, rt := range rtypes {
		b.WriteString(rt.ID)
		b.WriteByte('|')
		b.WriteString(rt.Name)
		b.WriteByte('|')
		b.WriteString(rt.Icon)
		b.WriteByte(0)
	}
	return b.String()
}

func cloneSyncItems(items []types.ResourceSyncItem) []types.ResourceSyncItem {
	if items == nil {
		return nil
	}
	out := make([]types.ResourceSyncItem, len(items))
	for i, it := range items {
		out[i] = it
		if it.Children != nil {
			out[i].Children = cloneSyncItems(it.Children)
		}
	}
	return out
}

// fileSize 安全取文件大小（Stat 失败返回 0）——原 BuildSyncItems 内 sizeOf 闭包升格，
// 后续 RepoAudit/sync.go 内若需大小统计可复用，避免各写 4 行 os.Stat 样板。
func fileSize(path string) int64 {
	fi, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return fi.Size()
}

// buildDirLevelChildren 为 dirLevelSync 类型的单个文件夹构建子文件条目列表。
// 原 BuildSyncItems L168-200 buildChildrenForDir 闭包升格：仓库侧是权威源，
// globalPath 不存在时返回 nil（连夹都不存在自然无子项可预览）；子文件禁用
// 检测同步口径（.disabled/.ban → ⛔）。返回列表子项 Status 继承 DiffFolderContentsScan
// 结果——Synced/Missing/Optional 已在 diff 阶段按路径成对判定。
func buildDirLevelChildren(globalPath, instPath, rtype, rIcon, groupGlobalDir string) []types.ResourceSyncItem {
	if _, err := os.Stat(globalPath); err != nil {
		return nil
	}
	// DiffFolderContentsScan：复用 scanner 已缓存的仓库根扫描结果（groupGlobalDir）
	// 反推全局侧文件列表，消除每个模型夹的全局子树重复 Walk（实例侧量级小保持原 Walk）。
	diffs := ysmsync.DiffFolderContentsScan(globalPath, instPath, rtype, scanner.ScanEntriesWithHit, groupGlobalDir)
	children := make([]types.ResourceSyncItem, 0, len(diffs))
	for _, d := range diffs {
		childStatus := d.Status
		childIcon := rIcon
		lowName := strings.ToLower(filepath.Base(d.AbsPath))
		if types.IsDisableSuffix(lowName) {
			childStatus = types.SyncStatusDisabled
			childIcon = "⛔"
		}
		children = append(children, types.ResourceSyncItem{
			Path:   d.AbsPath,
			Name:   d.RelPath, // 前端子项展示用相对路径
			Status: childStatus,
			Type:   rtype,
			Icon:   childIcon,
			Size:   d.Size,
		})
	}
	return children
}

// itemMeta resolveItemMeta 的判定结果打包：目录入口/最终状态/默认状态/图标四元组。
// 收拢为结构体后 appendOneItem 只接收一个 meta，根除「拆包再按位转发」的参数漂移。
type itemMeta struct {
	isDirEntry    bool
	status        types.SyncStatus
	defaultStatus types.SyncStatus
	icon          string // 空=由调用方按 rtype 填默认
}

// resolveItemMeta 解析同步条目的元信息：是否是 dirLevel 允许的条目/目录入口、
// 禁用判定（⛔）/legacy 硬链接（🔗）/文件夹（📁）图标与状态。
// 返回值：(判定结果打包, 是否合法条目)
// 三分支（Synced/Missing/Extra）统一走同一判定链，根除历史上「仅 Synced 分支做
// 禁用检测」导致 Extra/Missing 夹上 .disabled 伪装可推送的口径漂移。
func resolveItemMeta(
	p, rtype string,
	isDirLevelType bool,
	defaultStatus types.SyncStatus,
	isLegacy func(string) bool,
) (itemMeta, bool) {
	var meta itemMeta
	meta.status = defaultStatus
	var isDirEntry bool
	if isDirLevelType {
		if fi, err := os.Stat(p); err == nil && fi.IsDir() {
			isDirEntry = true
		}
	}
	// 放行条件：扩展名命中 → 资源包夹 → dirLevel 的目录入口（三者任一）
	if !packs.IsTypeModelFile(p, rtype) && !fsutil.IsResourcePackFolder(p) && !isDirEntry {
		return meta, false
	}
	lowName := strings.ToLower(filepath.Base(p))
	meta.isDirEntry = isDirEntry
	meta.defaultStatus = defaultStatus
	if isDirEntry {
		meta.icon = "📁"
	}
	if types.IsDisableSuffix(lowName) {
		meta.status = types.SyncStatusDisabled
		meta.icon = "⛔"
	} else if isLegacy != nil && isLegacy(p) {
		meta.status = types.SyncStatusLegacy
		meta.icon = "🔗"
	}
	return meta, true
}

// rtypeCtx 单资源类型的处理上下文（processOneResourceType 一次构建）：
// 把 appendOneItem 原先逐条拆包转发的 rtype/rIcon/globalDir/instDir/isDirLevelType
// 五个类型内不变量收拢，签名从 11 参收敛到「接收者 + 条目路径 + meta」。
type rtypeCtx struct {
	rt         ResourceTypeInfo
	globalDir  string
	instDir    string
	isDirLevel bool
}

// appendOneItem 组装 ResourceSyncItem 并 append 到 typeItems：
//   - dirLevel 目录：调用 buildDirLevelChildren 拿子项 + diverged 聚合（仅 synced 夹提升）
//   - 文件：直接平铺，无 children
//
// 是原 appendItem 闭包 L234-271 的后半段升格；前缀判定（合法/禁用/图标）由 resolveItemMeta
// 打包进 itemMeta，本方法只消费已通过判定的结果，确保「过滤→组装」职责分层。
func (c *rtypeCtx) appendOneItem(typeItems *[]types.ResourceSyncItem, p string, meta itemMeta) {
	icon := meta.icon
	if icon == "" {
		icon = c.rt.Icon
	}
	var children []types.ResourceSyncItem
	if c.isDirLevel && meta.isDirEntry {
		instPath := p
		// R34 P2-13：用分隔符守卫而非裸 HasPrefix，
		// 防全局根是另一全局根前缀（D:\repo\a vs D:\repo\abc）时算出错误实例侧路径。
		if strings.HasPrefix(p, c.globalDir+string(filepath.Separator)) {
			rel := strings.TrimPrefix(p, c.globalDir+string(filepath.Separator))
			instPath = filepath.Join(c.instDir, rel)
		}
		children = buildDirLevelChildren(p, instPath, c.rt.ID, c.rt.Icon, c.globalDir)
		// diverged 提升规则（code review P2）：仅当「原 status 就是 synced（未被
		// disabled/legacy 覆盖）+ 子项有非 synced 差异」才升；missing/optional 夹
		// 保持自身状态，避免「整体缺失」误标成「部分差异」。
		if len(children) > 0 && meta.defaultStatus == types.SyncStatusSynced && meta.status == meta.defaultStatus {
			hasDiff := false
			for _, ch := range children {
				if ch.Status != types.SyncStatusSynced {
					hasDiff = true
					break
				}
			}
			if hasDiff {
				meta.status = types.SyncStatusDiverged
				icon = "🗂️"
			}
		}
	}
	*typeItems = append(*typeItems, types.ResourceSyncItem{
		Path:     p,
		Name:     filepath.Base(p),
		Status:   meta.status,
		Type:     c.rt.ID,
		Icon:     icon,
		Size:     fileSize(p),
		IsDir:    meta.isDirEntry,
		Children: children,
	})
}

// processOneResourceType 处理单个资源类型：
//   - 目录判定 + 分流（dirLevel Scan / fileLevel SyncResources）
//   - Synced/Missing/Extra 三分支遍历（三分支共用 resolveItemMeta+appendOneItem）
//   - dirLevel 结果做 nestDirLevelTree 树化
//
// 原 BuildSyncItems L132-296 主循环内体（164 行）完整升格，rtypes 外循环只负责迭代类型。
func processOneResourceType(
	rt ResourceTypeInfo,
	insVersionDir string,
	filesRoots map[string]string,
) []types.ResourceSyncItem {
	subDir := types.SubDirMap(rt.ID)
	if subDir == "" {
		return nil
	}
	globalDir := filesRoots[rt.ID]
	if globalDir == "" {
		return nil
	}
	instDir := types.FindInstDir(insVersionDir, subDir, rt.ID)
	isDirLevel := types.IsDirLevelSync(rt.ID)

	// ADR-064 分流：dirLevel 走 SyncResourcesDirLevelScan（注入 scanner 缓存复用），
	// fileLevel 走 SyncResources（相对路径成对对比，不会丢同名不同目录文件）
	var result types.ResourceSyncResult
	if isDirLevel {
		result = ysmsync.SyncResourcesDirLevelScan(globalDir, instDir, rt.ID, scanner.ScanEntriesWithHit)
	} else {
		result = ysmsync.SyncResources(globalDir, instDir, rt.ID)
	}

	var typeItems []types.ResourceSyncItem
	ctx := &rtypeCtx{rt: rt, globalDir: globalDir, instDir: instDir, isDirLevel: isDirLevel}
	// appendItem 统一出口：三分支共用 resolveItemMeta+appendOneItem，过滤/禁用/
	// 图标/子项 全程同口径。
	appendItem := func(p string, defaultStatus types.SyncStatus, isLegacy func(string) bool) {
		meta, ok := resolveItemMeta(p, rt.ID, isDirLevel, defaultStatus, isLegacy)
		if !ok {
			return
		}
		ctx.appendOneItem(&typeItems, p, meta)
	}

	for _, p := range result.Synced {
		appendItem(p, types.SyncStatusSynced, nil)
	}
	for _, p := range result.Missing {
		appendItem(p, types.SyncStatusMissing, nil)
	}
	for _, p := range result.Extra {
		appendItem(p, types.SyncStatusOptional, func(p string) bool {
			return ysmsync.GetLinkType(p) == types.LinkHard
		})
	}

	if isDirLevel {
		typeItems = nestDirLevelTree(typeItems, globalDir, instDir, rt.ID)
	}
	return typeItems
}

// BuildSyncItems 组装整合包内各资源类型的同步状态项（纯逻辑，root 由调用方注入）
// subtype 指定子类型目录名（如 EntityPlayer/SceneModel），仅 MMD 分组类型有效；
// 非空时路径限定到 subtype 子目录，避免扫全目录（清单式扫路径限定目录，与仓库侧同构）。
func BuildSyncItems(ins *types.VersionInstance, rtypes []ResourceTypeInfo, filesRoots map[string]string, subtype string) []types.ResourceSyncItem {
	// 导出入口自守卫（ADR-044② 防御范式）：唯一调用方保证非 nil，但导出函数必须防 panic
	if ins == nil {
		return nil
	}
	// 阶段 ①：30s TTL 短缓存命中（scanner 失效钩子 InvalidateSyncItemsCache 自动清空）
	key := buildSyncItemsKey(ins, rtypes, filesRoots, subtype)
	if v, ok := syncItemsCache.Load(key); ok {
		entry := v.(*syncItemsCacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return cloneSyncItems(entry.items)
		}
		syncItemsCache.Delete(key)
	}

	// 阶段 ②：逐类型处理（processOneResourceType 升格，外循环只负责 append）
	// subtype 参数仅参与 buildSyncItemsKey 缓存区分——清单式扫路径限定目录的实际
	// 分支由 processOneResourceType 内部 instDir=FindInstDir 决定（subtype 版本已
	// 在调用方写入 ins.VersionDir 后缀，此处透明读取），保持现状口径不新增。
	var items []types.ResourceSyncItem
	for _, rt := range rtypes {
		items = append(items, processOneResourceType(rt, ins.VersionDir, filesRoots)...)
	}

	// 阶段 ③：写缓存（clone 一次防调用方改返回值污染缓存；读端也 clone 一次）
	// TTL 写入时刻取当前生效值（scanner 单一事实源，随 AppConfig.ScanCacheTTLMs 变化）
	syncItemsCache.Store(key, &syncItemsCacheEntry{
		items:     cloneSyncItems(items),
		expiresAt: time.Now().Add(scanner.EffectiveCacheTTL()),
	})
	return items
}

// isResourcePackFolder 检查目录是否是资源包文件夹（内含 pack.mcmeta）——统一走 fsutil 收敛实现

// nestTreeNode 展示树节点：中间目录（容器）或叶子单元
type nestTreeNode struct {
	// 容器字段
	isDir bool
	// 叶子字段（isDir=false 或叶子模型夹）
	leaf *types.ResourceSyncItem
	// 容器 children：key = 下一路径段（目录段，不含扩展名判断——直接用段名）
	children map[string]*nestTreeNode
}

// nestDirLevelTree 把扁平 dirLevel 同步单元按相对路径段重建为嵌套展示树。
// 设计：模型文件夹/文件是叶子单元（保留现有 children——文件级 diff）；
// 仅含子模型的中间目录（如 wine_fox_json）自动生成容器节点（isDir=true + 聚合状态）。
// 顶层只返回根下直接子项（children 深度嵌套），镜像磁盘真实层级。
// 路径基准：Synced/Missing 是全局路径（globalDir 下），Extra 是实例路径（instDir 下）——
// 逐条按命中 root 剥离出相对路径段。
func nestDirLevelTree(flat []types.ResourceSyncItem, globalDir, instDir, rtype string) []types.ResourceSyncItem {
	root := &nestTreeNode{children: map[string]*nestTreeNode{}}
	relOf := func(p string) (string, bool) {
		for _, basedir := range []string{globalDir, instDir} {
			// 分隔符守卫：避免两根呈前缀嵌套时误归属（如 D:\repo 与 D:\repo-instance）
			if basedir == "" {
				continue
			}
			sep := string(filepath.Separator)
			if p != basedir && !strings.HasPrefix(p, basedir+sep) {
				continue
			}
			rel, err := filepath.Rel(basedir, p)
			if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
				return "", false
			}
			return filepath.ToSlash(rel), true
		}
		return "", false
	}
	// 为每个条目计算相对 root 的路径段，并挂入树
	for i := range flat {
		it := &flat[i]
		rel, ok := relOf(it.Path)
		if !ok {
			// 路径无法归属任一 root（防御）——保持扁平顶层
			root.children[it.Path] = &nestTreeNode{leaf: it}
			continue
		}
		segs := strings.Split(rel, "/")
		insert := func(leaf *types.ResourceSyncItem, segs []string) {
			cur := root
			for _, s := range segs[:len(segs)-1] {
				nxt, ok := cur.children[s]
				if !ok || nxt == nil {
					nxt = &nestTreeNode{isDir: true, children: map[string]*nestTreeNode{}}
					cur.children[s] = nxt
				} else if nxt.leaf != nil {
					// 同段名已是叶子（如全局侧平铺模型夹），又作为容器段下钻（实例侧同级更深嵌套）：
					// 防御——保留原叶子作为其下 `__self` 子项，避免覆盖/ nil map 写入 panic。
					// 现实中 SyncResourcesDirLevel 对模型夹 SkipDir 极少触发，属防御性降级。
					carry := nxt.leaf
					nxt.leaf = nil
					if nxt.children == nil {
						nxt.children = map[string]*nestTreeNode{}
					}
					nxt.children["__self"] = &nestTreeNode{leaf: carry}
				}
				cur = nxt
			}
			last := segs[len(segs)-1]
			if existing, ok := cur.children[last]; ok && existing != nil && existing.isDir {
				// 同段名既是叶子又是中间容器：把叶子收进 __self，防覆盖容器
				if existing.children == nil {
					existing.children = map[string]*nestTreeNode{}
				}
				existing.children["__self"] = &nestTreeNode{leaf: leaf}
				return
			}
			cur.children[last] = &nestTreeNode{leaf: leaf}
		}
		insert(it, segs)
	}
	return treeChildren(root, "", globalDir, instDir, rtype)
}

// treeChildren 把容器节点 children 展平为 ResourceSyncItem 列表
// 容器：isDir=true + 聚合状态（若子项有非 synced 差异 → diverged）；叶子原样返回
// baseRel：容器相对 root 的路径（段连接符 "/"）；root 用于还原容器绝对路径供 push/pull
func treeChildren(node *nestTreeNode, baseRel, globalDir, instDir, rtype string) []types.ResourceSyncItem {
	if len(node.children) == 0 {
		return nil
	}
	// 排序保证确定性输出
	keys := make([]string, 0, len(node.children))
	for k := range node.children {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	out := make([]types.ResourceSyncItem, 0, len(keys))
	for _, k := range keys {
		c := node.children[k]
		if c.leaf != nil {
			// 相对路径重建：叶子单元保留自身路径与状态
			out = append(out, *c.leaf)
			continue
		}
		// 容器：递归构建 children，聚合状态
		childRel := joinRel(baseRel, k)
		children := treeChildren(c, childRel, globalDir, instDir, rtype)
		status := aggregateStatus(children)
		icon := "📁"
		// 容器状态只可能是 synced/diverged/optional（aggregateStatus 聚合结果），无 missing；
		// 有差异(含可推/可拉)时用 🗂️ 指示可展开
		if status == types.SyncStatusDiverged || status == types.SyncStatusOptional {
			icon = "🗂️"
		}
		// 容器绝对路径：按聚合 status 选根——optional(可拉取) 源在实例侧，其余(可推送/同步) 源在
		// 全局侧。作为前端展开 key 与容器级 push/pull 的 data-path；避免混合夹锁错源侧
		containerPath := dirLevelContainerPath(status, childRel, globalDir, instDir)
		// Type 必填：前端 applyFilter 按 i.type === 选中类型过滤，容器若缺 Type(=空串)
		// 会被整体丢弃，导致整棵嵌套子树消失（嵌套1→嵌套2→动力臂 不显示的根因）
		out = append(out, types.ResourceSyncItem{
			Path:     containerPath,
			Name:     k,
			Status:   status,
			Type:     rtype,
			Icon:     icon,
			IsDir:    true,
			Children: children,
		})
	}
	return out
}

// dirLevelContainerPath 按容器聚合状态还原目录绝对路径。
// status 为 optional（纯实例独有，可拉取）→ 用实例根；否则（diverged/missing/synced，
// 可推送或同步）→ 用全局根。push 源在仓库侧、pull 源在整合包侧，方向与前端按钮一致。
func dirLevelContainerPath(status types.SyncStatus, rel, globalDir, instDir string) string {
	sep := string(filepath.Separator)
	relPath := strings.ReplaceAll(rel, "/", sep)
	base := globalDir
	if status == types.SyncStatusOptional {
		base = instDir
	}
	if base == "" {
		return rel
	}
	return filepath.Join(base, relPath)
}

// joinRel 拼接相对路径段
func joinRel(parent, seg string) string {
	if parent == "" {
		return seg
	}
	return parent + "/" + seg
}

// aggregateStatus 聚合子项状态：
//   - 全部 synced/disabled → synced（无推送差异；disabled 是用户刻意禁用的内容，不驱动容器推送）
//   - 含可推送差异（missing/diverged，不含 disabled）→ diverged（可推送）
//   - 仅 optional/legacy（实例侧独有）→ optional（可拉取）
//   - 空子项 → synced
//
// disabled 归入「中立」而非 hasPush：与 BuildSyncItems 自身「禁用内容不给推送按钮」语义一致——
// 否则含 .ban 子项的容器会被标 diverged、出现容器级 push 按钮，整夹 InstallDir 会覆盖用户刻意 .ban 的内容。
// 保留 optional 语义：纯可拉取容器应显示 pull 而非误归为 diverged 的 push
func aggregateStatus(children []types.ResourceSyncItem) types.SyncStatus {
	hasPush := false
	hasPull := false
	for _, c := range children {
		switch c.Status {
		case types.SyncStatusSynced, types.SyncStatusDisabled:
			// 同步项与禁用项都不算可推送差异（disabled 中立，防覆盖 .ban）
		case types.SyncStatusOptional, types.SyncStatusLegacy:
			hasPull = true
		default: // missing/diverged
			hasPush = true
		}
	}
	if hasPush {
		return types.SyncStatusDiverged
	}
	if hasPull {
		return types.SyncStatusOptional
	}
	return types.SyncStatusSynced
}
