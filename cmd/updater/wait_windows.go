//go:build windows

package main

import (
	"errors"
	"fmt"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

// stillActive 对应 Windows SDK 的 STILL_ACTIVE(259)：GetExitCodeProcess 在进程
// 仍在运行时返回该值。x/sys/windows 与标准库 syscall 均未导出该常量（仅
// winbase.h 定义），故本地声明并注明来源。
const stillActive uint32 = 259

// isRetryableReplaceErr 判断 replaceExe 错误是否可重试：仅文件占用类瞬时错误
// （共享冲突 ERROR_SHARING_VIOLATION / 文件被另一进程使用）值得退避重试——
// 主进程刚退出时杀软/系统索引可能短暂持有 PE 文件句柄。目标不存在、权限不足
// 等永久错误立即返回。
func isRetryableReplaceErr(err error) bool {
	if err == nil {
		return false
	}
	// errors.As 用 syscall.Errno（os 包 os.Rename/os.Open/os.Create 包装的就是
	// syscall.Errno；windows.Errno 是同构的不同命名类型，As 永不匹配 → 重试死代码）；
	// 常量对照用 windows.ERROR_*（标准库 syscall 不导出，数值 32/33 两包一致）
	var errno syscall.Errno
	if errors.As(err, &errno) {
		switch uintptr(errno) {
		case uintptr(windows.ERROR_SHARING_VIOLATION), uintptr(windows.ERROR_LOCK_VIOLATION):
			return true
		}
	}
	return false
}

// waitMainExit 轮询等待主进程退出（最多 waitTimeout）。
//
// 历史教训（807c81a5）：旧实现用 p.Signal(os.Kill) 探测存活，Signal(os.Kill) 在
// Windows 上会真的终止目标进程——helper 误杀仍在运行的主进程，故删除改为固定
// sleep。此处改用 OpenProcess + GetExitCodeProcess 只查询不干预：
//   - OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION) 失败（进程不存在/权限不足）
//     视为已退出，结束等待；
//   - GetExitCodeProcess 返回 STILL_ACTIVE(259) 表示进程仍在运行，继续轮询。
//
// 主进程 os.Exit(0) 后系统回收 PE 文件锁仍需短暂时间，等待结束后由调用方在
// replaceExe 前补一个短 sleep（见 main.go），确保 rename 不被共享冲突拦截。
func waitMainExit(pid uint32, waitTimeout time.Duration) error {
	deadline := time.Now().Add(waitTimeout)
	for {
		handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
		if err != nil {
			// 进程不存在（ERROR_INVALID_PARAMETER）→ 已退出，结束等待。
			// 权限不足（ERROR_ACCESS_DENIED，罕见）不视为退出——继续轮询等
			// 到超时由调用方报错，避免误判提前替换仍在运行的主进程
			if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
				return nil
			}
			if time.Now().After(deadline) {
				return fmt.Errorf("等待主进程退出超时（%v），PID %d 状态未知: %w", waitTimeout, pid, err)
			}
			time.Sleep(200 * time.Millisecond)
			continue
		}
		var code uint32
		ecErr := windows.GetExitCodeProcess(handle, &code)
		windows.CloseHandle(handle)
		if ecErr == nil && code != stillActive {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("等待主进程退出超时（%v），PID %d 仍在运行", waitTimeout, pid)
		}
		time.Sleep(200 * time.Millisecond)
	}
}
