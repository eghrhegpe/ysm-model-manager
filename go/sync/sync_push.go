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

// PullSingleResource 拉取单个资源（文件夹/文件）回仓库
func PullSingleResource(globalDir, targetDir, srcPath string) error {
	// 文件夹级拉取：整体复制文件夹到全局
	fi, stErr := os.Stat(srcPath)
	if stErr == nil && fi.IsDir() {
		folderName := filepath.Base(srcPath)
		dstDir := filepath.Join(globalDir, folderName)
		if err := os.MkdirAll(dstDir, 0755); err != nil {
			return err
		}
		entries, _ := os.ReadDir(srcPath)
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			srcFile := filepath.Join(srcPath, e.Name())
			if err := copyFile(srcFile, filepath.Join(dstDir, e.Name())); err != nil {
				return err
			}
		}
		return nil
	}
	dstDir := filepath.Dir(strings.Replace(srcPath, targetDir, globalDir, 1))
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}
	return copyFile(srcPath, filepath.Join(dstDir, filepath.Base(srcPath)))
}

// PushSingleResource 推送单个资源到整合包：
// 文件夹 / .json/.pmx/.pmd（文件夹级类型）走 InstallDir，其余 Install
func PushSingleResource(filePath, customDir, globalDir, linkMode, rtype string) error {
	fi, stErr := os.Stat(filePath)
	if stErr == nil && fi.IsDir() {
		return installer.InstallDir(filePath, customDir, globalDir, linkMode, rtype)
	}
	ext := strings.ToLower(filepath.Ext(filePath))
	if ext == ".json" || ext == ".pmx" || ext == ".pmd" {
		return installer.InstallDir(filepath.Dir(filePath), customDir, globalDir, linkMode, rtype)
	}
	return installer.Install(filePath, customDir, globalDir, linkMode)
}

// SyncCustomToRepo 同步整合包自定义目录的模型到仓库（哈希/名称去重）
func SyncCustomToRepo(customDir, repoDir string, scanFn func(string) []types.ModelEntry, logger Logger) (int, error) {
	customDir = strings.TrimSpace(customDir)
	repoDir = strings.TrimSpace(repoDir)
	if customDir == "" || repoDir == "" {
		return 0, fmt.Errorf("参数空")
	}
	srcEntries := scanFn(customDir)
	if len(srcEntries) == 0 {
		return 0, nil
	}

	repoEntries := scanFn(repoDir)
	repoHashes := make(map[string]bool)
	repoNames := make(map[string]bool)
	for _, re := range repoEntries {
		if re.Hash != "" {
			repoHashes[re.Hash] = true
		}
		repoNames[re.Name] = true
	}

	count := 0
	for _, e := range srcEntries {
		if e.Hash != "" && repoHashes[e.Hash] {
			logger(e.Name, e.Path, repoDir, 0, "skipped", "仓库已存在同哈希文件，跳过")
			continue
		}
		if repoNames[e.Name] {
			logger(e.Name, e.Path, repoDir, 0, "skipped", "仓库已存在同名文件，跳过")
			continue
		}
		rel, _ := filepath.Rel(customDir, e.Path)
		if rel == "" {
			rel = e.Name
		}
		dstPath := filepath.Join(repoDir, rel)
		dstDir := filepath.Dir(dstPath)
		if err := os.MkdirAll(dstDir, 0755); err != nil {
			logger(e.Name, e.Path, repoDir, 0, "failed", "创建目录失败: "+err.Error())
			continue
		}
		if _, err := installer.CopyFile(e.Path, dstDir); err != nil {
			logger(e.Name, e.Path, repoDir, 0, "failed", "复制失败: "+err.Error())
			continue
		}
		count++
		logger(e.Name, e.Path, repoDir, 0, "success", "已复制到仓库")
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
