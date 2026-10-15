// mmd_stats_test.go：MMD 统计级解析（ADR-346 刀 1）——PMX/PMD 骨骼数 + 纹理尺寸。
// fixtures 全部合成（本地无 MMD 样本，ADR-346 §4）：PMX 按 1.1 规范最小组、
// PMD 按 v1.0/v2.0 公开头部布局（双魔数 1284595134/1284595136）。
package mmd

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// ── 合成 fixtures ──

// writePmxFixture 造一个 PMX 1.1 最小组：bone_count 头声明 + 骨骼节区 + 纹理节区。
// texWithSize 非空时给 texture 带 <texsize>（直接尺寸源）；否则 texture 只有
// <tex> 相对引用（尺寸须探测同目录 PNG 头）；无纹理引用时 texture 节区为空。
func writePmxFixture(t *testing.T, dir, name string, bones int, texRelPath, texWithSize string) string {
	t.Helper()
	boneSection := ""
	for i := 0; i < bones; i++ {
		boneSection += fmt.Sprintf(
			`<bone name="b%d" trans="0 0 0" rot="1 0 0 0" parent="-1" side="0" visible="1" enabled="1" tobone="0" enabled="1" fixedaxis="0" hasmutable="0" noforce="0"/>`,
			i)
	}
	var texSection string
	// 原为单 case 的 `switch { case ...: }`——gocritic singleCaseSwitch 判红，
	// 且 case 体无 fallthrough 语义，改 if 等价。
	if texRelPath != "" {
		if texWithSize != "" {
			texSection = fmt.Sprintf(`<texture><name>t0</name><tex>%s</tex><texsize>%s</texsize></texture>`,
				texRelPath, texWithSize)
		} else {
			texSection = fmt.Sprintf(`<texture><name>t0</name><tex>%s</tex></texture>`, texRelPath)
		}
	}
	doc := `<?xml version="1.0" encoding="utf-8"?>` +
		`<model texcoord_count="1" vertex_count="1" uv_index_count="1" morph_count="0" material_count="1" part_count="0" bone_count="` +
		itoa(bones) + `" group_count="0" rigidbody_count="0" display_count="0">` +
		`<name>f</name><meta></meta>` +
		`<vertex><index><index index="0" uvindex="0" material="0"/></index></vertex>` +
		`<bone>` + boneSection + `</bone>` +
		`<morph/><material><name>m</name></material>` +
		texSection +
		`<blendshape/><collision/><joint/><imjoint/><extra>0</extra><addbone/><extra0/><extra1/><extra2/>` +
		`</model>`
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(doc), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

// writePngIhdr 造一个 IHDR 头有效的最小 PNG（1x1，尺寸 w×h 写入头 16-24 字节）。
func writePngIhdr(t *testing.T, dir, name string, w, h uint32) string {
	t.Helper()
	b := make([]byte, 24)
	copy(b, []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 'I', 'H', 'D', 'R'})
	binary.BigEndian.PutUint32(b[16:], w)
	binary.BigEndian.PutUint32(b[20:], h)
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, b, 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}

// writePmdFixture 按 PMD 公开布局造文件：魔数 + 版本 + name/comment(int32 长度前缀
// + 字符 + NUL) + 顶点数 + 顶点块 + 面数 + 面块 + 骨骼数（统计目标）+ 1 骨占位。
// vertex/face 块 = 零填充（统计器按计数跳块，不读内容）。
func writePmdFixture(t *testing.T, dir, name string, version byte, bones int) string {
	t.Helper()
	// v2.0: vertex 24B/个, face 18B/个；v1.0: vertex 12B/个, face 6B/个
	vertexStride, faceStride := 12, 6
	if version == '2' {
		vertexStride, faceStride = 24, 18
	}
	nVerts, nFaces := 2, 1
	var buf bytes.Buffer
	magic := uint32(0x4D4F4432)
	if version == '1' {
		magic = 0x4D4F4434
	}
	_ = binary.Write(&buf, binary.LittleEndian, magic)
	_ = binary.Write(&buf, binary.LittleEndian, uint32(0x766F322E)) // "v?0." 占位（统计器不读版本串内容，按魔数判布局）
	putStr := func(s string) {
		_ = binary.Write(&buf, binary.LittleEndian, uint32(len(s)))
		buf.WriteString(s)
		buf.WriteByte(0)
	}
	putStr("model")
	putStr("comment")
	_ = binary.Write(&buf, binary.LittleEndian, uint32(nVerts))
	buf.Write(make([]byte, nVerts*vertexStride))
	_ = binary.Write(&buf, binary.LittleEndian, uint32(nFaces))
	buf.Write(make([]byte, nFaces*faceStride))
	_ = binary.Write(&buf, binary.LittleEndian, uint32(bones))
	buf.WriteString("bone") // 1 骨占位（骨数据区统计器不读）
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

// ── 测试 ──

func TestParsePmxStats(t *testing.T) {
	base := t.TempDir()

	// 无纹理引用：骨计数 + 纹理尺寸零值（诚实 0,0）
	p1 := writePmxFixture(t, base, "none.pmx", 3, "", "")
	s, err := ParsePmxStats(p1)
	if err != nil {
		t.Fatalf("ParsePmxStats: %v", err)
	}
	if s.BoneCount != 3 || s.TexWidth != 0 || s.TexHeight != 0 {
		t.Errorf("无纹理组 = %+v，期望 bone=3 tex=0x0", s)
	}

	// texsize 直读（不碰文件）
	p2 := writePmxFixture(t, base, "sized.pmx", 5, "tex/t.png", "128,256")
	s, err = ParsePmxStats(p2)
	if err != nil {
		t.Fatalf("ParsePmxStats: %v", err)
	}
	if s.BoneCount != 5 || s.TexWidth != 128 || s.TexHeight != 256 {
		t.Errorf("texsize 直读 = %+v，期望 bone=5 tex=128x256", s)
	}

	// 无 texsize + 引用同目录 PNG → IHDR 探测
	if err := os.MkdirAll(filepath.Join(base, "tex"), 0o755); err != nil {
		t.Fatal(err)
	}
	writePngIhdr(t, filepath.Join(base, "tex"), "probe.png", 64, 128)
	p3 := writePmxFixture(t, base, "probe.pmx", 2, "tex/probe.png", "")
	s, err = ParsePmxStats(p3)
	if err != nil {
		t.Fatalf("ParsePmxStats: %v", err)
	}
	if s.BoneCount != 2 || s.TexWidth != 64 || s.TexHeight != 128 {
		t.Errorf("IHDR 探测 = %+v，期望 bone=2 tex=64x128", s)
	}

	// 引用文件缺失 → 纹理尺寸诚实零值（不报错、不猜）
	p4 := writePmxFixture(t, base, "missing.pmx", 1, "tex/gone.png", "")
	s, err = ParsePmxStats(p4)
	if err != nil {
		t.Fatalf("ParsePmxStats: %v", err)
	}
	if s.TexWidth != 0 || s.TexHeight != 0 {
		t.Errorf("缺失纹理引用 = %+v，期望 tex 零值", s)
	}
}

func TestParsePmdStats(t *testing.T) {
	base := t.TempDir()

	for _, tc := range []struct {
		name    string
		version byte
		bones   int
	}{
		{"pmd2", '2', 12},
		{"pmd1", '1', 7},
	} {
		p := writePmdFixture(t, base, tc.name+".pmd", tc.version, tc.bones)
		s, err := ParsePmdStats(p)
		if err != nil {
			t.Fatalf("ParsePmdStats(%s): %v", tc.name, err)
		}
		if s.BoneCount != tc.bones {
			t.Errorf("%s BoneCount = %d，期望 %d", tc.name, s.BoneCount, tc.bones)
		}
		// PMD 纹理尺寸不探测（§决策：PMT 尾块探测属扩展项）——诚实零值
		if s.TexWidth != 0 || s.TexHeight != 0 {
			t.Errorf("%s 纹理尺寸应为诚实零值，got %dx%d", tc.name, s.TexWidth, s.TexHeight)
		}
	}
}

func TestParsePmdStats_InvalidMagic(t *testing.T) {
	base := t.TempDir()
	p := filepath.Join(base, "bad.pmd")
	if err := os.WriteFile(p, []byte("not a pmx file at all"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ParsePmdStats(p); err == nil {
		t.Error("非法魔数应报错（不猜）")
	}
}

func TestParsePmxStats_InvalidXml(t *testing.T) {
	base := t.TempDir()
	p := filepath.Join(base, "bad.pmx")
	if err := os.WriteFile(p, []byte("not xml"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ParsePmxStats(p); err == nil {
		t.Error("非 XML 内容应报错（不猜）")
	}
}
