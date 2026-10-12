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
//     localPosition/texIdx/id/boneId）**逐位精确比对**。理由：其余项全由加减乘构成，
//     IEEE754 对同一运算顺序结果确定——有差异必然是两侧抄写的表达式/结合序不同，
//     不是平台噪声，必须精确才抓得住。本语料正是靠此抓到 JS South 面
//     `u+z+x+z` vs Go `u+sz+sz+sx` 的 1 ULP 分叉（Blockbench 权威为 size[2]*2+size[0]，
//     即 Go 正确、JS 抄错结合序，已修 JS）。localRotation 含 cos/sin/sqrt，跨实现
//     可差 1 ULP，属真噪声，故唯一走容差。
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

	"ysm-model-manager/go/internal/testutil"
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
	Comment           string             `json:"$comment"`
	Semantics         string             `json:"$semantics"`
	SemanticsBoneL    string             `json:"$semanticsBoneLocalPos"`
	SemanticsMerge    string             `json:"$semanticsMergeCubes"`
	Cases             []cubeParityCase   `json:"cases"`
	BoneLocalPosCases []boneLocalPosCase `json:"boneLocalPosCases"`
	MergeCubesCases   []mergeCubesCase   `json:"mergeCubesCases"`
}

// ===== 族②残余：computeBoneLocalPos（Go buildBoneLocalData）对账 =====

// boneLocalPosCase 一条骨骼本地位置对账用例。
// parentPivot=null 表示「根骨骼」**或**「声明了父骨骼但父 pivot 缺失」——Go 侧
// buildBoneLocalData 与 TS computeBoneLocalPos 在这两种情形都回落 X 翻转根公式
// （spec-bones.go L71/L74），故语料把它们收成同一输入形态；
// declaredParent 显式标注 Go 侧 b.Parent 是否非空，驱动走哪条分支
// （TS 侧只看到 parentPivot 空/非空，无法区分根骨骼与父 pivot 缺失——这条靠
// declaredParent 钉死 Go 的分支语义，防日后一方改分支判据另一方不跟）。
type boneLocalPosCase struct {
	ID             string    `json:"id"`
	Comment        string    `json:"$comment,omitempty"`
	BonePivot      []any     `json:"bonePivot"`
	ParentPivot    []any     `json:"parentPivot"` // null = 无父 pivot
	DeclaredParent bool      `json:"declaredParent"`
	Golden         []float64 `json:"golden"` // [x,y,z]，纯加减乘可精确比对
}

// parityCube 全字段立方体快照（mergeCubes 输入/输出 golden 用）。
// Cube2D.PivotSet/CubeTexW/H 在 Go 侧是 json:"-"（不序列化），故语料显式写出、
// regen 后回填——与 buildCubeMeshData 用例对 cube 的处理完全一致。
type parityCube struct {
	Origin   [3]float64 `json:"origin"`
	Size     [3]float64 `json:"size"`
	Pivot    [3]float64 `json:"pivot"`
	PivotSet bool       `json:"pivotSet"`
	UV       [2]float64 `json:"uv"`
	FaceUV   string     `json:"faceUV"`
	Rotation [3]float64 `json:"rotation"`
	TexSlot  int        `json:"texSlot"`
	Inflate  float64    `json:"inflate"`
	Mirror   bool       `json:"mirror"`
	CubeTexW int        `json:"cubeTexW"`
	CubeTexH int        `json:"cubeTexH"`
}

// mergeCubesCase 一条 cube 合并对账用例。输入 old/new 为 Cube2D 数组，
// golden 为合并后按序输出的完整 cube 快照（mergeCubes 只做「引用搬运」，不运算，
// 故输出 cube 是某个输入 cube 的原样拷贝——逐位精确比对即钉住「哪条被替换、
// 哪条被追加、顺序如何」的全部语义）。
type mergeCubesCase struct {
	ID      string       `json:"id"`
	Comment string       `json:"$comment,omitempty"`
	Old     []parityCube `json:"old"`
	New     []parityCube `json:"new"`
	Golden  []parityCube `json:"golden"`
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

// runBoneLocalPosCase 按 case 构造输入走真实入口 buildBoneLocalData。
// bonePivot → b.Pivot 派生（bp）；parentPivot 非空 → pivots["P"]；declaredParent=true
// → b.Parent="P"（触发 Go 的父骨骼分支或「父 pivot 缺失回落根公式」分支）。
func runBoneLocalPosCase(c boneLocalPosCase) [3]float64 {
	bp := vec3{fOf(c.BonePivot[0]), fOf(c.BonePivot[1]), fOf(c.BonePivot[2])}
	b := types.Bone2D{}
	pivots := map[string]vec3{}
	if c.ParentPivot != nil {
		pivots["P"] = vec3{fOf(c.ParentPivot[0]), fOf(c.ParentPivot[1]), fOf(c.ParentPivot[2])}
	}
	if c.DeclaredParent {
		b.Parent = "P"
	}
	localPos, _, _ := buildBoneLocalData(b, bp, pivots)
	return localPos
}

// toParityCube / fromParityCube：parityCube（语料形状）↔ types.Cube2D（运行时形状）。
// PivotSet/CubeTexW/H 由语料显式带回——Go 侧序列化会丢，必须手动搬运。
func toParityCube(c types.Cube2D) parityCube {
	return parityCube{
		Origin: c.Origin, Size: c.Size, Pivot: c.Pivot, PivotSet: c.PivotSet,
		UV: c.UV, FaceUV: c.FaceUV, Rotation: c.Rotation, TexSlot: c.TexSlot,
		Inflate: c.Inflate, Mirror: c.Mirror, CubeTexW: c.CubeTexW, CubeTexH: c.CubeTexH,
	}
}

func fromParityCube(pc parityCube) types.Cube2D {
	return types.Cube2D{
		Origin: pc.Origin, Size: pc.Size, Pivot: pc.Pivot, PivotSet: pc.PivotSet,
		UV: pc.UV, FaceUV: pc.FaceUV, Rotation: pc.Rotation, TexSlot: pc.TexSlot,
		Inflate: pc.Inflate, Mirror: pc.Mirror, CubeTexW: pc.CubeTexW, CubeTexH: pc.CubeTexH,
	}
}

// runMergeCubesCase 按 case 构造输入走真实入口 mergeCubes。
func runMergeCubesCase(c mergeCubesCase) []parityCube {
	old := make([]types.Cube2D, 0, len(c.Old))
	for _, pc := range c.Old {
		old = append(old, fromParityCube(pc))
	}
	newC := make([]types.Cube2D, 0, len(c.New))
	for _, pc := range c.New {
		newC = append(newC, fromParityCube(pc))
	}
	res := mergeCubes(old, newC)
	out := make([]parityCube, 0, len(res))
	for _, r := range res {
		out = append(out, toParityCube(r))
	}
	return out
}

// diffBoneLocalPos 骨骼本地位置逐位精确比对（纯加减乘，无容差）。
func diffBoneLocalPos(got, want [3]float64) string {
	return diffVec3("golden", got, want)
}

// diffParityCube 单条 cube 全字段逐位精确比对。
func diffParityCube(label string, got, want parityCube) string {
	if got.Origin != want.Origin {
		return fmt.Sprintf("%s.origin: got=%v want=%v", label, got.Origin, want.Origin)
	}
	if got.Size != want.Size {
		return fmt.Sprintf("%s.size: got=%v want=%v", label, got.Size, want.Size)
	}
	if got.Pivot != want.Pivot {
		return fmt.Sprintf("%s.pivot: got=%v want=%v", label, got.Pivot, want.Pivot)
	}
	if got.PivotSet != want.PivotSet {
		return fmt.Sprintf("%s.pivotSet: got=%v want=%v", label, got.PivotSet, want.PivotSet)
	}
	if got.UV != want.UV {
		return fmt.Sprintf("%s.uv: got=%v want=%v", label, got.UV, want.UV)
	}
	if got.FaceUV != want.FaceUV {
		return fmt.Sprintf("%s.faceUV: got=%q want=%q", label, got.FaceUV, want.FaceUV)
	}
	if got.Rotation != want.Rotation {
		return fmt.Sprintf("%s.rotation: got=%v want=%v", label, got.Rotation, want.Rotation)
	}
	if got.TexSlot != want.TexSlot {
		return fmt.Sprintf("%s.texSlot: got=%d want=%d", label, got.TexSlot, want.TexSlot)
	}
	if got.Inflate != want.Inflate {
		return fmt.Sprintf("%s.inflate: got=%v want=%v", label, got.Inflate, want.Inflate)
	}
	if got.Mirror != want.Mirror {
		return fmt.Sprintf("%s.mirror: got=%v want=%v", label, got.Mirror, want.Mirror)
	}
	if got.CubeTexW != want.CubeTexW {
		return fmt.Sprintf("%s.cubeTexW: got=%d want=%d", label, got.CubeTexW, want.CubeTexW)
	}
	if got.CubeTexH != want.CubeTexH {
		return fmt.Sprintf("%s.cubeTexH: got=%d want=%d", label, got.CubeTexH, want.CubeTexH)
	}
	return ""
}

// diffParityCubes 合并输出按序逐条精确比对。
func diffParityCubes(label string, got, want []parityCube) string {
	if len(got) != len(want) {
		return fmt.Sprintf("%s 长度: got=%d want=%d", label, len(got), len(want))
	}
	for i := range want {
		if d := diffParityCube(fmt.Sprintf("%s[%d]", label, i), got[i], want[i]); d != "" {
			return d
		}
	}
	return ""
}

// diffCubeMesh 逐字段比对。
// ⚠️ **浮点项刻意用逐位精确比对**，只有 localRotation 走容差。理由：
// positions/normals/uvs/localPosition 全部由**加减乘**构成，IEEE754 对同一运算顺序
// 的结果是确定的——出现差异必然是**两侧抄写的结合序/表达式不同**，不是平台噪声。
// 本语料正是靠精确比对抓到 JS South 面 `u+z+x+z` vs Go `u+sz+sz+sx` 的 1 ULP 分叉
// （z=8、x=0.001 时两种结合序落在不同舍入粒度上），若改用相对容差就会把它永久藏起来。
// localRotation 例外：eulerToQuaternion 含 cos/sin/sqrt，跨实现可差 1 ULP，属真噪声。
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
		if !sameFloat(got.LocalRotation[i], v) {
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

// rotEps localRotation 相对容差（仅用于含三角函数/开方的项）。
const rotEps = 1e-9

// sameFloat NaN/±Inf 走严格同态，其余相对容差——**只服务 localRotation**。
func sameFloat(a, b float64) bool {
	if math.IsNaN(a) || math.IsNaN(b) {
		return math.IsNaN(a) && math.IsNaN(b)
	}
	if math.IsInf(a, 0) || math.IsInf(b, 0) {
		return a == b
	}
	if a == b {
		return true
	}
	scale := math.Abs(a)
	if math.Abs(b) > scale {
		scale = math.Abs(b)
	}
	if scale < 1 {
		scale = 1
	}
	return math.Abs(a-b) <= rotEps*scale
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
	testutil.NoError(t, err, "读黄金语料失败")
	var gf cubeParityGoldenFile
	err = json.Unmarshal(data, &gf)
	testutil.NoError(t, err, "解析黄金语料失败")
	testutil.Equal(t, len(gf.Cases) > 0, true, "黄金语料不得为空")
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

	// 族②残余：computeBoneLocalPos（Go buildBoneLocalData ↔ TS computeBoneLocalPos）
	for i := range gf.BoneLocalPosCases {
		c := gf.BoneLocalPosCases[i]
		t.Run(c.ID, func(t *testing.T) {
			got := runBoneLocalPosCase(c)
			if regen {
				gf.BoneLocalPosCases[i].Golden = got[:]
				return
			}
			var want [3]float64
			copy(want[:], c.Golden)
			if d := diffBoneLocalPos(got, want); d != "" {
				t.Errorf("[%s] 对账漂移：%s", c.ID, d)
			}
		})
	}

	// 族②残余：mergeCubes（Go spec.go mergeCubes ↔ TS cube-mesh.ts mergeCubes）
	for i := range gf.MergeCubesCases {
		c := gf.MergeCubesCases[i]
		t.Run(c.ID, func(t *testing.T) {
			got := runMergeCubesCase(c)
			if regen {
				gf.MergeCubesCases[i].Golden = got
				return
			}
			if d := diffParityCubes("golden", got, c.Golden); d != "" {
				t.Errorf("[%s] 对账漂移：%s", c.ID, d)
			}
		})
	}

	if regen {
		out, err := json.MarshalIndent(gf, "", "  ")
		testutil.NoError(t, err, "MarshalIndent")
		err = os.WriteFile(cubeMeshGoldenPath, append(out, '\n'), 0o644)
		testutil.NoError(t, err, "写黄金语料失败")
		fmt.Printf("黄金语料已重写: %s\n", cubeMeshGoldenPath)
	}
}
