// ===== 推送/拉取执行（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 PushResourceToInstance /
// PullResourceFromInstance 提取执行循环；实例查找/目录解析由薄壳完成，
// 本文件只做 SyncResources 结果的落地复制 + 计数。
package sync

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/types"
)

// Logger 导入日志回调（薄壳注入 App.logger.Add）
type Logger func(name, src, dst string, size int64, status, msg string)

// PushResources 推送缺失资源到整合包（folder 级类型用 SyncResourcesDirLevel）
//
// 多层物理路径支持：
//
//	对于 dirLevelSync 类型，会在目标目录下还原相对 globalDir 的完整路径层级。
//	例如仓库 maid-model/vendor/character/pack.zip 推送后落位到
//	targetDir/vendor/character/pack.zip，而非扁平化的 targetDir/pack.zip。
func PushResources(rtype, globalDir, targetDir, linkMode string, logger Logger) (int, error) {
	// 整段持 installer.InstallLock（ADR-056）：差集（SyncResources）在锁外计算会让陈旧
	// diff 在两次 Install 之间被并发 Pull/Relink 改写目标目录后继续安装——与同文件
	// PullResources/RelinkDir 的整段持锁口径对齐。循环内改用 *Locked 变体防重入死锁。
	installer.InstallLock.Lock()
	defer installer.InstallLock.Unlock()
	defer InvalidateSyncScanCaches() // 推送会改实例/全局目录，清同步扫盘缓存防陈旧
	count := 0
	failed := 0

	// YSM(.json) 和 MMD(.pmx/.pmd) 位于子目录中，需文件夹推送
	// 用文件夹级同步检测 missing，然后完整复制整个文件夹（含纹理等配套文件）
	// 多层物理路径：行内计算 rel(globalDir, missing) 保留中间目录层级
	if types.IsDirLevelSync(rtype) {
		dirResult := SyncResourcesDirLevel(globalDir, targetDir, rtype)
		for _, missing := range dirResult.Missing {
			fi, stErr := os.Stat(missing)
			var err error
			if stErr == nil && !fi.IsDir() {
				err = installer.InstallLocked(missing, targetDir, globalDir, linkMode)
			} else {
				// 多层物理路径：用 InstallDirRel 保留仓库层级结构
				// 例如 missing=globalDir/vendor/character/modelA → targetDir/vendor/character/modelA
				rel, relErr := filepath.Rel(globalDir, missing)
				// code review P3：rel == "."（missing == globalDir——目录根本身是模型文件夹）
				// 也回退 InstallDir（InstallDirRel 的 rel=="." 拒绝会静默推送失败——与旧
				// 行为一致：basename 落位）
				if relErr != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
					// 越界回退到 InstallDir 原语义（basename 落位）
					err = installer.InstallDirLocked(missing, targetDir, globalDir, linkMode, rtype)
				} else {
					err = installer.InstallDirRelLocked(missing, targetDir, filepath.ToSlash(rel), globalDir, linkMode, rtype)
				}
			}
			if err == nil {
				count++
			} else {
				failed++
				if logger != nil {
					logger(filepath.Base(missing), missing, targetDir, 0, "failed", "推送失败: "+err.Error())
				}
			}
		}
		if failed > 0 {
			return count, fmt.Errorf("推送完成: 成功 %d，失败 %d", count, failed)
		}
		return count, nil
	}

	// 非文件夹级类型：文件级同步（整段已持 InstallLock，见函数头注释）
	result := SyncResources(globalDir, targetDir, rtype)
	for _, src := range result.Missing {
		if err := installer.InstallLocked(src, targetDir, globalDir, linkMode); err == nil {
			count++
		} else {
			failed++
			if logger != nil {
				logger(filepath.Base(src), src, targetDir, 0, "failed", "推送失败: "+err.Error())
			}
		}
	}
	if failed > 0 {
		return count, fmt.Errorf("推送完成: 成功 %d，失败 %d", count, failed)
	}
	return count, nil
}

// PullResources 拉取整合包多余资源回仓库
// 持 InstallLock：从实例目录复制文件回仓库，与 SyncToggleStatus/RelinkDir
// 等并发操作同一实例目录文件互斥（ADR-056 共享单锁）
func PullResources(rtype, globalDir, targetDir string, logger Logger) (int, error) {
	installer.InstallLock.Lock()
	defer installer.InstallLock.Unlock()
	defer InvalidateSyncScanCaches() // 拉取会改全局仓库目录，清同步扫盘缓存防陈旧
	// 找出 extra 的文件并复制到全局
	// 对 YSM/MMD 使用文件夹级同步
	var result types.ResourceSyncResult
	if types.IsDirLevelSync(rtype) {
		result = SyncResourcesDirLevel(globalDir, targetDir, rtype)
	} else {
		result = SyncResources(globalDir, targetDir, rtype)
	}
	count := 0
	failed := 0
	for _, src := range result.Extra {
		fi, stErr := os.Stat(src)
		isDir := stErr == nil && fi.IsDir()
		if types.IsDirLevelSync(rtype) {
			// 相对 targetDir 映射到 globalDir，保留子目录层级（EntityPlayer/角色A →
			// mmd/EntityPlayer/角色A）；越界无法映射时回退文件名（旧行为）
			rel, relErr := filepath.Rel(targetDir, src)
			if relErr != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				rel = filepath.Base(src)
			}
			dstPath := filepath.Join(globalDir, rel)
			if isDir {
				// 递归复制整个目录（保留相对路径）——MMD/YSM 模型文件夹的深层子目录
				// （textures/toon 等）不能丢弃；失败时 copyDirRecursive 已回滚清理
				if err := copyDirRecursive(src, dstPath); err != nil {
					failed++
					if logger != nil {
						logger(filepath.Base(src), src, dstPath, 0, "failed", "拉取失败: "+err.Error())
					}
					continue
				}
				count++
			} else {
				if err := os.MkdirAll(filepath.Dir(dstPath), fsutil.DirPerms); err != nil {
					failed++
					if logger != nil {
						logger(filepath.Base(src), src, filepath.Dir(dstPath), 0, "failed", "创建目录失败: "+err.Error())
					}
					continue
				}
				if err := copyFile(src, dstPath); err != nil {
					failed++
					if logger != nil {
						logger(filepath.Base(src), src, dstPath, 0, "failed", "拉取失败: "+err.Error())
					}
					continue
				}
				count++
			}
			continue
		}
		mapped, mapErr := mapSrcToGlobal(src, targetDir, globalDir)
		if mapErr != nil {
			failed++
			if logger != nil {
				logger(filepath.Base(src), src, globalDir, 0, "failed", "路径映射失败: "+mapErr.Error())
			}
			continue
		}
		dstDir := filepath.Dir(mapped)
		if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
			failed++
			if logger != nil {
				logger(filepath.Base(src), src, dstDir, 0, "failed", "拉取失败: "+err.Error())
			}
			continue
		}
		// 文件级类型的目录条目（如 resourcepack 的 pack.mcmeta 文件夹 Extra）：
		// copyFile 对目录会失败——审核补丁，目录整体复制到映射目标（保留 rel）
		if isDir {
			if err := copyDirRecursive(src, mapped); err != nil {
				failed++
				if logger != nil {
					logger(filepath.Base(src), src, mapped, 0, "failed", "拉取失败: "+err.Error())
				}
				continue
			}
			count++
			continue
		}
		if err := copyFile(src, filepath.Join(dstDir, filepath.Base(src))); err != nil {
			failed++
			if logger != nil {
				logger(filepath.Base(src), src, dstDir, 0, "failed", "拉取失败: "+err.Error())
			}
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
// 持 InstallLock：从实例目录复制文件回仓库，与并发同步操作互斥（ADR-056）
func PullSingleResource(globalDir, targetDir, srcPath string) error {
	installer.InstallLock.Lock()
	defer installer.InstallLock.Unlock()
	defer InvalidateSyncScanCaches() // 拉取会改全局仓库目录，清同步扫盘缓存防陈旧
	// 文件夹级拉取：整体复制文件夹到全局（保留相对 targetDir 的子类层级）。
	// 越界（srcPath 不在 targetDir 内）直接报错——与文件分支 mapSrcToGlobal 严格口径
	// 一致；旧行为退化为 basename 会把越界目录错误落到 globalDir 根（丢子类层级 + 同名覆盖）。
	fi, stErr := os.Stat(srcPath)
	if stErr == nil && fi.IsDir() {
		rel, relErr := filepath.Rel(targetDir, srcPath)
		if relErr != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("路径 %s 不在目标目录 %s 内", srcPath, targetDir)
		}
		dstDir := filepath.Join(globalDir, rel)
		// 递归复制整个目录（保留相对路径），深层子目录（textures/toon 等）一并拉取
		return copyDirRecursive(srcPath, dstDir)
	}
	mapped, mapErr := mapSrcToGlobal(srcPath, targetDir, globalDir)
	if mapErr != nil {
		return mapErr
	}
	dstDir := filepath.Dir(mapped)
	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
		return err
	}
	return copyFile(srcPath, filepath.Join(dstDir, filepath.Base(srcPath)))
}

// PushSingleResource 推送单个资源到整合包：
// 文件夹 / .json/.pmx/.pmd（文件夹级类型）走 InstallDir，其余 Install。
// 子类内部模型（EntityPlayer/角色A）落位到 customDir/<子类>，保留层级。
//
// 扩展名判断说明：.json 用于 YSM（ysm.json 是文件夹级入口），.pmx/.pmd 用于 MMD。
// 不依赖 IsDirLevelSync(rtype) 是因为本函数是通用入口（前端传任意 rtype），
// 由调用方保证 rtype 与 filePath 匹配。若 rtype 不匹配，InstallDir 内部会按
// installDir/scanDir 推导目标路径，不会出错但可能路径不对——这是调用方责任。
//
// ⚠️ 毒舌审核 P0：原硬编码 ext == ".json" 会误判普通 readme.json 为 YSM 文件夹级安装。
// 改为 IsYsmEntryJSON 精确匹配 ysm.json，避免非 YSM 场景的 .json 误触发。
func PushSingleResource(filePath, customDir, globalDir, linkMode, rtype string) error {
	defer InvalidateSyncScanCaches() // 推送会改实例目录，清同步扫盘缓存防陈旧
	fi, stErr := os.Stat(filePath)
	if stErr == nil && fi.IsDir() {
		return installer.InstallDir(filePath, customDir, globalDir, linkMode, rtype)
	}
	ext := strings.ToLower(filepath.Ext(filePath))
	// .pmx/.pmd 一律视为 MMD 文件夹级安装（整个父目录）
	if ext == ".pmx" || ext == ".pmd" {
		dir := filepath.Dir(filePath)
		return installer.InstallDir(dir, customDir, globalDir, linkMode, rtype)
	}
	// .json 仅 ysm.json 视为 YSM 文件夹级入口（防 readme.json 等误判）
	if ext == ".json" && types.IsYsmEntryJSON(filePath) {
		dir := filepath.Dir(filePath)
		return installer.InstallDir(dir, customDir, globalDir, linkMode, rtype)
	}
	return installer.Install(filePath, customDir, globalDir, linkMode)
}

// SyncCustomToRepo 同步整合包自定义目录的模型到仓库（哈希/名称去重）
func SyncCustomToRepo(customDir, repoDir string, scanFn func(string) []types.ModelEntry, logger Logger) (int, error) {
	defer InvalidateSyncScanCaches() // 收编会改全局仓库目录，清同步扫盘缓存防陈旧
	customDir = strings.TrimSpace(customDir)
	repoDir = strings.TrimSpace(repoDir)
	if customDir == "" || repoDir == "" {
		return 0, fmt.Errorf("参数空")
	}
	if scanFn == nil {
		return 0, fmt.Errorf("scanFn 为空")
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
			if logger != nil {
				logger(e.Name, e.Path, repoDir, 0, "skipped", "仓库已存在同哈希文件，跳过")
			}
			continue
		}
		if repoNames[e.Name] {
			if logger != nil {
				logger(e.Name, e.Path, repoDir, 0, "skipped", "仓库已存在同名文件，跳过")
			}
			continue
		}
		rel, err := filepath.Rel(customDir, e.Path)
		if err != nil || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || rel == ".." {
			// P0 修复：防路径穿越——e.Path 不在 customDir 下时，丢弃 err 会生成 "..\\leaked\\m.ysm"
			// 并 MkdirAll 到 customDir 外部。显式拒绝越界条目。
			if logger != nil {
				logger(e.Name, e.Path, repoDir, 0, "failed",
					"跳过越界路径（不在 customDir 下）: "+e.Path)
			}
			continue
		}
		if rel == "" {
			rel = e.Name
		}
		dstPath := filepath.Join(repoDir, rel)
		dstDir := filepath.Dir(dstPath)
		if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
			if logger != nil {
				logger(e.Name, e.Path, repoDir, 0, "failed", "创建目录失败: "+err.Error())
			}
			continue
		}
		if _, err := installer.CopyFile(e.Path, dstDir); err != nil {
			if logger != nil {
				logger(e.Name, e.Path, repoDir, 0, "failed", "复制失败: "+err.Error())
			}
			continue
		}
		count++
		if logger != nil {
			logger(e.Name, e.Path, repoDir, 0, "success", "已复制到仓库")
		}
	}
	return count, nil
}

// mapSrcToGlobal P3 修复（子代理审计）：原用 strings.Replace(src, targetDir, globalDir, 1)
// 子串替换——非路径语义且大小写敏感（Windows 下 targetDir 与 src 前缀大小写不一致时 Replace
// 不命中 → dstDir=Dir(src) → copyFile(src, src) 静默截断源文件；或兄弟目录前缀误匹配写错目录）。
// 改用 filepath.Rel 精确映射：src 必须在 targetDir 下，rel 以 ".." 开头显式报错防逃逸。
func mapSrcToGlobal(src, targetDir, globalDir string) (string, error) {
	rel, err := filepath.Rel(targetDir, src)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("路径 %s 不在目标目录 %s 内", src, targetDir)
	}
	return filepath.Join(globalDir, rel), nil
}

// copyFile 复制文件到目标路径（已收敛至 fsutil.CopyFile 的 tmp+rename 原子落地——
// 原 os.Create+io.Copy 直写目标，拉取中断/磁盘满会留半截文件进仓库，被扫描成
// 「截断哈希」进入同步匹配；fsutil 补 Sync 落盘检查 + Chmod 0644，与 installer/
// fileops/recycle/importer 全部统一，ADR-044 策略 A）。
func copyFile(src, dst string) error {
	return fsutil.CopyFile(src, dst)
}

// copyDirRecursive 递归复制目录树到 dstDir（保留相对路径）：
// 已收敛至 fsutil.CopyDirRecursive（ADR-044 策略 A）。仅当 dstDir 为本次新建时才回滚
// 删除——重拉/刷新场景 dstDir 可能是用户既有模型文件夹，误删旧内容即数据丢失
// （对齐 installer.InstallDir 的 dstExisted 语义）。
func copyDirRecursive(src, dstDir string) error {
	dstExisted := false
	if _, err := os.Stat(dstDir); err == nil {
		dstExisted = true
	}
	return fsutil.CopyDirRecursive(src, dstDir, fsutil.CopyDirOptions{
		RejectSymlink: false,       // 保留 symlink 链接本身（不跟随复制）
		Overwrite:     true,        // 重拉/刷新场景允许覆盖既有文件
		Rollback:      !dstExisted, // 仅本次新建目录才整树回滚，防误删用户既有数据
	})
}
