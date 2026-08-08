package geometry

// ====== testdata 真实模型样本（从 upstream 裁剪的最小复现）======
// 来源：upstream/【战双】露西亚-深红囚影（YSGP 容器 Node+WASM 解码产物裁剪）
// - main.json：从 209 骨骼裁剪为 Root/AllBody/UpBody/AllHead/Head 骨骼链
// - arm.json：保留 8 骨骼（RightArm 等第一人称手臂组件）
// - 01tex.png / 02tex.png：真实纹理（>4KB，收集过滤阈值以上）
// - ysm.json：声明 model [main.json, arm.json] + texture [01tex.png, 02tex.png]
// 目标：用真实模型的特征校验组件序/TexSlot/TextureNames 不变式，
// 而不依赖合成夹具的"理想化"输入。

import (
	"archive/zip"
	"bytes"
	"os"
	"testing"
)

// loadTestdataZip 读取 testdata/multi_tex 全部文件并打包为 zip 字节
// （PNG 二进制经 []byte 直写，不经 string 中转，保证无损）
func loadTestdataZip(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	dir := "testdata/multi_tex"
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("读取 testdata 失败: %v", err)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		data, err := os.ReadFile(dir + "/" + e.Name())
		if err != nil {
			t.Fatalf("读取 %s 失败: %v", e.Name(), err)
		}
		w, err := zw.Create(e.Name())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// TestComponentsFromRealSample 真实样本多组件契约：
// main 优先 + 组件序 + TexSlot 全局化（无钳制）
func TestComponentsFromRealSample(t *testing.T) {
	data := loadTestdataZip(t)
	comps, texNames, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip 失败: %v", err)
	}
	if len(comps) != 2 {
		t.Fatalf("期望 2 组件（main+arm）, 得到 %d", len(comps))
	}
	// R1 契约：组件序纹理名（i < len(texOrder) 用声明序纹理名），
	// 与 TextureNames 同口径（去扩展名）
	if len(texNames) != 2 {
		t.Fatalf("texNames = %d, 期望 2", len(texNames))
	}
	if texNames[0] != "01tex" || texNames[1] != "02tex" {
		t.Errorf("texNames = %v, 期望 [01tex 02tex]（ysm texture 声明序, 去扩展名）", texNames)
	}

	names0 := make(map[string]bool)
	for _, b := range comps[0].Bones {
		names0[b.Name] = true
	}
	names1 := make(map[string]bool)
	for _, b := range comps[1].Bones {
		names1[b.Name] = true
	}

	// main 优先：组件 0 应含 main 的骨骼链（Root/UpBody/Head）
	if !names0["Root"] || !names0["UpBody"] || !names0["Head"] {
		t.Errorf("组件 0 应为 main（含 Root/UpBody/Head）, 实际骨骼: %v", keysOf(names0))
	}
	// 组件 1 应为 arm（RightArm 等第一人称手臂）
	if !names1["RightArm"] {
		t.Errorf("组件 1 应为 arm（含 RightArm）, 实际骨骼: %v", keysOf(names1))
	}

	// TexSlot 全局化：main→0, arm→1（无钳制，组件序）
	for _, b := range comps[0].Bones {
		for _, c := range b.Cubes {
			if c.TexSlot != 0 {
				t.Errorf("main 组件 cube TexSlot = %d, 期望 0", c.TexSlot)
			}
			if c.CubeTexW != 256 || c.CubeTexH != 256 {
				t.Errorf("main 组件 CubeTexW/H = %d/%d, 期望 256/256（真实模型纹理尺寸）", c.CubeTexW, c.CubeTexH)
			}
		}
	}
	for _, b := range comps[1].Bones {
		for _, c := range b.Cubes {
			if c.TexSlot != 1 {
				t.Errorf("arm 组件 cube TexSlot = %d, 期望 1", c.TexSlot)
			}
		}
	}
}

// TestTextureNamesFromRealSample 真实样本纹理名契约：
// TextureNames 与 pngs 同长、去扩展名、按 ysm texture 声明序
func TestTextureNamesFromRealSample(t *testing.T) {
	data := loadTestdataZip(t)
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if len(pngs) != 2 {
		t.Fatalf("pngs = %d, 期望 2（真实样本 2 张纹理）", len(pngs))
	}
	if len(model.TextureNames) != len(pngs) {
		t.Fatalf("TextureNames = %d, 期望与 pngs 同长 %d", len(model.TextureNames), len(pngs))
	}
	// 去扩展名 + 按 ysm texture 声明序（01tex 在前, 02tex 在后）
	if model.TextureNames[0] != "01tex" || model.TextureNames[1] != "02tex" {
		t.Errorf("TextureNames = %v, 期望 [01tex 02tex]（真实模型命名）", model.TextureNames)
	}
}

// keysOf 输出 map 键集合（测试断言辅助）
func keysOf(m map[string]bool) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}
