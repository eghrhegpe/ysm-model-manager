package cli

// perf_targets.go — 基准测试的目标集解析（ADR-262 D3：目标集由 Go 侧从 registry 派生）。
//
// 立因（2026-09-17）：`single-bench` 此前只能吃单个 `--model`，没有「按资源类型挑样本、挑几个」
// 的统一入口（用户原话：「该统一设置挑选多少个模型的不设置」）。目标集解析放在这里，
// 发现权复用 `scanner.ScanEntries`（**发现权单点**，registry 驱动），不另立扩展名白名单——
// 目录式模型（解包 YSM 目录）由 scanner 折叠为 `<dir>/ysm.json` 条目，天然被覆盖。

import (
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// perfTypeManifestEntry 单类型的样本清单条目（ADR-262 D3「样本清单」在 Go 侧的落地形态）。
//
// 它是「CLI 侧性能采集能力」的**单一登记处**：是否具备分析链路、该链路应产出几个阶段。
// 用 Go 表而非外部 JSON：与 registry 同仓同语言，漂移由测试直接断言，无需加载器与跨端同步。
type perfTypeManifestEntry struct {
	// CliAnalyzable CLI 是否具备该类型的分析链路（解析器只在前端 3D adapter 的类型为 false）
	CliAnalyzable bool
	// ExpectedStages 该类型在 CLI 侧应产出的阶段链长度（0 = 不采集阶段）
	//
	// ⚠️ 只声明**长度**：① 的名称随形态变（目录式「① 清单读取」/ 文件式「① 文件读取」），
	// ② 的名称随扩展名变（.ysm→「② JSON 解析」/ .zip→「② 模型解析」）。把名称写死在清单里
	// 只会制造第二份真值；长度已足以抓住「阶段链断裂」（如 MMD 缺 ④⑤⑥）。
	ExpectedStages int
	// Note 该条目的口径说明（为什么不可分析 / 长度为什么是这些）
	Note string
}

// perfTypeManifest CLI 性能采集的类型清单（发现白名单 ≠ 可分析白名单）。
//
// 只有 YSM 有 CLI 分析链路：`.ysm` 走 WASM 解码、`.zip/.7z` 走 geometry 容器解析、
// 目录式走 `ysm.FindComponentsInExtractedYSM`（`app.App.LoadModelComponents` 的 `.json` 分支），
// 阶段链 = ① 读取/清单 ② 解析 ③ 验证 ④ 几何 ⑤ 纹理 ⑥ 序列化 ⑦ 缓存（7 段）。
// PMX/PMD/VRM/FBX/GLTF 的解析器只在**前端 3D adapter**里（Three.js 生态），CLI 拿到是空模型，
// 阶段耗时全是空数据 —— 矩阵必须显式区分（与 gui-flow 对 PMX 跳过 ④⑤⑥ 的口径同源）。
//
// 未登记的类型 = CLI 不可分析（默认零值），无需逐条罗列；新增 CLI 分析链路时在此登记。
var perfTypeManifest = map[string]perfTypeManifestEntry{
	"ysm": {
		CliAnalyzable:  true,
		ExpectedStages: 7,
		Note:           "CLI 唯一完整分析链路（WASM 解码 / geometry 容器 / 解包目录三形态）",
	},
}

// rtypeDisplayName 取 registry 里的类型显示名（类型命名单一事实源 = resource_types.json）；
// 未登记类型返回空串，由调用方回落 rtype id。
func rtypeDisplayName(rtype string) string {
	if rtype == "" {
		return ""
	}
	for _, rt := range registry.LoadRegistry().ResourceTypes {
		if rt.ID == rtype {
			return rt.Name
		}
	}
	return ""
}

// cliAnalyzable 查询类型是否具备 CLI 分析链路（未登记即不可分析）。
func cliAnalyzable(rtype string) bool {
	return perfTypeManifest[rtype].CliAnalyzable
}

// cliAnalyzablePath 判定某路径是否属于 CLI 可分析的模型（ADR-262 D3 收编，2026-09-18）。
//
// 这是「这个文件 CLI 能不能真分析」的**单点答案**，由两个既有事实源组合而成：
// 归属 = `classifyForScan`（三段口径 location > extension > container，flow.go）、
// 可分析性 = `perfTypeManifest` / `cliAnalyzable`（本文件）。
//
// 立因：这问题原先在四处各写一份扩展名白名单（并发基准 `.ysm` 过滤、`scanFirstModel|allowedExts`、
// gui-flow 首模型 `ext == ".ysm"`），其中 `scanFirstModel` 把 `.vrm/.gltf/.litematic` 也算「模型」
// ——这些类型的解析器只在前端 3D adapter，CLI 拿到是空模型，喂进基准即「空模型数据当实测」。
// 故本谓词同时承担去重与诚实两条职责：不新建表，只删表。
func cliAnalyzablePath(path, ext string, reg *registry.ResourceTypeRegistry) bool {
	return cliAnalyzable(classifyForScan(path, ext, reg))
}

// pickCliAnalyzable 从已扫描条目里挑出 CLI 可分析的模型路径：
// 保持扫描序（排序/截断由调用方决定，本函数不做隐式重排，也不臆断「首选什么类型」）。
func pickCliAnalyzable(entries []types.ModelEntry) []string {
	reg := registry.LoadRegistry()
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if cliAnalyzablePath(e.Path, strings.ToLower(filepath.Ext(e.Path)), reg) {
			out = append(out, e.Path)
		}
	}
	return out
}

// scanBenchTargets 按资源类型扫描基准目标集：发现 → 类型过滤 → 确定性排序 → 取前 N。
//
// rtype 为空时退化为「所有 CLI 可分析类型」（用于自动挑首个模型，如 health --bench / perf-snapshot）。
// rtype 非空时按该类型过滤（即使该类型 CLI 不可分析也返回——由调用方标注 unsupported，
// 而不是静默丢掉，否则「按类型跑矩阵」会得到空结果而无任何解释）。
//
// 排序用路径字典序而非扫描序：Walk 顺序依文件系统而变，测试与 AI 断言需要可复现的目标集。
func scanBenchTargets(filesRoot, rtype string, maxModels int) []string {
	if filesRoot == "" || maxModels < 1 {
		return nil
	}
	reg := registry.LoadRegistry()
	var out []string
	for _, e := range scanner.ScanEntries(filesRoot) {
		got := classifyForScan(e.Path, strings.ToLower(filepath.Ext(e.Path)), reg)
		if rtype != "" {
			if got != rtype {
				continue
			}
		} else if !cliAnalyzable(got) {
			continue
		}
		out = append(out, e.Path)
	}
	sort.Strings(out)
	if len(out) > maxModels {
		out = out[:maxModels]
	}
	return out
}

// perfTypeGroup 按类型归并后的目标集（--all-types 用）。
type perfTypeGroup struct {
	Rtype string
	// Found 仓库中该类型条目总数（未截断），供矩阵回显「跑了几个 / 一共有几个」
	Found int
	// Targets 实际取样（路径字典序前 N）
	Targets []string
}

// scanTargetsGrouped 扫描整个仓库并按类型归并（类型字典序，组内路径字典序，各组取前 maxPerType）。
//
// 只收录**仓库里真实存在**的类型：空跑一堆 0 计数的类型对用户/AI 都是噪声。
// 组内包含 CLI 不可分析的类型（由调用方标 unsupported），保证「仓库里有什么」如实可见。
func scanTargetsGrouped(filesRoot string, maxPerType int) []perfTypeGroup {
	if filesRoot == "" || maxPerType < 1 {
		return nil
	}
	reg := registry.LoadRegistry()
	byType := map[string][]string{}
	for _, e := range scanner.ScanEntries(filesRoot) {
		got := classifyForScan(e.Path, strings.ToLower(filepath.Ext(e.Path)), reg)
		byType[got] = append(byType[got], e.Path)
	}
	types := make([]string, 0, len(byType))
	for t := range byType {
		types = append(types, t)
	}
	sort.Strings(types)

	out := make([]perfTypeGroup, 0, len(types))
	for _, t := range types {
		paths := byType[t]
		sort.Strings(paths)
		targets := paths
		if len(targets) > maxPerType {
			targets = targets[:maxPerType]
		}
		out = append(out, perfTypeGroup{Rtype: t, Found: len(paths), Targets: targets})
	}
	return out
}

// perfTopTarget 「全库前 N 大」目标集的一项：路径 + 类型 + 参与排序的**体量**。
//
// 体量单独回显而不是回读 ModelEntry.Size：目录式模型的 Size 是入口清单大小（见 targetFootprint），
// 拿它当「占用」正是本功能要修的那个坑。
type perfTopTarget struct {
	Path      string
	Rtype     string
	Footprint int64
}

// perfSizeSourceDirTotal 体量口径 token（回显进 spec.size_source）：
// 目录式模型按**目录内容合计**参与排序，其余形态按文件字节数。
//
// 为什么不按 ModelEntry.Size 一把梭：`scanner.ScanEntries` 给解包目录式模型的 Size 是
// `<dir>/ysm.json` 清单本身（fixture 实测 115B），按它排名会把最大的解包模型排到最后——
// 那等于「按入口文件大小找最大的模型」，与用户问的问题不是同一个。此口径与 web 适配器
// 填同一字段的既有约定（`frontend/src/backend/web-fs.ts` 目录求和）一致。
const perfSizeSourceDirTotal = "dir_total"

// targetFootprint 单个目标的体量：目录式模型（入口是 ysm.json 清单）→ 目录内容合计；
// 其余形态 → 文件字节数。目录统计失败时回落到清单大小（不假装 0，0 会让它排到最后而不留痕）。
func targetFootprint(e types.ModelEntry) int64 {
	if registry.IsYsmEntryJSON(filepath.Base(e.Path)) {
		if size, err := fsutil.DirSize(filepath.Dir(e.Path)); err == nil {
			return size
		}
	}
	return e.Size
}

// scanTopLargestTargets 扫全库 → 算每条体量 → 体量降序、同体量路径升序 → 取前 n。
//
// 返回第二个值是**全库未截断**的逐类型计数（供 spec.types[].found 沿用「一共有几条」的既有语义，
// 而不是「入选了几条」——后者会让「跑了 3 个 / 一共 300 个」这种信息消失）。
//
// 候选池是**全库**（含 CLI 不可分析的类型）：ADR 问的是「最大的模型是谁」，PMX 恰好最大时把它
// 静默剔掉，用户看到的是一份空报告而没有任何解释——入选后由载荷标 unsupported 才是诚实的答法。
// 顺序即排名（前 N 大的意义就在「谁最大」），不按类型归并。
func scanTopLargestTargets(filesRoot string, n int) ([]perfTopTarget, map[string]int) {
	if filesRoot == "" || n < 1 {
		return nil, nil
	}
	reg := registry.LoadRegistry()
	found := make(map[string]int)
	all := make([]perfTopTarget, 0)
	for _, e := range scanner.ScanEntries(filesRoot) {
		rtype := classifyForScan(e.Path, strings.ToLower(filepath.Ext(e.Path)), reg)
		found[rtype]++
		all = append(all, perfTopTarget{Path: e.Path, Rtype: rtype, Footprint: targetFootprint(e)})
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].Footprint != all[j].Footprint {
			return all[i].Footprint > all[j].Footprint
		}
		return all[i].Path < all[j].Path
	})
	if len(all) > n {
		all = all[:n]
	}
	return all, found
}
