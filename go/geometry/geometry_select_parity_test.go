// ===== geometry 选择链双端对账（2026-10-11 审计 G-geometry 收口）=====
// 黄金语料：tests/fixtures/parity/geometry-select.golden.json（单一事实源，双端共享，
// 沿 texture-order / cube-mesh / ysm-summary parity 先例）。
// 主源 = Go geometry/parse.go|ParseBedrockGeometry；regen：
//
//	YSM_PARITY_REGEN=1 go test ./go/geometry -run TestGeometrySelectParity
//
// TS 消费方：frontend/src/preview-3d/model/geometry-select-parity.test.ts（走生产入口
// buildSpecFromGeometryJSON，不手搓入参）。任一侧选择链漂移即对账失败。
//
// 【为什么这块必须上机器守卫】spec-builder.ts|parseBedrockGeometry 是 Go
// geometry/parse.go 的手抄镜像（16db29a8d 按 Go 四段同构对齐结构面）。与
// texture-order / cube-mesh 同型的「两侧各有测试、各自绿、不互对账」形态——那两族
// 已被实证出 3+1 处真实分叉（声明命中回退/空壳跳选/GUI 过滤/键序互换）。选择链
// 决定「同一份 geometryRaw 跨通道选哪个模型」，分叉后果 = 桌面 Go 通道与网页兜底
// 通道渲染不同模型（比纹理序回退更严重）。
//
// 【口径】只锁**选择链骨架**（选了哪条/哪个键、GUI 过滤后剩哪些骨、纹理尺寸钳制、
// 空模型/null 契约），不锁 cube 逐值（positions/uvs 等属 cube-mesh 语料射程）；
// 骨架字段全为 字符串/整数/布尔——JSON 数字跨语言逐位一致，无容差、无浮点噪声。
package geometry

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/threejs"
	"ysm-model-manager/go/types"
)

// gsParityBone 语料内骨骼骨架（与 TS 侧提取面同字段）。
type gsParityBone struct {
	Name      string `json:"name"`
	Parent    string `json:"parent"`
	CubeCount int    `json:"cubeCount"`
}

// gsParityExpected 选择链结果骨架。reject = Go 侧 ParseBedrockGeometry 返回 nil
// **或** 零骨骼空模型（TS 侧两态同落 "{}"，契约同形）；骨架在 reject 时无意义
// （零值），比对只看 reject 位。
type gsParityExpected struct {
	Reject     bool           `json:"reject"`
	TexW       int            `json:"texW,omitempty"`
	TexH       int            `json:"texH,omitempty"`
	TextureID  *string        `json:"textureId"`
	Bones      []gsParityBone `json:"bones,omitempty"`
	TotalCubes int            `json:"totalCubes,omitempty"`
}

type gsParityCase struct {
	ID       string            `json:"id"`
	Note     string            `json:"$note,omitempty"`
	Input    string            `json:"input"`
	Expected *gsParityExpected `json:"expected"`
}

type gsParityGoldenFile struct {
	Comment   string         `json:"$comment"`
	Semantics string         `json:"$semantics"`
	Cases     []gsParityCase `json:"cases"`
}

const gsParityGoldenPath = "../../tests/fixtures/parity/geometry-select.golden.json"

// gsSkeleton 从**spec 层**提取选择链骨架（与 TS 侧 buildSpecFromGeometryJSON
// 的提取面同层同字段——模型层 texW 是 0 哨兵、spec 层已做 0→defaultTexSize(64)
// 兜底，跨层对账必假分叉，故 Go 侧同样走 threejs.BuildMulti 落 spec 再提取）。
func gsSkeleton(m *types.BedrockModel) *gsParityExpected {
	if m == nil || len(m.Bones) == 0 {
		return &gsParityExpected{Reject: true}
	}
	spec, err := threejs.BuildMulti([]types.BedrockModel{*m}, nil)
	if err != nil || spec == "{}" {
		// 语料全为良构输入，spec 构建失败/空组即选择链异常——按拒绝态对账
		return &gsParityExpected{Reject: true}
	}
	var o struct {
		Models []struct {
			TextureWidth  float64 `json:"textureWidth"`
			TextureHeight float64 `json:"textureHeight"`
			TextureID     *string `json:"textureId"`
			Bones         []struct {
				Name      string  `json:"name"`
				ParentID  *string `json:"parentId"`
				CubeCount int     `json:"_cubeCount"`
			} `json:"bones"`
		} `json:"models"`
	}
	if err := json.Unmarshal([]byte(spec), &o); err != nil || len(o.Models) == 0 {
		return &gsParityExpected{Reject: true}
	}
	g := o.Models[0]
	bones := make([]gsParityBone, 0, len(g.Bones))
	total := 0
	for _, b := range g.Bones {
		parent := ""
		if b.ParentID != nil {
			parent = *b.ParentID
		}
		bones = append(bones, gsParityBone{Name: b.Name, Parent: parent, CubeCount: b.CubeCount})
		total += b.CubeCount
	}
	return &gsParityExpected{Reject: false, TexW: int(g.TextureWidth), TexH: int(g.TextureHeight), TextureID: g.TextureID, Bones: bones, TotalCubes: total}
}

// diffGSSkeleton 逐字段比对（点名第一个漂移字段）。
func diffGSSkeleton(got, want *gsParityExpected) string {
	if (got == nil) != (want == nil) {
		return fmt.Sprintf("骨架 nil 性不一致 got=%v want=%v", got == nil, want == nil)
	}
	if got.Reject != want.Reject {
		return fmt.Sprintf("reject: got=%v want=%v", got.Reject, want.Reject)
	}
	if got.Reject {
		return ""
	}
	if got.TexW != want.TexW {
		return fmt.Sprintf("texW: got=%d want=%d", got.TexW, want.TexW)
	}
	if got.TexH != want.TexH {
		return fmt.Sprintf("texH: got=%d want=%d", got.TexH, want.TexH)
	}
	if (got.TextureID == nil) != (want.TextureID == nil) {
		return fmt.Sprintf("textureId nil 性: got=%v want=%v", got.TextureID, want.TextureID)
	}
	if got.TextureID != nil && *got.TextureID != *want.TextureID {
		return fmt.Sprintf("textureId: got=%q want=%q", *got.TextureID, *want.TextureID)
	}
	if len(got.Bones) != len(want.Bones) {
		return fmt.Sprintf("bones 数量: got=%d want=%d", len(got.Bones), len(want.Bones))
	}
	for i := range want.Bones {
		g, w := got.Bones[i], want.Bones[i]
		if g.Name != w.Name {
			return fmt.Sprintf("bones[%d].name: got=%q want=%q", i, g.Name, w.Name)
		}
		if g.Parent != w.Parent {
			return fmt.Sprintf("bones[%d].parent: got=%q want=%q", i, g.Parent, w.Parent)
		}
		if g.CubeCount != w.CubeCount {
			return fmt.Sprintf("bones[%d].cubeCount: got=%d want=%d", i, g.CubeCount, w.CubeCount)
		}
	}
	if got.TotalCubes != want.TotalCubes {
		return fmt.Sprintf("totalCubes: got=%d want=%d", got.TotalCubes, want.TotalCubes)
	}
	return ""
}

func TestGeometrySelectParity(t *testing.T) {
	data, err := os.ReadFile(gsParityGoldenPath)
	testutil.NoError(t, err, "读黄金语料失败")
	var gf gsParityGoldenFile
	err = json.Unmarshal(data, &gf)
	testutil.NoError(t, err, "解析黄金语料失败")
	testutil.Equal(t, len(gf.Cases) > 0, true, "黄金语料不得为空")
	regen := os.Getenv("YSM_PARITY_REGEN") == "1"

	for i := range gf.Cases {
		c := gf.Cases[i]
		t.Run(c.ID, func(t *testing.T) {
			got := gsSkeleton(ParseBedrockGeometry([]byte(c.Input)))
			if regen {
				gf.Cases[i].Expected = got
				return
			}
			testutil.NotNil(t, c.Expected, "[%s] golden 缺 expected（先 YSM_PARITY_REGEN=1 生成）", c.ID)
			if d := diffGSSkeleton(got, c.Expected); d != "" {
				t.Errorf("[%s] 选择链漂移: %s", c.ID, d)
			}
		})
	}

	if regen {
		out, err := json.MarshalIndent(gf, "", "  ")
		testutil.NoError(t, err, "MarshalIndent")
		err = os.WriteFile(gsParityGoldenPath, append(out, '\n'), 0o644)
		testutil.NoError(t, err, "写黄金语料失败")
		fmt.Printf("黄金语料已重写: %s\n", gsParityGoldenPath)
	}
}
