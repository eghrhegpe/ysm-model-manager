// ===== 规范分类器（单一识别大脑，收敛三套编排）=====
//
// 背景（2026-08 收敛）：此前资源类型识别有三条独立编排——repoaudit.Audit
// （TypeByLocation→container→Classify(ext)）、packs.DetectResourceType
// （路径消歧+指纹+Priority）、importer.DetectContainerType（魔数扫描+MatchZipEntry
// 首命中）——行为分叉导致回归此起彼伏。本文件是唯一规范实现，三处全部改调。
//
// 三阶段语义（+Phase 0 nested 指纹）：
//
//	Phase 0: nestedPatterns 入口文件名指纹——注册表声明的嵌套入口（如 maid_model.json）
//	         是强约定名字指纹，强于扩展名（maid-model 只声明 .zip 扩展名，但其
//	         assets/ 入口 json 必须能识别）；
//	Phase 1: location 消歧——祖先目录命中 storageSubDir/instanceDir 且扩展名认同
//	         且 detector 校验通过（深祖先优先，MMD 子类型共享扩展名消歧）；
//	Phase 2: 容器指纹 + Priority 裁决——容器共享一次打开，逐类型指纹匹配，
//	         (priority desc, id asc) 双键裁决（同 Priority 按 ID 字典序，
//	         彻底消除「同 Priority 取注册序在前者」的顺序依赖）；
//	Phase 3: 兜底——容器未命中任何指纹 = 未知容器（"container"，禁裸扩展名
//	         last-wins）；非容器仅当扩展名恰好被一个类型声明时直判，多/零声明者
//	         一律 "other"（根目录散落 .pmx 曾被 last-wins 误归 SceneModel）。
//
// 归属（ADR-144）：原住 go/types（共享类型层），识别逻辑需开容器（container.Open /
// container.Entry）做指纹裁决，与「types 只放类型/注册表/纯扩展名判定」定位冲突，
// 且迫使 container 因循环依赖内联 stripDisableSuffix。整体下沉到本包（packs 已持有
// DetectResourceType 识别入口），types 回归纯类型层，container 可复用 types.StripDisableSuffix。
package packs

import (
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/types"
)

// 规范兜底分类值（非具体资源类型的诚实占位）
const (
	ClassContainer = "container" // 容器未命中任何指纹：未知内容，不猜
	ClassOther     = "other"     // 无锚点且扩展名歧义/无声明者：不猜
)

// ClassifyResource 规范资源类型识别器（单一事实源）。
// path 为文件路径（真实存在与否取决于阶段：Phase 0/1 纯路径解析，Phase 2 开容器读指纹）。
func ClassifyResource(path string, reg *types.ResourceTypeRegistry) string {
	if reg == nil || len(reg.ResourceTypes) == 0 {
		return ""
	}
	clean := types.StripDisableSuffix(path)
	ext := strings.ToLower(filepath.Ext(clean))
	isContainer := types.IsContainerExt(ext)

	if id := classifyByNestedPattern(clean, reg); id != "" {
		return id
	}
	if id := classifyByLocationStrict(path, ext, isContainer, reg); id != "" {
		return id
	}
	if id := classifyByFingerprint(path, ext, isContainer, reg); id != "" {
		return id
	}
	if isContainer {
		return ClassContainer
	}
	return ClassifyExt(ext, reg)
}

// ClassifyExt 扩展名兜底判定：仅单一声明者直判，多/零声明者返回 "other"。
// 取代原 repoaudit.Classify 的 map 覆盖写（last-wins）——共享扩展名靠扩展名
// 判型本身就是回归根源（.zip 被 14 类型声明，落点随 JSON 追加顺序漂移）。
// ExtBelongsToBy 归属 types（ADR-144：纯注册表查询，types/resource.go 守卫也用它，
// 故不随识别大脑下沉——避免 types→packs 反向依赖）。
func ClassifyExt(ext string, reg *types.ResourceTypeRegistry) string {
	owners := types.ExtBelongsToBy(ext, reg)
	if len(owners) == 1 {
		return owners[0]
	}
	return ClassOther
}

// DetectByEntries 条目名列表指纹裁决（importer 字节流路径专用，不开文件）：
// 对每个有指纹能力的类型做匹配，(priority desc, id asc) 裁决；无命中返回 ""。
// ysm 类型走段后缀指纹（ysm.json/models/ 任意层级），其余走 zipEntries 声明匹配。
func DetectByEntries(entries []string, reg *types.ResourceTypeRegistry) string {
	if reg == nil || len(reg.ResourceTypes) == 0 || len(entries) == 0 {
		return ""
	}
	lowered := make([]string, len(entries))
	for i, e := range entries {
		lowered[i] = strings.ToLower(e)
	}
	bestID := ""
	var bestRt *types.ResourceType
	for i := range reg.ResourceTypes {
		rt := &reg.ResourceTypes[i]
		pass := false
		switch strings.ToLower(rt.Detector) {
		case "ysm":
			pass = matchYsmEntryNames(lowered)
		default:
			if len(rt.ZipEntries) == 0 {
				continue
			}
			for _, name := range lowered {
				if rt.MatchZipEntry(name) {
					pass = true
					break
				}
			}
		}
		if !pass {
			continue
		}
		if bestRt == nil || betterCandidate(rt, bestRt) {
			bestID = rt.ID
			bestRt = rt
		}
	}
	return bestID
}

// betterCandidate 报告 candidate 是否应击败现任 best：
// priority 高者胜；同 priority 按 ID 字典序（确定性 tiebreak，注册表顺序无关）。
func betterCandidate(candidate *types.ResourceType, best *types.ResourceType) bool {
	if candidate.Priority != best.Priority {
		return candidate.Priority > best.Priority
	}
	return candidate.ID < best.ID
}

// classifyByNestedPattern Phase 0：nestedPatterns 入口文件名指纹。
// basename 命中 entryFiles 且祖先目录尾段命中 entryDir → 直接归该类型
// （名字指纹是注册表声明的强特征，不做扩展名/detector 过滤——maid-model 只声明
// .zip 但其 assets/mc/maid_model.json 入口必须可识别）。
func classifyByNestedPattern(path string, reg *types.ResourceTypeRegistry) string {
	base := strings.ToLower(types.NormalizeResourceName(filepath.Base(path)))
	if base == "" {
		return ""
	}
	dir := filepath.Dir(path)
	ancestors := ancestorDirs(dir)
	for i := range reg.ResourceTypes {
		rt := &reg.ResourceTypes[i]
		for _, np := range rt.NestedPatterns {
			hitFile := false
			for _, f := range np.EntryFiles {
				if strings.ToLower(f) == base {
					hitFile = true
					break
				}
			}
			if !hitFile || np.EntryDir == "" {
				continue
			}
			entryNorm := filepath.ToSlash(strings.ToLower(np.EntryDir))
			for _, anc := range ancestors {
				ancNorm := filepath.ToSlash(strings.ToLower(anc))
				if ancNorm == entryNorm || strings.HasSuffix(ancNorm, "/"+entryNorm) {
					return rt.ID
				}
			}
		}
	}
	return ""
}

// classifyByLocationStrict Phase 1：location 消歧（严格语义）。
// 与 TypeByLocation（宽松归属，统计用）的差异：扩展名必须认同 + detector 校验
// 通过才返回——保证消歧不跨组误判（.pmx 只在 MMD 组内消歧）。深祖先优先。
func classifyByLocationStrict(path string, ext string, isContainer bool, reg *types.ResourceTypeRegistry) string {
	dir := filepath.Dir(path)
	if dir == "." || dir == "" {
		return ""
	}
	ancestors := ancestorDirs(dir)
	// 容器条目共享一次打开（锐评 #4）：location 消歧对同目录多个候选类型连续
	// detector 判定时，同一容器不得被 Open/Entries N 次——与 classifyByFingerprint
	// 的共享打开对齐。provider 惰性：目录全不命中时零 Open 成本（非容器判定
	// 永不触发 provider）。
	var opened bool
	var shared []container.Entry
	entriesFor := func() []container.Entry {
		if !opened {
			opened = true
			shared = openContainerEntries(path)
		}
		return shared
	}
	// 深度优先：外层祖先深→浅，内层遍历类型
	for _, anc := range ancestors {
		ancNorm := filepath.ToSlash(strings.ToLower(anc))
		for i := range reg.ResourceTypes {
			rt := &reg.ResourceTypes[i]
			matchedDir := false
			for _, c := range []string{rt.InstanceDir, rt.StorageSubDir} {
				if c == "" {
					continue
				}
				cNorm := filepath.ToSlash(strings.ToLower(c))
				if ancNorm == cNorm || strings.HasSuffix(ancNorm, "/"+cNorm) {
					matchedDir = true
					break
				}
			}
			if !matchedDir {
				continue
			}
			// 仅当扩展名也匹配才返回——路径消歧不跨扩展名组误判
			if !hasExtIn(ext, rt.EffectiveExtensions()) {
				continue
			}
			if detectorPassesEntries(path, ext, isContainer, rt, entriesFor) {
				return rt.ID
			}
		}
	}
	return ""
}

// classifyByFingerprint Phase 2：指纹 + Priority 裁决。
// 容器共享一次打开（发现3 P3）；跨类型不比较匹配条目数（模式宽窄不可比，
// 发现1 P2）。裁决规则 (priority desc, id asc) 保证注册表顺序无关。
func classifyByFingerprint(path string, ext string, isContainer bool, reg *types.ResourceTypeRegistry) string {
	var entries []container.Entry
	opened := false
	bestID := ""
	var bestRt *types.ResourceType
	for i := range reg.ResourceTypes {
		rt := &reg.ResourceTypes[i]
		if !hasExtIn(ext, rt.EffectiveExtensions()) {
			continue
		}
		pass := false
		if isContainer && (rt.Detector == "ysm" || rt.Detector == "zipentry" || rt.Detector == "mcmeta" || rt.Detector == "shader") {
			if !opened {
				opened = true
				entries = openContainerEntries(path)
			}
			if rt.Detector == "ysm" {
				pass = matchYsmEntriesGO(entries)
			} else {
				pass = countZipEntryMatchesGO(entries, rt) > 0
			}
		} else if detectorPassesInternal(path, ext, isContainer, rt) {
			pass = true
		}
		if !pass {
			continue
		}
		if bestRt == nil || betterCandidate(rt, bestRt) {
			bestID = rt.ID
			bestRt = rt
		}
	}
	return bestID
}

// detectorPassesInternal detector 判定（packs.detectorPasses 的收敛版）：
// ysm → IsYsmFile；mcmeta/shader → 容器 + zipEntries 匹配；zipentry → 容器指纹
// 或非容器扩展名认同；extension/空 → 扩展名认同。
// 容器条目每次判定独立 Open（单次判定场景；location strict 多候选共享见
// detectorPassesEntries——锐评 #4）。
func detectorPassesInternal(path string, ext string, isContainer bool, rt *types.ResourceType) bool {
	return detectorPassesEntries(path, ext, isContainer, rt, func() []container.Entry {
		return openContainerEntries(path)
	})
}

// detectorPassesEntries 带容器条目 provider 的 detector 判定核心：
// entries 惰性取条目（调用方决定共享策略——location strict 对同目录多候选类型
// 连续判定时传「once」provider，容器只 Open/Entries 一次，对齐
// classifyByFingerprint 的共享打开；单次判定传直开 provider）。非容器分支
// 永不触发 provider（mcmeta/shader 早退、zipentry 走扩展名、ysm 走 IsYsmFile）。
func detectorPassesEntries(path string, ext string, isContainer bool, rt *types.ResourceType, entries func() []container.Entry) bool {
	switch strings.ToLower(rt.Detector) {
	case "ysm":
		if isContainer {
			return matchYsmEntriesGO(entries())
		}
		return IsYsmFile(path)
	case "mcmeta", "shader":
		if !isContainer {
			return false
		}
		return countZipEntryMatchesGO(entries(), rt) > 0
	case "zipentry":
		if isContainer {
			return countZipEntryMatchesGO(entries(), rt) > 0
		}
		return hasExtIn(ext, rt.EffectiveExtensions())
	case "", "extension":
		return hasExtIn(ext, rt.EffectiveExtensions())
	default:
		return hasExtIn(ext, rt.EffectiveExtensions())
	}
}

// IsYsmFile YSM 模型判定：.ysm 直判；.json 仅 ysm.json 入口清单；
// .zip/.7z 统一开容器走段后缀指纹（ADR-082 续：坏容器 false，识别不出就是识别不出）。
func IsYsmFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".ysm" {
		return true
	}
	if ext == ".json" {
		return types.IsYsmEntryJSON(filepath.Base(path))
	}
	if !types.IsContainerExt(ext) {
		return false
	}
	return matchYsmEntriesGO(openContainerEntries(path))
}

// MatchZipArchive 打开容器并按 rt.ZipEntries 内容指纹匹配（packs.matchZipArchive 收敛版）。
func MatchZipArchive(path string, rt *types.ResourceType) bool {
	return CountZipEntryMatches(openContainerEntries(path), rt) > 0
}

// CountZipEntryMatches 对已打开条目统计匹配数（去重：同一文件被多条规则命中只计一次）。
func CountZipEntryMatches(entries []container.Entry, rt *types.ResourceType) int {
	count := 0
	seen := make(map[string]bool)
	for _, e := range entries {
		name := e.Name()
		if rt.MatchZipEntry(name) && !seen[name] {
			seen[name] = true
			count++
		}
	}
	return count
}

// MatchYsmEntries 对已打开条目做 ysm 段后缀指纹判定（ysm.json/models/ 任意层级）。
func MatchYsmEntries(entries []container.Entry) bool {
	return matchYsmEntriesGO(entries)
}

// matchYsmEntryNames ysm 指纹核心（小写条目名列表）：任意层级段后缀命中
// ysm.json / models/ 前缀即 pass。
func matchYsmEntryNames(loweredNames []string) bool {
	for _, name := range loweredNames {
		segs := strings.Split(filepath.ToSlash(strings.ToLower(name)), "/")
		for i := range segs {
			seg := strings.Join(segs[i:], "/")
			if types.IsYsmEntryJSON(seg) || strings.HasPrefix(seg, "models/") {
				return true
			}
		}
	}
	return false
}

// matchYsmEntriesGO container.Entry 版 ysm 指纹（内部复用）。
func matchYsmEntriesGO(entries []container.Entry) bool {
	names := make([]string, len(entries))
	for i, e := range entries {
		names[i] = e.Name()
	}
	return matchYsmEntryNames(names)
}

// countZipEntryMatchesGO 内部别名（与导出 CountZipEntryMatches 同义）。
func countZipEntryMatchesGO(entries []container.Entry, rt *types.ResourceType) int {
	return CountZipEntryMatches(entries, rt)
}

// openContainerEntries 打开容器枚举条目（打开失败返回 nil——坏容器无指纹）。
func openContainerEntries(path string) []container.Entry {
	r, err := container.Open(path)
	if err != nil {
		return nil
	}
	defer r.Close()
	return r.Entries()
}

// IsTypeModelFile 判断文件名是否为指定资源类型的模型文件（ADR-064 收敛）：
// 扩展名命中该类型注册表扩展集（SupportedExtsForType），.json 仅放行 ysm.json。
// 原 sync.isModelFile 与 instance.extMatch 收敛于此（差异：空扩展集返回 false，
// 与 isModelFile 严格语义一致；extMatch 的空集放行分支在 BuildSyncItems 中
// 不会触发——未知类型早被 SubDirMap 空拦截跳过）。
// 归属（ADR-144）：原住 types/extensions.go，zipentry 分支需开容器做指纹
// （container.ZipMatchesEntries），随识别逻辑一并下沉本包。
func IsTypeModelFile(name, rtype string) bool {
	// filepath.Base 兼容裸名与完整路径调用（code review P1：4 个调用点已改传完整
	// 路径——裸名精确判断（ysm.json 特判/ext）对完整路径失效会误判）；zip 分支
	// 用原始 name 开文件（见下），不受 base 取 Base 影响
	base := types.NormalizeResourceName(filepath.Base(name))
	// ysm.json 特判（.json 扩展名在注册表中但只有 ysm.json 算模型文件）：
	// 仅当该类型扩展集含 .json（ysm）时放行——resourcepack/shaderpack 扩展集
	// 只有 .zip，整合包目录散落的 ysm.json 不得作为其独立同步条目（P3 修复：
	// 整合包推送/拉取列表被 ysm.json 刷屏）。
	if types.IsYsmEntryJSON(base) {
		for _, e := range types.SupportedExtsForType(rtype) {
			if strings.EqualFold(e, ".json") {
				return true
			}
		}
		return false
	}
	ext := strings.ToLower(filepath.Ext(base))
	rt := types.RegistryType(rtype)
	for _, e := range types.SupportedExtsForType(rtype) {
		if ext == strings.ToLower(e) && !strings.EqualFold(e, ".json") {
			// zipentry 检测器类型：.zip 是「装模型的容器」而非模型实体，
			// 必须枚举 zip 内含条目、命中本类型 zipEntries 指纹才算模型
			// （与 packs.DetectResourceType 的 case "zipentry" 语义对齐）。
			// 否则任何 .zip（坏包/纯打包物）会被同步推送/拉取链路误判为
			// 顶层模型文件搬运——ADR 收敛：不为文件操作放粗放判定。
			if strings.EqualFold(e, ".zip") && rt != nil && rt.Detector == "zipentry" {
				return container.ZipMatchesEntries(name, rt.MatchZipEntry)
			}
			return true
		}
	}
	return false
}

// hasExtIn 扩展名集合成员判定（大小写归一）。
func hasExtIn(ext string, exts []string) bool {
	for _, e := range exts {
		if ext == strings.ToLower(e) {
			return true
		}
	}
	return false
}

// ancestorDirs 祖先目录收集（深→浅；Windows 盘符根与卷标显式终止）。
func ancestorDirs(dir string) []string {
	var ancestors []string
	d := dir
	for d != "." && d != "" && d != string(filepath.Separator) {
		ancestors = append(ancestors, d)
		parent := filepath.Dir(d)
		if parent == d {
			break
		}
		d = parent
	}
	return ancestors
}
