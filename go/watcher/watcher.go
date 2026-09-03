package watcher

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/fsutil"
	mdsync "ysm-model-manager/go/sync"

	"github.com/fsnotify/fsnotify"
)

// ScanFunc matches mdsync.ScanFunc
type ScanFunc = mdsync.ScanFunc

// debounceDelay 防抖延迟 — 仓库文件变更后等待多久再触发同步（合并批量操作）
// 测试可覆盖为更小值以加速
var debounceDelay = 800 * time.Millisecond

// stopWaitTimeout Stop 等待 loop/同步退出的上限（防挂起）
const stopWaitTimeout = 5 * time.Second

// Watcher 监听仓库目录的文件变更，自动同步 .ban 状态到所有整合包
type Watcher struct {
	w            *fsnotify.Watcher
	filesRoot    string
	mcRoot       string
	scanFn       ScanFunc
	clearCacheFn func() // 扫描缓存失效回调（可选）
	mu           sync.Mutex
	debounce     *time.Timer
	done         chan struct{}
	running      bool
	syncRunning  bool           // 同步执行中标志（防并发重入）
	syncPending  bool           // 执行期间积累的新事件，完成后需再跑一轮
	wg           sync.WaitGroup // 等待 in-flight 同步完成（Stop 阻塞）
	loopDone     chan struct{}  // loop 退出信号（Stop 等待后再返回，保证重启无竞态）
}

// New 创建文件监听器
func New(filesRoot, mcRoot string, scanFn ScanFunc, clearCacheFn ...func()) *Watcher {
	var ccf func()
	if len(clearCacheFn) > 0 {
		ccf = clearCacheFn[0]
	}
	return &Watcher{
		filesRoot:    filesRoot,
		mcRoot:       mcRoot,
		scanFn:       scanFn,
		clearCacheFn: ccf,
		done:         make(chan struct{}),
		loopDone:     make(chan struct{}),
	}
}

// Start 开始监听
func (w *Watcher) Start() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.running {
		return nil
	}

	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	w.w = fw
	// 每次 Start 重建 done 与 loopDone：支持 Stop 后再 Start（已关闭的 channel 不可复用）
	w.done = make(chan struct{})
	w.loopDone = make(chan struct{})
	w.running = true

	// 递归添加子目录
	filepath.WalkDir(w.filesRoot, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			log.Printf("[watcher] WalkDir 跳过 %s: %v", path, err)
			return nil
		}
		if d.IsDir() {
			// 跳过 .recycle 目录
			if fsutil.IsRecycleDir(d.Name()) {
				return filepath.SkipDir
			}
			if err := fw.Add(path); err != nil {
				log.Printf("[watcher] 添加监听失败 %s: %v", path, err)
			}
		}
		return nil
	})

	// 提示：Linux 下 inotify 默认限制 8192 个监听文件。
	// 项目默认 Windows 部署（ReadDirectoryChangesW 无此限制），故暂不实现定期全量扫描回退；
	// 若未来支持 Linux 且仓库过深导致 fw.Add 失败，再考虑全量扫描兜底。
	// 失败已 log.Printf 记录，便于诊断。
	// ADR-047 明示：Android 依赖 fsnotify 对 FUSE/外置存储的兼容性（inotify 经 sdcardfs
	// 事件可能不完整），仓库根变更可能漏报；Android 上以手动刷新/重扫为准，不做轮询兜底。

	go w.loop()
	log.Printf("[watcher] 已启动: %s", w.filesRoot)
	return nil
}

// Stop 停止监听
func (w *Watcher) Stop() {
	w.mu.Lock()
	if !w.running {
		w.mu.Unlock()
		return
	}
	w.running = false
	if w.debounce != nil {
		w.debounce.Stop()
	}
	close(w.done)
	if w.w != nil {
		w.w.Close()
		// 关闭即置 nil：与 loop panic 恢复路径（同样 Close+nil）保持同一不变量——
		// 谁关闭谁置空，杜绝「已 Close 的 watcher 再被 recover 分支二次 Close」；
		// Start 每次 NewWatcher 重建，置 nil 不影响 Stop→Start 重启。
		w.w = nil
	}
	w.mu.Unlock()
	// 等待 loop 退出（上限防挂起）——close(done) 后 loop 退出是异步的，
	// 不等待就返回会让「Stop→立即 Start」重启时旧 loop 与新 Start 的字段写读竞争
	// （go test -race 检出 TestStartStopRestart），旧 loop 的 recover 还可能误关新 watcher
	waitLoop := time.NewTimer(stopWaitTimeout)
	select {
	case <-w.loopDone:
		waitLoop.Stop()
	case <-waitLoop.C:
		log.Printf("[watcher] 等待 loop 退出超时，强制停止")
	}
	// loop 退出后不可能再武装计时器（debounceSync 带 running 守卫），清掉已停止的
	// 计时器引用：防「Stop→立即 Start」后旧代计时器 firing 产生一次多余同步
	// （syncAll 读到新 running=true 会误触发），同时让重启后的 w.debounce 状态干净
	w.mu.Lock()
	if w.debounce != nil {
		w.debounce.Stop()
		w.debounce = nil
	}
	w.mu.Unlock()
	// 等待正在执行的同步完成（上限，避免网络盘挂起阻塞退出/重启）
	done := make(chan struct{})
	go func() { w.wg.Wait(); close(done) }()
	waitSync := time.NewTimer(stopWaitTimeout)
	select {
	case <-done:
		waitSync.Stop()
	case <-waitSync.C:
		log.Printf("[watcher] 等待同步超时，强制停止")
	}
	log.Println("[watcher] 已停止")
}

// IsRunning 返回是否正在运行
func (w *Watcher) IsRunning() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.running
}

func (w *Watcher) loop() {
	// panic 兜底：fsnotify 内部异常不能留下"running=true 但监听已死"的假活状态
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[watcher] loop panic: %v", r)
			w.mu.Lock()
			w.running = false
			// panic 后必须关闭 fsnotify watcher，否则其 inotify/句柄永久泄漏——
			// Stop 因 !running 早退不会清理（原实现），再次 Start 又新建一个 → 泄漏累积
			if w.w != nil {
				w.w.Close()
				w.w = nil
			}
			w.mu.Unlock()
		}
		close(w.loopDone) // 通知 Stop：本 loop 已完全退出（panic 恢复路径同样需要）
	}()
	// loop 入口一次性捕获本地 channel 引用——原 select 每轮读共享字段
	// w.w.Events/w.w.Errors/w.done，Stop→立即 Start（restartWatcher 正是此序列）后
	// 旧 loop 回到 select 会读到新 watcher → 双 loop 双倍触发防抖 + -race 数据竞争，
	// 且旧 loop 的 recover 可能误关新 watcher
	w.mu.Lock()
	if w.w == nil {
		// Stop 已先行（Close + 置 nil，见 Stop 内不变量注释）：本代 loop 无 watcher
		// 可监听，直接退出（defer 仍会 close(loopDone)，Stop 的等待正常解除）
		w.mu.Unlock()
		return
	}
	evs, errs, done, fw := w.w.Events, w.w.Errors, w.done, w.w
	w.mu.Unlock()
	for {
		select {
		case ev, ok := <-evs:
			if !ok {
				return
			}
			// 过滤噪声事件（临时/锁/下载中文件），不触发同步
			if isNoiseEvent(ev.Name) {
				continue
			}
			// 新建目录不自动继承监听（fsnotify 非递归）：收到 Create 目录事件后补
			// 监听新目录树（锐评 #5），否则新建子目录内部变更全部漏报——Windows 的
			// ReadDirectoryChangesW 同样只报父目录内容变化、不给子目录句柄，同需补 Add。
			if ev.Op&fsnotify.Create != 0 {
				watchNewDir(fw, ev.Name)
			}
			// 任何文件系统变化（Create/Rename/Remove/Write）都触发防抖同步
			// 这同时覆盖了：禁用（创建 .ban）、启用（删除/重命名 .ban）、新增模型等所有场景
			// 不需要复杂的事件类型/文件名校验，syncAll 内部会扫描实际状态差异
			w.debounceSync()

		case err, ok := <-errs:
			if !ok {
				return
			}
			log.Printf("[watcher] 错误: %v", err)

		case <-done:
			return
		}
	}
}

// watchNewDir 为新建目录补监听（fsnotify 非递归，新目录须显式 Add 才能收到内部变更）。
// 递归 WalkDir 覆盖 mkdir -p 级联场景：Create 事件到达时目录树可能已就位（批量解压），
// 只 Add 事件路径会漏掉其中已存在的子目录；.recycle 段跳过与 Start 的初始注册口径一致。
// 失败一律容忍（目录瞬移/已监听/Stop 竞态关闭均 log 后继续）：同步语义不依赖单次事件
// 完备——后续其它事件触发 syncAll 时会扫描实际状态差异兜底。
func watchNewDir(fw *fsnotify.Watcher, root string) {
	if fi, err := os.Stat(root); err != nil || !fi.IsDir() {
		return
	}
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			log.Printf("[watcher] 新目录遍历失败 %s: %v", p, err)
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		if fsutil.IsRecycleDir(d.Name()) {
			return filepath.SkipDir
		}
		if err := fw.Add(p); err != nil {
			log.Printf("[watcher] 添加新目录监听失败 %s: %v", p, err)
		}
		return nil
	})
}

// isNoiseEvent 判断是否为噪声事件（临时/锁/下载中文件），不触发同步
func isNoiseEvent(name string) bool {
	base := strings.ToLower(filepath.Base(name))
	if strings.HasPrefix(base, "~$") {
		return true
	}
	for _, suffix := range []string{".tmp", ".temp", ".swp", ".crdownload", ".part"} {
		if strings.HasSuffix(base, suffix) {
			return true
		}
	}
	return false
}

// debounceSync 防抖触发同步
func (w *Watcher) debounceSync() {
	w.mu.Lock()
	defer w.mu.Unlock()
	// running 守卫：Stop 已置 running=false 后（done 已关闭，loop 仍在消费队列里
	// 最后几个事件）不再武装计时器，否则「Stop→立即 Start」后旧代计时器 firing
	// 会读到新 running=true 而误触发一次多余同步（假活/跨代事件）
	if !w.running {
		return
	}
	if w.debounce != nil {
		w.debounce.Stop()
	}
	w.debounce = time.AfterFunc(debounceDelay, w.syncAll)
}

// syncAll 同步所有整合包的启用/禁用状态
// 执行串行化：防抖只合并"调度"，此处合并"执行"——已有同步在跑时仅标记待续跑，
// 当前轮结束后串行再跑一轮，避免多个 syncAll 并发操作同一批整合包目录
func (w *Watcher) syncAll() {
	w.mu.Lock()
	if !w.running {
		w.mu.Unlock()
		return
	}
	if w.syncRunning {
		w.syncPending = true
		w.mu.Unlock()
		return
	}
	w.syncRunning = true
	w.wg.Add(1) // 持锁 Add，保证先于 Stop 的 Wait，避免 WaitGroup 误用
	w.mu.Unlock()

	defer func() {
		w.wg.Done()
		w.mu.Lock()
		w.syncRunning = false
		restart := w.running
		// R34 P2-9：syncPending 续跑竞态修复。
		// 原实现 pending := w.syncPending 与 w.syncPending = false 在同一锁内，
		// 但 L259-262 的 syncPending=true 设置与 L271 syncRunning=false 复位
		// 之间存在窗口——若 in-flight 实例的 defer 已越过 pending 读取点，
		// 新设置的 pending 被静默丢弃。
		// 修复：在 syncRunning=false 复位之后、释放锁之前，重新检查 syncPending。
		// 此时任何在同步期间到达的事件要么已被 L259-262 标记为 pending，
		// 要么在 syncRunning 复位后看到 syncRunning==false 直接进入新一轮。
		pending := w.syncPending
		w.syncPending = false
		w.mu.Unlock()
		// 执行期间积累的新事件：串行续跑一轮（Stop 后不再续跑）
		if pending && restart {
			w.syncAll()
		}
	}()

	// syncAll 在 time.AfterFunc 的 goroutine 中执行，loop 的 recover 覆盖不到；
	// scanFn/ListVersions/SyncToggleStatus/clearCacheFn 任一 panic 会直接崩溃整个进程。
	// 兜底恢复并记录日志（wg.Done/syncRunning 复位仍由上方 defer 保证执行）。
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[watcher] syncAll panic: %v", r)
		}
	}()

	instances := mdsync.ListVersions(w.mcRoot)
	if len(instances) == 0 {
		return
	}
	// 文件变更后先清扫描缓存，确保下次读取最新数据
	// 移到 ListVersions/len==0 判断之后——无整合包时任何事件都清空缓存的问题
	if w.clearCacheFn != nil {
		w.clearCacheFn()
	}
	// 空仓库短路：仓库无模型文件时无需同步状态，避免每个实例重复空扫
	if len(w.scanFn(w.filesRoot)) == 0 {
		return
	}
	totalDisable := 0
	totalEnable := 0
	for _, ins := range instances {
		if !ins.Exists {
			continue
		}
		d, e, err := mdsync.SyncToggleStatus(ins.CustomDir, w.filesRoot, w.scanFn)
		if err != nil {
			log.Printf("[watcher] %s 同步失败: %v", ins.Name, err)
			continue
		}
		totalDisable += d
		totalEnable += e
	}
	if totalDisable > 0 || totalEnable > 0 {
		log.Printf("[watcher] 自动同步完成: 禁用 %d 启用 %d", totalDisable, totalEnable)
	}
}
