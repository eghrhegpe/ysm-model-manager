// instance_tree.go：同步结果嵌套树构建（原 instance.go 拆分，2026-10 文件行数治理）。
// BuildSyncItems / nestDirLevelTree / treeChildren / absorbSelfMarker / dirLevelContainerPath /
// aggregateStatus——扁平条目按目录层级聚合为可渲染的嵌套树。
package instance

import (
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

func BuildSyncItems(ins *types.VersionInstance, rtypes []registry.ResourceType, filesRoots map[string]string, subtype string) []types.ResourceSyncItem {
	// 导出入口自守卫（ADR-044② 防御范式）：唯一调用方保证非 nil，但导出函数必须防 panic
	if ins == nil {
		return nil
	}
	// 阶段 ①：30s TTL 短缓存命中（scanner 失效钩子 InvalidateSyncItemsCache 自动清空）
	key := buildSyncItemsKey(ins, rtypes, filesRoots, subtype)
	if items, ok := syncItemsCache.get(key); ok {
		return items
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
	syncItemsCache.put(key, cloneSyncItems(items))
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
		// 容器：递归构建 children
		childRel := joinRel(baseRel, k)
		children := treeChildren(c, childRel, globalDir, instDir, rtype)
		// 混合夹的目录 marker（其 Path 与容器同路径）先吸收再聚合——保证 marker 直挂
		// 文件的状态参与容器聚合，否则散文件异常（如 global 侧 Missing）时容器仍显示
		// Synced，容器级 push/pull 决策漏掉该文件。吸收判定不依赖 containerPath
		// （containerPath 依赖 status，status 依赖吸收，倒置会死锁），改按两侧候选根匹配。
		children = absorbSelfMarker(children, childRel, globalDir, instDir)
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

// absorbSelfMarker 吸收「容器自身的目录 marker」行，返回容器的实际子项。
//
// 背景：混合夹（自身直接含平铺模型文件、又含子模型夹）在扫描侧会被登记两条——除容器身份外，
// 还把自身登记成一条目录条目（sync_dirlevel.go 的目录 marker，用于与对侧同名叶子目录对齐键集，
// 防「内容相同却显示分歧」的幻影 Missing+Extra）。展示层若原样吐行，会渲染成
// 「同名目录嵌在自己里面」（如 `2.大学学姐 > 2.大学学姐`）；更糟的是该 marker 的 Path 与容器
// Path 相同，而前端 dirOpen 以 data-path 为 key —— 点一次容器会连带展开这个影子行。
//
// 处置：marker 行不吐，把它的**直接子文件**（Name 不含 "/"）并入容器；子夹内的文件已由各子夹
// 节点负责展示（marker 的 children 是 buildDirLevelChildren 的递归 RelPath 列表，含 "/" 的
// 属于子夹），上提会同一批文件列两遍。
//
// 判定：marker 的 Path 是「两侧候选根之一 + 容器相对路径」——status 尚未聚合（吸收必须先于
// 聚合，否则 marker 子文件状态不参与容器状态），故不能经 dirLevelContainerPath 反推，改为
// global/inst 两根各拼一次候选，命中即认。子夹下的叶子路径必然更深，不会误伤。
// 另：marker 必须真有直挂子文件可并才吸收——Path 恰好等于候选根且无 Children 的行是
// nestDirLevelTree 同段防御的 __self 叶子（真实文件条目），静默丢弃 = 显示数据丢失，原样保留。
func absorbSelfMarker(children []types.ResourceSyncItem, childRel, globalDir, instDir string) []types.ResourceSyncItem {
	sep := string(filepath.Separator)
	relPath := strings.ReplaceAll(childRel, "/", sep)
	markerPath := filepath.Join(globalDir, relPath)
	instMarkerPath := filepath.Join(instDir, relPath)
	// 预判是否存在 marker：无则原样返回，免掉常见路径的整表分配+拷贝
	has := false
	for i := range children {
		ch := children[i]
		if (ch.Path == markerPath || ch.Path == instMarkerPath) && len(ch.Children) > 0 {
			has = true
			break
		}
	}
	if !has {
		return children
	}
	merged := make([]types.ResourceSyncItem, 0, len(children))
	for i := range children {
		ch := children[i]
		if (ch.Path == markerPath || ch.Path == instMarkerPath) && len(ch.Children) > 0 {
			for j := range ch.Children {
				if direct := ch.Children[j]; !strings.Contains(direct.Name, "/") {
					merged = append(merged, direct)
				}
			}
			continue
		}
		merged = append(merged, ch)
	}
	return merged
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
