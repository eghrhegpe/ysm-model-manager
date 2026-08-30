// ========== 回收站（拆分自 app_install.go）==========
// 从 app_install.go 拆分：回收站相关函数
package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/recycle"
	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

// ========== 回收站 ==========
// R24 P3：recycle 五个绑定（Move/Restore/Delete/Empty）与安装/同步并发操作同一批
// 文件（实例目录 Rename/Remove、.recycle 内 Move）→ 统一纳入 InstallLock 互斥
// （共享单锁闭环，与 ClearInstanceResources/DeduplicateCustomDir 同口径）。
// ⚠️ 这些绑定不得在已持 InstallLock 的路径内被调用（非重入锁，会自死锁）。
func (a *App) MoveToRecycle(src string) error {
	installer.InstallLock.Lock()
	defer installer.InstallLock.Unlock()
	// 尝试所有可能的资源根目录，找到包含 src 的那个
	root := a.findRecycleRoot(src)
	if root == "" {
		root = a.ysmRoot()
	}
	// src 等于资源根本身时拒绝——findRecycleRoot 对 rel=="."
	// 判命中 + recycle.IsInside 对 path==root 放行 → 整仓库移入 .recycle（可恢复但误操作面大）；
	// fallback 到 ysmRoot 后 Clean 相等同样拒绝。
	// EqualFold 大小写不敏感比较（对齐 paths.IsInside 的 Windows 语义，
	// 防大小写不同的根输入绕过守卫）
	if strings.EqualFold(filepath.Clean(src), filepath.Clean(root)) {
		return fmt.Errorf("不能把资源根目录整体移入回收站")
	}
	if err := recycle.Move(src, root); err != nil {
		return err
	}
	scanner.InvalidateCache()
	return nil
}

// Deprecated: 前端已迁移统一入口（前端 0 消费），保留仅为兼容旧绑定面；待发版清理。
// 注意（R23 P3-3）：与 MoveToRecycle 不对称——findRecycleRoot 失败时无 ysmRoot 兜底，
// 直接返回 error（保留旧绑定错误语义，避免静默降级到错误根目录）。
func (a *App) MoveToRecycleEx(src string) (string, string) {
	installer.InstallLock.Lock()
	defer installer.InstallLock.Unlock()
	root := a.findRecycleRoot(src)
	if root == "" {
		return "error", "未找到包含此文件的资源目录"
	}
	res := recycle.MoveEx(src, root)
	if res.Action != "error" {
		// 移动成功后失效扫描缓存——与 MoveToRecycle 对齐（防 30s 陈旧缓存"复活"）
		scanner.InvalidateCache()
	}
	return res.Action, res.Reason
}

// findRecycleRoot 查找包含 src 路径的资源根目录（用于多类型回收）
func (a *App) findRecycleRoot(src string) string {
	cfg := a.LoadAppConfig()
	roots := []string{
		a.ysmRoot(),
		cfg.ResourcepackRoot,
		cfg.ShaderpackRoot,
		cfg.SchematicRoot,
		cfg.LitematicRoot,
		cfg.MmdRoot,
		cfg.VrcRoot,
	}
	// CustomRoots 纳入根列表（迁移后废弃字段已清空，recycle 必须查新源——codereview 批次3 P2）
	if cfg.CustomRoots != nil {
		for _, r := range cfg.CustomRoots {
			roots = append(roots, r)
		}
	}
	for _, r := range roots {
		if r == "" {
			continue
		}
		rel, err := filepath.Rel(r, src)
		if err != nil {
			continue
		}
		// 与 isPathInRoot 根拒绝对齐——rel=="."（src 即根）不得判命中，
		// 精确段比较替代裸 HasPrefix（..foo 合法目录不误拒）
		if rel == "." || rel == ".." {
			continue
		}
		sep := string(filepath.Separator)
		if strings.HasPrefix(rel, ".."+sep) {
			continue
		}
		return r
	}
	return ""
}

// Deprecated: 前端已迁移统一入口（前端 0 消费），保留仅为兼容旧绑定面；待发版清理。
func (a *App) ClearCustomDir(customDir string) (int, error) {
	customDir = strings.TrimSpace(customDir)
	if customDir == "" {
		return 0, fmt.Errorf("目录为空")
	}
	// 补根守卫——原实现对任意 customDir 直接 WalkDir + os.Remove，
	// 可删仓库外任意 .ysm/.zip/.7z（仅限与仓库同名的文件）
	// 根级（customDir == ysmRoot）由 isPathInRoot 的 rel=="." 拒绝覆盖（2026-08-09 P1 修复）——
	// 该函数已拒绝根路径本身，customDir==ysmRoot 时返回「路径超出仓库目录」
	if !a.isPathInRoot(customDir) {
		return 0, fmt.Errorf("路径超出仓库目录")
	}

	repoFiles := a.ScanModelEntries(a.ysmRoot())
	repoByName := map[string]types.ModelEntry{}
	for _, e := range repoFiles {
		repoByName[e.Name] = e
		// 双 key 登记：scanner 的 Name 含 .ban/.disabled 后缀（filepath.Base 原始名），
		// 而 customDir 侧 lookupName 剥后缀——不登记剥后缀名则仓库禁用条目永远匹配不上
		stripped := types.StripDisableSuffix(e.Name)
		if stripped != e.Name {
			repoByName[stripped] = e
		}
	}

	count := 0
	failures := 0
	filepath.WalkDir(customDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			failures++
			return nil
		}
		if d.IsDir() {
			if strings.ToLower(d.Name()) == ".recycle" {
				return filepath.SkipDir
			}
			return nil
		}
		// ADR-064 锚定：扩展名判定走注册表（原硬编码 .ysm/.zip/.7z，新增 YSM
		// 承载格式或资源类型时清理功能失效）；IsTypeModelFile 内部剥 .ban/.disabled
		fileName := filepath.Base(p)
		if !types.IsTypeModelFile(fileName, "ysm") {
			return nil
		}

		lookupName := types.StripDisableSuffix(fileName)

		_, hasName := repoByName[lookupName]
		if !hasName {
			a.logger.Add(fileName, p, customDir, 0, "skipped", "仓库中无此文件，跳过删除（请先上传到仓库）")
			return nil
		}

		if err := os.Remove(p); err != nil {
			failures++
			a.logger.Add(fileName, p, customDir, 0, "failed", err.Error())
			return nil
		}
		count++
		a.logger.Add(fileName, p, customDir, 0, "success", "已从整合包删除（仓库保留）")
		return nil
	})
	// 无条件失效缓存——部分失败（failures>0）时已删 count 个文件，同样不能留陈旧缓存
	scanner.InvalidateCache()
	if failures > 0 {
		return count, fmt.Errorf("清理完成: 成功 %d，失败 %d", count, failures)
	}
	return count, nil
}

func (a *App) ListRecycleBin(recyclePath string) []types.ModelEntry {
	cfg := a.LoadAppConfig()
	roots := a.allRecycleRoots(cfg)
	all := []types.ModelEntry{}
	seen := map[string]bool{}
	for _, r := range roots {
		for _, e := range recycle.List(r) {
			if seen[e.Path] {
				continue
			}
			seen[e.Path] = true
			all = append(all, e)
		}
	}
	return all
}

func (a *App) RestoreFromRecycle(src, filesRoot string) error {
	installer.InstallLock.Lock()
	defer installer.InstallLock.Unlock()
	// 尝试所有根目录恢复
	cfg := a.LoadAppConfig()
	for _, r := range a.allRecycleRoots(cfg) {
		if recycle.New(r).RecycleDir() == "" {
			continue
		}
		if err := recycle.Restore(src, r); err == nil {
			// 恢复 = 仓库新增文件——失效扫描缓存，否则 30s 内扫描不到恢复的文件
			scanner.InvalidateCache()
			return nil // 找到正确的根目录并恢复
		}
	}
	if err := recycle.Restore(src, filesRoot); err != nil {
		return err
	}
	// fallback 恢复成功同样失效缓存
	scanner.InvalidateCache()
	return nil
}

func (a *App) DeleteFromRecycle(src string) error {
	installer.InstallLock.Lock()
	defer installer.InstallLock.Unlock()
	cfg := a.LoadAppConfig()
	for _, r := range a.allRecycleRoots(cfg) {
		if recycle.New(r).RecycleDir() == "" {
			continue
		}
		if err := recycle.Delete(src, r); err == nil {
			return nil
		}
	}
	return recycle.Delete(src, a.ysmRoot())
}

// EmptyRecycleBin 清空所有已配置资源根目录的回收站，返回删除条目总数。
// src 参数保留以兼容既有前端绑定契约（批次4 P2 参数命名）：历史遗留占位，
// 实际清空全部回收站而非按单目录，Go 端不消费该值。
func (a *App) EmptyRecycleBin(src string) (int, error) {
	installer.InstallLock.Lock()
	defer installer.InstallLock.Unlock()
	cfg := a.LoadAppConfig()
	total := 0
	failed := []string{}
	for _, r := range a.allRecycleRoots(cfg) {
		n, err := recycle.Empty(r)
		if err != nil {
			failed = append(failed, r)
			continue
		}
		total += n
	}
	scanner.InvalidateCache()
	if len(failed) > 0 {
		return total, fmt.Errorf("%d 个资源目录清空失败: %s", len(failed), strings.Join(failed, ", "))
	}
	return total, nil
}

// allRecycleRoots 返回所有配置了路径的资源根目录
// 注意：回收站统一使用 RepoRoot/.recycle，McRoot 等游戏目录不参与回收站管理
func (a *App) allRecycleRoots(cfg types.AppConfig) []string {
	roots := []string{
		a.ysmRoot(),
		cfg.ResourcepackRoot,
		cfg.ShaderpackRoot,
		cfg.SchematicRoot,
		cfg.LitematicRoot,
		cfg.MmdRoot,
		cfg.VrcRoot,
	}
	// CustomRoots 纳入根列表（迁移后废弃字段已清空，回收站须查新源——codereview 批次3 P2）
	if cfg.CustomRoots != nil {
		for _, r := range cfg.CustomRoots {
			roots = append(roots, r)
		}
	}
	result := []string{}
	for _, r := range roots {
		if r != "" {
			result = append(result, r)
		}
	}
	return result
}
