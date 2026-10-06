package app

import (
	"testing"
)

// ===== imagePixelArea（纹理尺寸序的核心度量）=====
//
// 失败模式 = 排序静默错：面积算错不会报错，只会让主纹理贴错（arrow 置首的历史 bug）。
// 故这里的断言钉「解析出的面积」与「排序优先级结果」，而非「没 panic」。

// pngHeader 构造 24 字节 PNG 头（签名 + 长度 + IHDR + big-endian w/h）
func pngHeader(w, h uint32) []byte {
	b := make([]byte, 24)
	copy(b[:8], []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A})
	b[12], b[13], b[14], b[15] = 'I', 'H', 'D', 'R'
	b[16], b[17], b[18], b[19] = byte(w>>24), byte(w>>16), byte(w>>8), byte(w)
	b[20], b[21], b[22], b[23] = byte(h>>24), byte(h>>16), byte(h>>8), byte(h)
	return b
}

// jpegSegment 构造一段 JPEG 标记段：FF marker len_hi len_lo payload...
// 注意自带头部 FF：调用方前缀只需 SOI(FF D8)，再拼本函数（勿再补裸 FF，否则扫描器把
// 标记读成 0xFF 并按 0xC000 长度跳跃 → 静默返回 0）。
func jpegSegment(marker byte, payload []byte) []byte {
	segLen := len(payload) + 2
	seg := []byte{0xFF, marker, byte(segLen >> 8), byte(segLen)}
	return append(seg, payload...)
}

// jpegSOI JPEG 起始两字节（其后必须紧跟段头 FF）
var jpegSOI = []byte{0xFF, 0xD8}

// sofPayload 构造 SOF 段负载：精度(1) + 高(2) + 宽(2) + 其余
func sofPayload(h, w uint16) []byte {
	return []byte{0x08, byte(h >> 8), byte(h), byte(w >> 8), byte(w), 0x03, 0x01, 0x11, 0x00}
}

func TestImagePixelArea_NonImage(t *testing.T) {
	for _, tc := range []struct {
		name string
		data []byte
	}{
		{"nil", nil},
		{"空切片", []byte{}},
		{"短字节", []byte{1, 2, 3}},
		{"仅PNG签名头不足24", []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}},
		{"PNG签名但非IHDR", func() []byte {
			b := pngHeader(64, 64)
			copy(b[12:16], []byte("IDAT"))
			return b
		}()},
		{"仅JPEG SOI", []byte{0xFF, 0xD8}},
		{"JPEG SOI+裸标记头不足4", []byte{0xFF, 0xD8, 0xFF, 0xC0}},
		{"JPEG无SOF段", append(append([]byte{}, jpegSOI...), jpegSegment(0xE0, []byte("JFIF\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"))...)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := imagePixelArea(tc.data); got != 0 {
				t.Fatalf("无法解析应返回 0, got %d", got)
			}
		})
	}
}

func TestImagePixelArea_PNG(t *testing.T) {
	// 面积 = w*h 且为 big-endian：512×512 主贴图 vs 64×64 装饰
	if got := imagePixelArea(pngHeader(512, 512)); got != 512*512 {
		t.Fatalf("512x512 = %d, want %d", got, 512*512)
	}
	if got := imagePixelArea(pngHeader(1, 1)); got != 1 {
		t.Fatalf("1x1 = %d, want 1", got)
	}
	// 宽高不对称：验证字段未串位（w 在 offset 16，h 在 offset 20）
	if got := imagePixelArea(pngHeader(300, 7)); got != 300*7 {
		t.Fatalf("300x7 = %d, want %d（宽高字段串位？）", got, 300*7)
	}
}

func TestImagePixelArea_JPEG(t *testing.T) {
	t.Run("SOF0基础", func(t *testing.T) {
		data := append(append([]byte{}, jpegSOI...), jpegSegment(0xC0, sofPayload(512, 256))...)
		if got := imagePixelArea(data); got != 512*256 {
			t.Fatalf("SOF0 = %d, want %d", got, 512*256)
		}
	})

	t.Run("跨过APP0段后命中SOF2(渐进式)", func(t *testing.T) {
		data := append([]byte{}, jpegSOI...)
		data = append(data, jpegSegment(0xE0, []byte("JFIF\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"))...)
		data = append(data, jpegSegment(0xC2, sofPayload(64, 32))...)
		if got := imagePixelArea(data); got != 64*32 {
			t.Fatalf("SOF2 = %d, want %d", got, 64*32)
		}
	})

	t.Run("跳过无尺寸的DHT段不误判为SOF", func(t *testing.T) {
		// 0xC4(DHT) 落在 0xC0-0xCF 区间但无尺寸字段：若未排除会按 SOF 偏移读出错误面积
		data := append([]byte{}, jpegSOI...)
		data = append(data, jpegSegment(0xC4, []byte{0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09})...)
		data = append(data, jpegSegment(0xC0, sofPayload(100, 200))...)
		if got := imagePixelArea(data); got != 100*200 {
			t.Fatalf("DHT 后 SOF = %d, want %d（DHT/DAC/JPG 排除失效）", got, 100*200)
		}
	})

	t.Run("跳过RSTn标记", func(t *testing.T) {
		data := append([]byte{}, jpegSOI...)
		data = append(data, 0xFF, 0xD0) // RST0：无长度字段，只前进 2 字节
		data = append(data, 0xFF, 0xD1)
		data = append(data, jpegSegment(0xC0, sofPayload(8, 16))...)
		if got := imagePixelArea(data); got != 8*16 {
			t.Fatalf("RST 后 SOF = %d, want %d", got, 8*16)
		}
	})

	t.Run("填充字节非FF时逐字节前进", func(t *testing.T) {
		// APP0(长度4) 走完后 i=8 落在填充字节 0x41/0x42 上：扫描须逐字节 i++ 直到下一个 0xFF
		data := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0x41, 0x42}
		data = append(data, jpegSegment(0xC0, sofPayload(20, 10))...)
		if got := imagePixelArea(data); got != 20*10 {
			t.Fatalf("填充后 SOF = %d, want %d", got, 20*10)
		}
	})

	t.Run("数据不足以容纳SOF段返回0", func(t *testing.T) {
		// 循环守卫 i+9 <= len(data) 必须先成立才会读到 SOF，截断流在守卫处即停
		short := []byte{0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08}
		if got := imagePixelArea(short); got != 0 {
			t.Fatalf("截断数据应返回 0, got %d", got)
		}
	})
}

// TestJPEGMarkerPredicates SOF 识别与「无长度标记」判据逐条钉死（决定扫描步进的正确性）
func TestJPEGMarkerPredicates(t *testing.T) {
	sof := []byte{0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
	for _, m := range sof {
		if !jpegMarkerIsSOF(m) {
			t.Errorf("marker 0x%02X 应判为 SOF（有尺寸字段）", m)
		}
	}
	// 同区间但无尺寸字段：DHT(0xC4)/JPG(0xC8)/DAC(0xCC)，误判即读出错面积
	for _, m := range []byte{0xC4, 0xC8, 0xCC} {
		if jpegMarkerIsSOF(m) {
			t.Errorf("marker 0x%02X 不应判为 SOF（无尺寸字段）", m)
		}
	}
	// 区间外
	for _, m := range []byte{0xBF, 0xD0, 0xE0, 0xFF} {
		if jpegMarkerIsSOF(m) {
			t.Errorf("marker 0x%02X 在 SOF 区间外", m)
		}
	}
	for _, m := range []byte{0xD0, 0xD1, 0xD7, 0xD8, 0xD9} {
		if !jpegMarkerHasNoLength(m) {
			t.Errorf("marker 0x%02X 应判为无长度标记", m)
		}
	}
	for _, m := range []byte{0xC0, 0xC4, 0xDA, 0xE0} {
		if jpegMarkerHasNoLength(m) {
			t.Errorf("marker 0x%02X 有长度字段，不应跳过", m)
		}
	}
}

// TestOrderTexBySize_Priority 排序优先级不变量（失败模式 = 静默贴错纹理）：
//  1. 面积大的在前（512×512 主贴图必须压过 64×64 箭头）
//  2. 面积相同保持原序（SliceStable，不得因排序抖动换纹理）
//  3. names/datas 同名同序（错位即前端贴到别的模型上）
//  4. 无法解析的图（面积 0）排到有面积的之后，但彼此保持原序
func TestOrderTexBySize_Priority(t *testing.T) {
	items := []ysmTexItem{
		{name: "arrow", raw: pngHeader(64, 64), mime: "image/png"},
		{name: "main", raw: pngHeader(512, 512), mime: "image/png"},
		{name: "tieA", raw: pngHeader(64, 64), mime: "image/png"},
		{name: "tieB", raw: pngHeader(64, 64), mime: "image/png"},
		{name: "broken", raw: []byte{1, 2, 3}, mime: "image/png"},
		{name: "wide", raw: pngHeader(1024, 16), mime: "image/png"},
	}
	names := []string{"arrow", "main", "tieA", "tieB", "broken", "wide"}
	datas := []string{"d:arrow", "d:main", "d:tieA", "d:tieB", "d:broken", "d:wide"}

	gotNames, gotData := orderTexBySize(names, datas, items)
	// main(262144) > wide(16384) > arrow==tieA==tieB(4096, 原序稳定) > broken(0)
	wantNames := []string{"main", "wide", "arrow", "tieA", "tieB", "broken"}
	wantData := []string{"d:main", "d:wide", "d:arrow", "d:tieA", "d:tieB", "d:broken"}

	if len(gotNames) != len(wantNames) {
		t.Fatalf("排序长度不匹配: got %v, want %v", gotNames, wantNames)
	}
	for i := range wantNames {
		if gotNames[i] != wantNames[i] {
			t.Fatalf("纹理序优先级错（第 %d 位）:\n  got:  %v\n  want: %v", i, gotNames, wantNames)
		}
		if gotData[i] != wantData[i] {
			t.Fatalf("names/datas 错位（第 %d 位）:\n  got:  %v\n  want: %v", i, gotData, wantData)
		}
	}
}

// TestOrderTexBySize_SingleAndEmpty 边界：0/1 项直接原样返回，不进排序
func TestOrderTexBySize_SingleAndEmpty(t *testing.T) {
	if n, d := orderTexBySize(nil, nil, nil); len(n) != 0 || len(d) != 0 {
		t.Fatalf("空输入应原样返回，got %v %v", n, d)
	}
	n, d := orderTexBySize([]string{"only"}, []string{"d:only"}, []ysmTexItem{{name: "only", raw: pngHeader(8, 8)}})
	if len(n) != 1 || n[0] != "only" || d[0] != "d:only" {
		t.Fatalf("单项应原样返回，got %v %v", n, d)
	}
}
