package logs

import (
	"sync"
	"time"

	"ysm-model-manager/go/types"
)

// RuntimeBuffer 运行时日志环形缓冲：捕获标准库 log 输出（watcher/sync 等），供诊断页展示。
// 实现 io.Writer，配合 log.SetOutput 使用；容量超限时丢弃最旧条目。
type RuntimeBuffer struct {
	mu   sync.Mutex
	logs []types.RuntimeLog
	cap  int
}

// NewRuntimeBuffer 创建环形缓冲
func NewRuntimeBuffer(capacity int) *RuntimeBuffer {
	if capacity <= 0 {
		capacity = 200
	}
	return &RuntimeBuffer{logs: []types.RuntimeLog{}, cap: capacity}
}

// Write 实现 io.Writer：每次调用记录一条运行时日志（标准库 log 一行即一次 Write）
func (b *RuntimeBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.logs = append(b.logs, types.RuntimeLog{
		Message:   string(p),
		Timestamp: time.Now().UnixMilli(),
	})
	if len(b.logs) > b.cap {
		b.logs = b.logs[len(b.logs)-b.cap:]
	}
	return len(p), nil
}

// GetAll 返回全部日志的副本
func (b *RuntimeBuffer) GetAll() []types.RuntimeLog {
	b.mu.Lock()
	defer b.mu.Unlock()
	cp := make([]types.RuntimeLog, len(b.logs))
	copy(cp, b.logs)
	return cp
}

// Clear 清空缓冲
func (b *RuntimeBuffer) Clear() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.logs = []types.RuntimeLog{}
}
