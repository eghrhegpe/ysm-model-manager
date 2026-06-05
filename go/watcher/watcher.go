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

// Watcher 监听仓库目录的 .ban 操作，自动同步到所有整合包
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
			return nil
		}
		if d.IsDir() {
			// 跳过 .recycle 目录
			if strings.EqualFold(d.Name(), ".recycle") {
				return filepath.SkipDir
			}
			fw.Add(path)
		}
		return nil
	})

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
		case event, ok := <-w.w.Events:
			if !ok {
				return
			}
			// 只关注 Rename 和 Create（Windows 上重命名会产生 Rename+Create）
			if event.Op&fsnotify.Rename == 0 && event.Op&fsnotify.Create == 0 {
				continue
			}
			// 检查是否与 .ban 相关
			name := strings.ToLower(event.Name)
			if !strings.HasSuffix(name, ".ban") && event.Op&fsnotify.Create != 0 {
				// Create 事件且不是 .ban → 可能是从 .ban 改回来的
				// 检查原路径（去掉新后缀看看是否是 .ban 改名回来的）
				ext := filepath.Ext(name)
				if ext != ".ysm" && ext != ".zip" && ext != ".7z" {
					continue
				}
			}
			if event.Op&fsnotify.Rename != 0 && !strings.HasSuffix(name, ".ban") {
				// Rename 非 .ban 文件 → 可能是从 .ban 改回原名
				ext := filepath.Ext(name)
				if ext != ".ysm" && ext != ".zip" && ext != ".7z" {
					continue
				}
			}
			// 文件名本身含 .ban 后缀 → 直接触发同步
			if !strings.Contains(name, ".ban") {
				continue
			}

			// 去抖：500ms 内批量事件只触发一次
			w.mu.Lock()
			if w.debounce != nil {
				w.debounce.Stop()
			}
			w.debounce = time.AfterFunc(800*time.Millisecond, w.syncAll)
			w.mu.Unlock()

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
