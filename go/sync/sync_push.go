// ===== 推送/拉取执行（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 PushResourceToInstance /
// PullResourceFromInstance 提取执行循环；实例查找/目录解析由薄壳完成，
// 本文件只做 SyncResources 结果的落地复制 + 计数。
package sync

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/types"
)

// Logger 导入日志回调（薄壳注入 App.logger.Add）
type Logger func(name, src, dst string, size int64, status, msg string)

// PushResources 推送缺失资源到整合包（folder 级类型用 SyncResourcesDirLevel）
func PushResources(rtype, globalDir, targetDir, linkMode string, logger Logger) (int, error) {
	count := 0
	failed := 0

	// YSM(.json) 和 MMD(.pmx/.pmd) 位于子目录中，需文件夹推送
	// 用文件夹级同步检测 missing，然后完整复制整个文件夹（含纹理等配套文件）
	if rtype == "mmd-skin" || rtype == "ysm" {
		dirResult := SyncResourcesDirLevel(globalDir, targetDir, rtype)
		for _, missingDir := range dirResult.Missing {
			if err := installer.InstallDir(missingDir, targetDir, globalDir, linkMode, rtype); err == nil {
				count++
			} else {
				failed++
				logger(filepath.Base(missingDir), missingDir, targetDir, 0, "failed", "推送失败: "+err.Error())
			}
		}
		if failed > 0 {
			return count, fmt.Errorf("推送完成: 成功 %d，失败 %d", count, failed)
		}
		return count, nil
	}

	// 非文件夹级类型：文件级同步
	result := SyncResources(globalDir, targetDir)
	for _, src := range result.Missing {
		if err := installer.Install(src, targetDir, globalDir, linkMode); err == nil {
			count++
		} else {
			failed++
			logger(filepath.Base(src), src, targetDir, 0, "failed", "推送失败: "+err.Error())
		}
	}
	if failed > 0 {
		return count, fmt.Errorf("推送完成: 成功 %d，失败 %d", count, failed)
	}
	return count, nil
}

// PullResources 拉取整合包多余资源回仓库
func PullResources(rtype, globalDir, targetDir string, logger Logger) (int, error) {
	// 找出 extra 的文件并复制到全局
	// 对 YSM/MMD 使用文件夹级同步
	var result types.ResourceSyncResult
	if rtype == "ysm" || rtype == "mmd-skin" {
		result = SyncResourcesDirLevel(globalDir, targetDir, rtype)
	} else {
		result = SyncResources(globalDir, targetDir)
	}
	count := 0
	failed := 0
	for _, src := range result.Extra {
		fi, stErr := os.Stat(src)
		isDir := stErr == nil && fi.IsDir()
		if rtype == "ysm" || rtype == "mmd-skin" {
			if isDir {
				folderName := filepath.Base(src)
				dstDir := filepath.Join(globalDir, folderName)
				if err := os.MkdirAll(dstDir, 0755); err != nil {
					failed++
					logger(folderName, src, dstDir, 0, "failed", "拉取失败: "+err.Error())
					continue
				}
				entries, _ := os.ReadDir(src)
				for _, e := range entries {
					if e.IsDir() {
						continue
					}
					srcFile := filepath.Join(src, e.Name())
					if err := copyFile(srcFile, filepath.Join(dstDir, e.Name())); err != nil {
						failed++
						logger(e.Name(), srcFile, dstDir, 0, "failed", "拉取失败: "+err.Error())
						continue
					}
				}
				count++
			} else {
				if err := copyFile(src, filepath.Join(globalDir, filepath.Base(src))); err != nil {
					failed++
					logger(filepath.Base(src), src, globalDir, 0, "failed", "拉取失败: "+err.Error())
					continue
				}
				count++
			}
			continue
		}
		dstDir := filepath.Dir(strings.Replace(src, targetDir, globalDir, 1))
		if err := os.MkdirAll(dstDir, 0755); err != nil {
			failed++
			logger(filepath.Base(src), src, dstDir, 0, "failed", "拉取失败: "+err.Error())
			continue
		}
		if err := copyFile(src, filepath.Join(dstDir, filepath.Base(src))); err != nil {
			failed++
			logger(filepath.Base(src), src, dstDir, 0, "failed", "拉取失败: "+err.Error())
			continue
		}
		count++
	}
	if failed > 0 {
		return count, fmt.Errorf("拉取完成: 成功 %d，失败 %d", count, failed)
	}
	return count, nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
