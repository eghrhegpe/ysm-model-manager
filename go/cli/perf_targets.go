package cli

// perf_targets.go — 基准测试的目标集解析（ADR-262 D3：目标集由 Go 侧从 registry 派生）。
//
// 立因（2026-09-17）：`single-bench` 此前只能吃单个 `--model`，没有「按资源类型挑样本、挑几个」
// 的统一入口（用户原话：「该统一设置挑选多少个模型的不设置」）。目标集解析放在这里，
// 发现权复用 `scanner.ScanEntries`（**发现权单点**，registry 驱动），不另立扩展名白名单——
// 目录式模型（解包 YSM 目录）由 scanner 折叠为 `<dir>/ysm.json` 条目，天然被覆盖。

import (
	"path/filepath"

	"ysm-model-manager/go/fsutil"
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

// 注：条目形状的挑选器 `pickCliAnalyzable(entries)` 已退役（2026-09-18，ADR-262 D3 修订）——
// 「从候选池里挑出 CLI 可分析的」现在只有 `filterAnalyzable([]perfTarget)` 一个出口（perf_target_set.go），
// 它与 `collectPerfTargets` 同处一条数据流；再留一份同语义的挑选器就是第二条路径。

// scanBenchTargets 按资源类型扫描基准目标集：发现 → 类型过滤 → 确定性排序 → 取前 N。
//
// rtype 为空时退化为「所有 CLI 可分析类型」（用于自动挑首个模型，如 health --bench / perf-snapshot）。
// rtype 非空时按该类型过滤（即使该类型 CLI 不可分析也返回——由调用方标注 unsupported，
// 而不是静默丢掉，否则「按类型跑矩阵」会得到空结果而无任何解释）。
//
// 排序用路径字典序而非扫描序：Walk 顺序依文件系统而变，测试与 AI 断言需要可复现的目标集。
//
// ADR-262 D3 修订（2026-09-18）：本函数是 `--target rtype/all --order path` 的具名形态，
// 实现已收敛到 `collectPerfTargets` / `orderPerfTargets` / `capFlat` 三个原语——旧面这里
// 曾自扫一遍仓库（与 scanTargetsGrouped / scanTopLargestTargets 各扫一遍），三旋钮若照旧
// 各写一份就会变成第四、第五份。行为逐字不变（既有测试即回归证明）。
func scanBenchTargets(filesRoot, rtype string, maxModels int) []string {
	if filesRoot == "" || maxModels < 1 {
		return nil
	}
	ts, _ := collectPerfTargets(filesRoot)
	if rtype != "" {
		ts = filterRtype(ts, rtype)
	} else {
		ts = filterAnalyzable(ts)
	}
	return pathsOf(capFlat(orderPerfTargets(ts, perfOrderPath), maxModels))
}

// matrixGroups（bench_concurrent.go）取代了原 scanTargetsGrouped：它把「= --target all --order path」
// 的具名形态泛化为「按 spec 收窄 → 排序 → 分组」三步，rtype/all 与两种排序共用同一条路径。
// 保留具名形态会让同一件事留下两份实现，故删除——需路径序全类型分组时用
// matrixGroups(root, perfTargetSpec{Target: perfTargetAll, Order: perfOrderPath, MaxModels: n})。

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
//
// 入参是 (路径, 字节数) 而非 `types.ModelEntry`（2026-09-18，ADR-262 D3 修订）：体量与排序
// 现在由 `perfTarget` 承载，取 ModelEntry 会让 perfTarget 不得不反向伪造一个条目。
func targetFootprint(path string, entrySize int64) int64 {
	if registry.IsYsmEntryJSON(filepath.Base(path)) {
		if size, err := fsutil.DirSize(filepath.Dir(path)); err == nil {
			return size
		}
	}
	return entrySize
}

// 注：`scanTopLargestTargets(filesRoot, n)` 已退役（2026-09-18，ADR-262 D3 修订）——它曾是
// `--target repo --order size --max-models n` 的具名形态，现由 `repoPerfTargets(filesRoot, order, n)`
// 承担：**同一个组合同时服务生产与测试**（旧写法里测试打具名函数、生产直接拼三原语，测试便证明
// 不了生产在跑什么）。体量口径仍由 `targetFootprint` 单点给出，同体量路径升序由 `orderPerfTargets` 定。
