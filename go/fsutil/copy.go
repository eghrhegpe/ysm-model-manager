// ===== 原子复制原语（ADR-044 策略 A：基础设施工具收敛）=====
// 收敛自 fileops/recycle/importer/sync 四份 copyFile + 四份 copyDirRecursive：
// 单文件复制统一为 CopyFile（tmp+rename 原子 + Sync 落盘 + Chmod 0644 + MkdirAll 父目录），
// 目录复制统一为 CopyDirRecursive（参数化 symlink 策略 / 防覆盖 / 失败回滚），
// 各包按自身语义传参，禁止各自手写 tmp+rename 实现。
// 背景：直写目标在磁盘满/IO 中断时留半截损坏文件（项目头号反模式），
// 且多份实现语义漂移（recycle 曾缺 Sync、fileops 缺 Chmod）；收敛后单一实现 + 选项。

package fsutil

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ===== 步骤类型化错误（ADR-044 策略 A：机制归 fsutil、文案归调用方）=====
// StepError 复制过程单步失败的标注错误：只指明「哪一步」失败（中性步骤名，不含 UI 文案），
// 具体 Operation/Reason/Suggestion 由调用方（如 installer 的 mapStepToAppError）按 own 语义映射。
// Error() 透传内层错误、Unwrap 透传内层——既有调用方对 err.Error() 文本 / errors.Is 的断言零影响；
// 需要区分步骤的调用方经 errors.As 取 Step。

// 复制各失败点的中性步骤名（无 UI 文案，供调用方 switch 后自定文案）
const (
	StepStat      = "stat"       // 源 Stat / 目录源前置拒绝
	StepOpen      = "open"       // 打开源
	StepCloseSrc  = "close_src"  // 读毕关闭源
	StepMkdir     = "mkdir"      // 创建目标父目录
	StepCreateTmp = "create_tmp" // 创建临时文件
	StepCopy      = "copy"       // io.Copy 写入
	StepSync      = "sync"       // 数据落盘
	StepClose     = "close"      // 关闭临时文件
	StepChmod     = "chmod"      // 权限 0644
	StepRename    = "rename"     // 原子替换到目标
)

// StepError 带步骤标注的复制错误。
type StepError struct {
	Step string
	Err  error
}

func (e *StepError) Error() string { return e.Err.Error() }
func (e *StepError) Unwrap() error { return e.Err }

// stepErr 用 StepError 包装一个失败点（仅包内 CopyFile/CopyDir 使用）。
func stepErr(step string, err error) error {
	return &StepError{Step: step, Err: err}
}

// CopyFile 原子复制单文件：先写同目录临时文件再 rename 落地，崩溃/失败不留半截目标。
//   - MkdirAll 目标父目录（与 recycle/importer 的 copyFile 行为对齐）；
//   - Sync 落盘后再 Close+Rename（与 installer.copyFileLocked 对齐，防零长度文件装盘）；
//   - Chmod 0644（CreateTemp 恒建 0600，对齐 installer/importer 的 0644 约定，
//     防多用户/共享目录下复制文件不可读）。
//
// 同目录 tmp+rename 天然跨分区兼容（tmp 与 dst 同盘），无需 EXDEV 特殊分支。
// 返回普通 error；不追踪 symlink（上层 walk 负责 symlink 策略）。
func CopyFile(src, dst string) error {
	// 前置检查：拒绝目录源——Windows 上 os.Open 目录后即使 Close，句柄释放有延迟，
	// 会阻塞 TempDir 清理（TestCopyFile_SrcIsDir）。提前 Stat 拒绝，避免打开目录句柄。
	if fi, err := os.Stat(src); err != nil {
		return stepErr(StepStat, err)
	} else if fi.IsDir() {
		return stepErr(StepStat, fmt.Errorf("源为目录: %s", src))
	}
	in, err := os.Open(src)
	if err != nil {
		return stepErr(StepOpen, err)
	}
	if err := os.MkdirAll(filepath.Dir(dst), DirPerms); err != nil {
		in.Close()
		return stepErr(StepMkdir, err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".copy-*.tmp")
	if err != nil {
		in.Close()
		return stepErr(StepCreateTmp, err)
	}
	tmpName := tmp.Name()
	ok := false
	defer func() {
		tmp.Close()
		if !ok {
			os.Remove(tmpName)
		}
	}()
	if _, err := io.Copy(tmp, in); err != nil {
		in.Close()
		return stepErr(StepCopy, err)
	}
	// 读取完成后立即关闭源文件——Windows 上文件被进程持有句柄时
	// os.Rename 无法覆盖（Access is denied），src/dst 同目录场景尤其会触发。
	// defer Close 在函数退出时才执行，太晚了。
	if err := in.Close(); err != nil {
		return stepErr(StepCloseSrc, err)
	}
	// Sync 确保数据落盘后再 Close+Rename（与 installer/recycle/importer 的
	// copyFile 落盘检查对齐：不 Sync 时崩溃可能零长度文件装盘）
	if err := tmp.Sync(); err != nil {
		return stepErr(StepSync, err)
	}
	if err := tmp.Close(); err != nil {
		return stepErr(StepClose, err)
	}
	if err := os.Chmod(tmpName, FilePerms); err != nil {
		os.Remove(tmpName)
		return stepErr(StepChmod, err)
	}
	if err := os.Rename(tmpName, dst); err != nil {
		os.Remove(tmpName)
		return stepErr(StepRename, err)
	}
	ok = true
	return nil
}

// CopyDirOptions 目录递归复制选项（各调用方按自身语义传参）
type CopyDirOptions struct {
	// RejectSymlink 拒绝复制符号链接（fileops 安全红线：仓库内 symlink
	// 指向外部时词法校验通过但内容被拷入；true=遇到即报错。
	// false=复制链接本身（recycle/sync：保留链接语义，不跟随复制）。
	RejectSymlink bool
	// Overwrite 目标已存在：true=覆盖（配合 AtomicRename 时整目录替换；
	// 否则逐文件覆盖，失败时可能残留半截树）。
	Overwrite bool
	// Rollback 失败时整树回滚（RemoveAll dstDir），防半棵树残留被扫成
	// 「截断模型」进入同步匹配。fileops 恒 true；sync 仅当 dst 为本次新建时
	// true（重拉/刷新场景 dst 可能是用户既有目录，误删旧内容即数据丢失）。
	// AtomicRename 为 true 时本字段无效（tmpDir 由 defer 自动清理）。
	Rollback bool
	// AtomicRename 通过 tmpDir → rename 实现原子替换（importer 用）。
	// 先复制到 src 同级临时目录，再 rename 到 dst。
	// 若 dst 已存在，先备份为 dst.bak-<timestamp>，rename 失败时恢复。
	// 防止进程崩溃时目标目录残留半截树。
	AtomicRename bool
}

// CopyDirRecursive 递归复制目录树到 dst（保留相对路径）。
// 逐项 MkdirAll + CopyFile；symlink 按 opts 策略处理（拒绝或复制链接本身）；
// 失败按 opts.Rollback 整树回滚。与 sync/fileops/recycle 的 copyDirRecursive
// 语义对齐（新增类型/调用方只需传选项，不再各自实现）。
// opts.AtomicRename 为 true 时通过 tmpDir → rename 原子替换，同时开启祖先守卫。
func CopyDirRecursive(src, dst string, opts CopyDirOptions) error {
	// ── AtomicRename 分支：tmpDir → rename 原子替换 ──
	if opts.AtomicRename {
		// 祖先守卫：src 包含 dst 时拒绝（防死循环与静默自我替换）
		absSrc, err := filepath.Abs(src)
		if err != nil {
			return fmt.Errorf("解析源路径失败: %w", err)
		}
		absDst, err := filepath.Abs(dst)
		if err != nil {
			return fmt.Errorf("解析目标路径失败: %w", err)
		}
		if absSrc == absDst {
			return fmt.Errorf("源目录与目标目录相同: %s", absSrc)
		}
		rel, rErr := filepath.Rel(absSrc, absDst)
		if rErr == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("目标目录 %s 位于源目录 %s 内，递归复制会死循环", absDst, absSrc)
		}

		// 创建临时目录（与 dst 同盘，确保 rename 跨分区兼容）
		tmpDir, err := os.MkdirTemp(filepath.Dir(dst), ".tmp_copy_")
		if err != nil {
			return err
		}
		defer os.RemoveAll(tmpDir) // 失败或 rename 后 tmpDir 已不存在，安全

		if err := copyDirRecursiveWalk(src, tmpDir, opts); err != nil {
			return err
		}

		// 原子替换：若目标已存在，先备份再 rename
		// ⚠️ 崩溃窗口（有意的取舍）：Rename(dst, backup) 成功与 Rename(tmpDir, dst) 之间
		// 进程崩溃 → dst 缺失，旧数据仅在 .bak-<ts>；恢复需人工扫描同目录 .bak-*。
		// 两步 rename 无法在单进程内进一步原子化（POSIX/Win 均无目录级事务），
		// 故仅文档化窗口 + 备份永不覆盖（纳秒时间戳）作为兜底。
		if _, stErr := os.Lstat(dst); stErr == nil {
			backup := dst + ".bak-" + strconv.FormatInt(time.Now().UnixNano(), 10)
			if rmErr := os.RemoveAll(backup); rmErr != nil {
				log.Printf("[fsutil] 清理陈旧备份失败 %s: %v（不影响本次替换，rename 仍可继续）", backup, rmErr)
			}
			if err := os.Rename(dst, backup); err != nil {
				return err
			}
			if err := os.Rename(tmpDir, dst); err != nil {
				_ = os.Rename(backup, dst) // 回滚恢复
				return err
			}
			if rmErr := os.RemoveAll(backup); rmErr != nil {
				log.Printf("[fsutil] 替换成功后清理备份失败 %s: %v（旧数据完整保留在该路径）", backup, rmErr)
			}
			return nil
		}
		return os.Rename(tmpDir, dst)
	}

	// ── 普通分支：原地复制（逐文件落盘，失败按 opts.Rollback 整树回滚）──
	if err := copyDirRecursiveWalk(src, dst, opts); err != nil {
		if opts.Rollback {
			if rmErr := os.RemoveAll(dst); rmErr != nil {
				log.Printf("[fsutil] 复制失败回滚清理失败 %s: %v（原错误: %v）", dst, rmErr, err)
			}
		}
		return err
	}
	return nil
}

// copyDirRecursiveWalk 执行 WalkDir 遍历并复制到 dstDir（共用 walk 逻辑）。
// 供 CopyDirRecursive 的普通分支与 AtomicRename 分支共用，消除第二份 walk 实现。
func copyDirRecursiveWalk(src, dstDir string, opts CopyDirOptions) error {
	if err := os.MkdirAll(dstDir, DirPerms); err != nil {
		return err
	}
	return filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&os.ModeSymlink != 0 {
			if opts.RejectSymlink {
				return fmt.Errorf("拒绝复制符号链接: %s", p)
			}
			linkTarget, lerr := os.Readlink(p)
			if lerr != nil {
				return lerr
			}
			target, rerr := relJoin(dstDir, src, p)
			if rerr != nil {
				return rerr
			}
			_ = os.Remove(target)
			return os.Symlink(linkTarget, target)
		}
		rel, rerr := filepath.Rel(src, p)
		if rerr != nil {
			return rerr
		}
		target := filepath.Join(dstDir, rel)
		if d.IsDir() {
			return os.MkdirAll(target, DirPerms)
		}
		if !opts.Overwrite {
			// Lstat 而非 Stat：目标位置是悬空符号链接时 Stat 返回 NotExist，
			// 守卫被绕过 → CopyFile 的 rename 静默顶掉链接（对齐 recycle.uniqueDest 口径）
			if _, err := os.Lstat(target); err == nil {
				return fmt.Errorf("目标已存在: %s", target)
			}
		}
		return CopyFile(p, target)
	})
}

// relJoin 计算 p 相对 src 的目标路径（symlink 分支专用，避免与文件分支的
// filepath.Rel 重复调用语义混淆）
func relJoin(dst, src, p string) (string, error) {
	rel, err := filepath.Rel(src, p)
	if err != nil {
		return "", err
	}
	return filepath.Join(dst, rel), nil
}
