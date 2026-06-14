package watcher

import (
	"log"
	"os"
	"path/filepath"
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
	w       *fsnotify.Watcher
	repoRoot string
	mcRoot   string
	scanFn   ScanFunc
	mu       sync.Mutex
	debounce *time.Timer
	done     chan struct{}
	running  bool
}

// New 创建文件监听器
func New(repoRoot, mcRoot string, scanFn ScanFunc) *Watcher {
	return &Watcher{
		repoRoot: repoRoot,
		mcRoot:   mcRoot,
		scanFn:   scanFn,
		done:     make(chan struct{}),
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
	defer w.mu.Unlock()
	if !w.running {
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
	log.Println("[watcher] 已停止")
}

// IsRunning 返回是否正在运行
func (w *Watcher) IsRunning() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.running
}

func (w *Watcher) loop() {
	for {
		select {
		case _, ok := <-w.w.Events:
			if !ok {
				return
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
func (w *Watcher) syncAll() {
	instances := mdsync.ListVersions(w.mcRoot)
	if len(instances) == 0 {
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
