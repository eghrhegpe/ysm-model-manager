// ===== extractTextureViaYSM 注入解码器测试 =====
// 2026-08-08 架构决策后 .ysm 封面走注入解码器（go/ysm.SetDecoder，internal/app 注入
// Node+WASM 实现），本文件用 mock 解码器验证提取逻辑与未注入降级路径
package fileops

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/ysm"
)

func TestExtractTextureViaYSM_NoDecoderInjected(t *testing.T) {
	// 解码器未注入（测试默认状态）→ 按不可用报错，静默降级
	path := filepath.Join(t.TempDir(), "m.ysm")
	if err := os.WriteFile(path, []byte("YSGP\x00test"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if _, err := extractTextureViaYSM(path); err == nil {
		t.Fatal("未注入解码器应报错")
	}
}

func TestExtractTextureViaYSM_MockDecoderHitPNG(t *testing.T) {
	// 注入 mock：解码产物含 geometry JSON + PNG → 命中纹理
	png := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}
	ysm.SetDecoder(func(data []byte) []ysm.DecodedFile {
		return []ysm.DecodedFile{
			{Path: "output/geo/main.json", Data: []byte(`{"minecraft:geometry":[]}`)},
			{Path: "output/textures/skin.png", Data: png},
		}
	})
	t.Cleanup(func() { ysm.SetDecoder(nil) })

	path := filepath.Join(t.TempDir(), "m.ysm")
	if err := os.WriteFile(path, []byte("YSGP\x00test"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	got, err := extractTextureViaYSM(path)
	testutil.NoError(t, err, "注入解码器不应报错")
	if string(got) != string(png) {
		t.Errorf("应返回解码出的 PNG, 得到 %d 字节", len(got))
	}
}

func TestExtractTextureViaYSM_MockDecoderNoPNG(t *testing.T) {
	// 注入 mock 但产物无纹理 → 报错（调用方按无封面处理）
	ysm.SetDecoder(func(data []byte) []ysm.DecodedFile {
		return []ysm.DecodedFile{
			{Path: "output/geo/main.json", Data: []byte(`{"minecraft:geometry":[]}`)},
		}
	})
	t.Cleanup(func() { ysm.SetDecoder(nil) })

	path := filepath.Join(t.TempDir(), "m.ysm")
	if err := os.WriteFile(path, []byte("YSGP\x00test"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if _, err := extractTextureViaYSM(path); err == nil {
		t.Fatal("无纹理产物应报错")
	}
}

func TestExtractTextureViaYSM_MissingFile(t *testing.T) {
	// 文件不存在 → 读取失败报错（无需解码器）
	path := filepath.Join(t.TempDir(), "absent.ysm")
	if _, err := extractTextureViaYSM(path); err == nil {
		t.Fatal("文件不存在应报错")
	}
}
