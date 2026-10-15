// sync_dirlevel_sync.go：文件夹级同步主流程（原 sync_dirlevel.go 拆分，2026-10 文件行数治理）。
// SyncResourcesDirLevel / SyncResourcesDirLevelScan / collectEntriesWalk / collectEntriesFromScan——
// global/instance 两侧文件夹级对比与补齐。
package sync

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

type ScanEntriesFn func(dir string) ([]types.ModelEntry, bool)

// dirLevelUnit 文件夹级同步单元（一侧）：身份 key → 单元。
// 携带内容字段是为了复用 ResourceDiff/contentDiffers 做内容级判定（ADR-344 D1）——
// 原实现把单元表做成 map[string]string 只比 key 存在性，仓库侧改过内容的平铺模型文件
// （身份键相同）恒判 Synced，面板「已同步」不可信、行内无推送按钮（推了等于没推）。
// 字段导出仅为满足 go-cmp（sync_dirlevel_scan_test.go 以 cmp.Equal 锁两信道等价）。
type dirLevelUnit struct {
	Path  string // 单元绝对路径
	Rel   string // 相对 rootDir 的原始 slash 小写路径（跨格式判定用，见 dirLevelDiffEntries）
	IsDir bool
	Size  int64
	// Hash 文件级 SHA256，scan 信道由 types.ModelEntry.Hash 旁挂、Walk 回退信道由
	// 同一次 scanFn 结果旁挂；空=未知 → ResourceDiff 回退 Size 对比（同 DiffEntry.Hash 契约）。
	Hash string
	// Oversize 该文件因超 MaxImportSize（>500MB）被**刻意跳过哈希**（bug-chronicle #36）。
	// 与「空 Hash 但设计上不哈希」区分开：超限文件的**同尺寸不足以证明内容一致**
	// （改内容可保持同尺寸），故 contentDiffers 对其不回退 Size 谎报 Synced，而保守判
	// 「可能不同」（P0-2 诚实化）。与文件级信道 DiffEntry.Oversize 同口径同判据——
	// 不移植这条腿，ADR-344 宣称的「同一契约」就只搬了 Hash/Size 两条。
	Oversize bool
}

// dirLevelCacheKey 构建文件夹级同步的缓存键（kind 恒为 dirlevel）。
// syncResourcesDirLevel 的 collectEntries 闭包与 collectEntriesWalkCached 原本各写一份
// 「构造 cacheKey + loadSyncScanCache」块，jscpd 记为新增重复对；收口到此处消除。
//
// hashed 区分「带扫描摘要的单元表」与「纯 Size 单元表」（ADR-344 D1）：两者判定强度不同，
// 互相污染会让内容级判定在 30s TTL 窗口内静默退化——与文件级信道 resources 的同名字段
// 挡住的是同一类 bug（见 sync_cache.go 该字段注释）。
func dirLevelCacheKey(rootDir, rtype string, hashed bool) syncDirectoryScanKey {
	return syncDirectoryScanKey{kind: "dirlevel", root: rootDir, rtype: rtype, hashed: hashed}
}

// dirLevelCacheValue syncDirLevelScanCache 的缓存值型：单元表 + 同次计算产出的键碰撞清单。
// 碰撞随值同存（2026-10-15 P0 面板接线）：否则缓存命中返回空 Warnings，「碰撞已记录」
// 只在 30s TTL 窗口的首次走盘后短暂可见——诊断信道必须跨缓存命中稳定。
type dirLevelCacheValue struct {
	Units      map[string]dirLevelUnit
	Collisions []string
}

// loadDirLevelScanCache 读文件夹级同步缓存（syncDirLevelScanCache）；命中返回 true。
// 返回的 map 是缓存共享对象，消费方必须只读（见 sync_cache.go 契约）。
func loadDirLevelScanCache(rootDir, rtype string, hashed bool) (map[string]dirLevelUnit, []string, bool) {
	v, ok := loadSyncScanCache[dirLevelCacheValue](&syncDirLevelScanCache, dirLevelCacheKey(rootDir, rtype, hashed))
	if !ok {
		return nil, nil, false
	}
	return v.Units, v.Collisions, true
}

// SyncResourcesDirLevel 文件夹级同步（默认 filepath.Walk，行为不变，供测试/旧调用方使用）。
func SyncResourcesDirLevel(globalDir, instanceDir, rtype string) types.ResourceSyncResult {
	return syncResourcesDirLevel(globalDir, instanceDir, rtype, nil)
}

// SyncResourcesDirLevelScan 同 SyncResourcesDirLevel，但注入 scanFn 复用扫描缓存，
// 消除 8 个 MMD 子类型 ×(1+N 整合包) 对同一仓库树的重复 Walk（性能修复）。
// scanFn 一般用 scanner.ScanEntriesWithHit；其结果带 30s TTL + single-flight，
// 故 8×(N+1) 次调用对同一目录实际只走盘一次。无嵌套模式类型（MMD/YSM）从已扫描
// 文件列表精确反推同步条目；含嵌套模式（maid-model 等）回退 filepath.Walk。
func SyncResourcesDirLevelScan(globalDir, instanceDir, rtype string, scanFn ScanEntriesFn) types.ResourceSyncResult {
	return syncResourcesDirLevel(globalDir, instanceDir, rtype, scanFn)
}

func syncResourcesDirLevel(globalDir, instanceDir, rtype string, scanFn ScanEntriesFn) types.ResourceSyncResult {
	// 单元表是否带扫描摘要：同一次调用内的两条信道（scan 反推 / Walk 回退）必须同口径，
	// 否则缓存键的 hashed 维度名不副实（见 dirLevelCacheKey）。
	hashed := scanFn != nil

	// collectEntries 收集整棵树的同步单元：以相对路径（relKeyDirLevel）为 key，
	// 保留完整目录层级。scanFn 命中时从已扫描文件列表反推（避免重复 Walk），
	// 否则退回 filepath.Walk 原行为（结果叠 30s sync 目录扫描缓存，
	// 使 maid-model 等嵌套类型的回退 Walk 在 TTL 内也只真正走一次）。
	// 回退 Walk 时把同一次 scanFn 结果的摘要旁挂进来——Walk 信道因此也有内容级判定，
	// 两条信道判定强度一致（否则 hashed 键会把弱判定结果当强判定复用）。
	// 返回值第二项 = 键碰撞警告（同键不同 Rel 的 last-write-wins 覆盖事件）；
	// 第三项 fresh = 本调用是否新计算（false = 缓存命中，碰撞随缓存值返回但不再重打日志，
	// 防 30s TTL 窗口内反复刷新刷屏——日志只在首次走盘产出时打一次）。
	collectEntries := func(rootDir string) (map[string]dirLevelUnit, []string, bool) {
		if cached, cols, ok := loadDirLevelScanCache(rootDir, rtype, hashed); ok {
			return cached, cols, false
		}
		var entries []types.ModelEntry
		scanHit := false
		if scanFn != nil {
			entries, scanHit = scanFn(rootDir)
		}
		if scanHit && len(entries) > 0 {
			if m, collisions := collectEntriesFromScan(entries, rootDir, rtype); m != nil {
				// scan-hit 衍生结果叠同款 syncDirLevelScanCache：BuildSyncItems 周期内
				// 8 个 MMD 子类型 × N 个实例反复对同一个全局仓库根 (rootDir, rtype)
				// 重算 O(entries) 衍生 map——命中 scanner 30s TTL+single-flight 窗口内
				// 直接返回，与 Walk 回退路径（collectEntriesWalkCached）对称复用缓存。
				// 仅当 m != nil（无嵌套模式可反推）才存——nil 回退 Walk 不缓存，
				// 否则会把「须走 Walk」误判为命中而永久跳过 Walk。
				// hashed 用变量而非字面量 true：本分支今天只在 scanFn != nil 时可达（hashed 恒真），
				// 但硬编码会让「读槽/写槽」在将来重构中悄悄分叉（复核 P3-6）。
				storeSyncScanCache(&syncDirLevelScanCache, dirLevelCacheKey(rootDir, rtype, hashed), dirLevelCacheValue{Units: m, Collisions: collisions})
				return m, collisions, true
			}
		}
		// 外层缓存已 miss 才走到这里，故本调用为新计算（fresh=true）
		m, collisions := collectEntriesWalkCached(rootDir, rtype, hashed, dirLevelHashByPath(entries))
		return m, collisions, true
	}

	globalUnits, globalCollisions, globalFresh := collectEntries(globalDir)
	instanceUnits, instanceCollisions, instanceFresh := collectEntries(instanceDir)
	result := dirLevelResult(globalUnits, instanceUnits)
	// 碰撞 fail-loud：汇入结果诊断信道（两种情况都挂）+ 日志留痕（仅新计算时打，缓存命中不重打）
	//（同「Walk 错误」本地惯用法；CLI 侧 stderr 可见，GUI 侧日志面板可见）。
	if globalFresh {
		for _, w := range globalCollisions {
			log.Printf("[sync] 全局侧 %s", w)
		}
	}
	if instanceFresh {
		for _, w := range instanceCollisions {
			log.Printf("[sync] 实例侧 %s", w)
		}
	}
	result.Warnings = append(result.Warnings, globalCollisions...)
	result.Warnings = append(result.Warnings, instanceCollisions...)
	return result
}

// dirLevelResult 归并两侧单元表出同步结果：内容级判定**复用 ResourceDiff**
// （ADR-064 单点对比：哈希优先、无哈希回退 Size），不再手写「键存在即 Synced」（ADR-344 D1）。
// 目录单元两侧均无折叠指纹（scan 信道产不出，见 ADR-344 D2）→ contentDiffers 判 Synced，
// 即目录单元仍是存在性语义，其内容分叉由展开层（DiffFolderContentsScan → 子文件
// missing/diverged → 容器聚合）承担。
func dirLevelResult(globalUnits, instanceUnits map[string]dirLevelUnit) types.ResourceSyncResult {
	return ResourceDiff(
		dirLevelDiffEntries(globalUnits, instanceUnits),
		dirLevelDiffEntries(instanceUnits, globalUnits),
	)
}

// dirLevelDiffEntries 把一侧单元表投影成 ResourceDiff 的输入。
// 内容字段仅在「对侧同键存在且原始相对路径相同」时填：relKeyDirLevel 按模型身份剥扩展名
// 与禁用后缀（B.zip 与 B.ysm 同键），而跨格式比字节**恒不相等**——照比会造出「点了推送
// 也不收敛」的假待推送（推送落 B.ysm 后实例里 B.zip 仍在，键与内容双双不变）。故跨格式
// 退化为「同身份即已同步」的旧语义，同格式才比内容（ADR-344 D1）。
// 顺带把 `.disabled` 与活跃文件的路径差异挡在内容比较之外——那属批 C 的裁决范围。
func dirLevelDiffEntries(units, others map[string]dirLevelUnit) map[string]DiffEntry {
	out := make(map[string]DiffEntry, len(units))
	for key, u := range units {
		e := DiffEntry{Path: u.Path, IsDir: u.IsDir}
		if other, ok := others[key]; ok && u.Rel != "" && other.Rel == u.Rel {
			e.Size, e.Hash, e.Oversize = u.Size, u.Hash, u.Oversize
		}
		out[key] = e
	}
	return out
}

// dirLevelHashByPath 把 scanner 条目按清理后的绝对路径索引成摘要表，供 Walk 回退信道
// 旁挂（与文件级信道的 collectScanHashes 同范式；键用绝对路径是因为 Walk 侧拿到的就是路径）。
// 空表/nil 均可安全查询（Go 的 nil map 读返回零值）。
func dirLevelHashByPath(entries []types.ModelEntry) map[string]string {
	if len(entries) == 0 {
		return nil
	}
	m := make(map[string]string, len(entries))
	for _, e := range entries {
		if e.Hash != "" {
			m[filepath.Clean(e.Path)] = e.Hash
		}
	}
	return m
}

// dirLevelRel 单元相对 rootDir 的原始路径（slash + 小写），供跨格式判定。
// 与 relKeyDirLevel 的分工：后者剥扩展名/禁用后缀（模型身份），本函数保留它们——
// 它要回答的正是「两侧格式是否同一」，剥掉就问不出来了。
func dirLevelRel(rootDir, path string) string {
	rel, err := filepath.Rel(rootDir, path)
	if err != nil {
		return ""
	}
	return strings.ToLower(filepath.ToSlash(rel))
}

// upsertDirLevelUnit 把一个同步单元登记进单元表；同键已存在且**原始相对路径不同**
// （同级同身份不同扩展名的两个物理文件，如 model_a.pmx + model_a.pmd）时记录一条
// 碰撞警告——覆盖方与被覆盖方都点名。覆盖行为（last-write-wins）本身是既有语义
// （目录 vs 文件同名碰撞已按尾随 "/" 修复，纯文件/文件碰撞见 sync_dirlevel.go 头注释
// 已知限制项）：本 helper 只把「静默丢一个」升级为「丢得可见」，不改键表内容。
func upsertDirLevelUnit(m map[string]dirLevelUnit, collisions *[]string, key string, unit dirLevelUnit) {
	if old, ok := m[key]; ok && old.Rel != unit.Rel {
		*collisions = append(*collisions, fmt.Sprintf(
			"dirLevel 键碰撞 %q：既有 %q 被 %q 覆盖（last-write-wins，被覆盖方不再进同步列表）",
			key, old.Rel, unit.Rel))
	}
	m[key] = unit
}

// collectEntriesWalk 原 filepath.Walk 实现（scanFn 未命中时回退，语义权威基准）。
// 返回 (units, collisions, partialFail)：partialFail 表示 Walk 中途遇错（子树读失败/目录消失），
// 调用方据此决定残缺结果不入缓存——与 sync.go 的 rootFailed/partialFail 双守卫同口径；
// collisions 为同键不同 Rel 的 last-write-wins 覆盖事件（见 upsertDirLevelUnit），空=无碰撞。
// 以下所有分支逻辑（isDirTypeModelFolder / containsModelSubfolder / 容器下钻注册自身键）
// 均继承自原 SyncResourcesDirLevel 的 Walk 实现，保持与旧行为完全一致——
// collectEntriesFromScan 的反推结果须与之等价（见 sync_dirlevel_scan_test.go）。
func collectEntriesWalk(rootDir string, rtype string, hashByPath map[string]string) (map[string]dirLevelUnit, []string, bool) {
	entries := make(map[string]dirLevelUnit)
	var collisions []string
	partialFail := false
	memo := make(nestedDirMemo)
	// Walk 外层返回仅承接回调错误，而回调恒返回 nil（含 root 不存在首回调 err→partialFail，
	// 见下方 err 分支），故外层返回恒 nil——按最佳努力忽略，与其余 WalkDir 收口口径一致
	_ = filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			log.Printf("[sync] Walk 错误 %s: %v", path, err)
			partialFail = true
			return nil
		}
		if !info.IsDir() {
			// 平铺模型文件：在任意深度收集（不再限定 rootDir 顶层）
			if packs.IsTypeModelFile(path, rtype) {
				if key := relKeyDirLevel(rootDir, path, false); key != "" {
					upsertDirLevelUnit(entries, &collisions, key, dirLevelUnit{
						Path: path, Rel: dirLevelRel(rootDir, path),
						Size: info.Size(), Hash: hashByPath[filepath.Clean(path)],
						// P0-2 诚实化（与文件级 collect 同判据）：超限文件同尺寸不足以证明内容一致
						Oversize: info.Size() > registry.MaxImportSize,
					})
				}
			}
			return nil
		}
		if path == rootDir {
			return nil
		}
		// 跳过回收站目录（与 scanner.ScanEntries 对齐）
		if fsutil.IsRecycleDir(path) {
			return filepath.SkipDir
		}
		// relink 备份尸体子树剔除（ADR-342）：恢复点不是模型，不得进同步 diff
		if isRelinkBackupPath(path) {
			return filepath.SkipDir
		}
		// 模型文件夹：在任意深度收集（不再限定一级子目录）
		// 使用 memo 变体消除 patternFind 重复子树扫描（patternFind 已知残余 IO）
		if isDirTypeModelFolderMemo(path, rtype, memo) {
			// 容器目录混入直接平铺模型文件（.ysm/.zip）也会被 isDirTypeModelFolder 判真，
			// 但若它同时含子模型文件夹，则是「容器」而非「叶子模型夹」——整体收编 SkipDir
			// 会吞掉子夹层级（如 嵌套1/ 内含平铺 .ysm + 01_taisho_maid/ + 嵌套2/ 深层）。
			// 此时下钻保留各子夹层级，让 nestDirLevelTree 重建容器。
			if containsModelSubfolderMemo(path, rtype, memo) {
				// 容器下钻时也注册自身键（目录 marker）——与对侧同名
				// 叶子目录（仅平铺文件——pre-fix 安装）键一致，避免键集不相交产生
				// 幻影 Missing+Extra（内容相同却显示分歧）
				if key := relKeyDirLevel(rootDir, path, true); key != "" {
					upsertDirLevelUnit(entries, &collisions, key, dirLevelUnit{Path: path, Rel: dirLevelRel(rootDir, path), IsDir: true})
				}
				return nil
			}
			if key := relKeyDirLevel(rootDir, path, true); key != "" {
				upsertDirLevelUnit(entries, &collisions, key, dirLevelUnit{Path: path, Rel: dirLevelRel(rootDir, path), IsDir: true})
			}
			return filepath.SkipDir
		}
		// 非模型子目录：继续递归（可能包含深层嵌套的模型文件夹/文件）
		return nil
	})
	return entries, collisions, partialFail
}

// collectEntriesWalkCached 与 collectEntriesWalk 语义一致，但结果叠 30s
// sync 目录扫描缓存；用于嵌套类型（maid-model）等无法从 scanner 扁平列表
// 精确反推、必须回退 Walk 的路径。
// hashed 与调用方（collectEntries 闭包）的缓存键口径一致：命中与写入必须同槽，
// 否则强/弱判定结果会互相复用（见 dirLevelCacheKey）。
func collectEntriesWalkCached(rootDir, rtype string, hashed bool, hashByPath map[string]string) (map[string]dirLevelUnit, []string) {
	if cached, cols, ok := loadDirLevelScanCache(rootDir, rtype, hashed); ok {
		return cached, cols
	}
	entries, collisions, partialFail := collectEntriesWalk(rootDir, rtype, hashByPath)
	// 完整 Walk 才入缓存（对齐 sync.go 的 rootFailed/partialFail 双守卫）：
	// 根目录存在 ≠ 子树扫完整——原 os.Stat 守卫与完整性无关，子目录读失败时
	// 残缺 entries 仍会被缓存 30s 当权威。partialFail 已覆盖 root 不存在（首回调即 err）。
	if !partialFail {
		storeSyncScanCache(&syncDirLevelScanCache, dirLevelCacheKey(rootDir, rtype, hashed), dirLevelCacheValue{Units: entries, Collisions: collisions})
	}
	return entries, collisions
}

// collectEntriesFromScan 从 scanner 已扫描的模型文件列表反推目录级同步条目，
// 语义与 collectEntriesWalk 对齐。仅适用于「无嵌套模式」类型（MMD/YSM）：
// 此类类型的「模型文件夹」= 直接含模型文件的目录，可从扁平文件列表精确重建；
// 含嵌套模式（maid-model：assets/<ns>/maid_model.json）无法从文件列表精确重建，
// 调用方须先判 NestedPatternsFor 为空，否则应返回 nil 回退 Walk。
//
// 重建规则（对照 Walk 的 SkipDir 语义）：
//   - 平铺模型文件：仅当父目录不是「叶子模型文件夹」时登记（叶子夹 SkipDir 不登记内部文件；
//     容器夹下钻则登记内部文件；父为 rootDir 恒登记）。
//   - 模型文件夹：所有直接含模型文件的目录（含容器）均登记为目录键。
//
// 单元附带 Size/Hash（ADR-344 D1）：scan 条目自带摘要，是 dirLevel 内容级判定的哈希来源。
// 返回 (units, collisions)：collisions 同 collectEntriesWalk 口径（同键不同 Rel 覆盖事件）。
func collectEntriesFromScan(entries []types.ModelEntry, rootDir, rtype string) (map[string]dirLevelUnit, []string) {
	// 含嵌套模式无法精确重建，回退 nil → 调用方走 Walk
	if len(registry.NestedPatternsFor(rtype)) > 0 {
		return nil, nil
	}
	sep := string(filepath.Separator)
	rootDir = filepath.Clean(rootDir)

	// 直接含模型文件的目录索引 + 收集的模型文件
	dirHasModelFile := make(map[string]bool)
	var modelFiles []types.ModelEntry
	for _, e := range entries {
		p := e.Path
		if isRelinkBackupPath(p) {
			// 备份尸体剔除（ADR-342）：生产链走 scanner 命中时到这里，scanner 会下钻
			// 尸体内文件并照常填哈希——只修 Walk 通道等于没修
			continue
		}
		if p != rootDir && !strings.HasPrefix(p, rootDir+sep) {
			continue // 不在 rootDir 下的条目忽略（防御）
		}
		if !packs.IsTypeModelFile(p, rtype) {
			continue
		}
		dirHasModelFile[filepath.Dir(p)] = true
		modelFiles = append(modelFiles, e)
	}

	// directChildModelFolder 判定 parent 是否直接含子模型文件夹（对照 containsModelSubfolder）。
	// 预处理一次 parent→直接子模型夹 反向索引，使每次查询 O(1)（原实现为 O(n_files × n_dirs)
	// 全量扫描 dirHasModelFile，大仓库下有感知）。语义与原实现严格等价。
	directChildModelDirs := make(map[string][]string)
	for d := range dirHasModelFile {
		p := filepath.Dir(d)
		if p == rootDir || strings.HasPrefix(p, rootDir+sep) {
			directChildModelDirs[p] = append(directChildModelDirs[p], d)
		}
	}
	directChildModelFolder := func(parent string) bool {
		return len(directChildModelDirs[parent]) > 0
	}

	out := make(map[string]dirLevelUnit)
	var collisions []string
	// 1) 平铺模型文件：父为 rootDir 或父非叶子模型文件夹时登记
	for _, e := range modelFiles {
		p := e.Path
		parent := filepath.Dir(p)
		unit := dirLevelUnit{
			Path: p, Rel: dirLevelRel(rootDir, p), Size: e.Size, Hash: e.Hash,
			// 与 Walk 信道同判据（scan 条目同样带 Size；>500MB 的哈希在 scanner 侧已跳过）
			Oversize: e.Size > registry.MaxImportSize,
		}
		if parent == rootDir {
			if key := relKeyDirLevel(rootDir, p, false); key != "" {
				upsertDirLevelUnit(out, &collisions, key, unit)
			}
			continue
		}
		isLeafFolder := dirHasModelFile[parent] && !directChildModelFolder(parent)
		if !isLeafFolder {
			if key := relKeyDirLevel(rootDir, p, false); key != "" {
				upsertDirLevelUnit(out, &collisions, key, unit)
			}
		}
	}
	// 2) 模型文件夹：直接含模型文件的目录（含容器）均登记为目录键
	for d := range dirHasModelFile {
		if d == rootDir {
			continue
		}
		if !strings.HasPrefix(d, rootDir+sep) {
			continue
		}
		if key := relKeyDirLevel(rootDir, d, true); key != "" {
			upsertDirLevelUnit(out, &collisions, key, dirLevelUnit{Path: d, Rel: dirLevelRel(rootDir, d), IsDir: true})
		}
	}
	return out, collisions
}
