// mmd_stats.go：MMD 统计级解析（ADR-346 刀 1）——骨骼数 + 纹理尺寸，供 SearchModels
// 数值条件分流（go/geometry 域，统计语义 ≠ 3D 全解析：cube 无 MMD 语义恒 0，
// 纹理尺寸取 texsize 直读或 PNG IHDR 探测，不解码贴图全量）。
//
// PMX（XML 1.0/1.1）：头声明 bone_count 单源；<texture><texsize> 直读，
// 缺失时按 <tex> 相对引用探同目录 PNG 头（IHDR 16-24 字节，引用缺失 = 诚实零值）。
// PMD（二进制 v1.0/v2.0）：按公开布局跳变长节区至 bone_count 定长字段
// （魔数 1284595134 / 1284595136）；纹理尺寸不探测（PMT 尾块 = 扩展项，诚实零值）。
package mmd

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// MmdStats MMD 统计级解析结果（ADR-346：CubeCount 无 MMD 语义，不落字段——
// 消费端 BedrockModel.CubeCount 由分流层按类型置 0，诚实零值）。
type MmdStats struct {
	BoneCount int
	TexWidth  int
	TexHeight int
}

// CanParse 本统计器可解析的扩展名（ADR-346：.pmx/.pmd；.vrm/.zip 无统计链路，
// 诚实零值——能力归解析器自报，分流层不硬编码扩展名表）。
func CanParse(ext string) bool {
	switch strings.ToLower(ext) {
	case ".pmx", ".pmd":
		return true
	}
	return false
}

// ParseStats 按扩展名分派 PMX/PMD 统计解析
func ParseStats(path, ext string) (MmdStats, error) {
	switch strings.ToLower(ext) {
	case ".pmx":
		return ParsePmxStats(path)
	case ".pmd":
		return ParsePmdStats(path)
	}
	return MmdStats{}, fmt.Errorf("mmd 统计器不支持扩展名: %s", ext)
}

// ── PMX（XML）──

// ParsePmxStats 统计级解析 PMX：骨计数取 <model> 头区 bone_count 属性声明（PMX 1.1
// 规范单源；缺失 = 0 不猜——节区计数回退在嵌套骨结构上失真已弃用），纹理尺寸取
// texture 节区 <texsize> 直读或 PNG IHDR 探测（纯字符串扫描——实现迭代实测：
// token 流式 2MB ~110ms、全量 xml.Unmarshal ~65ms 均超 50ms 性能门禁；字符串扫描 ≈ I/O 时间）。
// 16MB 读上限（超限 = 非统计目标，截断不猜全量）。
func ParsePmxStats(path string) (MmdStats, error) {
	f, err := os.Open(path)
	if err != nil {
		return MmdStats{}, err
	}
	defer func() { _ = f.Close() }()
	data, err := io.ReadAll(io.LimitReader(f, 16<<20))
	if err != nil {
		return MmdStats{}, err
	}
	out, ok := scanPmxStats(data)
	if !ok {
		return MmdStats{}, fmt.Errorf("pmx: 无 <model> 头（非 PMX 内容，不猜）")
	}
	// 纹理引用探测（texsize 全缺省时按引用探 PNG IHDR；引用缺失 = 诚实零值）
	for _, ref := range scanPmxTexRefs(data) {
		abs := filepath.Join(filepath.Dir(path), ref)
		if w, h, ok := probePngSize(abs); ok && (w > out.TexWidth || h > out.TexHeight) {
			out.TexWidth, out.TexHeight = w, h
		}
	}
	return out, nil
}

// scanPmxStats 纯字符串扫描 PMX 统计字段（无 XML 解析器依赖，≈ I/O 成本）
func scanPmxStats(data []byte) (MmdStats, bool) {
	var out MmdStats
	// 定位 <model 头区（首个出现；PMX 规范根元素）
	start := bytes.Index(data, []byte("<model"))
	if start < 0 {
		return out, false
	}
	// 头区属性：读至 model 开标签的 '>'
	headEnd := bytes.IndexByte(data[start:], '>')
	if headEnd < 0 {
		return out, false
	}
	// indexAttr 返回**段内**偏移（相对 data[start:]）；atoiAfterEq 吃「值起点起」的段。
	// 0 是合法骨计数（无骨骼模型），不触发回退——节区回退已弃用（嵌套骨结构取首个
	// </bone> 必失真），缺 bone_count 头声明 = 0（PMX 1.1 规范头恒含该属性，缺失即异常，不猜）。
	if i := indexAttr(data[start:start+headEnd], "bone_count"); i >= 0 {
		out.BoneCount = atoiAfterEq(data[start+i : start+headEnd])
	}
	// texture 节区 texsize 直读（全组最大）
	tex := bytes.Index(data, []byte("<texture>"))
	for tex >= 0 {
		texEnd := bytes.Index(data[tex:], []byte("</texture>"))
		if texEnd < 0 {
			break
		}
		section := data[tex : tex+texEnd]
		if ts := bytes.Index(section, []byte("<texsize>")); ts >= 0 {
			rest := section[ts+len("<texsize>"):]
			// 值收束 = 下一标签的 '<'（'</texsize>' 的 '>' 是终止符自身，
			// 误用 IndexByte '>' 会把 "128,256</texsiz" 当值——解析必败）
			if e := bytes.IndexByte(rest, '<'); e > 0 {
				if w, h, ok := parseTexSize(string(rest[:e])); ok && (w > out.TexWidth || h > out.TexHeight) {
					out.TexWidth, out.TexHeight = w, h
				}
			}
		}
		// 多 texture 迭代：下一 <texture> 的绝对位（o 是相对 data[tex+texEnd:] 的偏移）
		if nxt := bytes.Index(data[tex+texEnd:], []byte("<texture>")); nxt >= 0 {
			tex = tex + texEnd + nxt
		} else {
			tex = -1
		}
	}
	return out, true
}

// indexAttr 找 name="<value>" 属性值起点（value 首字符的段内偏移；-1 = 缺失）。
// 偏移口径：needle = name + "=\""（len = len(name)+2），值起点 = i + len(name) + 2。
func indexAttr(seg []byte, name string) int {
	i := bytes.Index(seg, []byte(name+"=\""))
	if i < 0 {
		return -1
	}
	return i + len(name) + 2 // 跳开 name + '=' + '"'，落在 value 首字符
}

// atoiAfterEq 扫描 value 至引号收束解析 int（解析失败 = 0，不猜）
func atoiAfterEq(seg []byte) int {
	e := bytes.IndexByte(seg, '"')
	if e < 0 {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(string(seg[:e])))
	return n
}

// scanPmxTexRefs 提取 texture 节区 <tex> 引用（纯字符串扫描，同 texture 节区定位口径）
func scanPmxTexRefs(data []byte) []string {
	var refs []string
	tex := bytes.Index(data, []byte("<texture>"))
	for tex >= 0 {
		texEnd := bytes.Index(data[tex:], []byte("</texture>"))
		if texEnd < 0 {
			break
		}
		section := data[tex : tex+texEnd]
		if tr := bytes.Index(section, []byte("<tex>")); tr >= 0 {
			rest := section[tr+len("<tex>"):]
			// 值收束 = 下一标签 '<'（同 texsize 口径；'>' 会误连进后续标签）
			if e := bytes.IndexByte(rest, '<'); e > 0 {
				refs = append(refs, string(rest[:e]))
			}
		}
		// 同 scanPmxStats 的多 texture 迭代口径
		if nxt := bytes.Index(data[tex+texEnd:], []byte("<texture>")); nxt >= 0 {
			tex = tex + texEnd + nxt
		} else {
			tex = -1
		}
	}
	return refs
}

// parseTexSize 解析 <texsize>「w,h」声明
func parseTexSize(s string) (int, int, bool) {
	parts := strings.Split(strings.TrimSpace(s), ",")
	if len(parts) != 2 {
		return 0, 0, false
	}
	w, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	h, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return w, h, true
}

// probePngSize 探 PNG 头 IHDR（16-24 字节 big-endian 宽/高）；引用缺失/非 PNG = 零值
func probePngSize(path string) (int, int, bool) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, false
	}
	defer func() { _ = f.Close() }()
	hdr := make([]byte, 24)
	if _, err := io.ReadFull(f, hdr); err != nil {
		return 0, 0, false
	}
	// PNG 签名 8 字节 + IHDR 块头 4（长度）+ 'IHDR'
	if !bytes.Equal(hdr[:8], []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}) ||
		string(hdr[12:16]) != "IHDR" {
		return 0, 0, false
	}
	w := int(binary.BigEndian.Uint32(hdr[16:20]))
	h := int(binary.BigEndian.Uint32(hdr[20:24]))
	if w <= 0 || h <= 0 {
		return 0, 0, false
	}
	return w, h, true
}

// ── PMD（二进制）──

// ParsePmdStats 统计级解析 PMD：按公开布局跳变长节区至 bone_count。
// 布局（v1.0 / v2.0）：魔数(4) 版本(4) name(str) comment(str) 顶点数(4) 顶点块
// （v2: 24B/个，v1: 12B/个） 面数(4) 面块（v2: 18B/个，v1: 6B/个） 骨骼数(4)。
// 魔数 1284595136 = v1.0，1284595134 = v2.0（MMD 工具链公开约定）。
func ParsePmdStats(path string) (MmdStats, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return MmdStats{}, err
	}
	if len(data) < 8 {
		return MmdStats{}, fmt.Errorf("pmd 文件过短: %d", len(data))
	}
	magic := binary.LittleEndian.Uint32(data[0:4])
	var isV2 bool
	switch magic {
	case 0x4D4F4432: // 'M','O','D',0x32
		isV2 = true
	case 0x4D4F4434: // 'M','O','D',0x34
	default:
		return MmdStats{}, fmt.Errorf("pmd 魔数非法: 0x%08x", magic)
	}

	vertexStride, faceStride := 12, 6
	if isV2 {
		vertexStride, faceStride = 24, 18
	}
	off := 8
	// 跳 name / comment（int32 长度前缀 + 字符 + NUL）
	for i := 0; i < 2; i++ {
		if off+4 > len(data) {
			return MmdStats{}, fmt.Errorf("pmd 布局越界(str%d): %d", i, off)
		}
		strLen := int(binary.LittleEndian.Uint32(data[off : off+4]))
		off += 4
		if strLen < 0 || off+strLen+1 > len(data) {
			return MmdStats{}, fmt.Errorf("pmd 布局越界(str%d 长度 %d)", i, strLen)
		}
		off += strLen + 1 // +1 NUL 终止
	}
	// 顶点数 + 顶点块
	if off+4 > len(data) {
		return MmdStats{}, fmt.Errorf("pmd 布局越界(顶点数)")
	}
	verts := int(binary.LittleEndian.Uint32(data[off : off+4]))
	off += 4
	if verts < 0 || off+verts*vertexStride > len(data) {
		return MmdStats{}, fmt.Errorf("pmd 布局越界(顶点块 %d)", verts)
	}
	off += verts * vertexStride
	// 面数 + 面块
	if off+4 > len(data) {
		return MmdStats{}, fmt.Errorf("pmd 布局越界(面数)")
	}
	faces := int(binary.LittleEndian.Uint32(data[off : off+4]))
	off += 4
	if faces < 0 || off+faces*faceStride > len(data) {
		return MmdStats{}, fmt.Errorf("pmd 布局越界(面块 %d)", faces)
	}
	off += faces * faceStride
	// 骨骼数（统计目标）
	if off+4 > len(data) {
		return MmdStats{}, fmt.Errorf("pmd 布局越界(骨骼数)")
	}
	bones := int(binary.LittleEndian.Uint32(data[off : off+4]))
	// 上界守卫：正常 MMD 模型骨骼 ≤ 数千；异常值 = 布局漂移，拒信不猜
	if bones > 100000 {
		return MmdStats{}, fmt.Errorf("pmd bone_count 异常: %d（布局漂移？）", bones)
	}
	return MmdStats{BoneCount: bones}, nil
}
