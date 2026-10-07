// updater_install.go：旧版本清理与新版本安装（原 updater.go 拆分，2026-10 文件行数治理）。
// CleanupOldVersion / InstallUpdate——更新包落盘后启动新版本，旧 .old 文件下次启动清理。
package updater

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"

	"ysm-model-manager/go/executil"
	"ysm-model-manager/go/fsutil"
)

func CleanupOldVersion() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	oldPath := exe + ".old"
	// 自愈：目标 exe 缺失但 .old 存在（上一次替换中途崩溃）→ 恢复
	if _, err := os.Stat(exe); os.IsNotExist(err) {
		if _, e2 := os.Stat(oldPath); e2 == nil {
			if err := os.Rename(oldPath, exe); err != nil {
				log.Printf("[updater] 恢复 exe 失败 %s: %v", exe, err)
			}
		}
	}
	if _, err := os.Stat(oldPath); err == nil {
		if err := os.Remove(oldPath); err != nil {
			log.Printf("[updater] 清理旧文件失败 %s: %v", oldPath, err)
		}
	}
}

// InstallUpdate 校验下载的更新 exe 并通过 helper 进程替换当前 exe。
// 流程：校验新 exe（PE 魔数）→ 复制到临时目录 → 释放 helper → 启动 helper → 主进程退出
// （v1.13.0 起纯 exe 发布：Windows Release 资产为裸 exe，不再有 zip 解压环节）
func InstallUpdate(exePath string) error {
	updateLock.Lock()
	defer updateLock.Unlock()

	// 平台守卫：非 Windows asset 为 .tar.gz，自动更新仅支持 Windows——
	// 明确拒绝而非静默下载后在装包时给误导性错误
	if runtime.GOOS != "windows" {
		return fmt.Errorf("%w，请手动下载更新", ErrNotWindows)
	}

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取程序路径失败: %w", err)
	}

	// 装盘前预检：校验 PE 魔数 + PE 签名，防损坏/篡改包替换运行中 exe
	// 旧实现仅校验 2 字节 "MZ"，攻击者可在合法 MZ 后附带任意 payload。
	// 增强：读取 PE header 偏移（MZ + 0x3C 处的 4 字节 little-endian），
	// 定位 PE 签名（"PE\0\0"），确认是完整 PE 文件。
	f, err := os.Open(exePath)
	if err != nil {
		return fmt.Errorf("打开更新包失败: %w", err)
	}
	var magic [2]byte
	_, err = io.ReadFull(f, magic[:])
	if err != nil || string(magic[:]) != "MZ" {
		_ = f.Close()
		return ErrInvalidPackage
	}
	// 读取 PE header 偏移（MZ + 0x3C）
	if _, err := f.Seek(0x3C, io.SeekStart); err != nil {
		_ = f.Close()
		return fmt.Errorf("%w：读取 PE 偏移失败: %v", ErrInvalidPackage, err)
	}
	var peOffsetBytes [4]byte
	if _, err := io.ReadFull(f, peOffsetBytes[:]); err != nil {
		_ = f.Close()
		return fmt.Errorf("%w：读取 PE 偏移失败: %v", ErrInvalidPackage, err)
	}
	peOffset := int(peOffsetBytes[0]) | int(peOffsetBytes[1])<<8 | int(peOffsetBytes[2])<<16 | int(peOffsetBytes[3])<<24
	// 偏移合理性检查：PE header 不可能在 MZ header 之前，也不能太远（PE 文件通常 < 1GB）
	if peOffset < 64 || peOffset > 1<<30 {
		_ = f.Close()
		return fmt.Errorf("%w：PE 偏移非法 %d", ErrInvalidPackage, peOffset)
	}
	// 读取 PE 签名（"PE\0\0"）
	if _, err := f.Seek(int64(peOffset), io.SeekStart); err != nil {
		_ = f.Close()
		return fmt.Errorf("%w：定位 PE 签名失败: %v", ErrInvalidPackage, err)
	}
	var peSig [4]byte
	if _, err := io.ReadFull(f, peSig[:]); err != nil {
		_ = f.Close()
		return fmt.Errorf("%w：读取 PE 签名失败: %v", ErrInvalidPackage, err)
	}
	if string(peSig[:]) != "PE\x00\x00" {
		_ = f.Close()
		return fmt.Errorf("%w：PE 签名不匹配", ErrInvalidPackage)
	}
	_ = f.Close()

	// 准备临时目录：复制新 exe + 释放 helper
	tmpDir, err := os.MkdirTemp("", "ysm-update")
	if err != nil {
		return fmt.Errorf("创建临时目录失败: %w", err)
	}
	newPath := filepath.Join(tmpDir, "YSM-Model-Manager.exe")
	if err := fsutil.CopyFile(exePath, newPath); err != nil {
		_ = os.RemoveAll(tmpDir) // 最佳努力清理，失败不影响报错返回
		return fmt.Errorf("准备新 exe 失败: %w", err)
	}
	helperPath := filepath.Join(tmpDir, "ysm-updater-helper.exe")
	if err := extractEmbeddedHelper(helperPath); err != nil {
		_ = os.RemoveAll(tmpDir)
		return fmt.Errorf("释放更新助手失败: %w", err)
	}

	// 启动 helper（传入 新exe路径 目标exe路径 主进程PID）
	pid := strconv.Itoa(os.Getpid())
	cmd := exec.Command(helperPath, newPath, exe, pid)
	cmd.Dir = tmpDir
	// helper 是自更新进程，不得闪黑框控制台——executil.HideWindow 全平台收敛点
	// （Windows 实装 SW_HIDE，其他平台空操作；updater 是唯一生产 exec.Command 调用点）
	executil.HideWindow(cmd)
	if err := cmd.Start(); err != nil {
		_ = os.RemoveAll(tmpDir)
		return fmt.Errorf("启动更新助手失败: %w", err)
	}

	// 清理临时下载文件
	if err := os.Remove(exePath); err != nil {
		log.Printf("[updater] 清理临时文件失败: %v", err)
	}

	// 主进程退出收口：库函数不直接 os.Exit——defer（updateLock.Unlock 等）
	// 必须正常走完，退出由调用方据 ErrExitRequested 在应用层执行（helper 已在子进程
	// 侧等待，主进程退出即完成 exe 替换）。Wails 前端应在此之前显示提示。
	return ErrExitRequested
}

// 更新 exe 复制已收敛至 fsutil.CopyFile（ADR-044 策略 A：同目录 tmp+rename 原子落地，
// 防磁盘满留半截 exe；此处旧有裸 os.Create+io.Copy 实现已删除，见 recycle.go 同款收敛）
