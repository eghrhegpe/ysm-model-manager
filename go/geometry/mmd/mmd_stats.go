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
	"encoding/xml"
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

// ParsePmxStats 统计级解析 PMX：骨计数取模型头 bone_count 属性（单一事实源，
// 不扫骨骼节区——大文件节区扫描成本无收益，头声明与节区一致性由格式规范保证）。
func ParsePmxStats(path string) (MmdStats, error) {
	f, err := os.Open(path)
	if err != nil {
		return MmdStats{}, err
	}
	defer f.Close()
	// 统计级全读（PMX 文本 XML 数 MB 量级毫秒内；16MB 上限 = 超限非统计目标）
	data, err := io.ReadAll(io.LimitReader(f, 16<<20))
	if err != nil {
		return MmdStats{}, err
	}

	type texInfo struct {
		Name    string `xml:"name"`
		Tex     string `xml:"tex"`
		TexSize string `xml:"texsize"`
	}
	var model struct {
		BoneCount string    `xml:"bone_count,attr"`
		Textures  []texInfo `xml:"texture"`
	}
	if err := xml.Unmarshal(data, &model); err != nil {
		return MmdStats{}, fmt.Errorf("pmx 解析: %w", err)
	}
	bones, err := strconv.Atoi(strings.TrimSpace(model.BoneCount))
	if err != nil {
		return MmdStats{}, fmt.Errorf("pmx bone_count 非法: %q", model.BoneCount)
	}

	var out MmdStats
	out.BoneCount = bones
	// 纹理尺寸取全组最大（过滤语义 = 模型最大纹理，同 Bedrock 管线口径）：
	// 先全量直读 texsize；仍有未决条目才按引用探 PNG IHDR（引用缺失 = 诚实零值）
	probeIdx := []int{}
	for i, tx := range model.Textures {
		if w, h, ok := parseTexSize(tx.TexSize); ok {
			if w > out.TexWidth || h > out.TexHeight {
				out.TexWidth, out.TexHeight = w, h
			}
			continue
		}
		if tx.Tex != "" {
			probeIdx = append(probeIdx, i)
		}
	}
	for _, i := range probeIdx {
		abs := filepath.Join(filepath.Dir(path), model.Textures[i].Tex)
		if w, h, ok := probePngSize(abs); ok {
			if w > out.TexWidth || h > out.TexHeight {
				out.TexWidth, out.TexHeight = w, h
			}
		}
	}
	return out, nil
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
	defer f.Close()
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
