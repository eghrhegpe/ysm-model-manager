// ===== ZIP 尾部探针（audit #1：探测上限与导入上限口径对齐）=====
// 背景：DetectZipType 原走「整包解码 → 顺序遍历 local file header」，探测上限
// MaxReadLimit(50MB) 与导入上限 MaxImportSize(500MB) 之间形成口径真空——
// 50~500MB 的合法 zip 探测必返 unknown 但导入本身接受。类型判定只需全部条目名，
// 而 zip 的完整条目名列表在末尾 central directory（EOCD 索引）——只需解码 base64
// 末尾窗口即可拿到，内存 O(窗口) 与包体积无关。
package importer

import (
	"encoding/base64"

	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/types"
)

const (
	// zipCentralHeaderSig 中央目录条目签名（PK\x01\x02）
	zipCentralHeaderSig = 0x02014b50
	// zipEOCDSig End Of Central Directory 签名（PK\x05\x06）
	zipEOCDSig = 0x06054b50
	// tailProbeMaxRaw 尾部解码窗口原始字节上限：中央目录每条目约 46+文件名，
	// 4MB 可容纳约 7 万条目；超出（超大条目数/zip64）返回 ok=false 交全量兜底。
	tailProbeMaxRaw = 4 << 20
	// zipEOCDMaxComment EOCD 注释区最大长度（规范上限 65535），定位时向前搜索的边界
	zipEOCDMaxComment = 65535
)

// DetectZipTypeFromBase64Tail 解码 base64 末尾窗口、解析 zip 中央目录条目名并分类。
// 返回 (id, ok)：ok=true 表示尾部探针已给出确定答案（含空串——确为 zip 但无匹配类型）；
// ok=false 表示无法从尾部判定（非 zip / zip64 / 中央目录超出窗口 / 解码失败），
// 调用方应回退到整包解码路径。
func DetectZipTypeFromBase64Tail(b64 string) (string, bool) {
	// base64 契约：标准填充编码（len%4==0），与 DecodeBase64Limited 同源输入
	if len(b64) < 8 || len(b64)%4 != 0 {
		return "", false
	}
	pad := 0
	for i := len(b64) - 1; i >= 0 && b64[i] == '='; i-- {
		pad++
	}
	if pad > 2 {
		return "", false
	}
	rawLen := len(b64)/4*3 - pad

	// 尾部窗口：4 字符组对齐切后缀（每组恒 3 字节，后缀解码即文件末尾原样字节）
	tailChars := len(b64)
	if rawLen > tailProbeMaxRaw {
		tailChars = (tailProbeMaxRaw + 2) / 3 * 4
	}
	data, err := base64.StdEncoding.DecodeString(b64[len(b64)-tailChars:])
	if err != nil {
		return "", false
	}
	fileTailOffset := rawLen - len(data) // 尾部窗口在原文件中的起始偏移

	// 从末尾定位 EOCD（容许注释区，向前最多搜 22+65535 字节）
	eocd := -1
	minIdx := len(data) - 22 - zipEOCDMaxComment
	if minIdx < 0 {
		minIdx = 0
	}
	for i := len(data) - 22; i >= minIdx; i-- {
		if le32(data[i:]) != zipEOCDSig {
			continue
		}
		commentLen := int(le16(data[i+20:]))
		if i+22+commentLen == len(data) {
			eocd = i
			break
		}
	}
	if eocd < 0 {
		return "", false // 无 EOCD：非 zip 或尾部截断，交全量兜底
	}
	totalEntries := int(le16(data[eocd+10:]))
	cdSize := int(le32(data[eocd+12:]))
	cdOffset := int(le32(data[eocd+16:]))
	// zip64（字段触顶 0xFFFF/0xFFFFFFFF）不在本探针范围，交全量兜底
	if totalEntries == 0xFFFF || cdSize == 0xFFFFFFFF || cdOffset == 0xFFFFFFFF {
		return "", false
	}
	cdStart := cdOffset - int(fileTailOffset)
	if cdStart < 0 || cdStart+cdSize > len(data) {
		return "", false // 中央目录超出窗口（条目数超出 tailProbeMaxRaw 容量），交全量兜底
	}

	entries := make([]string, 0, totalEntries)
	idx := cdStart
	end := cdStart + cdSize
	for idx+46 <= end {
		if le32(data[idx:]) != zipCentralHeaderSig {
			break
		}
		nameLen := int(le16(data[idx+28:]))
		extraLen := int(le16(data[idx+30:]))
		commentLen := int(le16(data[idx+32:]))
		if idx+46+nameLen > end {
			break
		}
		entries = append(entries, string(data[idx+46:idx+46+nameLen]))
		idx += 46 + nameLen + extraLen + commentLen
	}
	if len(entries) != totalEntries {
		return "", false // 条目数对不上：解析不完整，宁可兜底不误判
	}
	id := packs.DetectByEntries(entries, types.LoadRegistry())
	if id == packs.ClassContainer || id == packs.ClassOther {
		return "", true
	}
	return id, true
}

// le16/le32 小端读取（与 importer_file.go 逐位移位口径一致，独立小函数避免类型噪声）
func le16(b []byte) uint16 { return uint16(b[0]) | uint16(b[1])<<8 }
func le32(b []byte) uint32 {
	return uint32(b[0]) | uint32(b[1])<<8 | uint32(b[2])<<16 | uint32(b[3])<<24
}
