// ===== 重链接执行（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 relinkDir 提取：按 SHA256 哈希比对
// 将整合包实例目录中的文件重新链接到仓库版本（原子替换，失败回滚）。
// scanFn（扫描）/ linkMode / logger 由薄壳注入。
package sync

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/types"
)

// RelinkDir 按哈希比对重链接实例目录与仓库（原子替换，失败回滚）
func RelinkDir(customDir, repoRoot, rtype, linkMode string, scanFn func(string) []types.ModelEntry, logger Logger) (int, error) {
	customDir = strings.TrimSpace(customDir)
	repoRoot = strings.TrimSpace(repoRoot)
	if customDir == "" || repoRoot == "" {
		return 0, fmt.Errorf("参数为空")
	}
	repoEntries := scanFn(repoRoot)
	repoByHash := make(map[string]string)
	for _, e := range repoEntries {
		if e.Hash != "" {
			repoByHash[e.Hash] = e.Path
		}
	}
	customEntries := scanFn(customDir)
	count := 0
	for _, ce := range customEntries {
		if ce.Hash == "" {
			continue
		}
		srcPath, found := repoByHash[ce.Hash]
		if !found {
			continue
		}
		// ysm.json / .pmx / .pmd：使用 InstallDir 重新链接整个文件夹
		ext := strings.ToLower(filepath.Ext(ce.Path))
		baseName := strings.ToLower(filepath.Base(ce.Path))
		baseName = strings.TrimSuffix(baseName, ".ban")
		isDirType := (baseName == "ysm.json" && rtype == "ysm") ||
			(ext == ".pmx" || ext == ".pmd")
		if isDirType {
			srcDir := filepath.Dir(srcPath)
			// ce.Path 已在目标子目录内，父层才是 InstallDir 要写入的基础目录
			dstParent := filepath.Dir(ce.Path)
			// P1 修复：ysm.json/.pmx 平铺在 customDir 根层时（dstParent == customDir），
			// InstallDir 的「挪走整目录→重建→回滚」会连带把同目录其他模型一起 rename 走、
			// 重建失败回滚后其他模型也随备份 RemoveAll 丢失。根层平铺退化为单文件落地，
			// 不做整目录替换。
			if filepath.Clean(dstParent) == filepath.Clean(customDir) {
				// P2 修复（code_review）：用 CopyFile 装到 customDir 平铺位置——
				// installer.Install 按 rel(srcPath, repoRoot) 推导目标，仓库侧文件在子目录时
				// 会装到 <customDir>/<subdir>/<base> 而平铺位置 <customDir>/<base> 残留陈旧副本
				//（报告成功但游戏实际加载的文件未重链）。CopyFile 直接落地到平铺目录。
				if _, err := installer.CopyFile(srcPath, customDir); err != nil {
					logger(ce.Name, ce.Path, customDir, 0, "failed", "relink 失败: "+err.Error())
					continue
				}
				count++
				continue
			}
			// 但 InstallDir 会自动创建 {targetSubDir}，如果 dstParent 已经是模型目录
			// 则会二次嵌套。正确的做法：上一层目录作为 dstDir，让 InstallDir 创建子目录
			dstBase := filepath.Dir(dstParent)
			// 原子替换：先把旧目录挪走作备份，InstallDir 重建成功后再清理备份；
			// 失败则回滚恢复，避免目录整体丢失（旧实现先 RemoveAll 后重建，失败即丢）
			backup := dstParent + ".relink-bak"
			_ = os.RemoveAll(backup)
			if err := os.Rename(dstParent, backup); err != nil {
				logger(ce.Name, ce.Path, dstParent, 0, "failed", "relink 备份目录失败: "+err.Error())
				continue
			}
			if err := installer.InstallDir(srcDir, dstBase, repoRoot, linkMode, rtype); err != nil {
				// 回滚：删除半成品，恢复原目录
				_ = os.RemoveAll(filepath.Join(dstBase, filepath.Base(srcDir)))
				_ = os.Rename(backup, dstParent)
				logger(ce.Name, ce.Path, dstParent, 0, "failed", "relink 失败: "+err.Error())
				continue
			}
			_ = os.RemoveAll(backup)
			count++
			continue
		}
		// 传入基础 customDir，让 installer.Install 自行计算相对路径。
		// Install 内部对已存在的旧文件做原子替换（临时链接 + rename），失败不破坏原文件
		if err := installer.Install(srcPath, customDir, repoRoot, linkMode); err != nil {
			logger(ce.Name, ce.Path, customDir, 0, "failed", "relink 失败: "+err.Error())
			continue
		}
		count++
	}
	return count, nil
}
