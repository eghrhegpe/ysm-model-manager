// ===== 原子写文件（ADR-044 策略 A：基础设施工具函数收敛）=====
// 收敛自 go/importer/importer_file.go 的 WriteFileAtomic——tags/logs/fileops 等所有
// 「落盘 JSON/数据文件」的包统一引用本函数，禁止各自手写 tmp+rename 实现。
// 背景：`os.WriteFile` 直写目标在磁盘满/IO 中断时留半截损坏文件（项目头号反模式），
// 且非覆盖场景再次写入命中已存在检查形成死锁；CreateTemp + rename 保证原子替换。

package fsutil

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
)

// 陷阱 #11：各阶段失败必须经 sentinel + errors.Is 判定，禁止文本匹配（strings.Contains
// 错误消息）。调用方（如 go/importer 的 AppError 包装）可用 errors.Is 区分阶段并映射
// 不同的错误码（如 MKDIR_FAILED），维持既有结构化错误契约（code_review）。
var (
	// ErrTempCreateFailed 标记「创建临时文件」阶段失败（目录只读/磁盘满/配额/NUL 路径）。
	ErrTempCreateFailed = errors.New("创建临时文件失败")
	// ErrWriteFailed 标记写入临时文件阶段失败（ENOSPC/EIO）。
	ErrWriteFailed = errors.New("写入失败")
	// ErrSyncFailed 标记 fsync 落盘阶段失败。
	ErrSyncFailed = errors.New("落盘失败")
	// ErrCloseFailed 标记关闭临时文件阶段失败。
	ErrCloseFailed = errors.New("关闭临时文件失败")
	// ErrChmodFailed 标记设置权限阶段失败。
	ErrChmodFailed = errors.New("设置权限失败")
	// ErrRenameFailed 标记 rename 落地阶段失败。
	ErrRenameFailed = errors.New("落地失败")
)

// ⚠️ 可注入故障点（包级函数变量，仅测试替换用，禁止生产调用）——OS 级失败（ENOSPC/EIO/只读目录等）
// 无法在测试中低成本真实构造，故收敛为包级变量供测试 swap；生产代码零改动语义，
// 失败清理（Remove 临时文件）保持真实执行，测试即可断言「无残渣」不变量。
// 不引入公共 API / 注入接口，维持 ADR-044 收敛口径。
var (
	createTempFile = os.CreateTemp
	writeToFile    = func(w io.Writer, data []byte) error {
		_, err := w.Write(data)
		return err
	}
	syncFile   = func(f *os.File) error { return f.Sync() }
	closeFile  = func(f *os.File) error { return f.Close() }
	chmodFile  = os.Chmod
	renameFile = os.Rename
)

// ReadLimitedEntry 读取 zip/7z 单条目：limit+1 探测截断（ADR-033 修复，ADR-044 策略 A 统一口径）——
// 原 `io.ReadAll(io.LimitReader(rc, limit))` 截断后 err==nil 静默，超限数据会被截断后继续使用
// （损坏数据装盘，项目头号反模式）。本函数读 limit+1 字节，len 超 limit 即判超限返回 nil；
// 读取错误同样返回 nil（调用方跳过该条目）。rc 由本函数 Close。
// 收敛自 go/geometry/archive.go 的 readLimitedEntry——ysm/packs 等各档上限探测统一引用本函数。
func ReadLimitedEntry(rc io.ReadCloser, limit int64) []byte {
	defer rc.Close()
	// limit<=0 边界不对称——limit==0 时空条目返回非 nil 空切片
	// （调用方视为有效数据）、非空条目返回 nil；limit<0 恒返回 nil；limit==MaxInt64 时
	// limit+1 溢出为负 → LimitReader 读 0 字节 → 静默返回空切片（被误当有效）。
	// 统一：非正 limit 一律 nil（调用方跳过该条目，语义清晰）
	if limit <= 0 || limit == math.MaxInt64 {
		return nil
	}
	buf, err := io.ReadAll(io.LimitReader(rc, limit+1))
	if err != nil {
		// 读取错误（IO 故障）与超限是两类失败：超限是预期内跳过，IO 故障需诊断线索——
		// 函数签名不变（nil 表示跳过该条目），但至少留下日志而非完全静默
		log.Printf("[fsutil] ReadLimitedEntry 读取失败（非超限，返回 nil 跳过条目）: %v", err)
		return nil
	}
	if int64(len(buf)) > limit {
		return nil
	}
	return buf
}

// WriteFileAtomic 临时文件 + rename 原子落地目标文件。
// CreateTemp 恒建 0600，落地前 chmod 0644（对齐 installer.copyFileLocked 约定，
// 防多用户/共享目录下导入/日志文件不可读）；任一失败分支删除临时文件，不留残渣。
// 返回普通 error（本包不依赖 go/types 的结构化错误契约，调用方按需包装）。
func WriteFileAtomic(destPath string, data []byte) error {
	// 跨平台 NUL 字节防御——Windows OS 自然拒绝（"invalid argument"），
	// 但 Linux filepath.Abs 会静默截断 NUL 后内容（"safe.ysm\x00.exe" → "safe.ysm"），
	// 导致写入非预期文件。在 Go 层显式拒绝，跨平台行为一致。
	if strings.Contains(destPath, "\x00") {
		return fmt.Errorf("%w: destPath 含 NUL 字节", ErrTempCreateFailed)
	}
	destDir := filepath.Dir(destPath)
	tmp, err := createTempFile(destDir, ".atomic-*.tmp")
	if err != nil {
		return fmt.Errorf("%w: %v", ErrTempCreateFailed, err)
	}
	tmpName := tmp.Name()
	if err := writeToFile(tmp, data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return fmt.Errorf("%w: %w", ErrWriteFailed, err)
	}
	// Sync 确保数据落盘后再 Close+Rename——与 installer/recycle/importer 的
	// copyFile 落盘检查对齐（ADR-033 截断静默反模式：不 Sync 时崩溃可能零长度文件装盘）
	if err := syncFile(tmp); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return fmt.Errorf("%w: %w", ErrSyncFailed, err)
	}
	if err := closeFile(tmp); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("%w: %w", ErrCloseFailed, err)
	}
	if err := chmodFile(tmpName, FilePerms); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("%w: %w", ErrChmodFailed, err)
	}
	if err := renameFile(tmpName, destPath); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("%w: %w", ErrRenameFailed, err)
	}
	return nil
}

// SHA256File 计算文件内容的 SHA256 哈希，返回十六进制字符串。
// 收敛自 scanner/texture_cache/sync 三处独立实现，统一为单一事实来源。
func SHA256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}
