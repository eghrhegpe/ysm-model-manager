// ysm-updater-helper — Windows 自更新助手
//
// 工作流程：
//  1. 等待主进程退出（OpenProcess 轮询 PID，只查询不干预）
//  2. 复制新的 exe 到目标位置（替换旧的，失败带退避重试）
//  3. 启动新主程序
//  4. 自我清理（删除临时文件）
//
// 命令行参数：
//
//	ysm-updater-helper.exe <new-exe-path> <target-exe-path> <main-pid>
package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

func main() {
	if len(os.Args) < 4 {
		fmt.Fprintf(os.Stderr, "用法: %s <new-exe-path> <target-exe-path> <main-pid>\n", filepath.Base(os.Args[0]))
		os.Exit(1)
	}

	newPath := os.Args[1]
	targetPath := os.Args[2]
	pidStr := os.Args[3]

	// pid 用于等待主进程退出（见 waitMainExit：OpenProcess 只查询不干预）
	pid64, err := strconv.ParseUint(pidStr, 10, 32)
	if err != nil {
		log.Fatalf("无效的 PID: %s", pidStr)
	}

	// 1. 等待主进程退出（最多 30 秒，轮询间隔 200ms）
	// 历史：旧实现用 Signal(os.Kill) 探测存活会误杀主进程（807c81a5），
	// 改为固定 sleep 2s（对慢盘/杀软锁回收时间不保证足够，替换可能失败）。
	// 现改为 OpenProcess+GetExitCodeProcess 轮询（只查询不干预，见 wait_windows.go），
	// 主进程退出后再补短等待确保 PE 文件锁回收。
	if err := waitMainExit(uint32(pid64), 30*time.Second); err != nil {
		log.Fatalf("等待主进程退出失败: %v", err)
	}
	// 主进程退出后系统回收 PE 文件锁需短暂时间（~500ms 级），短等待避免
	// replaceExe 的 rename 被共享冲突拦截（慢盘/杀软场景由下方重试兜底）
	time.Sleep(500 * time.Millisecond)

	// 2. 复制新 exe 到目标位置（原子替换：同目录临时文件 + .old 备份 + 失败回滚）
	// 慢盘/杀软可能在主进程退出后仍短暂占用 PE 文件——rename 报共享冲突时
	// 200ms 退避重试，最多 10s（比固定 sleep 更稳：正常场景一次成功，异常场景
	// 等到锁真正释放而非拍脑袋 2s）
	if err := replaceExeWithRetry(newPath, targetPath, 10*time.Second); err != nil {
		log.Fatalf("替换文件失败 %s → %s: %v", newPath, targetPath, err)
	}

	// 3. 启动新主程序
	newProc := exec.Command(targetPath)
	newProc.Dir = filepath.Dir(targetPath)
	if err := newProc.Start(); err != nil {
		if rbErr := os.Rename(targetPath+".old", targetPath); rbErr != nil {
			log.Printf("[updater] 启动失败回滚 %s: %v", targetPath, rbErr)
		}
		log.Fatalf("启动新程序失败: %v", err)
	}

	// 4. 清理临时文件
	tmpDir := filepath.Dir(newPath)
	os.RemoveAll(tmpDir)

	os.Exit(0)
}

// replaceExeWithRetry 带退避重试的 replaceExe：目标文件被占用（共享冲突）
// 时重试，直到成功或超时。仅重试「文件占用」类瞬时错误——目标不存在/权限
// 等永久错误立即返回，不空耗退避窗口。错误归类见 isRetryableReplaceErr。
func replaceExeWithRetry(newPath, targetPath string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		err := replaceExe(newPath, targetPath)
		if err == nil {
			return nil
		}
		if !isRetryableReplaceErr(err) || time.Now().After(deadline) {
			return err
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// copyFile 复制文件（保留原始文件在出错时不变）
func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("打开源文件失败: %w", err)
	}
	defer srcFile.Close()

	dstFile, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("创建目标文件失败: %w", err)
	}
	defer dstFile.Close()

	if _, err := io.Copy(dstFile, srcFile); err != nil {
		os.Remove(dst) // 清理不完整的文件
		return fmt.Errorf("写入失败: %w", err)
	}

	return dstFile.Close()
}

// replaceExe 原子替换 exe：先写 .new（target 原位不动），再备份为 .old，最后 rename 到位；
// 拷贝全程 target 始终可用，缺失窗口仅收敛为两段 rename 间隙（微秒级），任一步失败可回滚
func replaceExe(newPath, targetPath string) error {
	backup := targetPath + ".old"
	tmp := targetPath + ".new"
	// 1) 先写 .new：target 仍在原位，拷贝失败/断电时应用目录始终有可用 exe
	if err := copyFile(newPath, tmp); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("复制失败: %w", err)
	}
	// 2) 备份旧 exe（Go os.Rename 在 Windows 为 MoveFileEx+REPLACE_EXISTING，残留 .old 会被覆盖）
	if err := os.Rename(targetPath, backup); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("备份目标失败: %w", err)
	}
	// 3) .new → target：与 2) 之间是唯一缺失窗口（微秒级）
	if err := os.Rename(tmp, targetPath); err != nil {
		// 回滚前先清理 .new 残留（子代理审核 P2：第 3 步失败时 tmp 可能仍在，
		// CleanupOldVersion 只清 .old 不清 .new，残留会成为应用目录垃圾）
		os.Remove(tmp)
		if rbErr := os.Rename(backup, targetPath); rbErr != nil {
			log.Printf("[updater] 回滚失败 %s→%s: %v", backup, targetPath, rbErr)
		}
		return fmt.Errorf("替换失败: %w", err)
	}
	return nil
}
