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
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// perfTypeManifestEntry 单类型的样本清单条目（ADR-262 D3「样本清单」在 Go 侧的落地形态）。
//
// 它是「CLI 侧性能采集」的**阶段链产出口径登记处**：该链路应产出几个阶段。
// 用 Go 表而非外部 JSON：阶段链长度是 Go 内部验证语义，不与前端共享；
// 可分析性（有无解析链路）已迁至 resource_types.json 的 cliAnalyzable 声明（2026-09-21，
// 前端目标集选择器同源消费，ADR-269 D3 同步通路；本表不再持有，双写必然漂移）。
type perfTypeManifestEntry struct {
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
// ⚠️ 订正（2026-09-19）：本条此前写「只有 YSM 有 CLI 分析链路」——那是**错的**，并已实证造成
// 用户可见假阴性：`cliAnalyzable("maid-model") == false` → 自动挑选首个模型（scanFirstModel）、
// `--target all`、以及用户在面板里显式选「女仆」跑基准，一律被判 unsupported 并拒绝采集，
// 提示「CLI 无解析器」——而这句是假的。
// 依据（用户仓库 D:\YSM管理器测试文件夹 实测）：TLM 女仆包 `.zip` 走 `go/geometry` 的 maid L0
// 清单链路（`detectMaidNs` / `collectMaidManifest` / `resolveL0`，见 go/geometry/maid_l0.go），
// 与 YSM 容器同一个 `parseBedrockFromZip` 入口，阶段链同样是 ①读/清单 ②解析 ③验证 ④几何
// ⑤纹理 ⑥序列化 ⑦缓存（7 段）；实测 yingbai_arknights_pack 961 bones / 7 textures / 4696 cubes。
// 故现在是 **YSM 与 maid-model 两条链路**。
// PMX/PMD/VRM/FBX/GLTF 的解析器仍只在**前端 3D adapter**里（Three.js 生态），CLI 拿到是空模型，
// 阶段耗时全是空数据 —— 矩阵必须显式区分（与 gui-flow 对 PMX 跳过 ④⑤⑥ 的口径同源）。
//
// ⚠️ 教训（下一个人别再照抄错话）：本清单回答的是「CLI 有没有该**类型**的解析链路」，
// **不**回答「这条**条目**是否真有几何」——同一目录归属下音效包/纯资源包与真模型同类
// （实测 maid-model\ 下的 atri_sound_pack-1.0.0.zip 解析出 0 bones）。后一问由 `firstWithGeometry`
// 在末端验证，不得用类型谓词冒充。
//
// 可分析性（CliAnalyzable）已迁 resource_types.json 声明（默认 false）；未声明即不可分析，
// 新增 CLI 分析链路时同步改 JSON（cliAnalyzable: true）+ 在下方登记阶段链长度。
var perfTypeManifest = map[string]perfTypeManifestEntry{
	"ysm": {
		ExpectedStages: 7,
		Note:           "YSM 的完整分析链路（WASM 解码 / geometry 容器 / 解包目录三形态）——2026-09-19 前写作「CLI 唯一」，经 maid-model 实测订正",
	},
	"maid-model": {
		ExpectedStages: 7,
		Note:           "TLM 女仆包 .zip 走 geometry 包 maid L0 清单（detectMaidNs/collectMaidManifest/resolveL0），与 YSM 容器同一 ParseFromZip 入口；实测 7 段齐全",
	},
}

// rtypeDisplayName 取类型显示名（类型命名单一事实源 = registry / resource_types.json）。
//
// 未登记 id 通常返回空串、由调用方回落 rtype id——但 `classifyForScan` 的两个**兜底 token**
// 例外：`container`（容器未命中目录消歧）与 `other`（扩展名未命中）。它们**永远**不在 registry 里
// （正因为「不猜任意类型」才诚实标出来），若也返回空串，前端 `typeLabel` 的
// `rtype_label ? label : rtype` 会连同后面的 id span 印出同一个 token 两遍
// （「container container」）。故在此给出人话：数据诚实是 Go 的事，人话也归 Go 这个单点。
//
// ⚠️ 只给这两个**语义确定的兜底**编人话；其他未登记 id 仍返回空串——凭空造名会掩盖
// 真正的拼写漂移（如 manifest 里写错的类型 id）。
func rtypeDisplayName(rtype string) string {
	if rtype == "" {
		return ""
	}
	if label, ok := rtypeFallbackLabels[rtype]; ok {
		return label
	}
	for _, rt := range registry.LoadRegistry().ResourceTypes {
		if rt.ID == rtype {
			return rt.Name
		}
	}
	return ""
}

// rtypeFallbackLabels `classifyForScan` 兜底 token 的人话标签。
//
// token 本身是判定**来源**而非资源类型（见 flow.go|classifyForScanWithSource 与 perf_identity.go
// 的 rtype/rtype_source 注释），故不进 resource_types.json——那里是「真实资源类型」的表，
// 把兜底塞进去会让它参与类型枚举、扩展名归属等一切下游消费。
var rtypeFallbackLabels = map[string]string{
	"container": "容器（未定类型）",
	"other":     "其他（未识别扩展名）",
}

// cliAnalyzable 查询类型是否具备 CLI 分析链路（resource_types.json 的 cliAnalyzable 声明，
// 单一事实源，前端目标集选择器同源消费；2026-09-21 起不再读本表，双写必然漂移）。
func cliAnalyzable(rtype string) bool {
	rt := registry.RegistryType(rtype)
	return rt != nil && rt.CliAnalyzable
}

// cliAnalyzablePath 判定某路径是否属于 CLI 可分析的模型（ADR-262 D3 收编，2026-09-18）。
//
// 这是「这个文件 CLI 能不能真分析」的**单点答案**，由两个既有事实源组合而成：
// 归属 = `classifyForScan`（三段口径 location > extension > container，flow.go）、
// 可分析性 = `cliAnalyzable`（本文件；事实源是 resource_types.json 的 cliAnalyzable 声明）。
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

// maxGeometryProbe 「按序挑首个真有几何」的候选探测上限。
//
// 上限而非全量：每探测一个候选都要走 AnalyzeBedrockModel（几何缓存命中很便宜，冷缓存却是真解析），
// 而目录归属会把音效包/纯资源包混进同一类型（maid-model\ 下实测如此）。上限 5 与
// `--max-models` 的默认量级一致：够越过「前几个是资源包」的常见排列，又不至于让挑首个模型变慢。
const maxGeometryProbe = 5

// hasGeometry 该分析结果里是否真有几何（Bones 或 CubeCount 非 0）。
//
// 「CLI 可分析」（cliAnalyzable）只保证**类型**有解析链路，不保证**条目**含几何——音效包/纯资源包
// 按目录归属同样被判成 maid-model，解析出来是零骨骼空模型（实测 atri_sound_pack-1.0.0.zip）。
// ③ 的派生阶段门控（④⑤⑥ 只在真产出上跑）与候选顺延（firstWithGeometry）共用本谓词：
// 「什么叫真有几何」只留一份判定。
func hasGeometry(model types.BedrockModel) bool {
	return len(model.Bones) > 0 || model.CubeCount > 0
}

// firstWithGeometry 从有序候选里挑出第一个**真能解析出几何**（Bones 或 CubeCount 非 0）的条目。
//
// 立因：类型只保证「CLI 有该类型的解析链路」，不保证该条目含几何——音效包/纯资源包按目录归属
// 也会被判成 maid-model，解析出来是空模型。候选由既有单点产出（gui-flow 走 scanSummaryByType、
// 「挑首个模型」走 scanBenchTargets），本函数**不重判可分析性**（那是 cliAnalyzable 的事），
// 只在末端加一步「验证真有几何」——不留第二份同语义的挑选器。
//
// 返回 (命中路径, 模型, 试过的路径[], 是否命中)。边界：maxProbe < 1 或候选为空时返回零值
// （tried 为空）；未命中时 tried 是已探测的那些（最多 maxProbe 个），供调用方如实说明跳过了谁。
func firstWithGeometry(a AppService, candidates []string, maxProbe int) (string, types.BedrockModel, []string, bool) {
	if a == nil || maxProbe < 1 {
		return "", types.BedrockModel{}, nil, false
	}
	tried := make([]string, 0, maxProbe)
	for i, path := range candidates {
		if i >= maxProbe {
			break
		}
		model := a.AnalyzeBedrockModel(path)
		tried = append(tried, path)
		if hasGeometry(model) {
			return path, model, tried, true
		}
	}
	return "", types.BedrockModel{}, tried, false
}

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
