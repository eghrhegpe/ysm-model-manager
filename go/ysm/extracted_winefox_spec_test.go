package ysm

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/threejs"
)

// TestWineFoxBoatSpecTexIdx 用 tests/fixtures/ysm/01_taisho_maid 精简版 fixture 验证
// BuildMulti 输出中 boat 组件的 meshGroups[0].texIdx = 0。
func TestWineFoxBoatSpecTexIdx(t *testing.T) {
	ysmPath := filepath.Join("..", "..", "tests", "fixtures", "ysm", "01_taisho_maid", "ysm.json")
	comps, _ := FindComponentsInExtractedYSM(ysmPath)

	spec, err := threejs.BuildMulti(comps, nil)
	if err != nil {
		t.Fatalf("BuildMulti 失败: %v", err)
	}

	var doc struct {
		Models []struct {
			ID         string                 `json:"id"`
			Name       string                 `json:"name"`
			MeshGroups []struct{ TexIdx int } `json:"meshGroups"`
		} `json:"models"`
	}
	if err := json.Unmarshal([]byte(spec), &doc); err != nil {
		t.Fatalf("spec 解析失败: %v", err)
	}

	for i, mg := range doc.Models {
		var firstTexIdx int
		if len(mg.MeshGroups) > 0 {
			firstTexIdx = mg.MeshGroups[0].TexIdx
		}
		t.Logf("  comp[%d] id=%s name=%-8s meshCount=%d firstTexIdx=%d",
			i, mg.ID, mg.Name, len(mg.MeshGroups), firstTexIdx)
	}

	for i := range doc.Models {
		if doc.Models[i].Name == "boat" {
			for j, mesh := range doc.Models[i].MeshGroups {
				if mesh.TexIdx != 0 {
					t.Errorf("boat mesh[%d].texIdx = %d, 期望 0", j, mesh.TexIdx)
				}
			}
			// 首项 texIdx 先守卫再读（code review：与上方 log 循环同款 len 检查，
			// 空 meshGroups 时干净报错而非 index out of range panic 掩盖结果）
			var firstTexIdx int
			if len(doc.Models[i].MeshGroups) > 0 {
				firstTexIdx = doc.Models[i].MeshGroups[0].TexIdx
			}
			t.Logf("✓ boat: %d 个 mesh，首项 texIdx=%d", len(doc.Models[i].MeshGroups), firstTexIdx)
			return
		}
	}
	t.Fatal("spec 中未找到 name=boat 的 model group")
}
