// ===== 受限整文件读取（ADR-033 截断静默反模式的对立面）=====
// 收敛自 internal/app/app_model.go 等处的裸 os.ReadFile——整仓唯一违反
// registry.MaxReadLimit(50MB) 单源口径的簇（geometry/avatar/ysm/fileops 均已落地）。
// 与 ReadLimitedEntry 同口径（limit+1 探测），但面向「整文件」读取：超限返回
// ErrFileTooLarge 而非静默截断，避免把被 YSMParser 篡改输出的 GB 级内容喂给解析器撑爆内存。

package fsutil

import (
	"errors"
	"io"
	"math"
	"os"
)

// ErrFileTooLarge 标记文件超过读取上限（与 ADR-033 静默截断对立）。
// 调用方可 errors.Is 区分「超限」与「IO 故障」。
var ErrFileTooLarge = errors.New("文件超过读取上限")

// ReadFileLimited 读取 path 全部内容，上限 limit 字节；超限返回 ErrFileTooLarge（不静默截断）。
// limit 由调用方传入（通常 registry.MaxReadLimit），本包不依赖 registry 以免反向依赖循环。
func ReadFileLimited(path string, limit int64) ([]byte, error) {
	if limit <= 0 {
		return nil, ErrFileTooLarge
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	// limit+1 探测：读满 limit+1 即判超限（与 ReadLimitedEntry 同口径）。
	// limit == math.MaxInt64 时 limit+1 溢出为负 → LimitReader 读 0 字节，下方 len>limit 恒假
	// 会静默返回空切片，故显式拒绝该边界（调用方恒传有限上限，纯防御）。
	if limit == math.MaxInt64 {
		return nil, ErrFileTooLarge
	}
	buf, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(buf)) > limit {
		return nil, ErrFileTooLarge
	}
	return buf, nil
}
