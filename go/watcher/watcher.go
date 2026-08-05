package watcher

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	mdsync "ysm-model-manager/go/sync"

	"github.com/fsnotify/fsnotify"
)

// ScanFunc matches mdsync.ScanFunc
type ScanFunc = mdsync.ScanFunc

// debounceDelay 防抖延迟 — 仓库文件变更后等待多久再触发同步（合并批量操作）
const debounceDelay = 800 * time.Millisecond

// Watcher 监听仓库目录的文件变更，自动同步 .ban 状态到所有整合包
type Watcher struct {
	w            *fsnotify.Watcher
	repoRoot     string
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
}

// New 创建文件监听器
func New(repoRoot, mcRoot string, scanFn ScanFunc, clearCacheFn ...func()) *Watcher {
	var ccf func()
	if len(clearCacheFn) > 0 {
		ccf = clearCacheFn[0]
	}
	return &Watcher{
		repoRoot:     repoRoot,
		mcRoot:       mcRoot,
		scanFn:       scanFn,
		clearCacheFn: ccf,
		done:         make(chan struct{}),
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
	// 每次 Start 重建 done：支持 Stop 后再 Start（已关闭的 channel 不可复用）
	w.done = make(chan struct{})
	w.running = true

	// 递归添加子目录
	filepath.WalkDir(w.repoRoot, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			log.Printf("[watcher] WalkDir 跳过 %s: %v", path, err)
			return nil
		}
		if d.IsDir() {
			// 跳过 .recycle 目录
			if d.Name() == ".recycle" {
				return filepath.SkipDir
			}
			if err := fw.Add(path); err != nil {
				log.Printf("[watcher] 添加监听失败 %s: %v", path, err)
			}
		}
		return nil
	})

	// 提示：Linux 下 inotify 默认限制 8192 个监听文件。
	// 若仓库目录结构过深导致 fw.Add 失败，可考虑实现定期全量扫描作为回退。

	go w.loop()
	log.Printf("[watcher] 已启动: %s", w.repoRoot)
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
	}
	w.mu.Unlock()
	// 等待正在执行的同步完成，避免退出后仍有后台写盘
	w.wg.Wait()
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
			w.mu.Unlock()
		}
	}()
	for {
		select {
		case ev, ok := <-w.w.Events:
			if !ok {
				return
			}
			// 过滤噪声事件（临时/锁/下载中文件），不触发同步
			if isNoiseEvent(ev.Name) {
				continue
			}
			// 任何文件系统变化（Create/Rename/Remove/Write）都触发防抖同步
			// 这同时覆盖了：禁用（创建 .ban）、启用（删除/重命名 .ban）、新增模型等所有场景
			// 不需要复杂的事件类型/文件名校验，syncAll 内部会扫描实际状态差异
			w.debounceSync()

		case err, ok := <-w.w.Errors:
			if !ok {
				return
			}
			log.Printf("[watcher] 错误: %v", err)

		case <-w.done:
			return
		}
	}
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
		pending := w.syncPending
		w.syncPending = false
		restart := w.running
		w.mu.Unlock()
		// 执行期间积累的新事件：串行续跑一轮（Stop 后不再续跑）
		if pending && restart {
			w.syncAll()
		}
	}()

	// 文件变更后先清扫描缓存，确保下次读取最新数据
	if w.clearCacheFn != nil {
		w.clearCacheFn()
	}
	instances := mdsync.ListVersions(w.mcRoot)
	if len(instances) == 0 {
		return
	}
	// 空仓库短路：仓库无模型文件时无需同步状态，避免每个实例重复空扫
	if len(w.scanFn(w.repoRoot)) == 0 {
		return
	}
	totalDisable := 0
	totalEnable := 0
	for _, ins := range instances {
		if !ins.Exists {
			continue
		}
		d, e, err := mdsync.SyncToggleStatus(ins.CustomDir, w.repoRoot, w.scanFn)
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
