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

func TestExpandBoxUV_NonNegative(t *testing.T) {
	// 原 TestExpandBoxUV_ZeroTex 传 texW=1/texH=1 名不副实——
	// 并未测 texW==0 除零路径；改名反映实际断言（非负有限值）
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

func TestExpandBoxUV_ZeroTexGuard(t *testing.T) {
	// P3 补测：texW/texH ≤ 0 守卫——除零会产生 NaN UV，函数应显式拒绝
	// （生产路径由上游 texW==0→64 兜底，此用例锁定函数自身防御）
	var faces [6][8]float64
	if ok := expandBoxUV([2]float64{0, 0}, 8, 8, 8, 0, 64, &faces); ok {
		t.Error("texW=0 应返回 false（拒绝除零）")
	}
	if ok := expandBoxUV([2]float64{0, 0}, 8, 8, 8, 64, -1, &faces); ok {
		t.Error("texH<0 应返回 false")
	}
	// faces 不得被写入 NaN
	for _, face := range faces {
		for _, v := range face {
			if math.IsNaN(v) {
				t.Fatal("拒绝路径不得写入 NaN UV")
			}
		}
	}
}

// TestExpandBoxUV_QuadVertexOrder 锁定 b62f5913 修复：
// expandBoxUV 输出的 [8]float64 四角顶点序必须是
//
//	[u0,v0, u1,v0, u0,v1, u1,v1]
//
// 而非对角重复 [u0,v0, u1,v1, u0,v0, u1,v1]——后者导致每面 UV
// 退化为对角线性渐变（纹理被压成一条对角线）。
//
// 用例：cube 8×8×8 @ UV[0,0]，texW=texH=64。
//
//	East 面：fu=0, fv=8, fw=8, fh=8
//	期望四角（归一化后）：
//	  [0]=u0=0/64=0       [1]=v0=8/64=0.125
//	  [2]=u1=8/64=0.125    [3]=v0=0.125（与 [1] 同行）
//	  [4]=u0=0             [5]=v1=16/64=0.25
//	  [6]=u1=0.125         [7]=v1=0.25
//	关键不变量：[1]==[3]（顶点 0、1 同 v0 行）且 [5]==[7]（顶点 2、3 同 v1 行）。
//	对角重复 bug 下 [1]!=[3]（v0 vs v1）→ 此断言捕获回归。
func TestExpandBoxUV_QuadVertexOrder(t *testing.T) {
	var faces [6][8]float64
	ok := expandBoxUV([2]float64{0, 0}, 8, 8, 8, 64, 64, &faces)
	if !ok {
		t.Fatal("expandBoxUV 应返回 true")
	}
	// East 面四角显式断言
	east := faces[0]
	want := [8]float64{0, 0.125, 0.125, 0.125, 0, 0.25, 0.125, 0.25}
	for i := 0; i < 8; i++ {
		if math.Abs(east[i]-want[i]) > 1e-9 {
			t.Errorf("East face[%d] = %v, 期望 %v (四角顶点序 [u0,v0,u1,v0,u0,v1,u1,v1])", i, east[i], want[i])
		}
	}
	// 不变量：顶点 0、1 同 v0 行；顶点 2、3 同 v1 行
	for fi := 0; fi < 6; fi++ {
		f := faces[fi]
		if f[1] != f[3] {
			t.Errorf("face[%d] 顶点 0、1 的 v 不同 (%v vs %v)——对角重复回归", fi, f[1], f[3])
		}
		if f[5] != f[7] {
			t.Errorf("face[%d] 顶点 2、3 的 v 不同 (%v vs %v)——对角重复回归", fi, f[5], f[7])
		}
		// 顶点 0、2 同 u0 列；顶点 1、3 同 u1 列
		if f[0] != f[4] {
			t.Errorf("face[%d] 顶点 0、2 的 u 不同 (%v vs %v)——列对齐破坏", fi, f[0], f[4])
		}
		if f[2] != f[6] {
			t.Errorf("face[%d] 顶点 1、3 的 u 不同 (%v vs %v)——列对齐破坏", fi, f[2], f[6])
		}
	}
}

func TestHasBoneRotation(t *testing.T) {
	// P3 补测（子代理审计）：360°/720° 整圈旋转原始角度非 0 但四元数为单位四元数——
	// 统一判定口径后应视为无旋转（false），与骨骼循环 overwrite 决策一致
	cases := []struct {
		name string
		rot  [3]float64
		want bool
	}{
		{"无旋转", [3]float64{0, 0, 0}, false},
		{"单轴 90°", [3]float64{90, 0, 0}, true},
		{"多轴组合", [3]float64{30, 45, 60}, true},
		{"360° 整圈", [3]float64{360, 0, 0}, false},
		{"720° 整圈", [3]float64{0, 720, 0}, false},
		{"-360° 整圈", [3]float64{0, 0, -360}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := hasBoneRotation(c.rot); got != c.want {
				t.Errorf("hasBoneRotation(%v) = %v, 期望 %v", c.rot, got, c.want)
			}
		})
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
	// 只提供 east 面（west 等其余面应维持零值）
	uvStr := `{"east":{"uv":[0,0],"uv_size":[8,8]}}`
	var faces [6][8]float64
	ok := parseFaceUV(uvStr, &faces, 64, 64)
	if !ok {
		t.Fatal("parseFaceUV 应返回 true")
	}
	// east face 应解析到 u0=0/64=0, v0=0/64=0
	if faces[0][0] != 0 || faces[0][1] != 0 {
		t.Errorf("east face u0,v0 = %v,%v, 期望 0,0", faces[0][0], faces[0][1])
	}
	// west face（索引 1，即 faces[1]）未提供，应保持零值
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
			if v < lo {
				lo = v
			}
			if v > hi {
				hi = v
			}
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
	// localPos[0] = bonePivot.x + cp[0] = 0 + (-4) = -4（cp[0] 已 X 翻号 = -Pivot[0]）
	if md.LocalPosition != [3]float64{-4, 4, 4} {
		t.Errorf("LocalPosition = %v, 期望 [-4,4,4]", md.LocalPosition)
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
	// Blockbench mirror 两步语义（黄金参照 blockbench cube.js updateUV
	// box_uv mirror_uv 分支 L1298-1316）：
	//   ① 每面矩形自身水平翻转；② east 与 west 矩形整体互换。
	// 旧实现只做 ①（对齐 Java GeoQuad 的侧面理解不完整），缺 ② → mirror 对称件
	// 左右臂贴图互换（女仆左臂青条事故）。本测锁定 ②。
	// cube 8x8x8 @ origin[0,0,0]，box UV [0,0]，tex64：
	//   非 mirror east u∈[0,.125]、west u∈[.25,.375]
	//   mirror 后物理 east 贴 west 矩形翻转值：u0=.375, u2=.25
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
	eastU0, eastU2, westU0, westU2 := md.Uvs[0], md.Uvs[2], md.Uvs[8], md.Uvs[10]
	if eastU0 == eastU2 || westU0 == westU2 {
		t.Fatal("非 mirror 的 east/west 自身 u应对不同（测试前提不成立）")
	}
	if eastU0 != 0 || westU0 != 0.25 {
		t.Fatalf("非 mirror 基线偏移: east u0=%v（期望0）west u0=%v（期望.25）", eastU0, westU0)
	}
	c.Mirror = true
	mdMirror := buildCubeMeshData(c, vec3{0, 0, 0}, 64, 64, "bone1", 0)
	// mirror east = 非mirror west 翻转（u0↔u2）；mirror west = 非mirror east 翻转
	if mdMirror.Uvs[0] != westU2 || mdMirror.Uvs[2] != westU0 {
		t.Errorf("mirror east 应贴 west 矩形翻转值: 期望 u0=%v u2=%v, 实际 u0=%v u2=%v",
			westU2, westU0, mdMirror.Uvs[0], mdMirror.Uvs[2])
	}
	if mdMirror.Uvs[8] != eastU2 || mdMirror.Uvs[10] != eastU0 {
		t.Errorf("mirror west 应贴 east 矩形翻转值: 期望 u0=%v u2=%v, 实际 u0=%v u2=%v",
			eastU2, eastU0, mdMirror.Uvs[8], mdMirror.Uvs[10])
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
	// fallback pivot = 中心 → cp = [-4, 4, 4]（cube origin X 镜像后 ox=-8, sx=8, 中心=-4）
	// localPos[0] = bonePivot.x + cp[0] = 0 + (-4) = -4（cp[0] 已 X 翻号）
	lp := md.LocalPosition
	if lp[0] != -4 || lp[1] != 4 || lp[2] != 4 {
		t.Errorf("无 pivot 应 fallback 到 cube 中心: localPos = %v, 期望 [-4 4 4]", lp)
	}
	// fallback pivot 跟着 ox 镜像变（cp = ox + sx/2），lx/hx 相对 cp 偏移不变 → 顶点不变
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
	// 顶点相对原点：cube 8x8 X 镜像后 fx=-8, tx=0 → lx=-8, hx=0
	if md.Positions[0] != 0 || md.Positions[12] != -8 {
		t.Errorf("顶点应相对模型原点: xMax=%v xMin=%v, 期望 0 / -8", md.Positions[0], md.Positions[12])
	}
}
