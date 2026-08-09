// ===== 原子写文件（ADR-044 策略 A：基础设施工具函数收敛）=====
// 收敛自 go/importer/importer_file.go 的 WriteFileAtomic——tags/logs/fileops 等所有
// 「落盘 JSON/数据文件」的包统一引用本函数，禁止各自手写 tmp+rename 实现。
// 背景：`os.WriteFile` 直写目标在磁盘满/IO 中断时留半截损坏文件（项目头号反模式），
// 且非覆盖场景再次写入命中已存在检查形成死锁；CreateTemp + rename 保证原子替换。

package fsutil

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// ErrTempCreateFailed 标记「创建临时文件」阶段失败（目录只读/磁盘满/配额）。
// 调用方（如 go/importer 的 AppError 包装）可用 errors.Is 区分该阶段并映射
// 不同的错误码（如 MKDIR_FAILED），维持既有结构化错误契约（code_review）。
var ErrTempCreateFailed = errors.New("创建临时文件失败")

// ReadLimitedEntry 读取 zip/7z 单条目：limit+1 探测截断（ADR-033 修复，ADR-044 策略 A 统一口径）——
// 原 `io.ReadAll(io.LimitReader(rc, limit))` 截断后 err==nil 静默，超限数据会被截断后继续使用
// （损坏数据装盘，项目头号反模式）。本函数读 limit+1 字节，len 超 limit 即判超限返回 nil；
// 读取错误同样返回 nil（调用方跳过该条目）。rc 由本函数 Close。
// 收敛自 go/geometry/archive.go 的 readLimitedEntry——ysm/packs 等各档上限探测统一引用本函数。
func ReadLimitedEntry(rc io.ReadCloser, limit int64) []byte {
	defer rc.Close()
	buf, err := io.ReadAll(io.LimitReader(rc, limit+1))
	if err != nil || int64(len(buf)) > limit {
		return nil
	}
	return buf
}

// WriteFileAtomic 临时文件 + rename 原子落地目标文件。
// CreateTemp 恒建 0600，落地前 chmod 0644（对齐 installer.copyFileLocked 约定，
// 防多用户/共享目录下导入/日志文件不可读）；任一失败分支删除临时文件，不留残渣。
// 返回普通 error（本包不依赖 go/types 的结构化错误契约，调用方按需包装）。
func WriteFileAtomic(destPath string, data []byte) error {
	destDir := filepath.Dir(destPath)
	tmp, err := os.CreateTemp(destDir, ".atomic-*.tmp")
	if err != nil {
		return fmt.Errorf("%w: %v", ErrTempCreateFailed, err)
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return fmt.Errorf("写入失败: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("关闭临时文件失败: %w", err)
	}
	if err := os.Chmod(tmpName, 0644); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("设置权限失败: %w", err)
	}
	if err := os.Rename(tmpName, destPath); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("落地失败: %w", err)
	}
	return nil
}
