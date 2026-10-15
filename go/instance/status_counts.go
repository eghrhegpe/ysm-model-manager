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
// Overwrites（ADR-340-d2）与两路清单一并产出：`Missing ∪ MissingDirs` 中**会覆盖实例侧
// 已修改副本**的那些推送目标（收录口径见 ysmsync.PushTargetsForUnit——三路推导已随
// ADR-351 D4 下沉 go/sync，与推送路由同包），供批量推送如实计数与点名。
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
			Name:        ins.Name,
			CustomDir:   statusCustomDir(ins, rtypes),
			Missing:     []string{},
			MissingDirs: []string{},
			Overwrites:  []string{},
			Extra:       []string{},
			Disabled:    []string{},
		}
		// 面板链产物：单元树（dirLevel 已树化，顶层即展示单元）+ 缓存
		items := BuildSyncItems(ins, rtypes, filesRoots, "")
		for j := range items {
			foldUnit(&st, items[j])
		}
		// map 迭代序在 sync 层不保证，排序保证列表每次刷新顺序稳定（前端 diff/展示友好）。
		// 去重已随 ADR-351 D3 单表示退役：混合夹 marker 与平铺单元的重复表示在树化层
		// absorbSelfMarker 判重收口，清单天然无重复（回归锁 instance_tree_single_repr_test.go）；
		// 若未来出现新的重复形态，宁可它在这里红灯暴露，也不要静默压重掩盖。
		sort.Strings(st.Missing)
		sort.Strings(st.MissingDirs)
		sort.Strings(st.Overwrites)
		sort.Strings(st.Extra)
		sort.Strings(st.Disabled)
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

// dedupeSorted 已随 ADR-351 D3 单表示退役（2026-10-16）：重复表示在树化层
// absorbSelfMarker 判重收口，侧栏清单天然无重复；静默压重会掩盖新的重复形态。

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
		// 三路推导单点在 go/sync（ADR-351 D4 下沉）：与推送路由（PushSingleResource
		// 目录分支 / 逐条 Install）同包，展开规则不再靠本层注释复述远方行为。
		files, dirs, overwrites := ysmsync.PushTargetsForUnit(it)
		st.Missing = append(st.Missing, files...)
		st.MissingDirs = append(st.MissingDirs, dirs...)
		st.Overwrites = append(st.Overwrites, overwrites...)
	case types.SyncStatusOptional, types.SyncStatusLegacy:
		st.Extra = append(st.Extra, it.Path)
	case types.SyncStatusDisabled:
		// 禁用是用户刻意为之，绝不进待推送清单（否则一键安装会覆盖 .ban 内容）
		st.Disabled = append(st.Disabled, it.Path)
	}
}
