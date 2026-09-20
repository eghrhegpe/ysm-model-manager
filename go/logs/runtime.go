package logs

import (
	"regexp"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/types"
)

// DefaultRuntimeCap 环形缓冲默认容量（调用方未传参时使用；internal/app 显式引用）
const DefaultRuntimeCap = 200

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
		capacity = DefaultRuntimeCap
	}
	return &RuntimeBuffer{logs: []types.RuntimeLog{}, cap: capacity}
}

// Write 实现 io.Writer：每次调用记录一条运行时日志（标准库 log 一行即一次 Write）
//
// ADR-289：捕获层顺带提取 `[tag]` 前缀并推断级别——标准库 log 无级别也无结构，
// 但 212/250+ 个调用点已自发写 `[watcher]`/`[sync]` 这类前缀与「失败/警告」等词。
// 在此读出来（每条只解析一次），前端便能分级筛选与按 tag 检索，
// 而**无需改动任何一个调用点**。Message 一字不改，前端仍展示原文。
func (b *RuntimeBuffer) Write(p []byte) (int, error) {
	msg := string(p)
	b.mu.Lock()
	defer b.mu.Unlock()
	b.logs = append(b.logs, types.RuntimeLog{
		Message:   msg,
		Timestamp: time.Now().UnixMilli(),
		Level:     inferRuntimeLevel(msg),
		Tag:       extractRuntimeTag(msg),
	})
	if len(b.logs) > b.cap {
		b.logs = b.logs[len(b.logs)-b.cap:]
		// 底层数组远大于容量时重分配，释放突发峰值占用
		if cap(b.logs) > b.cap*4 {
			nb := make([]types.RuntimeLog, len(b.logs))
			copy(nb, b.logs)
			b.logs = nb
		}
	}
	return len(p), nil
}

// runtimeTagRe 提取行首 `[tag]`：tag 由字母/数字/下划线/连字符组成。
// ⚠️ 必须锚定行首（`^`）：`[latent]` 这类出现在消息中段的方括号不是分类前缀。
// 允许 tag 后无空格（如 `[queue]emit`），但空方括号 `[]` 不算。
var runtimeTagRe = regexp.MustCompile(`^\[([a-zA-Z0-9_-]+)\]`)

// extractRuntimeTag 取行首 `[tag]` 前缀，无则返回空串（不报错、不丢弃消息）
func extractRuntimeTag(msg string) string {
	if m := runtimeTagRe.FindStringSubmatch(msg); m != nil {
		return m[1]
	}
	return ""
}

// 级别推断词表（ADR-289 D2）：保守优先——宁可漏判为 info，也不错标为 error。
// 判定按 fatal → error → warn 递降取首个命中，**一组内不分先后**。
// ⚠️ 顺序即优先级：「警告: 同步失败」同时命中 warn 与 error，应取更严重的 error。
var (
	fatalMarkers = []string{"panic", "fatal", "致命"}
	errorMarkers = []string{"失败", "错误", "error", "拒绝", "无法"}
	warnMarkers  = []string{"警告", "⚠️", "[warn]", "超限", "跳过", "截断", "不可用", "未命中"}
)

// inferRuntimeLevel 按内容推断级别（无把握时 info）。
// 这是**启发式**，不是真实级别——标准库 log 不携带级别是硬前提（ADR-289 已记录该代价）。
func inferRuntimeLevel(msg string) types.LogLevel {
	lower := strings.ToLower(msg)
	for _, m := range fatalMarkers {
		if strings.Contains(lower, m) {
			return types.LevelFatal
		}
	}
	for _, m := range errorMarkers {
		if strings.Contains(lower, m) {
			return types.LevelError
		}
	}
	for _, m := range warnMarkers {
		if strings.Contains(lower, m) {
			return types.LevelWarn
		}
	}
	return types.LevelInfo
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
