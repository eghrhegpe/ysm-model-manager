package paths

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

// ===== 哨兵错误（Trap #11 修复）=====
// 错误分类统一走 sentinel + errors.Is/As，禁止调用方用
// strings.Contains(err.Error(), ...) 文本匹配分类——文案可读性变更或国际化
// 都会静默破坏文本匹配，而 sentinel 是稳定的程序化契约。
var (
	// ErrEmptyPath 路径为空（filepath.Abs("") 返回 CWD，必须显式拒绝）
	ErrEmptyPath = errors.New("paths: 路径为空")
	// ErrNULByte 路径或基准目录含 NUL 字节（Linux Abs 静默截断可绕过前缀检查）
	ErrNULByte = errors.New("paths: 路径含 NUL 字节")
	// ErrEmptyBase 基准目录为空
	ErrEmptyBase = errors.New("paths: 基准目录为空")
	// ErrNotInside 路径不在基准目录内（../ 越权、大小写/前缀不匹配）
	ErrNotInside = errors.New("paths: 路径不在基准目录内")
	// ErrResolveBase 无法解析基准路径（filepath.Abs 失败）
	ErrResolveBase = errors.New("paths: 无法解析基准路径")
	// ErrResolvePath 无法解析目标路径（filepath.Abs 失败）
	ErrResolvePath = errors.New("paths: 无法解析目标路径")
	// ErrRelFailed 计算相对路径失败（如 Windows 跨驱动器）
	ErrRelFailed = errors.New("paths: 计算相对路径失败")
)

// ErrPathEscalation 路径越权错误
type ErrPathEscalation struct {
	Path    string
	BaseDir string
	Reason  string
	// cause 分类哨兵，供 errors.Is/As 程序化分类
	cause error
}

func (e *ErrPathEscalation) Error() string {
	return fmt.Sprintf("路径越权: %s 不在 %s 目录下 (%s)", e.Path, e.BaseDir, e.Reason)
}

// Unwrap 暴露分类哨兵：errors.Is(err, ErrNotInside) 等可直接判断，
// 无需文本匹配错误文案。
func (e *ErrPathEscalation) Unwrap() error { return e.cause }

// IsInside 检查 path 是否在 baseDir 下，防止路径遍历。
// 注意：本函数不追踪符号链接。若 baseDir 或 path 中包含指向外部目录的符号链接，
// 可能错误地判定为安全。调用方应在必要时先用 filepath.EvalSymlinks 解析。
func IsInside(baseDir, path string) error {
	// BUG-2 修复：空路径无意义——filepath.Abs("") 返回 CWD，
	// 若 CWD 恰等于 baseDir 会误判通过，必须显式拒绝。
	if path == "" {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "空路径无意义", cause: ErrEmptyPath}
	}
	// BUG-5 修复：NUL 字节注入——Linux filepath.Abs 会静默截断 NUL 后内容
	// （如 "normal\x00../../etc" → "normal"），绕过后续 prefix 检查。
	// Windows filepath.Abs 虽然会报错，但报错类型不可控（err != ErrPathEscalation），
	// 且在 Clean 后可能漏过。主动拒绝，跨平台一致。
	if strings.Contains(path, "\x00") {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "路径含 NUL 字节", cause: ErrNULByte}
	}
	if baseDir == "" {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "空基准目录无意义", cause: ErrEmptyBase}
	}
	if strings.Contains(baseDir, "\x00") {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "基准路径含 NUL 字节", cause: ErrNULByte}
	}
	absBase, err := filepath.Abs(filepath.Clean(baseDir))
	if err != nil {
		return &ErrPathEscalation{
			Path: path, BaseDir: baseDir, Reason: "无法解析基准路径: " + err.Error(),
			// 注意：只用一个 %w（ErrResolveBase），底层 err 用 %v 格式化。
			// 双 %w 会创建多错误包装（Unwrap() []error），errors.Unwrap() 返回 nil，
			// 破坏 Unwrap 链（TestIsInside_RelFailureSentinel_Windows）。
			cause: fmt.Errorf("%w: %v", ErrResolveBase, err),
		}
	}
	absPath, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return &ErrPathEscalation{
			Path: path, BaseDir: baseDir, Reason: "无法解析目标路径: " + err.Error(),
			cause: fmt.Errorf("%w: %v", ErrResolvePath, err),
		}
	}

	rel, err := filepath.Rel(absBase, absPath)
	if err != nil {
		return &ErrPathEscalation{
			Path: path, BaseDir: baseDir, Reason: "计算相对路径失败: " + err.Error(),
			cause: fmt.Errorf("%w: %v", ErrRelFailed, err),
		}
	}
	// `rel == ".."` 或 `rel` 以 `..` + 分隔符开头才算越权——
	// 裸 `strings.HasPrefix(rel, "..")` 会把 base 下合法子目录名 `..foo` 误判为越权（false positive）
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "路径不在基准目录内", cause: ErrNotInside}
	}
	// 大小写不敏感检查（Windows 路径不区分大小写）
	basePrefix := strings.ToLower(absBase) + string(filepath.Separator)
	if !strings.EqualFold(absPath, absBase) && !strings.HasPrefix(strings.ToLower(absPath), basePrefix) {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "路径不在基准目录内", cause: ErrNotInside}
	}
	return nil
}

// IsInsideResolved 解析符号链接后再判定 path 是否在 baseDir 下（BUG-1 修复）。
// 与纯词法 IsInside 的差异：当 baseDir 或 path 含指向外部的 symlink 段时，
// 真实落点越出 baseDir —— 会被本函数按 ErrNotInside 拒绝，而 IsInside 会误判安全。
// 语义对齐 installer.validateInstallPaths 的「EvalSymlinks 两侧 → 再 IsInside」模式：
// 先词法快速失败（空/NUL/越权直接返回，零 I/O），词法通过的才解析真实路径二次复核；
// EvalSymlinks 失败（路径不存在/断链）时保留原路径不放宽不放窄——不存在的路径
// 无越权读取面，且未创建写入目标的中段 symlink 由 fileops.checkNoSymlinkInPath /
// installer.checkDstSymlinkSegments 逐段 Lstat 覆盖，不在此重复。
func IsInsideResolved(baseDir, path string) error {
	if err := IsInside(baseDir, path); err != nil {
		return err
	}
	return IsInside(resolveOrKeep(baseDir), resolveOrKeep(path))
}

// resolveOrKeep 解析路径符号链接为真实路径；失败（不存在/断链等）保留原路径。
// 与 installer.evalSymlinksOrKeep 同语义（存在解析到目标、不存在保留原样）。
func resolveOrKeep(p string) string {
	if resolved, err := filepath.EvalSymlinks(p); err == nil {
		return resolved
	}
	return p
}

// ResolveOrKeep 是 resolveOrKeep 的导出形式，供调用方缓存复用 baseDir 的解析结果
// （扫描热路径优化：baseDir 来自配置极少变化，每次重算 EvalSymlinks 是主要重复开销；
// path 侧仍应每次实时解析，保留对路径中途 symlink 的复核语义）。
func ResolveOrKeep(p string) string {
	return resolveOrKeep(p)
}

// HasTraversal 检查路径片段是否包含 ".." 遍历组件（统一入口）。
// 覆盖场景：纯文件名（importer）、目录名（fileops）、子路径（folder_import）。
// 跨平台：同时检查 / 和 \\，防止未 Clean 的原始输入绕过。
//
// 调用方不再各自手写 strings.Contains("../") 等检查——5 种写法收敛为 1 个入口。
func HasTraversal(p string) bool {
	if p == "" || p == ".." {
		return p == ".."
	}
	// 前缀: "../" 或 "..\\"
	if strings.HasPrefix(p, "../") || strings.HasPrefix(p, "..\\") {
		return true
	}
	// 后缀: "/.." 或 "\\.."
	if strings.HasSuffix(p, "/..") || strings.HasSuffix(p, "\\..") {
		return true
	}
	// 中间段: "/../" 或 "\\..\\"
	if strings.Contains(p, "/../") || strings.Contains(p, "\\..\\") {
		return true
	}
	return false
}

// ContainsMinecraftMarker 检查路径中是否包含 .minecraft 或 minecraft 标记
// PrismLauncher 实例目录下可能是 minecraft（无点），与 .minecraft 等价
// 注意：不解析符号链接，调用方需自行处理
func ContainsMinecraftMarker(path string) bool {
	cleaned := filepath.Clean(path)
	lower := strings.ToLower(cleaned)
	sep := strings.ToLower(string(filepath.Separator))
	for _, marker := range []string{".minecraft", "minecraft"} {
		// 相对路径首段 / 单段漏检——原只查 `sep+marker+sep`（中间段）与
		// `sep+marker` 后缀，`minecraft/mods`、`".minecraft/mods"`（无前导分隔符的首段）
		// 与单个 `minecraft` 段均不匹配，PrismLauncher 布局 `minecraft/mods` 会漏判
		if lower == marker || strings.HasPrefix(lower, marker+sep) {
			return true
		}
		mcMarker := sep + marker + sep
		if strings.Contains(lower, mcMarker) {
			return true
		}
		if strings.HasSuffix(lower, sep+marker) {
			return true
		}
	}
	return false
}
