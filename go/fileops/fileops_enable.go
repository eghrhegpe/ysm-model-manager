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

	"ysm-model-manager/go/types"
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
	// path 等于仓库根本身时拒绝——原 root 守卫仅覆盖 ysm.json
	// 提升分支，非 ysm.json 输入（普通文件/目录禁用段 os.Rename(path, path+disableSuffix)）无守卫，
	// path==root 时整个仓库根被改名成 ysm.disabled 隔离（与 MoveToRecycle/DeleteModelFile 根拒绝对齐）。
	// ① Abs 错误必须传播（对齐 DeleteModelFile 的 return err 模式——
	// 原 if err==nil 静默跳过守卫 = fail-open，Abs 失败时根保护静默丢失）；
	// ② 比较用 EqualFold 大小写不敏感（对齐 paths.IsInside 的 Windows 语义，防大小写绕过）
	if root != "" {
		absRoot, err := filepath.Abs(root)
		if err != nil {
			return false, err
		}
		absPath, err := filepath.Abs(path)
		if err != nil {
			return false, err
		}
		// 从「仅拒绝等于根」升级为「严格内部包含」判定——
		// 原 EqualFold 只防 path==root，仓库外路径（如 C:\Windows\...\x）可被改名 .disabled
		if strings.EqualFold(filepath.Clean(absPath), filepath.Clean(absRoot)) {
			return false, fmt.Errorf("不能对资源根目录执行启用/禁用操作")
		}
		rel, err := filepath.Rel(absRoot, absPath)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return false, fmt.Errorf("拒绝操作仓库外路径: %s", path)
		}
	}
	// 目录级禁用识别（与 IsFileBanned 对称）：父目录名以 .disabled/.ban 结尾 = 整组禁用态。
	// 启用方向：还原父目录名（去禁用后缀）；禁用方向：目录已在禁用态内，幂等返回。
	parentBase := filepath.Base(filepath.Dir(path))
	if types.IsDisableSuffix(parentBase) {
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
		if types.IsDisableSuffix(path) {
			// 文件自身也带禁用后缀（旧状态残留）：优先还原父目录再还原文件
			fileNew := types.StripDisableSuffix(path)
			if _, err := os.Lstat(fileNew); err == nil {
				return false, fmt.Errorf("目标已存在: %s", fileNew)
			}
			if err := os.Rename(path, fileNew); err != nil {
				return false, err
			}
		}
		// 大小写不敏感去禁用后缀（Windows 上 .DISABLED 目录也能还原）
		dirNew := types.StripDisableSuffix(bannedParent)
		if _, err := os.Lstat(dirNew); err == nil {
			return false, fmt.Errorf("目标已存在: %s", dirNew)
		}
		if err := os.Rename(bannedParent, dirNew); err != nil {
			return false, err
		}
		return true, nil // 整组启用
	}
	// ysm.json 是模型目录清单：禁用后缀作用于整个模型目录（整组语义）
	if types.IsYsmEntryJSON(filepath.Base(path)) {
		parent := filepath.Dir(path)
		// 目录提升守卫：父目录必须严格深于仓库根（防根级 ysm.json 重命名仓库根）
		if root != "" {
			absRoot, err := filepath.Abs(root)
			if err != nil {
				return false, err
			}
			absParent, err := filepath.Abs(parent)
			if err != nil {
				return false, err
			}
			rel, err := filepath.Rel(absRoot, absParent)
			if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				// 根级 ysm.json：回退到文件级禁用（不整组提升）
				path = parent + string(filepath.Separator) + filepath.Base(path)
			} else {
				path = parent
			}
		} else {
			path = filepath.Dir(path)
		}
	}
	if types.IsDisableSuffix(path) {
		// 委托 types.StripDisableSuffix（单一事实来源），不内联切片防口径漂移。
		newPath := types.StripDisableSuffix(path)
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
	if types.IsDisableSuffix(path) {
		return true
	}
	// 目录级禁用：父目录名以 .disabled/.ban 结尾（文件夹模型整组禁用）
	parent := filepath.Base(filepath.Dir(path))
	return types.IsDisableSuffix(parent)
}
