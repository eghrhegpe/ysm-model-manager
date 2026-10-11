// ===== 立方体几何双端对账（2026-10-11 巡检第 7 轮：cube-mesh.ts ↔ Go spec.go 手抄双源补自动守卫）=====
// 黄金语料：tests/fixtures/parity/cube-mesh.golden.json（单一事实源，双端共享，
// 沿 texture-order / ysm-summary / container-fingerprint parity 先例）。
// 主源 = Go threejs/spec.go|buildCubeMeshData；regen：
//
//	YSM_PARITY_REGEN=1 go test ./go/threejs -run TestCubeMeshParity
//
// TS 消费方：frontend/src/preview-3d/mesh/cube-mesh-parity.test.ts
// 任一侧展开表漂移即对账失败。
//
// 【为什么这块必须上机器守卫】cube UV 展开表 + 六面顶点序是**每个 cube 每面贴图方向**
// 的地基，且是 JS/Go 各一份的手抄实现。texture-order 的先例（cb1ce8d6d）已证明：
// 「两侧各有测试、各自绿」证不了「两侧互等」——那一族真实分叉了 3 处。cube 侧此前
// 同样只有各自侧手算期望值（JS cube-mesh.test.ts ↔ Go TestBuildCubeMeshData_*），
// 若有人改 Go 表并同步改 Go 测试、另一人改 JS 表并同步改 JS 测试，CI 全绿但已分叉。
//
// 【口径差异声明】
//  1. localRotation 用 1e-9 容差比对，其余（positions/normals/uvs/indices/
//     localPosition/texIdx/id/boneId）**精确比对**。理由：localRotation 走
//     eulerToQuaternion 的 cos/sin/sqrt——Go math 是 fdlibm 移植、JS Math 由实现
//     定义（V8 亦 fdlibm，通常一致但不保证），可差 1 ULP；几何数组全是加减乘除，
//     IEEE754 双精度跨语言逐位一致，故无需容差。1e-9 远小于任何真实公式改动产生的
//     偏差（量级 ≥1e-2），不影响抓漂移。
//  2. 特殊浮点值以字符串哨兵 "nan"/"inf"/"-inf" 表达（JSON 规范无 NaN/Inf 字面量），
//     双端各自映射——否则「NaN 入口拒绝」「inflate 溢出」两类守卫无法进语料。
//     输出侧无此问题：命中守卫即返回 null，golden 记 null。
//  3. parseUV 的 sx/sy/sz 取 **原始 c.Size**（非 inflate/clamp 后），两侧同口径；
//     语料含 inflate+boxUV 组合用例专门钉住这条（膨胀改几何不改 UV 布局）。
package threejs

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"testing"

	"ysm-model-manager/go/types"
)

// cubeParityMesh 与 Go MeshData 同字段（也即 TS MeshData 的字段面）。
type cubeParityMesh struct {
	ID            string     `json:"id"`
	BoneID        string     `json:"boneId"`
	LocalPosition [3]float64 `json:"localPosition"`
	LocalRotation [4]float64 `json:"localRotation"`
	Positions     []float64  `json:"positions"`
	Normals       []float64  `json:"normals"`
	Uvs           []float64  `json:"uvs"`
	Indices       []int      `json:"indices"`
	TexIdx        int        `json:"texIdx"`
}

type cubeParityCase struct {
	ID      string `json:"id"`
	Comment string `json:"$comment,omitempty"`
	Cube    struct {
		Origin   []any  `json:"origin"`
		Size     []any  `json:"size"`
		Pivot    []any  `json:"pivot"`
		PivotSet bool   `json:"pivotSet"`
		UV       []any  `json:"uv"`
		FaceUV   string `json:"faceUV"`
		Rotation []any  `json:"rotation"`
		TexSlot  int    `json:"texSlot"`
		Inflate  any    `json:"inflate"`
		Mirror   bool   `json:"mirror"`
		CubeTexW int    `json:"cubeTexW"`
		CubeTexH int    `json:"cubeTexH"`
	} `json:"cube"`
	BonePivot []any           `json:"bonePivot"`
	TexW      any             `json:"texW"`
	TexH      any             `json:"texH"`
	BoneID    string          `json:"boneID"`
	CubeIdx   int             `json:"cubeIdx"`
	Golden    *cubeParityMesh `json:"golden"`
}

type cubeParityGoldenFile struct {
	Comment   string           `json:"$comment"`
	Semantics string           `json:"$semantics"`
	Cases     []cubeParityCase `json:"cases"`
}

const cubeMeshGoldenPath = "../../tests/fixtures/parity/cube-mesh.golden.json"

// fOf 把语料数值（JSON number 或 "nan"/"inf"/"-inf" 哨兵串）映射为 float64。
func fOf(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		switch x {
		case "nan":
			return math.NaN()
		case "inf":
			return math.Inf(1)
		case "-inf":
			return math.Inf(-1)
		}
	}
	panic(fmt.Sprintf("cubeParity: 非法数值 %#v", v))
}

func vec2Of(a []any) [2]float64 { return [2]float64{fOf(a[0]), fOf(a[1])} }
func vec3Of(a []any) [3]float64 { return [3]float64{fOf(a[0]), fOf(a[1]), fOf(a[2])} }

// runCubeParityCase 按 case 构造输入走真实入口 buildCubeMeshData。
// PivotSet / CubeTexW / CubeTexH 在 Go 侧是 json:"-"（不序列化），故必须从语料
// 显式赋值——这正是语料要把它们写成显式字段的原因。
func runCubeParityCase(c cubeParityCase) *cubeParityMesh {
	cube := types.Cube2D{
		Origin:   vec3Of(c.Cube.Origin),
		Size:     vec3Of(c.Cube.Size),
		Pivot:    vec3Of(c.Cube.Pivot),
		PivotSet: c.Cube.PivotSet,
		UV:       vec2Of(c.Cube.UV),
		FaceUV:   c.Cube.FaceUV,
		Rotation: vec3Of(c.Cube.Rotation),
		TexSlot:  c.Cube.TexSlot,
		Inflate:  fOf(c.Cube.Inflate),
		Mirror:   c.Cube.Mirror,
		CubeTexW: c.Cube.CubeTexW,
		CubeTexH: c.Cube.CubeTexH,
	}
	md := buildCubeMeshData(cube, vec3{fOf(c.BonePivot[0]), fOf(c.BonePivot[1]), fOf(c.BonePivot[2])},
		fOf(c.TexW), fOf(c.TexH), c.BoneID, c.CubeIdx)
	if md == nil {
		return nil
	}
	return &cubeParityMesh{
		ID: md.ID, BoneID: md.BoneID,
		LocalPosition: md.LocalPosition, LocalRotation: md.LocalRotation,
		Positions: md.Positions, Normals: md.Normals, Uvs: md.Uvs,
		Indices: md.Indices, TexIdx: md.TexIdx,
	}
}

// diffCubeMesh 逐字段比对；localRotation 走 1e-9 容差（见文件头口径声明 1），
// 其余精确。返回首个差异描述（空串 = 一致）。
func diffCubeMesh(got, want *cubeParityMesh) string {
	if got == nil || want == nil {
		if (got == nil) != (want == nil) {
			return fmt.Sprintf("null 性不一致 got=%v want=%v", got == nil, want == nil)
		}
		return ""
	}
	if got.ID != want.ID {
		return fmt.Sprintf("id: got=%q want=%q", got.ID, want.ID)
	}
	if got.BoneID != want.BoneID {
		return fmt.Sprintf("boneId: got=%q want=%q", got.BoneID, want.BoneID)
	}
	if got.TexIdx != want.TexIdx {
		return fmt.Sprintf("texIdx: got=%d want=%d", got.TexIdx, want.TexIdx)
	}
	for i, v := range want.LocalRotation {
		if math.Abs(got.LocalRotation[i]-v) > 1e-9 {
			return fmt.Sprintf("localRotation[%d]: got=%v want=%v", i, got.LocalRotation[i], v)
		}
	}
	if d := diffVec3("localPosition", got.LocalPosition, want.LocalPosition); d != "" {
		return d
	}
	if d := diffFloats("positions", got.Positions, want.Positions); d != "" {
		return d
	}
	if d := diffFloats("normals", got.Normals, want.Normals); d != "" {
		return d
	}
	if d := diffFloats("uvs", got.Uvs, want.Uvs); d != "" {
		return d
	}
	return diffInts("indices", got.Indices, want.Indices)
}

func diffVec3(label string, got, want [3]float64) string {
	for i, v := range want {
		if got[i] != v {
			return fmt.Sprintf("%s[%d]: got=%v want=%v", label, i, got[i], v)
		}
	}
	return ""
}

func diffFloats(label string, got, want []float64) string {
	if len(got) != len(want) {
		return fmt.Sprintf("%s 长度: got=%d want=%d", label, len(got), len(want))
	}
	for i, v := range want {
		if got[i] != v {
			return fmt.Sprintf("%s[%d]: got=%v want=%v", label, i, got[i], v)
		}
	}
	return ""
}

func diffInts(label string, got, want []int) string {
	if len(got) != len(want) {
		return fmt.Sprintf("%s 长度: got=%d want=%d", label, len(got), len(want))
	}
	for i, v := range want {
		if got[i] != v {
			return fmt.Sprintf("%s[%d]: got=%d want=%d", label, i, got[i], v)
		}
	}
	return ""
}

func TestCubeMeshParity(t *testing.T) {
	data, err := os.ReadFile(cubeMeshGoldenPath)
	if err != nil {
		t.Fatalf("读黄金语料失败: %v", err)
	}
	var gf cubeParityGoldenFile
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
			got := runCubeParityCase(c)
			if regen {
				gf.Cases[i].Golden = got
				return
			}
			if d := diffCubeMesh(got, c.Golden); d != "" {
				t.Errorf("[%s] 对账漂移：%s", c.ID, d)
			}
		})
	}

	if regen {
		out, err := json.MarshalIndent(gf, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(cubeMeshGoldenPath, append(out, '\n'), 0o644); err != nil {
			t.Fatalf("写黄金语料失败: %v", err)
		}
		fmt.Printf("黄金语料已重写: %s\n", cubeMeshGoldenPath)
	}
}
