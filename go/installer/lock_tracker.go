package installer

import (
	"runtime"
	"sync"
	"sync/atomic"
)

// LockTracker 是带 goroutine owner 追踪的互斥锁。
//
// 与 sync.Mutex 的差异：
//   - HasLock() 精确返回「本 goroutine 是否持有」——不依赖 TryLock 的
//     「锁是否空闲」探测（他人 goroutine 持锁时 TryLock 会误判）。
//   - 兼容 sync.Locker 接口（Lock/Unlock），现有 InstallLocker 消费点零改动。
//
// 设计取舍（ADR-056 运行时断言升级）：
//   - owner 字段用 atomic.Uint64 存储——HasLock() 可在未持锁状态下
//     安全读取（避免 self-deadlock），无数据竞争。
//   - goroutine 身份通过 runtime.Stack 前缀 "goroutine N [state]" 提取 N，
//     同一 goroutine 跨调用点恒定，在 goroutine 存活期内唯一。
//     降级路径（runtime.Stack 异常时）以栈帧 PC 为 key + 全局单调计数器分配 token，
//     保证「不同 goroutine 不同 token」的语义。
//     LockTracker 的生命周期短（持锁段毫秒级），ID 复用风险可忽略。
type LockTracker struct {
	mu    sync.Mutex
	owner atomic.Uint64 // 持有者 goroutine ID（0 = 未持有）
}

// 降级路径状态：goroutine 身份缓存（以栈帧 PC 为 key，分配单调 token）
var (
	gidMu      sync.Mutex
	gidCounter uint64
	gidTable   = make(map[uintptr]uint64)
)

// goroutineIdentity 返回当前 goroutine 的稳定身份 key（降级路径用）。
// 取调用方（currentGoroutineID）所在帧的返回 PC——同一 goroutine 无论从 Lock() 还是
// HasLock() 调用，其"从测试函数调用 currentGoroutineID"的调用帧 PC 是固定的，
// 而 Lock()/HasLock() 的 PC 因调用点不同而变化。
// 用 skip=4 跳过 runtime.Callers→goroutineIdentity→currentGoroutineID→调用方，
// 取到"调用 currentGoroutineID 的帧"的 PC。
func goroutineIdentity() uintptr {
	var pc [2]uintptr
	// skip=4: [0]=goroutineIdentity 自身, [1]=currentGoroutineID, [2]=调用方帧, [3]=调用方的调用方
	nf := runtime.Callers(4, pc[:])
	if nf < 2 {
		// 栈太浅，退化为直接用当前帧
		nf = runtime.Callers(1, pc[:])
		if nf == 0 {
			return 0
		}
	}
	return pc[nf-2] // 取"调用 currentGoroutineID 的帧"的 PC
}

// currentGoroutineID 返回当前 goroutine 的稳定 token。
// 主路径：runtime.Stack 前缀 "goroutine N [state]" 提取 N（同一 goroutine 跨调用点恒定）。
// 降级路径（runtime.Stack 异常时）：以 goroutine 身份 PC 为 key + 全局单调计数器分配 token。
func currentGoroutineID() uint64 {
	// 主路径：从 runtime.Stack 提取 goroutine N
	// runtime.Stack 输出格式: "goroutine N [state]:\n..."
	// 前 9 字节固定为 "goroutine"，第 10 字节是空格，之后是十进制数字
	var buf [64]byte
	n := runtime.Stack(buf[:], false)
	if n > 10 && string(buf[:9]) == "goroutine" && buf[9] == ' ' {
		var id uint64
		for i := 10; i < n; i++ {
			if buf[i] < '0' || buf[i] > '9' {
				break
			}
			id = id*10 + uint64(buf[i]-'0')
		}
		if id > 0 {
			return id
		}
	}
	// 降级路径：以 goroutine 身份 PC 为 key，分配单调唯一 token
	ident := goroutineIdentity()
	if ident == 0 {
		return atomic.AddUint64(&gidCounter, 1)
	}
	gidMu.Lock()
	if tok, ok := gidTable[ident]; ok {
		gidMu.Unlock()
		return tok
	}
	tok := atomic.AddUint64(&gidCounter, 1)
	gidTable[ident] = tok
	gidMu.Unlock()
	return tok
}

// Lock 获取锁并记录 owner（实现 sync.Locker）。
func (l *LockTracker) Lock() {
	l.mu.Lock()
	l.owner.Store(currentGoroutineID())
}

// Unlock 释放锁并清除 owner（实现 sync.Locker）。
// 顺序：先清 owner 再释放 mu——保证 IsLocked() 语义严格一致：
//   - Lock 后：owner 已写入，IsLocked = true（锁被持有）
//   - Unlock 后：owner 已清零，IsLocked = false（锁已释放）
//
// 中间窗口（mu 仍锁定但 owner = 0）仅存在于同 goroutine 的 Unlock 调用栈内，
// 其他 goroutine 在此窗口内 IsLocked = false（正确：从外部视角锁即将释放）。
func (l *LockTracker) Unlock() {
	l.owner.Store(0)
	l.mu.Unlock()
}

// TryLock 非阻塞尝试获取锁。成功返回 true，锁被他人持有返回 false。
// 与 sync.Mutex.TryLock 语义一致。
func (l *LockTracker) TryLock() bool {
	if !l.mu.TryLock() {
		return false
	}
	l.owner.Store(currentGoroutineID())
	return true
}

// HasLock 返回「本 goroutine 是否持有此锁」。
// 用于 *Locked 入口的运行时断言：调用方已持锁 → true → 放行；
// 调用方未持锁 → false → panic。
//
// 与 TryLock 的本质区别：
//   - TryLock 探测「锁是否空闲」——他人 goroutine 持锁时 TryLock 失败（误判为已持锁）
//   - HasLock 精确区分 owner——消除误判窗口
//
// 实现说明：owner 是 atomic.Uint64，HasLock 在未持锁状态下安全读取，
// 不会 self-deadlock（不访问内部 mu）。
func (l *LockTracker) HasLock() bool {
	oid := currentGoroutineID()
	return oid != 0 && l.owner.Load() == oid
}

// IsLocked 返回「锁是否被任何 goroutine 持有」（不区分 owner）。
// 用于测试场景：判断锁段是否在临界区内。
func (l *LockTracker) IsLocked() bool {
	return l.owner.Load() != 0
}
