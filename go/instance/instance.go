// ===== 整合包实例同步状态组装（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 GetInstanceSyncStatus 提取组装逻辑；
// 纯 Go 逻辑，无 Wails runtime 依赖；McRoot/注册表/仓库根目录由薄壳注入。
// 2026-10 拆分：原 605 行按职责分为 instance.go（本文件：缓存 + 条目元信息 + rtypeCtx）/
// instance_tree.go（BuildSyncItems + 嵌套树构建）。
package instance

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/cespare/xxhash/v2"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/scanner"
	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// ========== 同步结果缓存（TTL 跟随 scanner.EffectiveCacheTTL，默认 30s）=====
// 背景：仓库树复用 scanner 30s 缓存后已经“正常 30 秒后刷新”；但整合包 BuildSyncItems
// 仍有 file-level SyncResources、maid-model 嵌套回退 Walk、实例侧 DiffFolderContents
// 等多条路径每次 stats:refresh 都会重新走盘。这里在最终结果上再叠一层短 TTL 缓存，
// 让整合包页也在同一刷新周期内走缓存；真实数据变更由 scanner 失效钩子 + 显式失效清理。
// 2026-09-14 锐评刀①：裸 sync.Map 收编为类型化组件（sync_items_cache.go）。
var syncItemsCache = newSyncCache() // *syncCache 单例

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
	syncItemsCache.clear()
}

// buildSyncItemsKey 仅供当前 BuildSyncItems 函数体实际依赖的输入做缓存键：
// 目前只读 ins.Name / ins.VersionDir / subtype / filesRoots / rtypes。
// 使用 xxhash 结构化摘要：新增字段不需要手动加进 key，哈希自动覆盖所有输入。
func buildSyncItemsKey(ins *types.VersionInstance, rtypes []registry.ResourceType, filesRoots map[string]string, subtype string) string {
	h := xxhash.New()
	// hash.Hash 契约：Write/WriteString 恒返回 nil 错误；仍显式忽略以满足 errcheck
	_, _ = h.WriteString(ins.Name)
	_, _ = h.Write([]byte{0})
	_, _ = h.WriteString(ins.VersionDir)
	_, _ = h.Write([]byte{0})
	_, _ = h.WriteString(subtype)
	_, _ = h.Write([]byte{0})
	rootKeys := make([]string, 0, len(filesRoots))
	for k := range filesRoots {
		rootKeys = append(rootKeys, k)
	}
	sort.Strings(rootKeys)
	for _, k := range rootKeys {
		_, _ = h.WriteString(k)
		_, _ = h.Write([]byte("="))
		_, _ = h.WriteString(filesRoots[k])
		_, _ = h.Write([]byte{0})
	}
	for _, rt := range rtypes {
		_, _ = h.WriteString(rt.ID)
		_, _ = h.Write([]byte{'|'})
		_, _ = h.WriteString(rt.Name)
		_, _ = h.Write([]byte{'|'})
		_, _ = h.WriteString(rt.Icon)
		_, _ = h.Write([]byte{0})
	}
	// 十六进制编码 8 字节 hash → 16 字符短键
	return fmt.Sprintf("%016x", h.Sum64())
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

// fileSize 已收敛至 fsutil.FileSize（instance/sync_dirlevel 同款样板统一委托）

// buildDirLevelChildren 为 dirLevelSync 类型的单个文件夹构建子文件条目列表。
// 原 BuildSyncItems L168-200 buildChildrenForDir 闭包升格：仓库侧是权威源，
// globalPath 不存在时返回 nil（连夹都不存在自然无子项可预览）；子文件禁用
// 检测同步口径（.disabled/.ban → ⛔）。返回列表子项 Status 继承 DiffFolderContentsScan
// 结果——Synced/Missing/Optional 已在 diff 阶段按路径成对判定。
// 混合夹直挂文件的重复表示由树化层 absorbSelfMarker 判重收口（ADR-351 D3 修订）——
// 本函数同时服务叶子模型夹（直挂 = 全部内容）与容器 marker（直挂有平铺单元
// 伴生）两种语境，语境判别在此不可得，勿在此过滤。
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
		if registry.IsDisableSuffix(lowName) {
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
	if registry.IsDisableSuffix(lowName) {
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
	rt         registry.ResourceType
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
		// 用分隔符守卫而非裸 HasPrefix，
		// 防全局根是另一全局根前缀（D:\repo\a vs D:\repo\abc）时算出错误实例侧路径。
		if strings.HasPrefix(p, c.globalDir+string(filepath.Separator)) {
			rel := strings.TrimPrefix(p, c.globalDir+string(filepath.Separator))
			instPath = filepath.Join(c.instDir, rel)
		}
		// 实例侧禁用载体识别（ADR-345 D3）：上面是**盲 join**，实例把整夹（或**其祖先容器夹**）
		// 改名成 `X.disabled/` 后该路径不存在 → 子项全判 missing → 父夹提升 diverged「待推送」
		// → 一键/行内推送另建活跃 `X/`，`X.disabled/` 残留 = 模型静默复活 + 同一模型两份副本。
		// 必须**沿 rel 上溯祖先**（复核 P1-2）：容器夹被整体禁用（`X.disabled/`，其下才是模型夹
		// `X/sub`）时，只查单元自身路径与其孪生会双双落空。
		// 认出载体后：子项以载体为基准 diff（同内容即 synced），单元标 ⛔（disabled 在中立桶，
		// 绝不进待推送/一键清单）。
		if alt, ok := fsutil.DisabledAncestorPath(c.instDir, instPath); ok {
			instPath = alt
			meta.status = types.SyncStatusDisabled
			meta.icon = "⛔"
		}
		children = buildDirLevelChildren(p, instPath, c.rt.ID, c.rt.Icon, c.globalDir)
		// diverged 提升规则：仅当「原 status 就是 synced（未被
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
		Size:     entrySize(meta.isDirEntry, p, children),
		IsDir:    meta.isDirEntry,
		Children: children,
	})
}

// entrySize 取条目大小：文件 = 自身字节数；目录 = 子树内容总量。
//
// 目录不能取 os.Stat(dir).Size()——那是目录项自身占用（NTFS 通常 0/4096/8192），与内容无关：
// 实测 600 字节的夹报 0、装着 206 MB 的模型夹在同步页显示 4.0 KB，纯属误导。
// 总量无需额外 IO：buildDirLevelChildren 已算出子项清单（DiffFolderContents 注释明确
// synced 条目含在结果中，供前端全量展示），求和即真实内容总量。
// 空夹 → 0，交由前端 `size > 0` 守卫留白，不猜。
// 子项清单取不到时（children 为空但夹在磁盘上真实存在，如 Extra 分支的实例侧路径——
// buildDirLevelChildren 以 global 侧 Stat 为门，镜像缺失即返回 nil）不能照抄 0，
// 否则「实际存在、有几百 MB 内容的夹」被误报为空。此时回退 fsutil.DirSize 对实际
// 存在的一侧递归求和（DirSize 内部 Stat 失败才返回 0，口径与注释一致）。
func entrySize(isDirEntry bool, p string, children []types.ResourceSyncItem) int64 {
	if !isDirEntry {
		return fsutil.FileSize(p)
	}
	if len(children) == 0 {
		// 仅当夹真实存在才回退求和；不存在时 DirSize 也返回 0，直接委托即可
		if _, err := os.Stat(p); err != nil {
			return 0
		}
		total, err := fsutil.DirSize(p)
		if err != nil {
			return 0
		}
		return total
	}
	var total int64
	for i := range children {
		total += children[i].Size
	}
	return total
}

// processOneResourceType 处理单个资源类型：
//   - 目录判定 + 分流（dirLevel Scan / fileLevel SyncResources）
//   - Synced/Missing/Extra 三分支遍历（三分支共用 resolveItemMeta+appendOneItem）
//   - dirLevel 结果做 nestDirLevelTree 树化
//
// 原 BuildSyncItems L132-296 主循环内体（164 行）完整升格，rtypes 外循环只负责迭代类型。
func processOneResourceType(
	rt registry.ResourceType,
	insVersionDir string,
	filesRoots map[string]string,
) []types.ResourceSyncItem {
	subDir := registry.SubDirMap(rt.ID)
	if subDir == "" {
		return nil
	}
	globalDir := filesRoots[rt.ID]
	if globalDir == "" {
		return nil
	}
	instDir := registry.FindInstDir(insVersionDir, subDir, rt.ID)
	isDirLevel := registry.IsDirLevelSync(rt.ID)

	// ADR-064 分流：dirLevel 走 SyncResourcesDirLevelScan、fileLevel 走 SyncResourcesWithConfig，
	// 两分支注入**同款** scanner 缓存化 scanFn（30s TTL + single-flight，哈希在 scanner 侧
	// 并行预算内现算，不触 hashlock 红线）：
	//   - dirLevel 注入系 ADR-344 D1（修「平铺模型文件改内容恒判 Synced」）；
	//   - fileLevel 注入系 2026-10-15 锐评（补漏网）：原直调 SyncResources（scanFn=nil →
	//     恒无哈希 → Size 兜底），同大小异内容的 pack.zip 恒判 Synced——而同目录对的
	//     internal/app|App.SyncResources（CLI instances list / 推送清单）早已注入
	//     a.scanModelEntries 走哈希判定（D2′-a），两路对同一事实答案相反。scanFn 旁挂后
	//     ContentVerdict（verdict.go 判定表，ADR-347）走哈希腿，异内容 → Missing+Diverged，
	//     resolveItemMeta 按清单标行。
	var result types.ResourceSyncResult
	if isDirLevel {
		result = ysmsync.SyncResourcesDirLevelScan(globalDir, instDir, rt.ID, scanner.ScanEntriesWithHit)
	} else {
		result = ysmsync.SyncResourcesWithConfig(globalDir, instDir, nil, scanner.ScanEntries, rt.ID)
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
	// ADR-340-d2：把「两侧均有、内容已变化（待推送更新）」从「仅仓库有」里分辨出来。
	// ResourceDiff 把两者同归 Missing（保持既有归属），若组装层不再分辨，则面板行与
	// 侧栏一键推送都无法告知「这一次推送会覆盖实例侧已修改的副本」——面板侧表现为
	// 分叉行冒充 missing（ADR-310 的 diverged 推送前确认闸对 fileLevel 类型形同虚设），
	// 侧栏侧表现为静默覆盖。状态取既有语义 SyncStatusDiverged（前端继承 missing 的
	// 可操作属性；计数/清单归属不变：foldUnit 把 missing|diverged 折同一桶）。
	diverged := make(map[string]bool, len(result.Diverged))
	for _, p := range result.Diverged {
		diverged[p] = true
	}
	for _, p := range result.Missing {
		status := types.SyncStatusMissing
		if diverged[p] {
			status = types.SyncStatusDiverged
		}
		appendItem(p, status, nil)
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
