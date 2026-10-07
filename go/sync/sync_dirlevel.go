// ===== 文件夹级资源同步（ADR-040 拆分，多层物理路径支持）=====
// 从 sync.go 拆出：YSM（ysm.json 文件夹）/ MMD（.pmx/.pmd 文件夹）按文件夹名对比
//
// ═══════════════════════════════════════════════════════════════════════════════
// 多层物理路径支持（2026-09 重构）
// ───────────────────────────────────────────────────────────────────────────────
// 原实现使用文件夹/文件名的 basename 作为同步 key，且仅收集 rootDir 顶层单元：
//   - 平铺模型文件仅收集 "直接位于 rootDir 下" 的（filepath.Dir(path)==rootDir）
//   - 模型文件夹仅收集 rootDir 的直接一级子目录（Walk 找到模型文件夹后 SkipDir，
//     不再深入兄弟目录间的深层嵌套）
//
// 后果：仓库多级子目录（如 maid-model/vendor/character/pack.zip）被扁平化，
// 同步时丢失层级信息，实质上阻碍模型仓库多层物理路径推广。
//
// 重构方案：
//  1. key 从 basename 升级为相对路径（relKeyDirLevel），天然保留目录层级
//  2. 平铺模型文件在任意深度收集——仅当父目录不含模型文件（未被整体收编 SkipDir）时可达，
//     属于边界路径：主路径（目录含模型文件 → isDirTypeModelFolder 检测为模型文件夹 →
//     SkipDir 整树收编）覆盖绝大多数场景
//  3. 模型文件夹在任意深度收集，不再限定一级子目录
//  4. 非模型子目录中不包含任何模型文件/文件夹时，SkipDir 优化遍历
//
// 已知限制（非本次回归，待治理）：
//   - 同级「不同扩展名同名文件」的 key 归一为同一相对路径（relKeyDirLevel 一律剥扩展名）：
//     如 `模型包.zip` 与 `模型包.ysm` 同键 `<parent>/模型包` → map last-write-wins 静默丢一个。
//     （目录与文件同名碰撞已由尾随 "/" 修复——见 relKeyDirLevel；本项为纯文件/文件碰撞，仍待治）
//   - patternFind 重复子树扫描已治理（2026-08-24）：collectEntriesWalk 内建
//     nestedDirMemo，一次 Walk 内同一目录+pattern 只递归一次，O(N²) 降为 O(N)。
//
// ═══════════════════════════════════════════════════════════════════════════════
// 2026-10 拆分：原 751 行按职责分为 sync_dirlevel.go（本文件：nested 目录检测 + memoization）/
// sync_dirlevel_sync.go（文件夹级同步主流程）/ sync_dirlevel_diff.go（文件夹内容差异比对）。
package sync

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/types/registry"
)

// isDirTypeModelFolder 检查一个子目录是否包含 YSM/MMD 模型文件（即文件夹级资源）
// 用于 YSM（.ysm / ysm.json）和 MMD（.pmx/.pmd）类型的文件夹级同步
// 支持多层嵌套结构检测（通过 NestedPatterns 配置）
func isDirTypeModelFolder(path string, rtype string) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if packs.IsTypeModelFile(filepath.Join(path, e.Name()), rtype) {
			return true
		}
	}
	// 基于 NestedPatterns 配置的多层嵌套检测
	// 支持任意深度的嵌套结构，不再硬编码 maid-model 特定逻辑
	// 只在当前目录是真正的模型目录（包含入口文件的目录）时返回 true
	if patterns := registry.NestedPatternsFor(rtype); len(patterns) > 0 {
		if foundDir := findNestedModelDir(path, patterns); foundDir != "" {
			// 只有当找到的模型目录就是当前路径时才返回 true
			// 如果找到的是更深层的目录，说明当前目录只是中间目录
			if filepath.Clean(foundDir) == filepath.Clean(path) {
				return true
			}
		}
	}
	return false
}

// findNestedModelDir 在指定目录下递归查找嵌套模型目录
// 返回第一个符合模式的模型目录路径，找不到返回空字符串
// 关键设计：返回实际的模型目录路径（包含入口文件的目录），
// 而不是中间目录的路径。这样 Walk 能正确识别嵌套结构。
func findNestedModelDir(path string, patterns []registry.NestedPattern) string {
	for _, pattern := range patterns {
		if found := patternFind(path, pattern, 0); found != "" {
			return found
		}
	}
	return ""
}

// patternFind 递归查找符合单个嵌套模式的模型目录
// 返回找到的模型目录路径，找不到返回空字符串
// 与 patternMatches 不同：此函数返回具体路径而非布尔值，
// 让调用方能区分"当前目录是模型文件夹"和"子目录中有模型文件夹"两种情况
//
// 返回值说明：
// - 当在 EntryDir 下（或其子目录）找到入口文件时，返回 EntryDir 的父目录
// - 这样能正确识别模型包的根目录（如 my_pack/assets/ns/maid_model.json -> my_pack）
// - 当 EntryDir 为空且入口文件直接在当前目录时，返回当前目录
//
// 实现：薄包装 patternFindMemo，传入独立空 memo。单次调用内目录路径唯一，
// memo 不会提前命中，故语义与"无 memo"的原实现逐分支一致（零行为变更，ADR-140 L3）。
func patternFind(path string, pattern registry.NestedPattern, depth int) string {
	return patternFindMemo(path, pattern, depth, make(map[string]string))
}

// checkEntryFiles 检查目录中是否存在入口文件列表中的任一文件
func checkEntryFiles(path string, entryFiles []string) bool {
	for _, entryFile := range entryFiles {
		// 支持不带路径的文件名（如 "maid_model.json"）
		fileName := filepath.Base(entryFile)
		if info, err := os.Stat(filepath.Join(path, fileName)); err == nil && !info.IsDir() {
			return true
		}
	}
	return false
}

// ===== nested 目录检测 memoization（去重 patternFind 重复子树扫描）=====

// nestedDirMemo 用于在同一棵 Walk 树内缓存 patternFind 的结果。
// 外层 key = patternKey（编码 EntryDir/EntryFiles/MaxDepth），
// 内层 key = 目录路径，值 = findNestedModelDir 对该路径+pattern 的返回结果（"" 表示未找到）。
type nestedDirMemo map[string]map[string]string

func patternKey(pattern registry.NestedPattern) string {
	var b strings.Builder
	b.WriteString(pattern.EntryDir)
	b.WriteByte(0)
	for _, f := range pattern.EntryFiles {
		b.WriteString(f)
		b.WriteByte(0)
	}
	b.WriteString(strconv.Itoa(pattern.MaxDepth))
	return b.String()
}

// defaultNestedMaxDepth 嵌套模式未显式配置 MaxDepth 时的递归上限。
// 10 层足够覆盖 maid-model assets/<ns>/maid_model.json 等常见嵌套路径，
// 又避免恶意/异常深层目录把 patternFind 拖入无意义深递归。
const defaultNestedMaxDepth = 10

// patternFindMemo 语义同 patternFind，但结果写入 memo 避免重复子树扫描。
// 同一棵 Walk 树内，同一路径+pattern 只递归一次。
func patternFindMemo(path string, pattern registry.NestedPattern, depth int, memo map[string]string) string {
	if v, ok := memo[path]; ok {
		return v
	}

	maxDepth := pattern.MaxDepth
	if maxDepth <= 0 {
		maxDepth = defaultNestedMaxDepth
	}
	if depth > maxDepth {
		memo[path] = ""
		return ""
	}

	if pattern.EntryDir == "" {
		if checkEntryFiles(path, pattern.EntryFiles) {
			memo[path] = path
			return path
		}
		memo[path] = ""
		return ""
	}

	dirName := filepath.Base(path)
	if strings.EqualFold(dirName, pattern.EntryDir) {
		entries, err := os.ReadDir(path)
		if err == nil {
			for _, e := range entries {
				if e.IsDir() {
					subPath := filepath.Join(path, e.Name())
					if checkEntryFiles(subPath, pattern.EntryFiles) {
						result := filepath.Dir(path)
						memo[path] = result
						return result
					}
				}
			}
			if checkEntryFiles(path, pattern.EntryFiles) {
				result := filepath.Dir(path)
				memo[path] = result
				return result
			}
		}
		memo[path] = ""
		return ""
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		memo[path] = ""
		return ""
	}
	for _, e := range entries {
		if e.IsDir() {
			subPath := filepath.Join(path, e.Name())
			if found := patternFindMemo(subPath, pattern, depth+1, memo); found != "" {
				memo[path] = found
				return found
			}
		}
	}
	memo[path] = ""
	return ""
}

func findNestedModelDirMemo(path string, patterns []registry.NestedPattern, memo nestedDirMemo) string {
	for _, pattern := range patterns {
		pKey := patternKey(pattern)
		pMemo := memo[pKey]
		if pMemo == nil {
			pMemo = make(map[string]string)
			memo[pKey] = pMemo
		}
		if found := patternFindMemo(path, pattern, 0, pMemo); found != "" {
			return found
		}
	}
	return ""
}

// isDirTypeModelFolderMemo 同 isDirTypeModelFolder，但使用 memo 去重 patternFind 子树扫描。
func isDirTypeModelFolderMemo(path string, rtype string, memo nestedDirMemo) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if packs.IsTypeModelFile(filepath.Join(path, e.Name()), rtype) {
			return true
		}
	}
	if patterns := registry.NestedPatternsFor(rtype); len(patterns) > 0 {
		if foundDir := findNestedModelDirMemo(path, patterns, memo); foundDir != "" {
			if filepath.Clean(foundDir) == filepath.Clean(path) {
				return true
			}
		}
	}
	return false
}

// containsModelSubfolderMemo 同 containsModelSubfolder，但使用 memo 去重 patternFind 子树扫描。
func containsModelSubfolderMemo(path string, rtype string, memo nestedDirMemo) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if isDirTypeModelFolderMemo(filepath.Join(path, e.Name()), rtype, memo) {
			return true
		}
	}
	return false
}

// relKeyDirLevel 计算目录级同步条目的规范化 key：相对路径 + 小写 + 去禁用后缀。
// 与 relKey 的区别：relKey 保留扩展名（供 ResourceDiff 按大小对比），
// 而目录级同步的 key 按「模型身份」去扩展名（模型 A 的 zip 无论版本为何，
// 身份相同；扩展名不是模型身份的一部分）。
// 多层物理路径支持：返回的 key 包含完整相对路径层级，如 "vendor/character/pack"
// 而非扁平化的 "pack"。
func relKeyDirLevel(root, path string, isDir bool) string {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	rel = strings.ToLower(rel)
	rel = registry.StripDisableSuffix(rel)
	// 剥离扩展名——模型身份不以扩展名区分
	if ext := filepath.Ext(rel); ext != "" {
		rel = strings.TrimSuffix(rel, ext)
	}
	// 目录键加尾随 "/"——与兄弟平铺文件（同名剥扩展名）区分——
	// 文件"嵌套1/动力臂.ysm"与目录"嵌套1/动力臂/"不再同键（map last-write-wins
	// 曾让文件覆盖目录——模型包静默丢失）
	if isDir {
		rel += "/"
	}
	return rel
}

// SyncResourcesDirLevel 按文件夹名对比资源（用于 YSM 的 ysm.json 文件夹和 MMD 的 .pmx/.pmd 文件夹）
// 以文件夹名为单位，一个文件夹包含模型文件 + 纹理文件 = 一个整体
// 同时也会收集各层级的平铺模型文件（如 .ysm），以相对路径（去扩展名）作为 key
// 路径存储：全局侧存全局路径，实例侧存实例路径；missing/extra 都是路径
//
// 多层物理路径支持：
//   - key 为相对路径（relKeyDirLevel），天然保留目录层级
//   - 平铺模型文件在任意深度收集
//   - 模型文件夹在任意深度收集
//   - 非模型空子目录跳过（SkipDir 优化），避免无意义遍历
//
// ScanEntriesFn 可选注入：复用 scanner 已缓存的扫描结果，避免对已被扫描层走盘过的
// 目录（如全局仓库根）重复全树 Walk。返回 (entries, hit)；hit=false 时调用方回退
// filepath.Walk 原行为。
