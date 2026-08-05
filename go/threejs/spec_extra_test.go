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
	c := types.Cube2D{Size: [3]float64{0, 0, 0}}
	md := buildCubeMeshData(c, vec3{}, 64, 64, "bone1", 0)
	if md != nil {
		t.Error("零尺寸 cube 应返回 nil")
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
	// localPosition = cubePivot - bonePivot = [4,4,4] - [0,0,0]
	if md.LocalPosition != [3]float64{4, 4, 4} {
		t.Errorf("LocalPosition = %v, 期望 [4,4,4]", md.LocalPosition)
	}
}

func TestBuildCubeMeshData_CustomTexDim(t *testing.T) {
	c := types.Cube2D{
		Origin:    [3]float64{0, 0, 0},
		Size:      [3]float64{8, 8, 8},
		Pivot:     [3]float64{4, 4, 4},
		UV:        [2]float64{0, 0},
		CubeTexW:  128,
		CubeTexH:  64,
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
	// 零厚度面（sx=0）→ buildCubeMeshData 返回 nil
	c := types.Cube2D{
		Origin: [3]float64{0, 0, 0},
		Size:   [3]float64{0, 8, 8}, // x 方向厚度为 0
		Pivot:  [3]float64{0, 4, 4},
		UV:     [2]float64{0, 0},
	}
	md := buildCubeMeshData(c, vec3{0, 0, 0}, 64, 64, "bone1", 0)
	if md != nil {
		t.Error("零尺寸 cube 应返回 nil")
	}
}