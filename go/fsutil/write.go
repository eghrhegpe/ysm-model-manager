// ===== 原子写文件（ADR-044 策略 A：基础设施工具函数收敛）=====
// 收敛自 go/importer/importer_file.go 的 WriteFileAtomic——tags/logs/fileops 等所有
// 「落盘 JSON/数据文件」的包统一引用本函数，禁止各自手写 tmp+rename 实现。
// 背景：`os.WriteFile` 直写目标在磁盘满/IO 中断时留半截损坏文件（项目头号反模式），
// 且非覆盖场景再次写入命中已存在检查形成死锁；CreateTemp + rename 保证原子替换。

package fsutil

import (
	"fmt"
	"os"
	"path/filepath"
)

// WriteFileAtomic 临时文件 + rename 原子落地目标文件。
// CreateTemp 恒建 0600，落地前 chmod 0644（对齐 installer.copyFileLocked 约定，
// 防多用户/共享目录下导入/日志文件不可读）；任一失败分支删除临时文件，不留残渣。
// 返回普通 error（本包不依赖 go/types 的结构化错误契约，调用方按需包装）。
func WriteFileAtomic(destPath string, data []byte) error {
	destDir := filepath.Dir(destPath)
	tmp, err := os.CreateTemp(destDir, ".atomic-*.tmp")
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %w", err)
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
