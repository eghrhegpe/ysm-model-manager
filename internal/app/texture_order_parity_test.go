// ===== 纹理序双端对账（2026-10-10 锐评：texture-order.ts ↔ texture_order.go 手抄双源补自动守卫）=====
// 黄金语料：tests/fixtures/parity/texture-order.golden.json（单一事实源，双端共享，
// 沿 ysm-summary / container-fingerprint parity 先例）。
// 主源 = Go internal/app/texture_order.go|orderTexItems；regen：
//
//	YSM_PARITY_REGEN=1 go test ./internal/app -run TestTextureOrderParity
//
// TS 消费方：frontend/src/preview-3d/decoder/texture-order-parity.test.ts
// （同 ysm.json 文本 + 同尺寸纹理，断言 buildOrderedTexKeys 产出同黄金值）。
// 任一侧实现漂移即对账失败——此前两侧「严格对称」只靠注释互指，「声明全不命中」
// 分支已真实分叉（Go 回退尺寸序、旧 TS 返回空列表）。
//
// 口径差异声明（fixture $semantics 同步记载）：路径一律正斜杠——Go filepath.Base
// 在 Windows 剥两种分隔符、TS 生产提取（wasm-geometry.matchTexKey 的入参名归一）
// 只认 '/'。语料刻意排除反斜杠输入，属已声明限制非缺陷。
package app

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

type texOrderParityCase struct {
	ID         string  `json:"id"`
	Comment    string  `json:"$comment,omitempty"`
	YsmContent *string `json:"ysmContent"` // null = 无 ysm.json
	Textures   []struct {
		Name string `json:"name"`
		W    int    `json:"w"`
		H    int    `json:"h"`
	} `json:"textures"`
	Golden []string `json:"golden"`
}

type texOrderGoldenFile struct {
	Comment   string               `json:"$comment"`
	Semantics string               `json:"$semantics"`
	Cases     []texOrderParityCase `json:"cases"`
}

const texOrderGoldenPath = "../../tests/fixtures/parity/texture-order.golden.json"

// runTexOrderCase 按 case 构造输入走真实入口 orderTexItems，返回纹理名序。
// 像素面积 = w*h——orderTexBySize 经 imagePixelArea 解析 PNG 头，这里用合成
// 1x1 头不现实，故以「面积注入」等价：items.raw 造合法 PNG 签名头（IHDR 带宽高），
// 与生产 imagePixelArea 同一解析路径（不绕开真码）。
func runTexOrderCase(c texOrderParityCase) []string {
	items := make([]ysmTexItem, 0, len(c.Textures))
	for _, t := range c.Textures {
		items = append(items, ysmTexItem{name: t.Name, raw: fakePNG(t.W, t.H), mime: "image/png"})
	}
	var ysm []byte
	if c.YsmContent != nil {
		ysm = []byte(*c.YsmContent)
	}
	names, _ := orderTexItems(items, ysm)
	return names
}

// fakePNG 造 imagePixelArea 可解析的最小 PNG 头：签名 8B + IHDR 段长 4B + "IHDR" 4B
// + 宽高 8B = 恰好 24B（解析器只读前 24 字节，不校验 CRC/压缩数据）。
func fakePNG(w, h int) []byte {
	be := func(v uint32) []byte { return []byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)} }
	data := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A,
		0x00, 0x00, 0x00, 0x0D, 'I', 'H', 'D', 'R'}
	data = append(data, be(uint32(w))...)
	data = append(data, be(uint32(h))...)
	return data
}

func TestTextureOrderParity(t *testing.T) {
	data, err := os.ReadFile(texOrderGoldenPath)
	if err != nil {
		t.Fatalf("读黄金语料失败: %v", err)
	}
	var gf texOrderGoldenFile
	if err := json.Unmarshal(data, &gf); err != nil {
		t.Fatalf("解析黄金语料失败: %v", err)
	}
	if len(gf.Cases) == 0 {
		t.Fatal("黄金语料为空")
	}
	regen := os.Getenv("YSM_PARITY_REGEN") == "1"

	for i := range gf.Cases {
		c := gf.Cases[i]
		t.Run(c.ID, func(t *testing.T) {
			got := runTexOrderCase(c)
			if regen {
				gf.Cases[i].Golden = got
				return
			}
			gotJSON, _ := json.Marshal(got)
			wantJSON, _ := json.Marshal(c.Golden)
			if string(gotJSON) != string(wantJSON) {
				t.Errorf("[%s] 对账漂移：\n got(Go) = %s\nwant(golden) = %s", c.ID, gotJSON, wantJSON)
			}
		})
	}

	if regen {
		out, err := json.MarshalIndent(gf, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(texOrderGoldenPath, append(out, '\n'), 0o644); err != nil {
			t.Fatalf("写黄金语料失败: %v", err)
		}
		fmt.Printf("黄金语料已重写: %s\n", texOrderGoldenPath)
	}
}
