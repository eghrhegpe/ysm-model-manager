// ===== 并行目录遍历（替代 filepath.WalkDir）=====
//
// filepath.WalkDir 是纯顺序 DFS：单次 readdir 阻塞后续全部目录，24 核机器上
// 目录级并行理论可拿满全部 CPU。实测（walkbench，8 核）浅树 2.98x / 中树 2.50x，
// p95 高出中位从 70% 塌缩到 23%。
//
// 回调契约与 filepath.WalkDir 一致：
//   - fs.SkipDir  → 跳过该条目子树（目录不展开；文件无意义，等同于跳过）
//   - fs.SkipAll  → 中止整个遍历（所有 worker 立即退出）
//   - 其他 error  → 记录为首错，继续遍历后返回（与 WalkDir「首错即停」略有差异——
//     并行遍历中停止意味着丢弃已排队目录，继续更合理；scanner 回调实际只返回
//     nil / SkipDir / SkipAll，此差异不可达）
//   - ReadDir 失败 → 再次回调该目录（带 err），回调返回 nil/SkipDir 则跳过子树继续
//
// 条目序：并行遍历产出非确定顺序，调用方须自行排序（ScanEntriesWithHitCtx 已补）。
package scanner

import (
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
)

// queueItem 携带路径与父级 ReadDir 产出的 DirEntry——ReadDir 失败时需再次回调
// 该目录（WalkDir 口径：fn(name, d, err)），此时 DirEntry 须保留而非传 nil，
// 否则回调内 d.IsDir() / d.Info() 会 panic。
type queueItem struct {
	path  string
	entry fs.DirEntry
}

// walkDirParallel 并行遍历目录树，回调契约与 filepath.WalkDir 一致。
//
// 结构：目录工作队列 + N 个 worker + outstanding 原子计数。
// outstanding = 已入队但尚未处理完的目录数。worker 读完一个目录后先入队子目录
// （outstanding += k），再对自身递减（outstanding -= 1）；因此 outstanding 只在
// 「最后一个无子目录的目录」被处理完时才落到 0，此时可安全 close(q)。
// 这个入队先于递减的顺序是关键——反序会让最后一个 worker 观察到瞬时 0 而提前关闭队列。
//
// 2026-10 拆解（gocyclo 25→≤20，ADR-324 并行遍历收口）：根目录阶段抽 startParallelWalk、
// 单目录项处理抽 handleDirItem、worker 主循环抽 workerLoop——行为不变量由
// walk_parallel_test.go 的 WalkDir 等价 + SkipDir/SkipAll/首错/竞态用例锁死。
func walkDirParallel(root string, fn fs.WalkDirFunc) error {
	// --- 根目录：Lstat + 首次回调（与 WalkDir 一致：根先于子目录）---
	rootDirEntry, err := startParallelWalk(root, fn)
	if err != nil {
		return err
	}
	if rootDirEntry == nil || !rootDirEntry.IsDir() {
		return nil // 根子树被跳（SkipDir）或根是文件：WalkDir 到此结束
	}

	// --- 并行阶段 ---
	abortCh := make(chan struct{})
	var aborted atomic.Bool
	abort := func() {
		if aborted.CompareAndSwap(false, true) {
			close(abortCh)
		}
	}

	var (
		errMu    sync.Mutex
		firstErr error
	)
	setErr := func(e error) {
		if e == nil {
			return
		}
		errMu.Lock()
		if firstErr == nil {
			firstErr = e
		}
		errMu.Unlock()
	}

	q := make(chan queueItem, 8192)
	var outstanding int32 = 1
	var qOnce sync.Once

	var wg sync.WaitGroup
	for i := 0; i < runtime.NumCPU(); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			workerLoop(q, abortCh, fn, &outstanding, &qOnce, setErr, abort)
		}()
	}
	q <- queueItem{path: root, entry: rootDirEntry}
	wg.Wait()

	// SkipAll 优先于首错返回（与 WalkDir 一致：SkipAll 是终止信号）
	if aborted.Load() {
		return fs.SkipAll
	}
	errMu.Lock()
	defer errMu.Unlock()
	return firstErr
}

// startParallelWalk 处理根目录（Lstat + 首次回调，与 WalkDir 同语义）。
// 返回 (rootDirEntry, err)：err 非 nil 即遍历终止（SkipAll/首错，调用方原样返回）；
// err 为 nil 且 rootDirEntry 为 nil = 根子树被 SkipDir 跳过（调用方返回 nil）。
func startParallelWalk(root string, fn fs.WalkDirFunc) (fs.DirEntry, error) {
	rootEntry, lerr := os.Lstat(root)
	if lerr != nil {
		// 根不存在/无权限：WalkDir 仅回调一次 err 后返回，不调用子目录遍历
		return nil, fn(root, nil, lerr)
	}
	rootDirEntry := fs.FileInfoToDirEntry(rootEntry)
	if ferr := fn(root, rootDirEntry, nil); ferr != nil {
		if ferr == fs.SkipDir {
			return nil, nil // SkipDir：跳过根的子树，WalkDir 返回 nil
		}
		return nil, ferr // SkipAll 或其他错误：WalkDir 原样返回
	}
	return rootDirEntry, nil
}

// handleDirItem 处理一个目录项：ReadDir 成功则逐子项回调并入队子目录，
// 失败则按 WalkDir 口径再次回调该目录（带 err）。返回 true = 触发 SkipAll，
// 调用方（worker）应立即退出。入队先于 worker 侧递减的顺序契约见 walkDirParallel 头注。
func handleDirItem(
	it queueItem,
	fn fs.WalkDirFunc,
	q chan queueItem,
	abortCh <-chan struct{},
	outstanding *int32,
	setErr func(error),
	abort func(),
) bool {
	names, err := os.ReadDir(it.path)
	if err != nil {
		// ReadDir 失败：WalkDir 口径——再次回调该目录（带 err）
		ferr := fn(it.path, it.entry, err)
		if ferr == fs.SkipAll {
			abort()
		} else if ferr != nil && ferr != fs.SkipDir {
			setErr(ferr)
		}
		return false
	}
	for _, en := range names {
		select {
		case <-abortCh:
			return true
		default:
		}
		p := filepath.Join(it.path, en.Name())
		ferr := fn(p, en, nil)
		switch {
		case ferr == fs.SkipAll:
			abort()
			return true
		case ferr != nil:
			if ferr != fs.SkipDir {
				setErr(ferr)
			}
			continue // SkipDir 或首错：不展开该条目
		case en.IsDir():
			atomic.AddInt32(outstanding, 1)
			q <- queueItem{path: p, entry: en}
		}
	}
	return false
}

// workerLoop 单个 worker 的主循环：取队列 → 处理目录项 → 对自身 outstanding 递减；
// 队列关闭（所有目录处理完）或 SkipAll/中止时退出。最后一个 outstanding 归零者
// 经 qOnce 安全 close(q)。
func workerLoop(
	q chan queueItem,
	abortCh <-chan struct{},
	fn fs.WalkDirFunc,
	outstanding *int32,
	qOnce *sync.Once,
	setErr func(error),
	abort func(),
) {
	for {
		select {
		case <-abortCh:
			return
		case it, ok := <-q:
			if !ok {
				return
			}
			if handleDirItem(it, fn, q, abortCh, outstanding, setErr, abort) {
				return // SkipAll：abort 已触发，立即退出
			}
			if atomic.AddInt32(outstanding, -1) == 0 {
				qOnce.Do(func() { close(q) })
			}
		}
	}
}
