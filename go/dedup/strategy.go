package dedup

import (
	"crypto/md5"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"ysm-model-manager/go/types"
)

// HashAlgorithm 去重算法策略接口
type HashAlgorithm interface {
	// ComputeHash 计算文件的哈希值或唯一标识
	ComputeHash(filePath string) (string, error)
	// Name 算法名称
	Name() string
}

// DeepHash 深度哈希算法 (基于 SHA256) - 精确但较慢
type DeepHash struct{}

func (d *DeepHash) Name() string {
	return "deep_hash"
}

func (d *DeepHash) ComputeHash(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	// 只读哈希路径：Close 错误无观测影响（与并行管道读失败日志无关），显式忽略防 lint 未处理
	defer func() { _ = f.Close() }()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

// QuickHash 快速哈希算法 (基于 MD5) - 速度较快，适合大文件
// QuickHash 使用 MD5 计算文件哈希，速度较快，适合大文件。
//
// 安全说明（R27 P3-3）：MD5 非抗碰撞，对抗场景下可构造碰撞。
// 去重结果直接驱动 recycle.Move（删除文件），MD5 碰撞虽概率极低但非零。
// QuickHash 组通过 size 预分组隐含二次 size 校验（同组必同 size），
// 降低碰撞窗口。对抗环境下应改用 DeepHash（SHA256）。
type QuickHash struct{}

func (q *QuickHash) Name() string {
	return "quick_hash"
}

func (q *QuickHash) ComputeHash(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	// 只读哈希路径：Close 错误无观测影响，显式忽略防 lint 未处理
	defer func() { _ = f.Close() }()

	h := md5.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

// NameSizeHash 基于文件名和大小的"伪哈希" - 速度最快但不精确
type NameSizeHash struct{}

func (ns *NameSizeHash) Name() string {
	return "name_size"
}

func (ns *NameSizeHash) ComputeHash(filePath string) (string, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		return "", err
	}
	name := filepath.Base(filePath)
	return fmt.Sprintf("%s_%d", name, info.Size()), nil
}

// NewHashAlgorithm 根据配置创建哈希算法实例
func NewHashAlgorithm(config *types.DedupConfig) HashAlgorithm {
	if config == nil {
		return &DeepHash{}
	}
	switch config.Strategy {
	case "quick_hash":
		return &QuickHash{}
	case "name_size":
		return &NameSizeHash{}
	case "deep_hash", "hash", "":
		fallthrough
	default:
		return &DeepHash{}
	}
}
