// ========== base64 受限解码 ==========
// binding 层 base64 输入的统一预检解码入口：先按编码长度上界拒绝超大输入，
// 再解码、解码后复检——消除 importer / app 各处「解码后才查大小」的内存尖刺分叉。
package fsutil

import (
	"encoding/base64"
	"errors"
	"strings"
)

// ErrB64TooLarge 输入解码后超过 max 上限（预检或复检命中均归此哨兵，调用方 errors.Is 分类）
var ErrB64TooLarge = errors.New("base64 解码结果超过大小上限")

// DecodeBase64Limited 受限 base64 解码（StdEncoding）。
// 三段式：len*3/4 预检（不解码即拒绝，防 GB 级字符串先全额物化）→ 解码 → 复检。
// max <= 0 时仅解码不做大小限制。
// 预检前剥离 \r\n（MIME/PEM 风格多行 base64）：DecodeString 解码时忽略换行，
// 预检若按原始长度算上界会把带换行的合法输入误判为超大——预检口径与解码器对齐。
func DecodeBase64Limited(s string, max int64) ([]byte, error) {
	if strings.ContainsAny(s, "\r\n") {
		s = strings.ReplaceAll(s, "\r", "")
		s = strings.ReplaceAll(s, "\n", "")
	}
	if max > 0 && int64(len(s))*3/4 > max {
		return nil, ErrB64TooLarge
	}
	data, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, err
	}
	if max > 0 && int64(len(data)) > max {
		return nil, ErrB64TooLarge
	}
	return data, nil
}
