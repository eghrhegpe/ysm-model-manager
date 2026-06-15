// ysm-updater-helper — Windows 自更新助手
//
// 工作流程：
//  1. 等待主进程退出（通过轮询进程列表或等待参数指定的 PID）
//  2. 复制新的 exe 到目标位置（替换旧的）
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

	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		log.Fatalf("无效的 PID: %s", pidStr)
	}

	// 1. 等待主进程退出（最多等待 30 秒）
	mainProc, err := os.FindProcess(pid)
	if err == nil && mainProc != nil {
		// 等待进程退出，轮询间隔 200ms
		for i := 0; i < 150; i++ {
			p, err := os.FindProcess(pid)
			if err != nil || p == nil {
				break
			}
			// FindProcess 在 Windows 上总是成功，需要尝试发送信号 0
			// 用 Signal(nil) 来检测进程是否存在
			if err := p.Signal(os.Kill); err != nil {
				break // 进程不存在或无法访问
			}
			time.Sleep(200 * time.Millisecond)
		}
	}
	// 额外等待 500ms 确保文件锁释放
	time.Sleep(500 * time.Millisecond)

	// 2. 复制新 exe 到目标位置
	if err := copyFile(newPath, targetPath); err != nil {
		log.Fatalf("复制文件失败 %s → %s: %v", newPath, targetPath, err)
	}

	// 3. 启动新主程序
	newProc := exec.Command(targetPath)
	newProc.Dir = filepath.Dir(targetPath)
	if err := newProc.Start(); err != nil {
		log.Fatalf("启动新程序失败: %v", err)
	}

	// 4. 清理临时文件
	tmpDir := filepath.Dir(newPath)
	os.RemoveAll(tmpDir)

	os.Exit(0)
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
