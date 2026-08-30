// ========== 文件操作 + 预览提取 + 包信息（薄壳，ADR-003 P3）==========
// 业务逻辑已下沉至 go/fileops（纯 Go 可测）；本文件仅做 Wails 绑定转发 +
// scanCache 缓存失效处理。
package app

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"ysm-model-manager/go/executil"
	"ysm-model-manager/go/fileops"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

// ========== 目录操作 ==========
func (a *App) CreateDir(dir string) error {
	return fileops.CreateDir(a.ysmRoot(), dir)
}

func (a *App) RenameDir(oldPath, newName string) error {
	if !a.isPathInRoot(oldPath) {
		return fmt.Errorf("路径超出仓库目录")
	}
	if err := fileops.RenameDir(oldPath, newName); err != nil {
		return err
	}
	// 改名后失效扫描缓存——否则 30s 内 ScanModelEntries 命中旧目录名（陈旧缓存"复活"）
	scanner.InvalidateCache()
	return nil
}

func (a *App) RemoveDir(dir string) error {
	if !a.isPathInRoot(dir) {
		return fmt.Errorf("路径超出仓库目录")
	}
	if err := fileops.RemoveDir(dir); err != nil {
		return err
	}
	// 删除后失效扫描缓存——否则 30s 内已删目录仍出现在扫描结果
	scanner.InvalidateCache()
	return nil
}

func (a *App) RenameFile(oldPath, newName string) error {
	// 补路径守卫——原实现无校验，任意 oldPath 均可被改名（知识卡守卫清单漏列 RenameFile）
	if !a.isPathInRoot(oldPath) {
		return fmt.Errorf("路径超出仓库目录")
	}
	if err := fileops.RenameFile(oldPath, newName); err != nil {
		return err
	}
	// 改名后失效扫描缓存——否则 30s 内旧文件名仍可被扫描命中
	scanner.InvalidateCache()
	return nil
}

// ========== 预览提取 ==========
// 路径守卫：与 ReadFileBytes 同口径（isPathInRootOrSelf）——「能读的文件就能预览」
// 对称范式；否则任意 modelPath 可返回根外文件的预览图 data URI（信息泄露面）。
func (a *App) FindPreviewImage(modelPath string) string {
	if !a.isPathInRootOrSelf(modelPath) {
		return ""
	}
	return fileops.FindPreviewImage(modelPath)
}

func (a *App) ExtractPreviewTexture(modelPath string) string {
	if !a.isPathInRootOrSelf(modelPath) {
		return ""
	}
	return fileops.ExtractPreviewTexture(modelPath)
}

// ========== 包信息 ==========
func (a *App) GetPackInfo(dirPath string) types.PackInfo {
	return fileops.GetPackInfo(a.ysmRoot(), dirPath)
}

// ========== 模型移动/复制 ==========
// MoveModelFile / CopyModelFile 根路径校验：原实现硬编码 cfg.FilesRoot，
// 但用户可能为某些资源类型配置了自定义根（MmdRoot/VrcRoot 等），这些自定义根
// 可能不在 FilesRoot 之下（如独立的 D:\MMD-Models 目录）。
// 修复：findMoveRoot 遍历所有已配置根，找到同时包含 src 和 dstDir 的那个根，
// 与 isPathInRootOrSelf 的多根校验口径一致。

// findMoveRoot 找到同时包含 src 和 dstDir 的合法仓库根。
// 遍历所有已配置根（FilesRoot + McRoot + 各类型专属根 + CustomRoots），
// 返回第一个同时包含两者的根；全部不匹配返回空串（调用方 fail-closed 拒绝）。
func (a *App) findMoveRoot(src, dstDir string) string {
	cfg := a.LoadAppConfig()
	roots := []string{
		cfg.FilesRoot,
		cfg.McRoot,
		cfg.ResourcepackRoot,
		cfg.ShaderpackRoot,
		cfg.SchematicRoot,
		cfg.LitematicRoot,
		cfg.MmdRoot,
		cfg.VrcRoot,
	}
	// CustomRoots 中的自定义根（如 MmdRoot 迁移后的 CustomRoots["EntityPlayer"]）
	if cfg.CustomRoots != nil {
		for _, r := range cfg.CustomRoots {
			if r != "" {
				roots = append(roots, r)
			}
		}
	}
	absSrc, err := filepath.Abs(src)
	if err != nil {
		return ""
	}
	absDst, err := filepath.Abs(dstDir)
	if err != nil {
		return ""
	}
	for _, root := range roots {
		if root == "" {
			continue
		}
		absRoot, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		relSrc, err := filepath.Rel(absRoot, absSrc)
		if err != nil {
			continue // 不同卷
		}
		if relSrc == ".." || strings.HasPrefix(relSrc, ".."+string(filepath.Separator)) {
			continue // src 不在此根内
		}
		relDst, err := filepath.Rel(absRoot, absDst)
		if err != nil {
			continue
		}
		if relDst == ".." || strings.HasPrefix(relDst, ".."+string(filepath.Separator)) {
			continue // dstDir 不在此根内
		}
		return root // 找到同时包含 src 和 dstDir 的根
	}
	return ""
}

// MoveModelFile 移动（findMoveRoot 遍历所有已配置根做路径安全校验，
// 修复原硬编码 cfg.FilesRoot 导致自定义根下文件无法移动的 bug。
// fail-closed：无匹配根时拒绝，不向 fileops 传空 root 跳过校验）
func (a *App) MoveModelFile(src, dstDir string) error {
	root := a.findMoveRoot(src, dstDir)
	if root == "" {
		return fmt.Errorf("源与目标必须位于同一仓库根内: %s -> %s", src, dstDir)
	}
	return fileops.MoveModelFile(root, src, dstDir)
}

// CopyModelFile 复制（同 MoveModelFile 修复：findMoveRoot 多根校验，fail-closed）
func (a *App) CopyModelFile(src, dstDir string) error {
	root := a.findMoveRoot(src, dstDir)
	if root == "" {
		return fmt.Errorf("源与目标必须位于同一仓库根内: %s -> %s", src, dstDir)
	}
	return fileops.CopyModelFile(root, src, dstDir)
}

// ImportModelFolder 文件夹型模型整组导入（YSM 解压目录 / MMD 模型目录，保留子目录层级，ADR-038 关联）
// folderName = 仓库文件夹名（模型名）；files = 相对路径 → base64 内容
// rtype 按文件夹内容推断（非硬编码 ysm）：扫主文件扩展名经 ExtBelongsTo 判定，
// 使 MMD 文件夹落到 EntityPlayer 根而非 ysm 根（ADR-092 子类型落位根基）。
func (a *App) ImportModelFolder(folderName, subpath string, files []types.ImportFileItem) error {
	rtype := inferFolderType(files)
	return a.importModelFolderAs(rtype, folderName, subpath, files)
}

// fallbackRepoType 全局兜底类型（默认仓库页上下文同源）：内容推断歧义/未知时的落点；
// 也是「中性页」标记——该页拖入时内容推断优先于上下文（见 ImportModelFolderTo）。
const fallbackRepoType = "ysm"

// ImportModelFolderTo 带页面上下文类型的文件夹整组导入（拖拽导入上下文路由）。
// rtype 来自前端当前树的根属性——树根本就派生自注册表路由配置，前端只透传不判型；
// 上下文优先：注册表校验通过即按该类型仓库根落盘，解决 .zip 多类型歧义文件夹
// 被内容推断兜底进 ysm 根的结构性失灵（maid-model 等仅注册 .zip 的类型永不可达）。
// 空串/未注册类型回退 inferFolderType 内容推断（兼容导入页等无上下文入口）。
// 提醒非阻断：内容明确归属其他单一类型且与上下文不符时记一条 warn 日志，
// 落盘仍按上下文执行——用户拖到哪页就落哪页的根。
// 例外（审核 P3-4）：上下文为默认中性类型时让位内容推断、整条走 ImportModelFolder
// 旧路（含 ysm.json 入口优先级与兜底），最常用入口不静默改数据落点。
func (a *App) ImportModelFolderTo(folderName, subpath, rtype string, files []types.ImportFileItem) error {
	rtype = strings.TrimSpace(rtype)
	if rtype == "" || types.RegistryType(rtype) == nil {
		return a.ImportModelFolder(folderName, subpath, files)
	}
	if mismatch := inferExplicitFolderType(files); mismatch != "" && mismatch != rtype {
		if rtype == fallbackRepoType {
			return a.ImportModelFolder(folderName, subpath, files)
		}
		a.AddOpLog("import", folderName, "", "", 0, "warn",
			fmt.Sprintf("内容特征指向 %s，按当前页面类型 %s 落盘", mismatch, rtype))
	}
	return a.importModelFolderAs(rtype, folderName, subpath, files)
}

// importModelFolderAs 按给定 rtype 解析仓库根并整组写入 + 失效扫描缓存
func (a *App) importModelFolderAs(rtype, folderName, subpath string, files []types.ImportFileItem) error {
	root, _ := a.GetRepoRoot(rtype)
	if root == "" {
		return fmt.Errorf("请先设置文件存储路径")
	}
	if err := fileops.WriteModelFolder(root, subpath, folderName, files); err != nil {
		return err
	}
	scanner.InvalidateCache()
	return nil
}

// inferExplicitFolderType 返回内容明确归属的单一类型；歧义/未知返回空串。
// 与 inferFolderType 的差别：不吞 ysm 兜底——专供「提醒非阻断」场景区分真 ysm 与兜底。
func inferExplicitFolderType(files []types.ImportFileItem) string {
	for _, f := range files {
		rel := filepath.Clean(filepath.FromSlash(strings.TrimSpace(f.RelPath)))
		ext := strings.ToLower(filepath.Ext(rel))
		if ext == ".json" {
			continue // json 不参与明确判定（ysm.json 入口语义属 inferFolderType 职责）
		}
		rtypes := types.ExtBelongsTo(ext)
		if len(rtypes) == 1 {
			return rtypes[0]
		}
	}
	return ""
}

// inferFolderType 从文件夹文件列表推断资源类型：
// 两遍扫描：先扫 ysm.json 入口（YSM 解压目录唯一入口，优先级不依赖 items 顺序——
// 前端收集顺序随 OS 枚举/拖拽序变化，审核 P3-1 修复顺序敏感性），
// 再扫首个「支持文件」（扩展名命中注册表且非 ysm.json 附属）经 ExtBelongsTo 判定，
// 单归属则用该类型；歧义/未知回退 ysm（保持向后兼容）。
// 关键：MMD 文件夹（含 .pmx/.pmd）不再落到 ysm 根。
func inferFolderType(files []types.ImportFileItem) string {
	// 第一遍：ysm.json 是 YSM 解压目录入口，任意位置出现即优先
	for _, f := range files {
		rel := filepath.Clean(filepath.FromSlash(strings.TrimSpace(f.RelPath)))
		if types.IsYsmEntryJSON(filepath.Base(rel)) {
			return fallbackRepoType
		}
	}
	// 第二遍：按首个单归属支持文件判定
	for _, f := range files {
		rel := filepath.Clean(filepath.FromSlash(strings.TrimSpace(f.RelPath)))
		ext := strings.ToLower(filepath.Ext(rel))
		if ext == ".json" {
			continue // 其他 json 不参与类型判定
		}
		rtypes := types.ExtBelongsTo(ext)
		if len(rtypes) == 1 {
			return rtypes[0]
		}
	}
	return fallbackRepoType
}

// ========== 在资源管理器中显示 ==========
func (a *App) RevealInExplorer(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("路径为空")
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", "/select,", filepath.FromSlash(path))
		// 不设 HideWindow：explorer 是 GUI 程序，CREATE_NO_WINDOW 干扰单实例
		// DDE 转发 → 资源管理器打不开/无反应（与 OpenFolder 同源坑，P5 修复）
	case "darwin":
		// macOS: Finder 中选中并显示文件
		cmd = exec.Command("open", "-R", filepath.FromSlash(path))
		executil.HideWindow(cmd)
	case "android":
		// ADR-047 平台守卫：Android 无桌面资源管理器，SAF 打开需要 content:// URI 桥
		// （MikuMikuAR ADR-194 已弃用 SAF），明确返回不支持避免 xdg-open 静默失败
		return errors.New("RevealInExplorer: Android 不支持在资源管理器中显示，请在文件管理器中手动查找")
	default:
		// Linux: 无"选中文件"命令，退化为打开所在目录
		cmd = exec.Command("xdg-open", filepath.Dir(filepath.FromSlash(path)))
		executil.HideWindow(cmd)
	}
	return cmd.Start()
}

// ========== 打开文件夹 ==========
// OpenFolder 在宿主文件管理器中打开目录（explorer/open/xdg-open 平台分支）。
// 与 RevealInExplorer 同源坑：explorer 是 GUI 程序，CREATE_NO_WINDOW 干扰单实例 DDE 转发。
func (a *App) OpenFolder(dir string) error {
	// 统一路径分隔符（Windows explorer 不接受混合斜杠）
	dir = filepath.Clean(dir)
	// 目录存在性检查（v1.5.9 曾加、重构中丢失）：explorer 打开不存在的路径
	// 会静默无反应或弹不可见错误框——前置校验给前端明确错误
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return fmt.Errorf("OpenFolder: 目录不存在: %s", dir)
	}
	// ADR-047 平台守卫：Android 无 xdg-open，SAF 打开需 content:// URI 桥
	// （MikuMikuAR ADR-194 已弃用 SAF），明确返回不支持避免命令静默失败
	if runtime.GOOS == "android" {
		return fmt.Errorf("OpenFolder: Android 不支持打开文件夹，请在文件管理器中手动查找")
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", dir)
		// 不设 HideWindow：explorer 是 GUI 程序（无控制台窗口），
		// CREATE_NO_WINDOW 会干扰其单实例 DDE 转发——文件夹打不开、
		// 表现为应用窗口呆住约 1 秒后无反应（P5 实测坑）
	case "darwin":
		cmd = exec.Command("open", dir)
		executil.HideWindow(cmd)
	default:
		cmd = exec.Command("xdg-open", dir)
		executil.HideWindow(cmd)
	}
	return cmd.Start()
}

// OpenInstanceFolder 按资源类型打开整合包内资源存储目录
//
// 扁平化架构下，统一使用 instanceDir（如 EntityPlayer、config/yes_steve_model/custom）
// 拼 instDir/instanceDir 作为打开目标；目录不存在也不回退（用户手动放错位置由他负责）。
//
// subdir 参数：保留签名为 Wails 绑定兼容，已不参与路由。
func (a *App) OpenInstanceFolder(instDir, rtype, subdir string) error {
	return a.OpenFolder(resolveInstDirTarget(instDir, rtype))
}

// resolveInstDirTarget 推导整合包内资源存储目录（纯函数可测）：
// 仅使用 instanceDir（固定偏移，版本隔离无关）。
// vanilla: instDir/instanceDir；Prism: instDir/instanceDir
// 未知类型返回 instDir。
func resolveInstDirTarget(instDir, rtype string) string {
	rt := types.RegistryType(rtype)
	if rt == nil {
		return instDir
	}
	if rt.InstanceDir != "" {
		return filepath.Join(instDir, rt.InstanceDir)
	}
	return instDir
}

// ========== 启用/禁用 ==========
// ToggleModelEnable 切换 .ban 状态（fileops 纯逻辑 + 薄壳缓存失效）
func (a *App) ToggleModelEnable(path string) (bool, error) {
	enabled, err := fileops.ToggleModelEnable(a.ysmRoot(), path)
	if err == nil {
		scanner.InvalidatePath(filepath.Dir(path))
	}
	return enabled, err
}

func (a *App) IsFileBanned(path string) bool {
	return fileops.IsFileBanned(path)
}

// ========== 统一启用/禁用（兄弟会话裁定：无 rtype，纯路径包含判定）==========
// ToggleEnable 统一启禁入口——root 归属由「哪个已知根包含此路径」判定，而非按
// rtype 路由：前端零类型信息过桥，杜绝「rtype 与实际位置不一致」（文件移动/复制后
// rtype 过期）错根；允许集合与 ToggleResourcePack 同口径（FilesRoot + McRoot +
// CustomRoots 值），内部复用 fileops 的 .disabled 统一机制（新标准，兼容历史 .ban）。
func (a *App) ToggleEnable(path string) (bool, error) {
	root := a.toggleRootFor(path)
	if root == "" {
		return false, fmt.Errorf("拒绝操作仓库外路径: %s", path)
	}
	enabled, err := fileops.ToggleModelEnable(root, path)
	if err == nil {
		scanner.InvalidatePath(filepath.Dir(path))
	}
	return enabled, err
}

// toggleAllowedRoots 收集启禁允许的根集合（与 ToggleResourcePack 同口径：
// FilesRoot + McRoot + CustomRoots 值），并追加 ysmRoot（GetRepoRoot("ysm")），
// 使「对 ysm 仓库子根本身启禁」也落入根守卫（path==root 拒绝）。
func (a *App) toggleAllowedRoots() []string {
	cfg := a.LoadAppConfig()
	roots := []string{cfg.FilesRoot, cfg.McRoot}
	if ysm, _ := a.GetRepoRoot("ysm"); ysm != "" {
		roots = append(roots, ysm)
	}
	if cfg.CustomRoots != nil {
		for _, s := range cfg.CustomRoots {
			if s != "" {
				roots = append(roots, s)
			}
		}
	}
	return roots
}

// toggleRootFor 返回 path 所在的启禁合法根：取「最具体（最深）匹配根」——
// 路径同时落在 FilesRoot 与 ysmRoot 内时选 ysmRoot，使子仓库内文件走更严的
// 子根守卫、path==子根时正确拒绝；不在任何根内返回空 = 拒绝。
func (a *App) toggleRootFor(path string) string {
	best := ""
	for _, root := range a.toggleAllowedRoots() {
		if root == "" {
			continue
		}
		if paths.IsInsideResolved(root, path) != nil {
			continue
		}
		if best == "" || len(root) > len(best) {
			best = root
		}
	}
	return best
}
