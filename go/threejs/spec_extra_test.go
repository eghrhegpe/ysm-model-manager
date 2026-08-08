// ===== go/threejs 补充单测 =====
package threejs

import (
	"math"
	"testing"

	"ysm-model-manager/go/types"
)

// ====== floatEqual ======

func TestFloatEqual_Exact(t *testing.T) {
	if !floatEqual([3]float64{1, 2, 3}, [3]float64{1, 2, 3}, 1e-6) {
		t.Error("相同值应 equal")
	}
}

func TestFloatEqual_WithinEps(t *testing.T) {
	if !floatEqual([3]float64{1, 2, 3}, [3]float64{1.000001, 2, 3}, 1e-3) {
		t.Error("epsilon 内应 equal")
	}
}

func TestFloatEqual_OutsideEps(t *testing.T) {
	if floatEqual([3]float64{1, 2, 3}, [3]float64{2, 2, 3}, 1e-6) {
		t.Error("超出 epsilon 不应 equal")
	}
}

// ====== cubesOverlap ======

func TestCubesOverlap_Same(t *testing.T) {
	a := types.Cube2D{Origin: [3]float64{0, 0, 0}, Size: [3]float64{8, 8, 8}}
	b := types.Cube2D{Origin: [3]float64{0, 0, 0}, Size: [3]float64{8, 8, 8}}
	if !cubesOverlap(a, b) {
		t.Error("相同 cube 应 overlap")
	}
}

func TestCubesOverlap_Different(t *testing.T) {
	a := types.Cube2D{Origin: [3]float64{0, 0, 0}, Size: [3]float64{8, 8, 8}}
	b := types.Cube2D{Origin: [3]float64{10, 0, 0}, Size: [3]float64{8, 8, 8}}
	if cubesOverlap(a, b) {
		t.Error("不同位置 cube 不应 overlap")
	}
}

func TestCubesOverlap_DifferentRotation(t *testing.T) {
	a := types.Cube2D{Origin: [3]float64{0, 0, 0}, Size: [3]float64{8, 8, 8}, Rotation: [3]float64{0, 0, 0}}
	b := types.Cube2D{Origin: [3]float64{0, 0, 0}, Size: [3]float64{8, 8, 8}, Rotation: [3]float64{0, 45, 0}}
	if cubesOverlap(a, b) {
		t.Error("不同旋转的 cube 不应 overlap")
	}
}

// ====== parseUV ======

func TestParseUV_BoxUV(t *testing.T) {
	var faces [6][8]float64
	c := types.Cube2D{UV: [2]float64{0, 0}}
	ok := parseUV(c, &faces, 8, 8, 8, 64, 64)
	if !ok {
		t.Fatal("box UV 应返回 true")
	}
	// east face: u0 = 0/64, v0 = (0+8)/64 = 0.125
	if faces[0][0] != 0 || faces[0][1] != 0.125 {
		t.Errorf("east face u0,v0 = %f,%f, 期望 0,0.125", faces[0][0], faces[0][1])
	}
}

func TestParseUV_FaceUV(t *testing.T) {
	var faces [6][8]float64
	c := types.Cube2D{FaceUV: `{"east":{"uv":[0,0],"uv_size":[8,8]}}`}
	ok := parseUV(c, &faces, 8, 8, 8, 64, 64)
	if !ok {
		t.Fatal("FaceUV 应返回 true")
	}
	if faces[0][0] != 0 || faces[0][1] != 0 {
		t.Errorf("east face u0,v0 = %f,%f, 期望 0,0", faces[0][0], faces[0][1])
	}
}

func TestParseUV_NoUV(t *testing.T) {
	var faces [6][8]float64
	// Cube2D 的 UV 固定为 [2]float64，所以 len(c.UV) >= 2 始终成立
	// 测试无 FaceUV 时走 expandBoxUV 路径
	c := types.Cube2D{UV: [2]float64{0, 0}}
	ok := parseUV(c, &faces, 8, 8, 8, 64, 64)
	if !ok {
		t.Error("无 FaceUV 时应走 expandBoxUV 并返回 true")
	}
}

// ====== expandBoxUV ======

func TestExpandBoxUV_ZeroTex(t *testing.T) {
	var faces [6][8]float64
	ok := expandBoxUV([2]float64{0, 0}, 8, 8, 8, 1, 1, &faces)
	if !ok {
		t.Fatal("expandBoxUV 应返回 true")
	}
	// 所有值应为非负有限数
	for fi, face := range faces {
		for _, v := range face {
			if v < 0 || math.IsInf(v, 0) || math.IsNaN(v) {
				t.Errorf("face[%d] 含非法值 %f", fi, v)
			}
		}
	}
}

// ====== parseFaceUV ======

func TestParseFaceUV_AllFaces(t *testing.T) {
	uvStr := `{"east":{"uv":[0,0],"uv_size":[8,8]},"west":{"uv":[8,0],"uv_size":[8,8]},"up":{"uv":[16,0],"uv_size":[8,8]},"down":{"uv":[24,0],"uv_size":[8,8]},"south":{"uv":[32,0],"uv_size":[8,8]},"north":{"uv":[40,0],"uv_size":[8,8]}}`
	var faces [6][8]float64
	ok := parseFaceUV(uvStr, &faces, 64, 64)
	if !ok {
		t.Fatal("parseFaceUV 应返回 true")
	}
	// east face: u0 = 0/64 = 0, v0 = 0/64 = 0, u1 = 8/64 = 0.125, v1 = 8/64 = 0.125
	// faces[fi] = [8]float64{u0, v0, u1, v0, u0, v1, u1, v1}
	// index 0=u0, 1=v0, 2=u1, 3=v0(dup), 4=u0(dup), 5=v1, 6=u1(dup), 7=v1(dup)
	if faces[0][0] != 0 || faces[0][2] != 0.125 {
		t.Errorf("east: u0=%f u1=%f", faces[0][0], faces[0][2])
	}
}

func TestParseFaceUV_InvalidJSON(t *testing.T) {
	var faces [6][8]float64
	ok := parseFaceUV("{invalid json}", &faces, 64, 64)
	if ok {
		t.Error("非法 JSON 应返回 false")
	}
}

func TestParseFaceUV_PartialFaces(t *testing.T) {
	// 只提供 east 和 west 面
	uvStr := `{"east":{"uv":[0,0],"uv_size":[8,8]}}`
	var faces [6][8]float64
	ok := parseFaceUV(uvStr, &faces, 64, 64)
	if !ok {
		t.Fatal("parseFaceUV 应返回 true")
	}
	if faces[0][0] == 0 && faces[0][1] == 0 {
		// east face 应有值
	} else {
		t.Errorf("east face 应有 UV 值, got %v", faces[0])
	}
	// west face 未提供，应保持 [0,0,0,0,0,0,0,0]
	if faces[1] != [8]float64{} {
		t.Errorf("west face 应保持零值, got %v", faces[1])
	}
}

// ====== eulerToQuaternion ======

func TestEulerToQuaternion_90Y(t *testing.T) {
	q := eulerToQuaternion(0, -90, 0)
	// 绕 Y 轴 -90°
	if math.Abs(q[1]-(-0.70710678)) > 1e-4 {
		t.Errorf("90Y qy = %v, want ≈ -0.7071", q[1])
	}
	if math.Abs(q[3]-0.70710678) > 1e-4 {
		t.Errorf("90Y qw = %v, want ≈ 0.7071", q[3])
	}
}

func TestEulerToQuaternion_90Z(t *testing.T) {
	q := eulerToQuaternion(0, 0, -90)
	// 绕 Z 轴 -90°
	if math.Abs(q[2]-(-0.70710678)) > 1e-4 {
		t.Errorf("90Z qz = %v, want ≈ -0.7071", q[2])
	}
	if math.Abs(q[3]-0.70710678) > 1e-4 {
		t.Errorf("90Z qw = %v, want ≈ 0.7071", q[3])
	}
}

func TestEulerToQuaternion_180X(t *testing.T) {
	q := eulerToQuaternion(-180, 0, 0)
	// 绕 X 轴 180° → qx=1, qw=0
	if math.Abs(q[0]-1) > 1e-4 {
		t.Errorf("180X qx = %v, want ≈ 1", q[0])
	}
	if math.Abs(q[3]) > 1e-4 {
		t.Errorf("180X qw = %v, want ≈ 0", q[3])
	}
}

// ====== buildCubeMeshData ======

func TestBuildCubeMeshData_ZeroSize(t *testing.T) {
	// 全零尺寸 cube → 对齐 C#：保留（三轴均被 thicknessEpsilon 修正，见 spec_portability 对比 #3）
	c := types.Cube2D{Size: [3]float64{0, 0, 0}}
	md := buildCubeMeshData(c, vec3{}, 64, 64, "bone1", 0)
	if md == nil {
		t.Fatal("零尺寸 cube 应保留（不再返回 nil）")
	}
	// 每轴跨度 ≥ thicknessEpsilon
	for _, axis := range []int{0, 1, 2} {
		lo, hi := 1e9, -1e9
		for i := 0; i < len(md.Positions); i += 3 {
			v := md.Positions[i+axis]
			if v < lo { lo = v }
			if v > hi { hi = v }
		}
		if hi-lo < thicknessEpsilon {
			t.Errorf("轴 %d 跨度 %v 应 ≥ %v", axis, hi-lo, thicknessEpsilon)
		}
	}
}

func TestBuildCubeMeshData_Valid(t *testing.T) {
	c := types.Cube2D{
		Origin: [3]float64{0, 0, 0},
		Size:   [3]float64{8, 8, 8},
		Pivot:  [3]float64{4, 4, 4},
		UV:     [2]float64{0, 0},
	}
	md := buildCubeMeshData(c, vec3{0, 0, 0}, 64, 64, "bone1", 0)
	if md == nil {
		t.Fatal("有效 cube 应返回非 nil")
	}
	if md.BoneID != "bone1" {
		t.Errorf("BoneID = %q, 期望 bone1", md.BoneID)
	}
	if md.ID != "bone1_0" {
		t.Errorf("ID = %q, 期望 bone1_0", md.ID)
	}
	if len(md.Positions) != 6*12 { // 6 faces * 12 coords
		t.Errorf("Positions 长度 = %d, 期望 72", len(md.Positions))
	}
	if len(md.Indices) != 6*6 { // 6 faces * 6 indices
		t.Errorf("Indices 长度 = %d, 期望 36", len(md.Indices))
	}
	// localPosition = X 翻转对齐 C#（ConvertBones）→ bonePivot - cubePivot = [0,0,0] - [4,4,4]
	if md.LocalPosition != [3]float64{-4, 4, 4} {
		t.Errorf("LocalPosition = %v, 期望 [4,4,4]", md.LocalPosition)
	}
}

func TestBuildCubeMeshData_CustomTexDim(t *testing.T) {
	c := types.Cube2D{
		Origin:   [3]float64{0, 0, 0},
		Size:     [3]float64{8, 8, 8},
		Pivot:    [3]float64{4, 4, 4},
		UV:       [2]float64{0, 0},
		CubeTexW: 128,
		CubeTexH: 64,
	}
	md := buildCubeMeshData(c, vec3{0, 0, 0}, 64, 64, "bone1", 0)
	if md == nil {
		t.Fatal("有效 cube 应返回非 nil")
	}
	// 验证 UV 使用了自定义纹理尺寸（128x64 而非 64x64）
	// east face: u0 = 0/128 = 0, v0 = 8/64 = 0.125
	if md.Uvs[0] != 0 || md.Uvs[1] != 0.125 {
		t.Errorf("UV 使用自定义纹理尺寸: u0=%f v0=%f, 期望 0,0.125", md.Uvs[0], md.Uvs[1])
	}
}

func TestBuildCubeMeshData_ThinCube(t *testing.T) {
	// 零厚度面（sx=0）→ 对齐 C# BuildCubeMeshData：保留 + thicknessEpsilon 修正（见 spec_portability 对比 #3）
	c := types.Cube2D{
		Origin: [3]float64{0, 0, 0},
		Size:   [3]float64{0, 8, 8}, // x 方向厚度为 0
		Pivot:  [3]float64{0, 4, 4},
		UV:     [2]float64{0, 0},
	}
	md := buildCubeMeshData(c, vec3{0, 0, 0}, 64, 64, "bone1", 0)
	if md == nil {
		t.Fatal("零尺寸 cube 应保留（不再返回 nil）")
	}
	// lx==hx → hx += thicknessEpsilon：X 方向跨度（East 面 x=hx，West 面 x=lx）非零
	// East 面顶点1 是 Positions[0..2]，West 面顶点1 是 Positions[12..14]
	xEast, xWest := md.Positions[0], md.Positions[12]
	if xEast-xWest < thicknessEpsilon {
		t.Errorf("零厚度 X 方向应被修正为 ≥%v，实际 %v", thicknessEpsilon, xEast-xWest)
	}
}

func TestBuildCubeMeshData_Inflate(t *testing.T) {
	// Blockbench inflate（P2 修复）：origin 各轴 -i、size 各轴 +2i，对齐 Java GeoCube。
	// 老模型（1.10+ 导出，如 inflate:0.01 / -0.35）此前被丢弃 → 尺寸偏小。
	// cube 8x8x8 @ origin[0,0,0]，inflate 0.5 → 膨胀后 X 跨度 = (0-0.5)..(0+8+0.5) = 9
	c := types.Cube2D{
		Origin:  [3]float64{0, 0, 0},
		Size:    [3]float64{8, 8, 8},
		Pivot:   [3]float64{4, 4, 4},
		UV:      [2]float64{0, 0},
		Inflate: 0.5,
	}
	md := buildCubeMeshData(c, vec3{0, 0, 0}, 64, 64, "bone1", 0)
	if md == nil {
		t.Fatal("有效 cube 应返回非 nil")
	}
	// East 面（x=hx）顶点 x = (cx+hx2) - cp[0]；cx/hx2 基于膨胀后 fx..tx
	// 膨胀后 fx=-0.5, tx=8.5 → cx=4, hx2=4.5 → lx=-0.5, hx=8.5（相对 pivot 4）
	xMin, xMax := md.Positions[12], md.Positions[0]
	if xMin != -4.5 || xMax != 4.5 {
		t.Errorf("inflate 0.5 后 X 跨度应为 [-4.5, 4.5]（相对 pivot），实际 [%v, %v]", xMin, xMax)
	}
	// 负 inflate：尺寸收缩
	c2 := types.Cube2D{
		Origin:  [3]float64{0, 0, 0},
		Size:    [3]float64{8, 8, 8},
		Pivot:   [3]float64{4, 4, 4},
		UV:      [2]float64{0, 0},
		Inflate: -0.5,
	}
	md2 := buildCubeMeshData(c2, vec3{0, 0, 0}, 64, 64, "bone1", 0)
	xMin2, xMax2 := md2.Positions[12], md2.Positions[0]
	if xMin2 != -3.5 || xMax2 != 3.5 {
		t.Errorf("inflate -0.5 后 X 跨度应为 [-3.5, 3.5]（相对 pivot），实际 [%v, %v]", xMin2, xMax2)
	}
	// box UV 必须基于**未膨胀**原始尺寸（对齐 C# 黄金参考：expandBoxUV(原始 sz) 再 inflate）：
	// East face u 跨度 = 8/64 = 0.125，而非膨胀后的 9/64（P2）
	u0, u1 := md.Uvs[0], md.Uvs[2]
	if math.Abs(u1-u0-8.0/64) > 1e-9 {
		t.Errorf("box UV 应基于原始尺寸: East u 跨度 = %v, 期望 8/64=%v（inflate 后几何 9/64 不得入 UV）", u1-u0, 8.0/64)
	}
	_ = c2
}

func TestBuildCubeMeshData_InflateClamp(t *testing.T) {
	// 负 inflate 超过半尺寸 → 尺寸缩成负数 → 面翻转（法线反、正面剔除后不可见，P3）。
	// clamp 到 thicknessEpsilon 保证 lx < hx。
	c := types.Cube2D{
		Origin:  [3]float64{0, 0, 0},
		Size:    [3]float64{1, 1, 1},
		Pivot:   [3]float64{0.5, 0.5, 0.5},
		UV:      [2]float64{0, 0},
		Inflate: -1.0, // 1 + 2*(-1) = -1 → clamp
	}
	md := buildCubeMeshData(c, vec3{0, 0, 0}, 64, 64, "bone1", 0)
	if md == nil {
		t.Fatal("clamp 后 cube 应仍有效")
	}
	// East x=hx、West x=lx（相对 pivot 0.5）：clamp 后 hx > lx
	xWest, xEast := md.Positions[12], md.Positions[0]
	if xEast <= xWest {
		t.Errorf("clamp 后 X 跨度应为正（lx<hx）: lx=%v hx=%v", xWest, xEast)
	}
	// UV 仍基于原始尺寸 1/64，不随 clamp 后几何
	u0, u1 := md.Uvs[0], md.Uvs[2]
	if math.Abs(u1-u0-1.0/64) > 1e-9 {
		t.Errorf("clamp 后 box UV 仍应基于原始尺寸: East u 跨度 = %v, 期望 1/64=%v", u1-u0, 1.0/64)
	}
}

func TestBuildCubeMeshData_Mirror(t *testing.T) {
	// Blockbench mirror（P2 修复）：UV 水平翻转（u 交换），对齐 Java GeoQuad。
	// cube 8x8x8 @ origin[0,0,0]，box UV [0,0]：
	//   East face u0=0/64=0, u1=8/64=0.125（无 mirror）
	//   mirror 后 u0/u1 交换 → u0=0.125, u1=0
	c := types.Cube2D{
		Origin: [3]float64{0, 0, 0},
		Size:   [3]float64{8, 8, 8},
		Pivot:  [3]float64{4, 4, 4},
		UV:     [2]float64{0, 0},
	}
	md := buildCubeMeshData(c, vec3{0, 0, 0}, 64, 64, "bone1", 0)
	if md == nil {
		t.Fatal("有效 cube 应返回非 nil")
	}
	u0Plain, u1Plain := md.Uvs[0], md.Uvs[2]
	if u0Plain == u1Plain {
		t.Fatal("非 mirror 的 u0/u1 应不同（测试前提不成立）")
	}
	c.Mirror = true
	mdMirror := buildCubeMeshData(c, vec3{0, 0, 0}, 64, 64, "bone1", 0)
	if mdMirror.Uvs[0] != u1Plain || mdMirror.Uvs[2] != u0Plain {
		t.Errorf("mirror 后 UV 应水平翻转: 期望 u0=%v u1=%v, 实际 u0=%v u1=%v",
			u1Plain, u0Plain, mdMirror.Uvs[0], mdMirror.Uvs[2])
	}
}

func TestBuildCubeMeshData_PivotFallback(t *testing.T) {
	// cube 未显式 pivot（PivotSet=false，Blockbench 缺省）→ 用 cube 中心作为旋转中心，
	// 对齐 YSMViewer 口径；修复 fox 解压目录模型 main 手臂消失（P1）。
	// cube 8x8x8 @ origin[0,0,0]，中心 = [4,4,4]；mesh localPos = bonePivot - cubePivot。
	c := types.Cube2D{
		Origin: [3]float64{0, 0, 0},
		Size:   [3]float64{8, 8, 8},
		UV:     [2]float64{0, 0},
		// PivotSet=false（未显式 pivot）
	}
	md := buildCubeMeshData(c, vec3{0, 0, 0}, 64, 64, "bone1", 0)
	if md == nil {
		t.Fatal("有效 cube 应返回非 nil")
	}
	// fallback pivot = 中心 [4,4,4] → localPos = bonePivot(0) - cp，但 Y 轴翻转对齐
	// C#（cp[1]-bonePivot.y）→ [-4, 4, 4]
	lp := md.LocalPosition
	if lp[0] != -4 || lp[1] != 4 || lp[2] != 4 {
		t.Errorf("无 pivot 应 fallback 到 cube 中心: localPos = %v, 期望 [-4 4 4]（Y 翻转对齐）", lp)
	}
	// 顶点相对中心：cube 8x8 中心 4 → lx=-4, hx=4（X 翻转对齐后同）
	if md.Positions[0] != 4 || md.Positions[12] != -4 {
		t.Errorf("顶点应相对中心对称: xMax=%v xMin=%v, 期望 4 / -4", md.Positions[0], md.Positions[12])
	}
}

func TestBuildCubeMeshData_ExplicitZeroPivot(t *testing.T) {
	// 显式 pivot:[0,0,0]（PivotSet=true，绕模型原点旋转的铰接件）→ **不得** fallback
	// 到 cube 中心，旋转中心保持模型原点（code_review P2）。
	// cube 8x8x8 @ origin[0,0,0]，显式 pivot [0,0,0] → localPos = bonePivot - [0,0,0] = [0,0,0]
	c := types.Cube2D{
		Origin:   [3]float64{0, 0, 0},
		Size:     [3]float64{8, 8, 8},
		Pivot:    [3]float64{0, 0, 0},
		PivotSet: true,
		UV:       [2]float64{0, 0},
	}
	md := buildCubeMeshData(c, vec3{0, 0, 0}, 64, 64, "bone1", 0)
	if md == nil {
		t.Fatal("有效 cube 应返回非 nil")
	}
	lp := md.LocalPosition
	if lp[0] != 0 || lp[1] != 0 || lp[2] != 0 {
		t.Errorf("显式 pivot [0,0,0] 应保留原点旋转中心: localPos = %v, 期望 [0 0 0]（不得 fallback 到中心）", lp)
	}
	// 顶点相对原点：cube 8x8 → lx=0, hx=8
	if md.Positions[0] != 8 || md.Positions[12] != 0 {
		t.Errorf("顶点应相对模型原点: xMax=%v xMin=%v, 期望 8 / 0", md.Positions[0], md.Positions[12])
	}
}
