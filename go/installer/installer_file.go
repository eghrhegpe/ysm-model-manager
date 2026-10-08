// installer_file.go：文件安装与错误映射（原 installer.go 拆分，2026-10 文件行数治理）。
// InstallToGlobal / CopyFile / CopyFileLocked / LinkOrCopy / SymlinkOrCopy / mapStepToAppError——
// 单文件安装到全局/仓库目录，含 link/symlink 跨分区降级与 errno 分类。
package installer

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

func InstallToGlobal(src, mcRoot string) (string, error) {
	InstallLocker.Lock()
	defer InstallLocker.Unlock()

	if src == "" || mcRoot == "" {
		return "", types.AppError{Code: types.ErrInvalidParam, Operation: "安装到全局", Reason: "参数为空", Suggestion: "请检查输入"}
	}
	mcRoot = cleanAbs(mcRoot)
	if !paths.ContainsMinecraftMarker(mcRoot) {
		return "", types.AppError{Code: types.ErrInvalidPath, Operation: "安装到全局", SourcePath: mcRoot, Reason: "目标不在 .minecraft 路径内", Suggestion: "请确保 .minecraft 目录路径正确"}
	}
	src = cleanAbs(src)
	if !isSupportedModelExt(src) {
		return "", types.AppError{Code: types.ErrUnsupportedFmt, Operation: "安装到全局", SourcePath: src, Reason: "不支持的文件类型", Suggestion: "支持格式: " + strings.Join(registry.AllExts(), " / ")}
	}
	// 固定布局约定：YSM mod 的全局模型目录固定在 config/yes_steve_model/custom（mod 加载约定），
	// 非用户可配置项；多实例根场景由上层传入具体 mcRoot，此处仅拼接布局。
	// ADR-064 锚定：路径走注册表 SubDirMap（原硬编码，YSM scanDir 变更时失联）
	customDir := filepath.Join(mcRoot, registry.SubDirMap("ysm"))
	if err := os.MkdirAll(customDir, fsutil.DirPerms); err != nil {
		return "", types.AppError{Code: types.ErrIO, Operation: "安装到全局", TargetPath: customDir, Reason: "无法创建安装目录", Suggestion: "请检查磁盘权限或空间"}
	}
	return CopyFileLocked(src, customDir)
}

// CopyFileLocked 复制文件到目标目录（调用方须已持有 InstallLock，禁止直接调用）。
// 委托 fsutil.CopyFile（ADR-044 收敛：原子 tmp+rename + Sync + Chmod 0644 +
// 目录源前置拒绝 + 读毕早关 src），复用其步骤类型化错误 StepError，把差异化
// UI 文案留在本层 mapStepToAppError——机制归 fsutil、文案归 installer，职责分层不破。
func CopyFileLocked(src, dstDir string) (string, error) {
	src = cleanAbs(src)
	dstDir = cleanAbs(dstDir)
	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
		return "", err
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	if src == dst {
		return dst, nil
	}
	if err := fsutil.CopyFile(src, dst); err != nil {
		var se *fsutil.StepError
		if errors.As(err, &se) {
			return "", mapStepToAppError(se.Step, src, dst, se.Err)
		}
		// 非 StepError（正常不会发生，防御兜底）
		return "", types.AppError{Code: types.ErrIO, Operation: "复制文件", SourcePath: src, TargetPath: dst, Reason: "复制文件失败", Suggestion: "请重试或检查磁盘状态"}
	}
	return dst, nil
}

// mapStepToAppError 将 fsutil.StepError 的中性步骤名映射为 installer 的差异化
// AppError 文案（与收敛前 CopyFileLocked 六档逐字一致，回归护栏见 TestMapStepToAppError）。
// 纯函数表：只读输入 → 只出输出，不含任何 IO。
func mapStepToAppError(step, src, dst string, err error) types.AppError {
	base := types.AppError{Code: types.ErrIO, Operation: "复制文件", SourcePath: src, TargetPath: dst}
	switch step {
	case fsutil.StepStat, fsutil.StepOpen:
		base.Reason, base.Suggestion = "无法读取源文件", "请检查文件是否被占用或已删除"
	case fsutil.StepCloseSrc:
		base.Reason, base.Suggestion = "源文件读取未正常完成", "请检查文件访问权限"
	case fsutil.StepMkdir:
		base.Reason, base.Suggestion = "无法创建目录", "请检查磁盘权限或空间"
	case fsutil.StepCreateTmp:
		base.Reason, base.Suggestion = "无法创建临时文件", "请检查磁盘空间或权限"
	case fsutil.StepCopy:
		base.Reason, base.Suggestion = "写入临时文件失败", "请检查磁盘空间或权限"
	case fsutil.StepSync:
		base.Reason, base.Suggestion = "临时文件落盘失败", "请检查磁盘空间或权限"
	case fsutil.StepClose:
		base.Reason, base.Suggestion = "临时文件写入未完成", "请检查磁盘空间或权限"
	case fsutil.StepChmod:
		base.Reason, base.Suggestion = "设置文件权限失败", "请检查目标位置权限"
	case fsutil.StepRename:
		base.Operation = "安装模型"
		base.Reason, base.Suggestion = "替换目标文件失败", "请检查目标文件是否被占用或为只读"
	default:
		base.Reason, base.Suggestion = "复制文件失败", "请重试或检查磁盘状态"
	}
	return base
}

// replaceTmpErr 处理「tmp 原子替换到 dst」失败的统一收口：清掉残留 tmp 并返回
// 逐字一致的「替换目标文件失败」AppError。
// LinkOrCopyLocked 与 SymlinkOrCopyLocked 末尾原本复制同款 os.Rename 错误块，
// jscpd 记为新增重复对；收口到此处消除。Windows 下目标被占用会 ERROR_SHARING_VIOLATION
// （见 go/AGENTS.md 坑点），故先 _ = os.Remove(tmp) 再报错，避免残留临时文件。
func replaceTmpErr(tmp, dst, src string, err error) error {
	_ = os.Remove(tmp)
	return types.AppError{Code: types.ErrIO, Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "替换目标文件失败", Suggestion: "请检查目标文件是否被占用或为只读"}
}

// CopyFile 复制文件到目标目录（带互斥锁）
func CopyFile(src, dstDir string) (string, error) {
	InstallLocker.Lock()
	defer InstallLocker.Unlock()
	return CopyFileLocked(src, dstDir)
}

// LinkOrCopyLocked 以硬链接落地 src 到 dstDir（调用方须持有 InstallLock，禁止直接调用）；
// 目标已存在时：
//   - 同源（已是到 src 的硬链接）→ 幂等返回
//   - 不同源（旧副本/旧版本）→ 先建临时链接再原子替换，失败不破坏原文件
func LinkOrCopyLocked(src, dstDir string) error {
	src = cleanAbs(src)
	dstDir = cleanAbs(dstDir)
	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
		return err
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	// hardlink 模式：wantSymlink=false——目标若是指向 src 的符号链接则视为不同源，强制转硬链接
	if same, err := sameSource(src, dst, false); err == nil && same {
		return nil
	}
	tmp := dst + ".link-tmp"
	_ = os.Remove(tmp)
	if err := os.Link(src, tmp); err != nil {
		return linkErr(src, dst, err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		return replaceTmpErr(tmp, dst, src, err)
	}
	return nil
}

// linkOrCopy 以硬链接落地 src 到 dstDir（带互斥锁）
func linkOrCopy(src, dstDir string) error {
	InstallLocker.Lock()
	defer InstallLocker.Unlock()
	return LinkOrCopyLocked(src, dstDir)
}

// SymlinkOrCopyLocked 以符号链接落地 src 到 dstDir（调用方须持有 InstallLock，禁止直接调用）；
// 目标已存在时与 LinkOrCopyLocked 同语义
func SymlinkOrCopyLocked(src, dstDir string) error {
	src = cleanAbs(src)
	dstDir = cleanAbs(dstDir)
	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
		return err
	}
	// os.Symlink 不要求目标存在，src 缺失时会创建悬空链接并静默返回 nil——
	// 先显式校验 src 存在，缺失时报错而非留下悬空链接
	if _, err := os.Stat(src); err != nil {
		return types.AppError{Code: types.ErrIO, Operation: "创建符号链接",
			SourcePath: src, Reason: "源文件不存在", Suggestion: "请检查模型文件是否已被删除"}
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	// symlink 模式：wantSymlink=true——目标若是硬链接则视为不同源，强制转符号链接
	if same, err := sameSource(src, dst, true); err == nil && same {
		return nil
	}
	tmp := dst + ".symlink-tmp"
	_ = os.Remove(tmp)
	if err := os.Symlink(src, tmp); err != nil {
		return symlinkErr(src, dst, err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		return replaceTmpErr(tmp, dst, src, err)
	}
	return nil
}

// symlinkOrCopy 以符号链接落地 src 到 dstDir（带互斥锁）
func symlinkOrCopy(src, dstDir string) error {
	InstallLocker.Lock()
	defer InstallLocker.Unlock()
	return SymlinkOrCopyLocked(src, dstDir)
}

// sameSource 判断 dst 是否已是 src 的有效落地点（同一文件 / 指向 src 的链接）。
// wantSymlink：hardlink 模式传 false（要求 dst 非符号链接）、symlink 模式传 true
// （要求 dst 是符号链接）：原实现只用 os.Stat+SameFile，对「dst 是指向 src 的 symlink」与「dst 是 src 的 hardlink」无法区分，
// hardlink 模式遇 symlink 静默放行不转换、symlink 模式遇 hardlink 也放行，linkMode 语义不落地。
// 不存在、断链或内容不同的旧副本均返回 false 语义（err != nil 或 !same）
func sameSource(src, dst string, wantSymlink bool) (bool, error) {
	dstInfo, err := os.Lstat(dst)
	if err != nil {
		return false, err
	}
	// 链接类型匹配：hardlink 模式拒绝符号链接目标（需转为硬链接）、
	// symlink 模式要求目标是符号链接（硬链接需转为符号链接）
	if wantSymlink != (dstInfo.Mode()&os.ModeSymlink != 0) {
		return false, nil
	}
	si, err := os.Stat(src)
	if err != nil {
		return false, err
	}
	di, err := os.Stat(dst)
	if err != nil {
		return false, err
	}
	return os.SameFile(si, di), nil
}

// errnoIs 按平台匹配 errno：Windows 用 Win32 错误码（如 ERROR_NOT_SAME_DEVICE=17），
// Unix 用 POSIX errno（如 EXDEV=18）——两端语义不同，必须分平台判断
func errnoIs(err error, unix, win int) bool {
	if runtime.GOOS == "windows" {
		return errors.Is(err, syscall.Errno(win))
	}
	return errors.Is(err, syscall.Errno(unix))
}

// linkErr 将硬链接错误分类为可操作的提示
func linkErr(src, dst string, err error) error {
	// errno 优先：跨设备（Unix EXDEV=18 / Win ERROR_NOT_SAME_DEVICE=17）、
	// 权限（Unix EACCES=13 / EPERM=1，Win ERROR_ACCESS_DENIED=5）
	if fsutil.IsCrossDeviceErr(err) {
		return types.AppError{Code: types.ErrLinkFailed, Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "仓库与游戏目录在不同分区，不支持硬链接", Suggestion: "请在设置中切换为复制模式"}
	}
	if errnoIs(err, 13, 5) || errnoIs(err, 1, 5) {
		return types.AppError{Code: types.ErrLinkFailed, Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "权限不足，无法创建硬链接", Suggestion: "请以管理员身份运行，或在设置中切换为复制模式"}
	}
	// errno 未命中的异常错误直落通用提示（文本兜底已删——陷阱 #11 禁止文本匹配错误分类；
	// errors.Is 可链式穿透 LinkError/PathError，errno 判定已覆盖主路径）
	return types.AppError{Code: types.ErrLinkFailed, Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "硬链接失败", Suggestion: "请在设置中切换为复制模式"}
}

// symlinkErr 将符号链接错误分类为可操作的提示
func symlinkErr(src, dst string, err error) error {
	// errno 优先：权限（Unix EPERM=1 / EACCES=13，Win ERROR_PRIVILEGE_NOT_HELD=1314 / ERROR_ACCESS_DENIED=5）
	if errnoIs(err, 1, 1314) || errnoIs(err, 13, 5) {
		return types.AppError{Code: types.ErrLinkFailed, Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "创建符号链接需要管理员权限", Suggestion: "请以管理员身份运行，或在设置中切换为复制模式"}
	}
	// 文本兜底已删（陷阱 #11），errno 未命中直落通用提示
	return types.AppError{Code: types.ErrLinkFailed, Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "符号链接失败", Suggestion: "请在设置中切换为复制模式"}
}

// IsValidRepoRoot 禁止选择系统敏感目录作为仓库
// 跨平台实现：禁止根目录、系统关键目录
func IsValidRepoRoot(path string) bool {
	abs, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return false
	}

	// 禁止任何盘符根目录（Windows）和根目录 /
	for _, root := range []string{"/", "\\"} {
		if abs == root || strings.TrimRight(abs, "\\/") == "" {
			return false
		}
	}
	// Windows 盘符根目录（C:\ D:\ 等）
	if len(abs) >= 3 && abs[1] == ':' && (abs[2] == '\\' || abs[2] == '/') && len(abs) == 3 {
		return false
	}

	// 系统关键目录（按平台）
	absLower := strings.ToLower(abs) + string(filepath.Separator)
	var forbidden []string
	if runtime.GOOS == "windows" {
		// Windows 系统目录——按目标所在盘符动态拼前缀（VolumeName），而非枚举 c:/d:/e:
		// （原枚举漏掉 F: 等盘上的 windows/program files）
		vol := strings.ToLower(filepath.VolumeName(abs))
		if vol != "" {
			prefix := vol + string(filepath.Separator)
			forbidden = append(forbidden,
				prefix+"windows"+string(filepath.Separator),
				prefix+"program files"+string(filepath.Separator),
				prefix+"program files (x86)"+string(filepath.Separator),
			)
		}
	} else {
		// Linux/macOS 系统目录
		forbidden = []string{
			"/etc" + string(filepath.Separator),
			"/usr" + string(filepath.Separator),
			"/bin" + string(filepath.Separator),
			"/sbin" + string(filepath.Separator),
			"/var" + string(filepath.Separator),
			"/dev" + string(filepath.Separator),
			"/proc" + string(filepath.Separator),
			"/sys" + string(filepath.Separator),
			"/System" + string(filepath.Separator),
			"/private" + string(filepath.Separator),
		}
	}

	for _, f := range forbidden {
		if strings.HasPrefix(absLower, f) || strings.EqualFold(abs, strings.TrimRight(f, string(filepath.Separator))) {
			return false
		}
	}

	return true
}
