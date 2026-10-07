// scanner_scan.go：模型扫描主体（原 scanner.go 拆分，2026-10 文件行数治理）。
// ScanEntries / ScanEntriesWithHit / lookupScanCache / joinInFlightWaiter / processScanDirEntry /
// ComputeFileHash / hashEntriesParallel——目录扫描 + SHA256 + 并行哈希。
package scanner

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// ========== 模型扫描 ==========

// ScanEntries 扫描目录下的模型文件（含 .recycle 排除、扩展名过滤、SHA256 哈希、30s TTL 缓存）
func ScanEntries(dir string) []types.ModelEntry {
	entries, _ := ScanEntriesWithHit(dir)
	return entries
}

// ScanEntriesCtx 同 ScanEntries，ctx 取消时中止 walk（ADR-197）。
func ScanEntriesCtx(ctx context.Context, dir string) []types.ModelEntry {
	entries, _ := ScanEntriesWithHitCtx(ctx, dir)
	return entries
}

// ScanEntriesWithHit 同 ScanEntries，但额外返回是否命中 30s 缓存。
// 调用方据此决定是否记录扫描日志，避免 30s 内重复访问同一目录时刷屏操作日志面板。
func ScanEntriesWithHit(dir string) ([]types.ModelEntry, bool) {
	return ScanEntriesWithHitCtx(context.Background(), dir)
}

// ScanEntriesWithHitCtx 同 ScanEntriesWithHit，带取消语义（ADR-197）：ctx 取消即
// fs.SkipAll 中止 walk，返回已收集的部分结果且不写入缓存（部分结果当成功缓存
// 会污染 30s TTL 窗口）。
func ScanEntriesWithHitCtx(ctx context.Context, dir string) ([]types.ModelEntry, bool) {
	dir = normalizeScanKey(dir)
	if dir == "" {
		return []types.ModelEntry{}, false
	}
	// 符号链接根目录检查（与 go/dedup ErrSymlinkRoot 口径对齐）：
	// scanner 走 WalkDir 会 lstat 根、读到链接目标后正常下钻，
	// 恶意/误操作构造的链接可让扫描读到目标外文件（Path 字段泄露绝对路径）。
	if fi, err := os.Lstat(dir); err == nil && fi.Mode()&os.ModeSymlink != 0 {
		emitScanError("[scanner] 扫描根目录是符号链接: %s", dir)
		return []types.ModelEntry{}, false
	}
	// 记录扫描开始时间（进入时），TTL 从此时刻算，不被扫描耗时侵蚀
	startTime := time.Now()
retry:
	// 记录进入时代际：扫描期间若缓存被失效，Store 前比对并丢弃结果
	// （retry 重来会重新捕获——失效后的等待方对齐「无航班」的 fresh 语义）
	gen := cacheGen.Load()
	// 记录进入时 per-key 版本——InvalidatePath 只递增本 key，
	// Store 前比对 keyVersion 防止「刚失效又被本目录在途扫描重新 Store」
	// P1 修复：keyVersions 值类型改为 *atomic.Uint64，用 Load() 读取原子值
	kv, _ := keyVersions.LoadOrStore(dir, &atomic.Uint64{})
	keyVersion := kv.(*atomic.Uint64).Load()

	if cloned, ok := lookupScanCache(dir); ok {
		return cloned, true
	}

	// 在途合并：同目录并发扫描共享一次 walk/Rust 扫描——首个调用方注册航班成为
	// owner，后续调用方并入航班等待，取克隆结果且 hit=true（薄壳不重复记扫描日志）。
	// 置于 Rust 快路径之前：Windows（Rust handled=true）下并发请求同样并入航班去重
	fl := &scanFlight{gen: gen, keyVersion: keyVersion}
	// owner 候选航班：wg.Add 须在 LoadOrStore 之前（waiter 可能在 Load 后立刻 Wait——
	// 计数先于暴露，Wait 才不会空跑）。waiter 路径（join 返回 hit/retry）下本 fl 被
	// 整体弃用：wg 计数 1 无人 Done 亦无害（从不 Wait 它，垃圾回收即可）——结构使然，
	// 已评估为「惯用法 + 已收敛产物」，不改为 singleflight.Group
	// （自建表支持 waiter 按启动时版本失效守卫，标准库 Group 无此语义）。
	fl.wg.Add(1)
	if res := joinInFlightWaiter(dir, fl); res.hit {
		return res.entries, true
	} else if res.retry {
		goto retry
	}
	// owner 身份：负责删除航班 + 放行等待方
	defer func() {
		inFlight.Delete(dir)
		fl.wg.Done()
	}()

	// owner 身份已定（waiter 已并入航班）——Go walk 结果同样记录到航班供 waiter 取。

	walkCount.Add(1)
	if h := getWalkStartHook(); h != nil {
		h()
	}
	entries := []types.ModelEntry{}
	// 并行遍历：filepath.WalkDir 是纯顺序 DFS，单次 readdir 阻塞后续全部目录——
	// walkDirParallel 用目录工作队列 + worker 池并行展开（契约见 walk_parallel.go）。
	// 回调并行执行，entries append 与 walkFailed 写入须加锁/原子化。
	// 根目录级 walk 失败标记——目录不存在/无权限时遍历仅回调一次 err 后结束，
	// 原实现打印后返回空列表并照常 Store 进缓存 30s，用户无法区分「目录真空」与
	// 「目录不可读」（失败结果被当成功缓存）
	var entriesMu sync.Mutex
	var walkFailed atomic.Bool
	// 接收遍历返回 error——根 lstat 失败时仅回调一次即返回，旧实现忽略该返回值
	// 导致 walkFailed 恒 false，空结果照常缓存。
	if werr := walkDirParallel(dir, func(p string, d os.DirEntry, err error) error {
		if ctx.Err() != nil {
			return fs.SkipAll // ADR-197：取消即中止整个 walk
		}
		entry, walkRet, rootFailed := processScanDirEntry(p, d, err, dir, true, true)
		if rootFailed {
			walkFailed.Store(true)
			return nil
		}
		if walkRet != nil {
			return walkRet
		}
		if entry != nil {
			entriesMu.Lock()
			entries = append(entries, *entry)
			entriesMu.Unlock()
		}
		return nil
	}); werr != nil {
		walkFailed.Store(true)
	}
	// 并行遍历产出非确定顺序——按路径排序恢复 filepath.WalkDir 的字典序口径，
	// 防同输入不同输出（缓存内容/索引行序/前端展示顺序）。
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Path < entries[j].Path
	})
	// SHA256 并行哈希回填：旧实现哈希在 WalkDir 回调内串行
	// 全量读盘（大库冷扫逐文件同步 IO）；walk 期间 deferHash 跳过计算，收集完条目后
	// 按 worker 池并行回填——条目序/错误口径不变（见 hashEntriesParallel）。
	hashEntriesParallel(entries)
	// 克隆 slice 后 Store，避免 sync.Map.Load 读到 WalkDir 中途
	// append 的部分写入（单线程 Wails 场景安全，但并发扫描无 race）
	stored := append([]types.ModelEntry(nil), entries...)
	// 航班结果供等待方克隆取用（须在 wg.Done 前写入——defer 于函数返回时放行等待方）
	fl.entries = stored
	// 取消路径：部分结果只返回不缓存（walkFailed 语义保留给真失败）
	if ctx.Err() != nil {
		return entries, false
	}
	tryStoreScanCache(dir, stored, startTime, gen, keyVersion, walkFailed.Load())
	return entries, false
}

// lookupScanCache 查 scanCache，命中新鲜条目返回 (克隆后的 entries, true)。
// 过期条目惰性 Delete 后返回 (nil, false)，继续真扫。
func lookupScanCache(dir string) ([]types.ModelEntry, bool) {
	v, ok := scanCache.Load(dir)
	if !ok {
		return nil, false
	}
	entry := v.(scanCacheEntry)
	if time.Now().Before(entry.expiresAt) {
		// 命中路径克隆后返回，避免调用方写回内部切片污染缓存后备数组+并发竞争；
		// 空结果用空切片做基底，保证序列化 [] 而非 null，与首次扫描口径一致
		return append([]types.ModelEntry{}, entry.entries...), true
	}
	// 过期条目惰性淘汰——长期运行大量目录后过期 entry 滞留内存
	scanCache.Delete(dir)
	return nil, false
}

// joinInFlightWaiter 尝试在 inFlight 表注册/并入航班。
// 返回 joinResult（替代原三态 bool 返回，语义不变）：
//   - hit=true：waiter 成功等到合法（版本未变）航班结果，直接用 res.entries
//   - retry=true：waiter 等到但版本已变，调用方 goto retry 重来
//   - hit 与 retry 皆 false：本调用成为 owner，需自己真扫并把结果写入 fl.entries
func joinInFlightWaiter(dir string, fl *scanFlight) joinResult {
	prev, loaded := inFlight.LoadOrStore(dir, fl)
	if !loaded {
		return joinResult{} // owner
	}
	other := prev.(*scanFlight)
	flightJoins.Add(1)
	other.wg.Wait()
	// 等待方失效守卫：比较 **flight 启动时** 版本（other.gen/other.keyVersion），
	// 而非 waiter 自身进入时捕获的——waiter 在失效后加入时自身捕获已是最新，
	// 与当前值恒等、守卫失效，会吞下 owner 失效前读到的旧扫描结果
	kvNow, _ := keyVersions.LoadOrStore(dir, &atomic.Uint64{})
	if cacheGen.Load() == other.gen && kvNow.(*atomic.Uint64).Load() == other.keyVersion {
		return joinResult{entries: append([]types.ModelEntry{}, other.entries...), hit: true}
	}
	return joinResult{retry: true} // 版本已变，调用方 goto retry
}

// processScanDirEntry 处理 WalkDir 单个回调：错误上报、目录级 Skip 判定（recycle/.github/禁用后缀）、
// 文件级扩展名过滤/禁用恢复/ysm.json 判定、文件信息读取、哈希计算，最后产出单个 *ModelEntry。
// 返回值：
//   - entry：非 nil 表示该文件应进入扫描结果
//   - walkRet：WalkDir 回调应 return 的 error 值（nil 继续 / filepath.SkipDir 跳子树）
//   - rootFailed：仅当 walk 根目录本身出错时返回 true，用于调用方标记 walkFailed
//
// 本函数是原 WalkDir 闭包内近 80 行逻辑的提纯升格，输入纯参数、无副作用（除错误回调和哈希）。
// wantMeta=false（作者提取等只看文件名的场景）时跳过 d.Info() 与哈希计算——
// 纯目录枚举，Size/ModTime/Hash 恒零值。
// deferHash=true（ScanEntries 走盘用）：哈希推迟到 walk 后由 hashEntriesParallel 并行
// 回填，本函数只留 Size/ModTime；其余调用方传 false 保持内联。
func processScanDirEntry(p string, d os.DirEntry, err error, dir string, wantMeta, deferHash bool) (entry *types.ModelEntry, walkRet error, rootFailed bool) {
	if err != nil {
		// 统一走错误回调（GUI 下 stdout 不可见，薄壳注入后进环形日志面板 ADR-082）
		emitScanError("[scanner] walk error: %s: %v", p, err)
		if p == dir {
			return nil, nil, true // 根目录本身打不开：整目录失败
		}
		return nil, nil, false
	}
	if d.IsDir() {
		// ADR-044 策略 A：回收站排除统一走 fsutil.IsRecycleDir（EqualFold 大小写不敏感、
		// 精确匹配基名，避免子串误杀 foo.recycle.ysm 等合法文件——与 go/sync/dedup 同口径）
		if fsutil.IsRecycleDir(p) {
			return nil, filepath.SkipDir, false
		}
		// .github 目录跳过——GenerateRepoIndex 内嵌 CI 脚本显式跳过 .github，此处
		// 口径统一，避免 .github 内合法扩展名进入 index，Go 侧与 CI 重生成索引漂移
		if d.Name() == ".github" {
			return nil, filepath.SkipDir, false
		}
		// 目录级禁用（ADR-038 D3.7）不得被扫描为活跃条目——原实现只过滤文件级禁用，
		// 导致目录级禁用模型以活跃身份进入 sync，被 GetInstanceStatus 列为 Missing
		if registry.IsDisableSuffix(d.Name()) {
			return nil, filepath.SkipDir, false
		}
		return nil, nil, false
	}
	ext := strings.ToLower(filepath.Ext(p))
	originalExt := ext
	// 目录级 .ban 已在上方 SkipDir；文件级 .ban/.disabled 恢复原扩展名判断
	// （stripDisableSuffix 与作者提取共用同口径）
	restored := stripDisableSuffix(p)
	if restored != p {
		originalExt = strings.ToLower(filepath.Ext(restored))
	}
	if !registry.IsSupportedExt(originalExt) {
		return nil, nil, false
	}
	// .json 只允许 ysm.json（动作/动画文件不应单独扫描推送）
	if originalExt == ".json" {
		baseName := registry.NormalizeResourceName(filepath.Base(p))
		if !registry.IsYsmEntryJSON(baseName) {
			return nil, nil, false
		}
	}
	name := filepath.Base(p)
	if registry.IsYsmEntryJSON(name) {
		name = filepath.Base(filepath.Dir(p))
	}
	e := types.ModelEntry{Name: name, Path: p, Ext: originalExt}
	if wantMeta {
		info, err := d.Info()
		if err != nil {
			// d.Info 失败跳过该文件——原实现 log 后仍以 Size=0/ModTime=0 混入，造成
			// 前端展示大小 0 的幽灵文件，同步哈希基于错误元数据；跳过比假条目更诚实。
			emitScanError("[scanner] 获取文件信息失败 %s: %v，跳过该文件", p, err)
			return nil, nil, false
		}
		e.Size = info.Size()
		e.ModTime = info.ModTime().UnixMilli()
		// 计算 SHA256 供同步系统使用（GetInstanceStatus 依赖哈希匹配）
		// 跳过非 YSM 类型的大文件（MMD/VRC 文件可达数十 MB，哈希全量太慢）
		// 蓝图文件（.nbt/.schematic/.litematic）通常较小，计入哈希以支持同步对比
		if registry.ShouldHashExt(originalExt) && !deferHash {
			e.Hash = ComputeFileHash(p)
			// 哈希失败留痕——静默置空会让同步把该文件当「无哈希」跳过（用户不知为何不同步）
			if e.Hash == "" {
				emitScanError("[scanner] 哈希计算失败/跳过 %s（读错误或超 %d 字节上限）", p, registry.MaxImportSize)
			}
		}
	}
	return &e, nil, false
}

// tryStoreScanCache 在版本守卫通过时写入扫描缓存。
// walkFailed（整目录 walk 根级错误）不写缓存——失败结果带 30s TTL 缓存会
// 让「目录不可读」持续显示为空（用户修好权限后 30s 内仍假空）。
func tryStoreScanCache(dir string, stored []types.ModelEntry, startTime time.Time, gen, keyVersion uint64, walkFailed bool) {
	if walkFailed {
		return
	}
	kvNow, _ := keyVersions.LoadOrStore(dir, &atomic.Uint64{})
	if cacheGen.Load() != gen || kvNow.(*atomic.Uint64).Load() != keyVersion {
		return // 版本已变（在途扫描期间被失效），丢弃旧结果
	}
	scanCache.Store(dir, scanCacheEntry{entries: stored, expiresAt: startTime.Add(scanTTL())})
}

// ComputeFileHash 计算文件的 SHA256 哈希（用于同步系统文件匹配）
func ComputeFileHash(path string) string {
	// 大文件哈希上限——.zip 资源包可达数百 MB，全量 io.Copy
	// 会整线程卡死扫描/同步（bug-chronicle #36「全量哈希拖慢非 YSM」）；超 MaxImportSize
	// 跳过哈希返回空（同步匹配对空哈希跳过该文件，与「读失败返回空」语义一致）
	if fi, err := os.Stat(path); err == nil && fi.Size() > registry.MaxImportSize {
		return ""
	}
	hash, err := fsutil.SHA256File(path)
	if err != nil {
		return ""
	}
	return hash
}

// hashEntriesParallel 并行计算 entries 的 SHA256 并按下标回填（旧实现哈希在 WalkDir 回调内串行全量读盘，大库冷扫被逐文件同步 IO 拖慢）。
// 语义与旧内联路径逐字节一致：仅 ShouldHashExt 条目参与、超 MaxImportSize 由
// ComputeFileHash 内部跳过、空哈希补 emitScanError（同旧回调内口径）；worker 数 =
// min(runtime.NumCPU, 待哈希数)，条目顺序不变（按下标回填）。
// 为何不收敛到 conc：本实现按下标原地写 entries[i].Hash 并保留全部结果（失败置空
// 由调用方 emitScanError 决定），conc 的 []R 值返回 + 仅返回 ok=true 契约不契合。
func hashEntriesParallel(entries []types.ModelEntry) {
	var jobs []int
	for i := range entries {
		if registry.ShouldHashExt(entries[i].Ext) {
			jobs = append(jobs, i)
		}
	}
	if len(jobs) == 0 {
		return
	}
	n := runtime.NumCPU()
	if n > len(jobs) {
		n = len(jobs)
	}
	if n < 1 {
		n = 1
	}
	var wg sync.WaitGroup
	ch := make(chan int, len(jobs))
	for w := 0; w < n; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range ch {
				entries[i].Hash = ComputeFileHash(entries[i].Path)
				if entries[i].Hash == "" {
					emitScanError("[scanner] 哈希计算失败/跳过 %s（读错误或超 %d 字节上限）", entries[i].Path, registry.MaxImportSize)
				}
			}
		}()
	}
	for _, j := range jobs {
		ch <- j
	}
	close(ch)
	wg.Wait()
}
