// ========== 回收站（拆分自 app_install.go）==========
// 从 app_install.go 拆分：回收站相关函数
package app

import (
	"fmt"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/recycle"
	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

// ========== 回收站 ==========
// recycle 五个绑定（Move/Restore/Delete/Empty）与安装/同步并发操作同一批
// 文件（实例目录 Rename/Remove、.recycle 内 Move）→ 统一纳入 InstallLock 互斥
// （共享单锁闭环，与 ClearInstanceResources 同口径）。
// ⚠️ 这些绑定不得在已持 InstallLock 的路径内被调用（非重入锁，会自死锁）。
func (a *App) MoveToRecycle(src string) error {
	installer.InstallLocker.Lock()
	defer installer.InstallLocker.Unlock()
	// 尝试所有可能的资源根目录，找到包含 src 的那个
	root := a.findRecycleRoot(src)
	if root == "" {
		root = a.ysmRoot()
	}
	// fail-fast：root 仍为空 → 无法定位回收站，拒绝执行
	if root == "" {
		return fmt.Errorf("找不到包含该文件的资源根目录，无法移入回收站")
	}
	// 根级自卫：src 等于**任一**已知资源根时拒绝——否则整仓库根会被 rename 进 `.recycle`
	// （可恢复，但属整仓库级误动）。
	//
	// ⚠️ 为什么判据是「任一」而不是「findRecycleRoot 返回的那一个」：`findRecycleRoot` 对
	// rel=="." 是 continue（**不**判命中），故当存在**严格包含 ysmRoot 的外层 CustomRoot** 时
	// 它会跳过内层根、返回外层根；此时拿 `src(内层根)` 与外层根比不相等 → 守卫整体失效。
	// 2026-10-15 复核实测复现：FilesRoot=base + CustomRoots={"maid-model": base} 时
	// MoveToRecycle(ysmRoot) 返回 nil、base/minecraft-mod/ysm 落进 base/.recycle/。
	// recycle.prepareMoveSource 的第二道守卫只比「传入的 root」，同样是外层根，帮不上忙。
	// 故两道并用：先与归属根比（原判据，语义不弱化），再与已知根全集比（补绕过口）。
	//
	// ⚠️ 不得反向改成「让 findRecycleRoot 对 rel=="." 判命中」——那会把归属变成内层根，
	// 改变 .recycle 落在哪个根下（产品裁定，不在本修复范围）。
	// EqualFold 大小写不敏感比较（对齐 paths.IsInside 的 Windows 语义，
	// 防大小写不同的根输入绕过守卫）
	cleanSrc := filepath.Clean(src)
	if strings.EqualFold(cleanSrc, filepath.Clean(root)) {
		return fmt.Errorf("不能把资源根目录整体移入回收站")
	}
	for _, r := range a.recycleRoots() {
		if r != "" && strings.EqualFold(cleanSrc, filepath.Clean(r)) {
			return fmt.Errorf("不能把资源根目录整体移入回收站")
		}
	}
	if err := recycle.Move(src, root); err != nil {
		return err
	}
	scanner.InvalidateCache()
	return nil
}

// recycleRoots 返回参与回收站归属判定的资源根集合（唯一枚举点）：
// ysmRoot + CustomRoots（CustomRoots 是唯一事实源，废弃字段已清空，不再读取）。
// findRecycleRoot（归属命中）与 MoveToRecycle（根级守卫）共用本枚举——各自拼 roots 会漂移，
// 而漂移的后果正是「守卫看的根集合」≠「归属判定看的根集合」（2026-10-15 那次绕过即此类）。
// map 以 range 展开而非 append(roots, cfg.CustomRoots...)：Go 不支持 map 展开进 append
// （编译期报 cannot use map as []string），且 range 与拆分前的逐条 append 语义逐字一致。
func (a *App) recycleRoots() []string {
	cfg := a.LoadAppConfig()
	roots := []string{
		a.ysmRoot(),
	}
	for _, r := range cfg.CustomRoots {
		roots = append(roots, r)
	}
	return roots
}

// findRecycleRoot 查找包含 src 路径的资源根目录（用于多类型回收）
func (a *App) findRecycleRoot(src string) string {
	for _, r := range a.recycleRoots() {
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

// ListRecycleBin 列出回收站条目。recyclePath 非空时只遍历与之相关的资源根
// （任一方向互相包含即视为相关），为空则退回全量遍历。
// 单根包含判定复用 go/paths.IsInside——其已覆盖空路径、NUL 字节、filepath.Rel
// 前缀误判（.. 与 ..foo）、Windows 大小写不敏感等边界，此处不另造一套。
func (a *App) ListRecycleBin(recyclePath string) []types.ModelEntry {
	cfg := a.LoadAppConfig()
	roots := a.allRecycleRoots(cfg)
	if recyclePath != "" {
		keep := make([]string, 0, len(roots))
		for _, r := range roots {
			if paths.IsInside(r, recyclePath) == nil || paths.IsInside(recyclePath, r) == nil {
				keep = append(keep, r)
			}
		}
		roots = keep
	}
	all := []types.ModelEntry{}
	seen := map[string]bool{}
	for _, r := range roots {
		for _, e := range recycle.New(r).List() {
			if seen[e.Path] {
				continue
			}
			seen[e.Path] = true
			all = append(all, e)
		}
	}
	return all
}

// RestoreFromRecycle 从回收站恢复条目。filesRoot 为兜底恢复根：allRecycleRoots
// 全部未命中时按它做最后一次尝试——GUI 传当前类型的仓库根（回收站列表按当前根
// 作用域过滤，条目与该根相关），CLI 传 --files-root；恒传空串会让 fallback 变成
// CWD 相对 ".recycle" 的死救援分支（2026-09 对接锐评③：前端已改传真实根）。
func (a *App) RestoreFromRecycle(src, filesRoot string) error {
	installer.InstallLocker.Lock()
	defer installer.InstallLocker.Unlock()
	// 尝试所有根目录恢复
	cfg := a.LoadAppConfig()
	for _, r := range a.allRecycleRoots(cfg) {
		if recycle.New(r).RecycleDir() == "" {
			continue
		}
		if err := recycle.New(r).Restore(src); err == nil {
			// 恢复 = 仓库新增文件——失效扫描缓存，否则 30s 内扫描不到恢复的文件
			scanner.InvalidateCache()
			return nil // 找到正确的根目录并恢复
		}
	}
	if err := recycle.New(filesRoot).Restore(src); err != nil {
		return err
	}
	// fallback 恢复成功同样失效缓存
	scanner.InvalidateCache()
	return nil
}

func (a *App) DeleteFromRecycle(src string) error {
	installer.InstallLocker.Lock()
	defer installer.InstallLocker.Unlock()
	cfg := a.LoadAppConfig()
	for _, r := range a.allRecycleRoots(cfg) {
		tm := recycle.New(r)
		if tm.RecycleDir() == "" {
			continue
		}
		if err := tm.Delete(src); err == nil {
			a.pruneRecycleEntry(tm, src)
			return nil
		}
	}
	fb := recycle.New(a.ysmRoot())
	if err := fb.Delete(src); err != nil {
		return err
	}
	a.pruneRecycleEntry(fb, src)
	return nil
}

// pruneRecycleEntry 回收站条目**永久删除**后清理标签键（审计 G1 收口 2026-10-11）：
// 条目永灭，原始路径旧键成永久孤儿——同名重导/同步回拉即复活旧标签（PruneKeys
// 立因病）。同族律与 pruneTags 一致：键形态不自算，原始路径由条目 rel 反推
// （recycleOriginal，与 Restore 落点推导同源）。
// 刻意区分：MoveToRecycle（临时态）不接 prune——Restore 自愈，prune 反而丢标签。
func (a *App) pruneRecycleEntry(tm *recycle.TrashManager, entry string) {
	if o := recycleOriginal(tm, entry); o != "" {
		a.pruneTags(o, true)
	}
}

// recycleOriginal 由回收站条目（.recycle/<rel>）反推其原始路径（标签键源头）：
// .recycle 内按源文件相对资源根的 rel 逐层镜像（go-recycle 卡「回收站在盘上的
// 结构」），原路径 = 资源根/<rel>。越权/不可解析条目返回空串（跳过不剪，
// 剪错前缀比不剪危害大）。
func recycleOriginal(tm *recycle.TrashManager, entry string) string {
	if tm.RecycleDir() == "" || entry == "" {
		return ""
	}
	rel, err := filepath.Rel(tm.RecycleDir(), entry)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return ""
	}
	return filepath.Join(filepath.Dir(tm.RecycleDir()), rel)
}

// recycleOriginals 枚举回收站全部条目对应的原始路径（List 过滤口径：含 ysm.json
// 的文件夹模型整组算 1 条）——清空前必须枚举，清空后 List 为空无从反推。
func recycleOriginals(tm *recycle.TrashManager) []string {
	out := []string{}
	for _, e := range tm.List() {
		if o := recycleOriginal(tm, e.Path); o != "" {
			out = append(out, o)
		}
	}
	return out
}

// EmptyRecycleBin 清空所有已配置资源根目录的回收站，返回删除条目总数。
// （2026-09 对接锐评③：原 src 占位参数退役——「前端绑定契约兼容」的历史遗留
// 死参数，GUI/CLI 两端均不消费该值，与 FindDuplicateFiles configStr 同批清理。）
func (a *App) EmptyRecycleBin() (int, error) {
	installer.InstallLocker.Lock()
	defer installer.InstallLocker.Unlock()
	cfg := a.LoadAppConfig()
	total := 0
	failed := []string{}
	for _, r := range a.allRecycleRoots(cfg) {
		tm := recycle.New(r)
		// 清空前枚举条目原始路径（清空后 List 为空无从反推）；清空成功才批量
		// prune 标签键（审计 G1 收口 2026-10-11）——清空失败则不动键
		orphans := recycleOriginals(tm)
		n, err := tm.Empty()
		if err != nil {
			failed = append(failed, r)
			continue
		}
		total += n
		for _, o := range orphans {
			a.pruneTags(o, true)
		}
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
	}
	// CustomRoots 是唯一事实源（废弃字段已清空，不再读取）
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
