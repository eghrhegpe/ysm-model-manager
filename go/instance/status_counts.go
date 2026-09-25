// ===== 侧栏计数入口：面板链为单一事实源（ADR-310）=====
//
// 背景：整合包侧栏三徽章与同步面板六 tab 长期各走一条 Go 链，同一磁盘状态
// 数字分叉（ADR-310 §1.2 七类结构性差异）。本文件是 ADR-310 §2.1 的「薄计数
// 入口」：**不新增任何 diff/禁用/聚合判定**，直接复用面板链产物 BuildSyncItems
// （其内部已含 SyncResourcesDirLevelScan/SyncResources + resolveItemMeta 三桶 +
// aggregatestatus 容器聚合 + 30s 结果缓存），只在最外层按面板 tabStatus 的折叠
// 规则把顶层单元折成四个数。
//
// 为什么不复用面板 renderer 的 collectCounts（父+子递归计数）：
//   - 面板徽标数 = 可见行数，dirLevel 树父单元与子文件会被重复计入；
//   - 侧栏徽章语义是「几个模型没装/多装」，单位必须是**面板单元**（模型夹/文件）。
//
// 两者粒度差异已由 ADR-310 §3「已知遗留」记录在案，侧栏数会小于面板 total。
package instance

import (
	"os"
	"sort"

	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// BuildInstanceStatusCounts 逐实例产出侧栏计数与清单（ADR-310 §2.1 薄入口）。
//
// 参数与 BuildSyncItems 同构（rtypes/filesRoots 由薄壳注入），因此天然复用
// 后者的 30s 结果缓存——侧栏 loadInstances 与面板同周期刷新时不会二次扫盘。
//
// 折叠规则（与面板 store.ts tabStatus + aggregateStatus 同源）：
//
//	synced                 → Synced
//	missing | diverged     → MissingCount（红=待推送；分叉学面板折叠进红，不补第四色）
//	optional | legacy      → Extra（橙=纯实例独有；legacy 硬链接在面板容器聚合里同样算 hasPull）
//	disabled               → Disabled（.ban/.disabled，不再蒸发也不计入 synced）
//
// 计数在**顶层单元**上做（不递归 children，避免面板父+子重复计数）；清单粒度见
// types.InstanceStatus 注释：Missing 保持仓库侧文件级绝对路径（一键安装契约）。
//
// CustomDir 与旧链 resolveInstanceScanDir 对齐：单类型调用时 = FindInstDir 解析出的
// 实例子目录（面板链 processOneResourceType 用的同一个目录）；多类型时退回 ins.CustomDir。
func BuildInstanceStatusCounts(
	instances []types.VersionInstance,
	rtypes []registry.ResourceType,
	filesRoots map[string]string,
) []types.InstanceStatus {
	results := make([]types.InstanceStatus, 0, len(instances))
	for i := range instances {
		ins := &instances[i]
		st := types.InstanceStatus{
			Name:      ins.Name,
			CustomDir: statusCustomDir(ins, rtypes),
			Missing:   []string{},
			Extra:     []string{},
			Disabled:  []string{},
		}
		// 面板链产物：单元树（dirLevel 已树化，顶层即展示单元）+ 缓存
		items := BuildSyncItems(ins, rtypes, filesRoots, "")
		for j := range items {
			foldUnit(&st, items[j])
		}
		// map 迭代序在 sync 层不保证，排序保证列表每次刷新顺序稳定（前端 diff/展示友好）；
		// 排序后压重：面板链「混合夹」会同时产出平铺文件叶与容器 marker 子项，
		// 同一文件重复列示（见 go-instance 卡已知限制），导入一键安装清单会重复安装
		sort.Strings(st.Missing)
		sort.Strings(st.Extra)
		sort.Strings(st.Disabled)
		st.Missing = dedupeSorted(st.Missing)
		st.Extra = dedupeSorted(st.Extra)
		st.Disabled = dedupeSorted(st.Disabled)
		// Status 取「红优先」——与 loader.ts 自派生口径一致（有待推送差异就不再是绿/橙）
		switch {
		case st.MissingCount > 0:
			st.Status = "missing"
		case len(st.Extra) > 0:
			st.Status = "extra"
		default:
			st.Status = "complete"
		}
		results = append(results, st)
	}
	return results
}

// dedupeSorted 就地压缩已排序切片中的相邻重复项（调用方须先 sort）。
// 必要性：面板链的「混合夹」既把平铺模型文件登记为独立叶子、又经 absorbSelfMarker
// 并入容器子项，同一文件会出现两次（面板侧表现为同名两行）；侧栏若原样带进
// 一键安装清单就会重复安装同一文件。此处只去重清单，不改单元计数。
func dedupeSorted(in []string) []string {
	if len(in) < 2 {
		return in
	}
	out := in[:1]
	for _, s := range in[1:] {
		if s != out[len(out)-1] {
			out = append(out, s)
		}
	}
	return out
}

// statusCustomDir 解析实例侧扫描目录（单类型走 FindInstDir，多类型退回 ins.CustomDir）
func statusCustomDir(ins *types.VersionInstance, rtypes []registry.ResourceType) string {
	if len(rtypes) == 1 {
		if sub := registry.SubDirMap(rtypes[0].ID); sub != "" {
			return registry.FindInstDir(ins.VersionDir, sub, rtypes[0].ID)
		}
	}
	return ins.CustomDir
}

// foldUnit 把一个顶层展示单元折进实例状态（计数 + 清单）。
// 容器节点（nestDirLevelTree 生成的中间目录）也参与折叠：其 aggregateStatus 已把
// 子项差异聚合为 diverged/optional，计数口径与面板可见行一致。
func foldUnit(st *types.InstanceStatus, it types.ResourceSyncItem) {
	switch it.Status {
	case types.SyncStatusSynced:
		st.Synced++
	case types.SyncStatusMissing, types.SyncStatusDiverged:
		st.MissingCount++
		st.Missing = append(st.Missing, pushFilePaths(it)...)
	case types.SyncStatusOptional, types.SyncStatusLegacy:
		st.Extra = append(st.Extra, it.Path)
	case types.SyncStatusDisabled:
		// 禁用是用户刻意为之，绝不进待推送清单（否则一键安装会覆盖 .ban 内容）
		st.Disabled = append(st.Disabled, it.Path)
	}
}

// pushFilePaths 把一个「待推送」单元展开成仓库侧文件级绝对路径。
//
// 一键安装（runDownloadMissing）逐条 Install，契约是文件而非夹；因此：
//   - 单元带 children（dirLevel 模型夹的 buildDirLevelChildren 产物，或嵌套容器）：
//     递归取 status ∈ {missing, diverged} 的子项——它们的 Path 由
//     DiffFolderContentsScan 给出，缺失/分叉都指向仓库侧（d.AbsPath=gEntry），
//     正是「推上去能修好」的那份源文件；
//   - 无 children 的文件单元：Path 本身即仓库侧文件路径（fileLevel 的 SyncResources
//     missing，或 dirLevel 根下散文件）；
//   - 无 children 但 Path 是磁盘上的目录（fileLevel 资源包夹，或 dirLevel 里
//     children 为空的叶子夹——如 maids 包内的文件均不被 IsTypeModelFile 命中）：
//     用 DiffFolderContents 以空实例侧 diff 出夹内文件；
//   - disabled 子项被排除（同 foldUnit：禁用内容不推送）。
//
// ⚠️ 绝不吐目录路径：本清单的消费端是「逐条 Install」，而目录路径在 install 侧语义
// 是错的——`InstallResourceToInstance` 对 isDir 类型走 `InstallDir(filepath.Dir(src))`，
// 传目录会把它**父目录**整棵装进实例（过度安装）；fileLevel 类型则落到
// `installer.Install(dir)`，`isSupportedModelExt("")` 必判不支持（必然失败）。
// 因此「夹内无可推送文件」时返回空清单——这是 ADR-310 §3 记明的计数/清单粒度差
// （单元算 1，可装文件 0），面板可用 `PushSingleResourceToInstance`（folder-aware）
// 单行推送该夹，侧栏一键安装不承担此路径。
func pushFilePaths(it types.ResourceSyncItem) []string {
	if len(it.Children) > 0 {
		var out []string
		for i := range it.Children {
			ch := it.Children[i]
			if ch.Status == types.SyncStatusMissing || ch.Status == types.SyncStatusDiverged {
				out = append(out, pushFilePaths(ch)...)
			}
		}
		return out
	}
	if fi, err := os.Stat(it.Path); err == nil && fi.IsDir() {
		var out []string
		// 实例侧传空串：该夹在实例侧不存在，全部文件按 missing 列出。
		// 复用面板同一条 diff 实现（DiffFolderContents），不另写扩展名过滤口径。
		for _, d := range ysmsync.DiffFolderContents(it.Path, "", it.Type) {
			if d.Status == types.SyncStatusMissing || d.Status == types.SyncStatusDiverged {
				out = append(out, d.AbsPath)
			}
		}
		return out
	}
	return []string{it.Path}
}
