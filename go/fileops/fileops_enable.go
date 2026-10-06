// ===== 启用/禁用（ADR-040 拆分自 fileops.go）=====
// 从 internal/app/app_files.go 下沉：.disabled 状态文件切换（文件级 + 目录级整组禁用）。
// 新标准用 .disabled（MC 生态通用），历史 .ban 数据仍可识别（StripDisableSuffix 兼容）。
// 纯 Go 逻辑，无 Wails runtime 依赖；root 参数由薄壳注入（原 a.ysmRoot()）。
// 与原文件同包：opMu 定义在 fileops.go，此处写类操作同样加锁（TOCTOU 串行化）。
package fileops

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/types/registry"
)

// disableSuffix 禁用方向写入的新标准后缀（MC 生态统一用 .disabled）
const disableSuffix = ".disabled"

// ========== 启用/禁用 ==========

// ToggleModelEnable 切换禁用状态文件（返回是否处于启用态；缓存失效由薄壳处理）
// ADR-038 D3.7：src 为 ysm.json 时提升为父目录级 .disabled——文件夹模型整组禁用，
// 目录重命名为 `父目录.disabled`，几何/动画/语言资源随目录一起被隔离。
// root 为资源仓库根（可选，空则跳过守卫）：防止根级 ysm.json 把整个仓库根重命名成 .disabled。
func ToggleModelEnable(root, path string) (bool, error) {
	opMu.Lock()
	defer opMu.Unlock()
	path = strings.TrimSpace(path)
	if path == "" {
		return false, fmt.Errorf("参数为空")
	}
	if err := checkToggleWithinRoot(root, path); err != nil {
		return false, err
	}
	// 目录级禁用识别（与 IsFileBanned 对称）：父目录名以 .disabled/.ban 结尾 = 整组禁用态。
	// 启用方向：还原父目录名（去禁用后缀）；禁用方向：目录已在禁用态内，幂等返回。
	if registry.IsDisableSuffix(filepath.Base(filepath.Dir(path))) {
		return enableBannedParentDirGroup(root, path)
	}
	lifted, err := liftYsmToggleTarget(root, path)
	if err != nil {
		return false, err
	}
	return applyDisableToggle(lifted)
}

// checkToggleWithinRoot 校验 path 严格位于 root 内部（空 root 跳过整条守卫）。
// path 等于仓库根本身时拒绝——原 root 守卫仅覆盖 ysm.json
// 提升分支，非 ysm.json 输入（普通文件/目录禁用段 os.Rename(path, path+disableSuffix)）无守卫，
// path==root 时整个仓库根被改名成 ysm.disabled 隔离（与 MoveToRecycle/DeleteModelFile 根拒绝对齐）。
// ① Abs 错误必须传播（对齐 DeleteModelFile 的 return err 模式——
// 原 if err==nil 静默跳过守卫 = fail-open，Abs 失败时根保护静默丢失）；
// ② 比较用 EqualFold 大小写不敏感（对齐 paths.IsInside 的 Windows 语义，防大小写绕过）
func checkToggleWithinRoot(root, path string) error {
	if root == "" {
		return nil
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	// 从「仅拒绝等于根」升级为「严格内部包含」判定——
	// 原 EqualFold 只防 path==root，仓库外路径（如 C:\Windows\...\x）可被改名 .disabled
	if strings.EqualFold(filepath.Clean(absPath), filepath.Clean(absRoot)) {
		return fmt.Errorf("不能对资源根目录执行启用/禁用操作")
	}
	rel, err := filepath.Rel(absRoot, absPath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("拒绝操作仓库外路径: %s", path)
	}
	return nil
}

// enableBannedParentDirGroup 处理「父目录名带禁用后缀」的整组启用（与 IsFileBanned 对称）。
// 返回 true 表示已处于启用态（父目录已在禁用态内时不做任何改名）。
func enableBannedParentDirGroup(root, path string) (bool, error) {
	bannedParent := filepath.Dir(path)
	// 根目录自身以禁用后缀结尾时禁止整组操作（防静默改名仓库根）
	if root != "" {
		absRoot, err := filepath.Abs(root)
		if err != nil {
			return false, err
		}
		if strings.EqualFold(filepath.Clean(bannedParent), filepath.Clean(absRoot)) {
			return false, fmt.Errorf("不能对资源根目录执行启用/禁用操作")
		}
	}
	var err error
	if registry.IsDisableSuffix(path) {
		// 文件自身也带禁用后缀（旧状态残留）→ 父目录与文件名两段式还原
		err = enableBannedParentDirAndFile(path, bannedParent)
	} else {
		err = enableBannedParentDir(bannedParent)
	}
	if err != nil {
		return false, err
	}
	return true, nil // 整组启用
}

// enableBannedParentDir 还原父目录名（去禁用后缀）——整组启用的决定性与唯一一步。
// 目标已存在时先行拒绝，防 os.Rename 静默覆盖同名目录。
func enableBannedParentDir(bannedParent string) error {
	// 大小写不敏感去禁用后缀（Windows 上 .DISABLED 目录也能还原）
	dirNew := registry.StripDisableSuffix(bannedParent)
	if _, err := os.Lstat(dirNew); err == nil {
		return fmt.Errorf("目标已存在: %s", dirNew)
	}
	return os.Rename(bannedParent, dirNew)
}

// enableBannedParentDirAndFile 旧状态残留（父目录与文件自身都带禁用后缀）的两段式还原。
// P3-1：先 Rename 父目录（决定性步骤），再 Rename 文件名。
// 旧顺序先 Rename 文件名再 Rename 父目录，若第二步失败，
// 文件名已去后缀但父目录仍禁用，产生「半启用」不一致态。
func enableBannedParentDirAndFile(path, bannedParent string) error {
	fileNew := registry.StripDisableSuffix(path)
	// 存在性检查对照旧父目录下 fileNew——两段式 Rename（先父目录后文件）
	// 会把旧父目录内的同名文件随父目录一起带到落点，检查旧路径恰好预判该冲突
	// （TestToggleModelEnable_DirBanFileNewExists 锁定：误改检查路径致冲突漏检）
	if _, err := os.Lstat(fileNew); err == nil {
		return fmt.Errorf("目标已存在: %s", fileNew)
	}
	// 大小写不敏感去禁用后缀（Windows 上 .DISABLED 目录也能还原）
	dirNew := registry.StripDisableSuffix(bannedParent)
	if _, err := os.Lstat(dirNew); err == nil {
		return fmt.Errorf("目标已存在: %s", dirNew)
	}
	// 先还原父目录（整组启用）
	if err := os.Rename(bannedParent, dirNew); err != nil {
		return err
	}
	// 再还原文件名（此时 path 仍指向旧 bannedParent 下的文件，
	// 但 bannedParent 已被 Rename 为 dirNew，path 实际路径已变）
	// path 是基于 bannedParent 的绝对路径，Rename 后需用 dirNew 下的新路径
	newFileInDir := filepath.Join(dirNew, filepath.Base(fileNew))
	return os.Rename(filepath.Join(dirNew, filepath.Base(path)), newFileInDir)
}

// liftYsmToggleTarget ysm.json 是模型目录清单：禁用后缀作用于整个模型目录（整组语义）。
// 目录提升守卫：父目录必须严格深于仓库根（防根级 ysm.json 重命名仓库根），
// 根级 ysm.json 回退到文件级禁用（不整组提升）。非 ysm.json 输入原样返回。
func liftYsmToggleTarget(root, path string) (string, error) {
	if !registry.IsYsmEntryJSON(filepath.Base(path)) {
		return path, nil
	}
	parent := filepath.Dir(path)
	if root == "" {
		return parent, nil
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	absParent, err := filepath.Abs(parent)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(absRoot, absParent)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		// 根级 ysm.json：回退到文件级禁用（不整组提升）
		return parent + string(filepath.Separator) + filepath.Base(path), nil
	}
	return parent, nil
}

// applyDisableToggle 对已解析的目标 path 执行启用（去禁用后缀还原）或禁用（写 .disabled）。
// 目标已存在时先行拒绝，防 os.Rename 静默覆盖既有模型。
func applyDisableToggle(path string) (bool, error) {
	if registry.IsDisableSuffix(path) {
		// 委托 registry.StripDisableSuffix（单一事实来源），不内联切片防口径漂移。
		newPath := registry.StripDisableSuffix(path)
		if _, err := os.Lstat(newPath); err == nil {
			return false, fmt.Errorf("目标已存在: %s", newPath)
		}
		if err := os.Rename(path, newPath); err != nil {
			return false, err
		}
		return true, nil // 启用
	}
	// 禁用（写入新标准 .disabled）
	newPath := path + disableSuffix
	if _, err := os.Lstat(newPath); err == nil {
		return false, fmt.Errorf("目标文件已存在: %s", newPath)
	}
	if err := os.Rename(path, newPath); err != nil {
		return false, err
	}
	return false, nil // 已禁用
}

// IsFileBanned 判断路径是否被禁用标记（文件级或目录级，ADR-038 D3.7）
// 支持新标准 .disabled 和历史 .ban。
func IsFileBanned(path string) bool {
	path = strings.TrimSpace(path)
	if path == "" {
		return false
	}
	if registry.IsDisableSuffix(path) {
		return true
	}
	// 目录级禁用：父目录名以 .disabled/.ban 结尾（文件夹模型整组禁用）
	parent := filepath.Base(filepath.Dir(path))
	return registry.IsDisableSuffix(parent)
}
