// ===== 文件操作核心（CRUD + 移动/复制/删除，ADR-003 P3 Logic Sinking）=====
// 从 internal/app/app_files.go 下沉：文件 CRUD、预览图/纹理提取、包信息、启用/禁用。
// 纯 Go 逻辑，无 Wails runtime 依赖；root 参数由薄壳注入（原 a.ysmRoot()）。
// ADR-040 按职责拆分：预览/元数据提取 → fileops_preview.go；启用/禁用 → fileops_enable.go。
package fileops

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"ysm-model-manager/go/config"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/types"
)

// maxPreviewRead 预览/元数据整读上限（P2 审计：原 os.ReadFile 无界，超大/畸形
// 文件可致内存膨胀——共享 types.MaxReadLimit 与 geometry/ysm 的 50MB 口径，索引 6.7+5.2）
const maxPreviewRead = types.MaxReadLimit

// previewReadLimit 预览整读上限：AppConfig.PreviewReadLimitMB > 0 用之，否则默认 50MB。
// 配置源收敛到 go/config 单持有点（ADR-091 D12），字段 0 = 回退包级默认。
func previewReadLimit() int64 {
	if mb := config.Get().PreviewReadLimitMB; mb > 0 {
		return int64(mb) << 20
	}
	return maxPreviewRead
}

// readLimitedFile 受限整读文件：上限 previewReadLimit()，超限/读失败返回 nil。
// 预览/元数据读取统一套上限，防超大文件整体拖入内存。
func readLimitedFile(path string) []byte {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	return fsutil.ReadLimitedEntry(f, previewReadLimit())
}

// opMu 写类操作互斥锁（P2-3 修复，审核发现 TOCTOU）：
// 原「Stat 判不存在 → Rename/Write」check-then-act 在并发下可交错（两并发 Move 同一文件、
// 并发 Toggle 同模型、并发 Copy 同目标互相覆盖）。薄壳 app_files.go 无 fileops 级互斥，
// 统一在此串行化写操作（读操作 FindPreviewImage/GetPackInfo 不加锁，读旧数据可接受）。
var opMu sync.Mutex

// ========== 目录操作 ==========

// CreateDir 在 root 下创建子目录（校验非法字符，与 RenameDir 对齐）
func CreateDir(root, dir string) error {
	opMu.Lock()
	defer opMu.Unlock()
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return fmt.Errorf("目录名为空")
	}
	if fsutil.ContainsIllegalNameChar(dir) {
		return fmt.Errorf("目录名包含非法字符")
	}
	if dir == "." || paths.HasTraversal(dir) {
		return fmt.Errorf("目录名包含非法路径段")
	}
	fullPath := filepath.Join(root, dir)
	return os.MkdirAll(fullPath, fsutil.DirPerms)
}

// renameToNewName 组装 newPath 并防覆盖重命名（RenameDir / RenameFile 共用尾部逻辑）。
func renameToNewName(oldPath, newName string) error {
	parent := filepath.Dir(oldPath)
	newPath := filepath.Join(parent, newName)
	if _, err := os.Lstat(newPath); err == nil {
		return fmt.Errorf("目标已存在: %s", newPath)
	}
	return os.Rename(oldPath, newPath)
}

// RenameDir 重命名目录（仅改末段，保持父目录）
func RenameDir(oldPath, newName string) error {
	opMu.Lock()
	defer opMu.Unlock()
	oldPath = strings.TrimSpace(oldPath)
	newName = strings.TrimSpace(newName)
	if oldPath == "" || newName == "" {
		return fmt.Errorf("参数为空")
	}
	// 与 RenameFile 对齐，newName 必须通过非法字符 + 穿越校验。
	// 原实现 `filepath.Join(parent, "../x")` 可逃出父目录/仓库。
	if fsutil.ContainsIllegalNameChar(newName) {
		return fmt.Errorf("目录名包含非法字符")
	}
	if newName == "." || paths.HasTraversal(newName) {
		return fmt.Errorf("目录名包含非法路径段")
	}
	return renameToNewName(oldPath, newName)
}

// RemoveDir 递归删除目录（基础安全校验——拒绝空路径/NUL/穿越段/根目录；
// 仓库归属校验由调用方 isPathInRoot 负责，此处为纵深防御）
func RemoveDir(dir string) error {
	opMu.Lock()
	defer opMu.Unlock()
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return fmt.Errorf("目录路径为空")
	}
	if strings.ContainsRune(dir, 0) {
		return fmt.Errorf("目录路径包含非法空字节")
	}
	clean := filepath.Clean(dir)
	// 拒绝相对路径穿越（.. / . / ../foo）——合法调用方应传入绝对路径
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return fmt.Errorf("目录路径包含非法路径段")
	}
	// 拒绝磁盘根目录（C:\ / / 等）——防误删整个驱动器
	if filepath.Dir(clean) == clean {
		return fmt.Errorf("不能删除根目录")
	}
	return os.RemoveAll(clean)
}

// RenameFile 重命名文件（校验非法字符；ysm.json 为模型目录清单，禁止改名）
func RenameFile(oldPath, newName string) error {
	opMu.Lock()
	defer opMu.Unlock()
	oldPath = strings.TrimSpace(oldPath)
	newName = strings.TrimSpace(newName)
	if oldPath == "" || newName == "" {
		return fmt.Errorf("参数为空")
	}
	if fsutil.ContainsIllegalNameChar(newName) {
		return fmt.Errorf("文件名包含非法字符")
	}
	// ADR-038 D3：ysm.json 是模型目录清单（游戏按目录名识别模型），禁止单文件改名
	if types.IsYsmEntryJSON(filepath.Base(oldPath)) {
		return fmt.Errorf("ysm.json 是模型目录清单，请重命名所在文件夹（整组操作）")
	}
	return renameToNewName(oldPath, newName)
}

// ========== 模型移动/复制 ==========

// renameForMove 可注入的 rename 实现（测试用：替换为返回 EXDEV 以强制触发
// 跨设备 copy+delete fallback；生产走 os.Rename）
var renameForMove = os.Rename

// checkNotSelfNested 拒绝目录自嵌套移动/复制（dstDir 位于 src 子树内时拒绝，含等值情形）。
func checkNotSelfNested(src, dstDir string) error {
	if absSrc, err := filepath.Abs(src); err == nil {
		if absDstDir, err := filepath.Abs(dstDir); err == nil {
			if relToSrc, err := filepath.Rel(absSrc, absDstDir); err == nil &&
				!strings.HasPrefix(relToSrc, ".."+string(filepath.Separator)) && relToSrc != ".." {
				return fmt.Errorf("目标目录不能位于源目录内: %s", dstDir)
			}
		}
	}
	return nil
}

// MoveModelFile 移动 src 到 dstDir（保留原名）
// root 用于路径安全校验（空则跳过校验，对齐 CopyModelFile 语义）；
// ADR-038 D3：src 为 ysm.json 时提升为移动整个模型目录（整组语义）；目录直接整组移动
func MoveModelFile(root, src, dstDir string) error {
	opMu.Lock()
	defer opMu.Unlock()
	src = strings.TrimSpace(src)
	dstDir = strings.TrimSpace(dstDir)
	if src == "" || dstDir == "" {
		return fmt.Errorf("参数空")
	}
	if root != "" {
		absRoot, err := filepath.Abs(root)
		if err != nil {
			return err
		}
		absSrc, err := filepath.Abs(src)
		if err != nil {
			return err
		}
		relSrc, err := filepath.Rel(absRoot, absSrc)
		if err != nil || relSrc == "." || relSrc == ".." || strings.HasPrefix(relSrc, ".."+string(filepath.Separator)) {
			return fmt.Errorf("源文件必须在仓库内: %s", src)
		}
		absDst, err := filepath.Abs(dstDir)
		if err != nil {
			return err
		}
		relDst, err := filepath.Rel(absRoot, absDst)
		if err != nil || relDst == ".." || strings.HasPrefix(relDst, ".."+string(filepath.Separator)) {
			return fmt.Errorf("目标目录必须在仓库内: %s", dstDir)
		}
		// 同 WriteModelFolder.checkNoSymlinkInPath 口径：dstDir 中间组件为指向仓库外
		// 已存在目录的 symlink 时，MkdirAll 放行、rename/copy 穿透写出
		if err := checkNoSymlinkInPath(absRoot, relDst); err != nil {
			return err
		}
	}
	// ysm.json 是模型目录清单：整组移动父目录（包内 geometry/animation/语言资源随目录一起走）。
	// 提升判定须在自嵌套检查之前执行——自嵌套检查必须用提升后的 src（目录）判定，
	// 否则 dstDir 位于模型目录内部时会穿透检查、MkdirAll 后在模型目录内留下空 junk 目录
	// 再 rename 失败（对齐 CopyModelFile 的「先提升、后自嵌套检查」顺序）。
	// 根级 ysm.json（父目录 == 仓库根）：不整组提升，回退单文件移动（防移走整个仓库）。
	liftToParent := false
	if types.IsYsmEntryJSON(filepath.Base(src)) {
		if root != "" {
			absRoot, err := filepath.Abs(root)
			if err != nil {
				return fmt.Errorf("解析仓库根路径失败: %w", err)
			}
			absSrc, err := filepath.Abs(src)
			if err != nil {
				return fmt.Errorf("解析源文件路径失败: %w", err)
			}
			if rel, err := filepath.Rel(absRoot, filepath.Dir(absSrc)); err == nil && rel == "." {
				liftToParent = false // 根级 ysm.json：单文件移动（走下方通用路径）
			} else {
				liftToParent = true
			}
		} else {
			liftToParent = true
		}
	}
	if liftToParent {
		src = filepath.Dir(src)
	}
	// 自嵌套检查须在 MkdirAll 之前执行——被拒移动不得在 src 内
	// 留下空 junk 目录（dstDir 位于 src 子树内时拒绝，
	// 含 dstDir == src 等值情形：dst=Join(src,Base(src)) 仍是 src 严格子目录）。
	if err := checkNotSelfNested(src, dstDir); err != nil {
		return err
	}
	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
		return err
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	// 移动前防覆盖检查，与 CopyModelFile 语义对齐——
	// 原实现 os.Rename 在 POSIX 上静默覆盖同名目标，Windows 上报错，行为不一致且可能数据丢失
	if _, err := os.Lstat(dst); err == nil {
		return fmt.Errorf("目标已存在: %s", dst)
	}
	if err := renameForMove(src, dst); err != nil {
		// 跨设备/跨卷移动：os.Rename 返回 EXDEV，回退到复制+删除源。
		// 禁用态是文件名重命名约定（ToggleModelEnable 把 path 重命名为
		// path+".disabled"），后缀随文件/目录名自然携带，无需额外处理兄弟文件
		if !fsutil.IsCrossDeviceErr(err) {
			return err
		}
		info, statErr := os.Stat(src)
		if statErr != nil {
			return statErr
		}
		if info.IsDir() {
			if cpErr := copyDirRecursive(src, dst); cpErr != nil {
				return cpErr
			}
		} else {
			if cpErr := copyFile(src, dst); cpErr != nil {
				return cpErr
			}
		}
		// 复制成功，尽力删除源；删除失败时数据已安全到达目标，返回错误但不回滚复制
		if rmErr := os.RemoveAll(src); rmErr != nil {
			return fmt.Errorf("跨设备移动：复制成功但删除源失败: %w", rmErr)
		}
		return nil
	}
	return nil
}

// CopyModelFile 复制 src 到 dstDir（root 用于路径安全校验，空则跳过校验）
// ADR-038 D3：支持目录递归复制（含 .ban 状态文件）；src 为 ysm.json 时提升为复制整个模型目录
func CopyModelFile(root, src, dstDir string) error {
	opMu.Lock()
	defer opMu.Unlock()
	src = strings.TrimSpace(src)
	dstDir = strings.TrimSpace(dstDir)
	if src == "" || dstDir == "" {
		return fmt.Errorf("参数空")
	}
	// 拒绝目录自嵌套复制——dstDir 位于 src 子树内时（先 MkdirAll 在 src 内创建
	// dstDir，再 WalkDir 遍历到它）递归自嵌套无限膨胀直至 ENAMETOOLONG。
	// 含 dstDir == src 等值情形（此时 dst=Join(src, Base(src)) 仍是 src 严格子目录，同样爆炸）。
	// 放在 MkdirAll 之前执行：被拒复制不得在 src 内留下空 junk 目录（code_review）。
	if root != "" {
		absRoot, err := filepath.Abs(root)
		if err != nil {
			return err
		}
		absDst, err := filepath.Abs(dstDir)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(absRoot, absDst)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("目标目录必须在仓库内: %s", dstDir)
		}
		// 同 WriteModelFolder.checkNoSymlinkInPath 口径：dstDir 中间组件为指向仓库外
		// 已存在目录的 symlink 时，MkdirAll 放行、rename/copy 穿透写出
		if err := checkNoSymlinkInPath(absRoot, rel); err != nil {
			return err
		}
		// src 也须落在仓库内——否则可把仓库外任意文件拷入仓库（读取越界）
		absSrc, err := filepath.Abs(src)
		if err != nil {
			return err
		}
		relSrc, err := filepath.Rel(absRoot, absSrc)
		if err != nil || relSrc == ".." || strings.HasPrefix(relSrc, ".."+string(filepath.Separator)) {
			return fmt.Errorf("源文件必须在仓库内: %s", src)
		}
	}
	// ysm.json 提升：复制整个模型目录（ADR-038 D3）
	if types.IsYsmEntryJSON(filepath.Base(src)) {
		src = filepath.Dir(src)
	}
	// 自嵌套检查须在 MkdirAll 之前执行——被拒复制不得在 src 内
	// 留下空 junk 目录（原实现 MkdirAll 先行，拒绝后 src 内残留空子目录污染后续复制）。
	// dstDir 位于 src 子树内时拒绝（含等值 "."——此时 dst=Join(src,Base(src)) 仍是 src
	// 严格子目录，WalkDir 自嵌套无限膨胀至 ENAMETOOLONG）
	if err := checkNotSelfNested(src, dstDir); err != nil {
		return err
	}
	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
		return err
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	// 防覆盖：目标已存在直接报错（单文件与目录一致）
	if _, err := os.Lstat(dst); err == nil {
		return fmt.Errorf("目标已存在: %s", dst)
	}
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return copyDirRecursive(src, dst)
	}
	if err := copyFile(src, dst); err != nil {
		return err
	}
	// 禁用态是文件名重命名约定（ToggleModelEnable：path → path+".disabled"），
	// 后缀随文件/目录名自然携带——不再处理兄弟 `<src>.disabled`（那属于撞名的
	// 无关被禁模型，复制/失败回滚均会误伤；与 MoveModelFile 语义对齐）
	return nil
}

// copyDirRecursive 递归复制目录（.ban 状态文件作为普通文件随遍历自然复制；防覆盖）
// 已收敛至 fsutil.CopyDirRecursive（ADR-044 策略 A）：拒 symlink + 防覆盖 + 失败整树回滚。
func copyDirRecursive(srcDir, dstDir string) error {
	return fsutil.CopyDirRecursive(srcDir, dstDir, fsutil.CopyDirOptions{
		RejectSymlink: true,  // 仓库安全红线：不追踪 symlink（paths.IsInside 声明）
		Overwrite:     false, // 防覆盖：目标已存在报错
		Rollback:      true,  // 失败整树回滚，防半棵树残留 + 重试被「目标已存在」永久卡死
	})
}

// ========== 模型删除 ==========

// DeleteModelFile 删除模型（目录感知，ADR-038 D3.6）：
// src 为 ysm.json 时删除整个模型目录（整组语义——包内 geometry/animation/语言资源随目录一起删）；
// 其余文件删除单文件。消除「单文件删除 vs 目录删除」双轨语义入口。
// root 为资源类型仓库根（可选，空则跳过守卫）：防止根级/盘符级 ysm.json 把整个仓库误删；
// 守卫拒绝时回退单文件删除（不整组、不误删仓库）。
func DeleteModelFile(root, path string) error {
	opMu.Lock()
	defer opMu.Unlock()
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("参数空")
	}
	if types.IsYsmEntryJSON(filepath.Base(path)) {
		parent := filepath.Dir(path)
		// 目录提升守卫：父目录必须严格深于仓库根（防根级 ysm.json 清空整个仓库）
		if root != "" {
			absRoot, err := filepath.Abs(root)
			if err != nil {
				return err
			}
			absParent, err := filepath.Abs(parent)
			if err != nil {
				return err
			}
			rel, err := filepath.Rel(absRoot, absParent)
			if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				// 仓库外路径（rel 无法判定或 .. 前缀）：显式拒绝，不静默降级——
				// 否则只删 ysm.json 单文件会留下孤儿资源目录且前端误报「已删除」
				return fmt.Errorf("拒绝删除仓库外路径: %s", path)
			}
			if rel == "." {
				// 真正的根级 ysm.json（父目录 == 仓库根）：回退单文件删除（不整组提升，防误删仓库）
				return os.Remove(path)
			}
		}
		return os.RemoveAll(parent)
	}
	// 非 ysm.json 分支补 root 包含守卫——原直接 os.Remove(path)，
	// root 参数完全不参与校验，仓库外路径（如 /etc/foo）会被无条件删除（防纵深缺口）
	if root != "" {
		absRoot, err := filepath.Abs(root)
		if err != nil {
			return err
		}
		absPath, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(absRoot, absPath)
		if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("拒绝删除仓库外路径: %s", path)
		}
	}
	return os.Remove(path)
}

// ========== 内部工具 ==========

// copyFile 复制文件（已收敛至 fsutil.CopyFile 的 tmp+rename 原子模式——
// 原直接 Create + io.Copy，崩溃/磁盘满留半截目标文件；fsutil 补 Sync 落盘检查 + Chmod 0644）
// 本处保留 Lstat 拒 symlink 前置守卫（仓库安全红线）。
func copyFile(src, dst string) error {
	// 复制前拒绝符号链接源——仓库内 symlink 指向外部
	// 文件（如 /etc/passwd）时，词法校验通过但内容被拷入仓库（读取越界）。paths.IsInside
	// 声明不追踪 symlink，调用方负责；此处用 Lstat 显式拒绝
	if fi, err := os.Lstat(src); err != nil {
		return err
	} else if fi.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("拒绝复制符号链接: %s", src)
	}
	return fsutil.CopyFile(src, dst)
}
