package threejs

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// ---- Build 基本结构 ----

func TestBuildEmptyModel(t *testing.T) {
	out, err := Build(types.BedrockModel{})
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	if out != "{}" {
		t.Fatalf("empty model: got %q, want {}", out)
	}
}

func TestBuildSingleCube(t *testing.T) {
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{{
			Name:  "b1",
			Pivot: [3]float64{0, 0, 0},
			Cubes: []types.Cube2D{{
				Origin: [3]float64{0, 0, 0},
				Size:   [3]float64{8, 8, 8},
				Pivot:  [3]float64{4, 4, 4},
				UV:     [2]float64{0, 0},
			}},
		}},
	}
	out, err := Build(model)
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	if !strings.Contains(out, `"name":"b1"`) {
		t.Fatalf("bone b1 missing in: %s", out)
	}
	// mesh localPosition — cp[0] 已 X 翻号（= -Pivot[0]），localPos[0] = bonePivot.x + cp[0]
	// = 0 + (-4) = -4（对齐 Blockbench mesh.position = cube.origin - parent.origin）
	if !strings.Contains(out, `"localPosition":[-4,4,4]`) {
		t.Fatalf("mesh localPosition mismatch: %s", out)
	}
}

// 反推审核 P1-1：inflate 运算溢出（origin=1e308 + inflate=-1e308 → 2e308 溢出为 +Inf）
// 入口守卫只查输入有限，运算后溢出必须被复查拦截（不得产出 Inf 顶点穿透 JSON）
func TestBuildCubeMeshData_InflateOverflow(t *testing.T) {
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{{
			Name:  "b1",
			Pivot: [3]float64{0, 0, 0},
			Cubes: []types.Cube2D{{
				Origin:  [3]float64{1e308, 0, 0},
				Size:    [3]float64{8, 8, 8},
				Pivot:   [3]float64{4, 4, 4},
				Inflate: -1e308, // ox - inflate = 1e308 - (-1e308) = 2e308 → +Inf
				UV:      [2]float64{0, 0},
			}},
		}},
	}
	out, err := Build(model)
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	if strings.Contains(out, "Infinity") || strings.Contains(out, "NaN") {
		t.Fatalf("inflate 运算溢出应被拦截，不得产出 Inf/NaN: %s", out)
	}
}

// code_review 复核 P2：无 inflate 的 origin+size 派生溢出（1e308+1e308 → 2e308 → +Inf）
// 顶点派生（tx=ox+sx）复查必须拦截，与 inflate 溢出同源故障
func TestBuildCubeMeshData_OriginPlusSizeOverflow(t *testing.T) {
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{{
			Name:  "b1",
			Pivot: [3]float64{0, 0, 0},
			Cubes: []types.Cube2D{{
				Origin:  [3]float64{1e308, 0, 0},
				Size:    [3]float64{1e308, 8, 8}, // ox+sx = 2e308 → +Inf
				Pivot:   [3]float64{4, 4, 4},
				Inflate: 0,
				UV:      [2]float64{0, 0},
			}},
		}},
	}
	out, err := Build(model)
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	if strings.Contains(out, "Infinity") || strings.Contains(out, "NaN") {
		t.Fatalf("origin+size 派生溢出应被拦截，不得产出 Inf/NaN: %s", out)
	}
}

// bug-chronicle #14：同名骨骼第二次出现且带 parent → 覆盖 pivot/parent 层级
func TestBuildDuplicateBoneMerge(t *testing.T) {
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{
			{
				Name:  "b1",
				Pivot: [3]float64{0, 0, 0},
				Cubes: []types.Cube2D{{Origin: [3]float64{0, 0, 0}, Size: [3]float64{2, 2, 2}, Pivot: [3]float64{0, 0, 0}, UV: [2]float64{0, 0}}},
			},
			{
				Name:   "b1",
				Parent: "p1",
				Pivot:  [3]float64{10, 0, 0},
				Cubes:  []types.Cube2D{{Origin: [3]float64{10, 0, 0}, Size: [3]float64{2, 2, 2}, Pivot: [3]float64{11, 0, 0}, PivotSet: true, UV: [2]float64{0, 0}}},
			},
			{Name: "p1", Pivot: [3]float64{0, 0, 0}},
		},
	}
	out, err := Build(model)
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	var spec Model3DSpec
	if err := json.Unmarshal([]byte(out), &spec); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, out)
	}
	// b1 只保留一条，且被有 parent 的版本覆盖
	count := 0
	for _, b := range spec.Models[0].Bones {
		if b.Name == "b1" {
			count++
			if b.ParentID == nil || *b.ParentID != "p1" {
				t.Fatalf("b1 parentId = %v, want p1 (有 parent 的同名骨骼应覆盖)", b.ParentID)
			}
			// localPosition = X 翻转对齐 C# → p1.pivot - b1.pivot = [0,0,0] - [10,0,0]
			if b.LocalPosition != [3]float64{-10, 0, 0} {
				t.Fatalf("b1 localPosition = %v, want [10 0 0]", b.LocalPosition)
			}
		}
	}
	if count != 1 {
		t.Fatalf("b1 应有 1 条记录，got %d", count)
	}
	// overwrite 语义：带 parent 的版本整体替换（含 cube），只保留新 cube
	if len(spec.Models[0].MeshGroups) != 1 {
		t.Fatalf("meshes = %d, want 1（overwrite 整体替换旧 cube）", len(spec.Models[0].MeshGroups))
	}
	m := spec.Models[0].MeshGroups[0]
	// 保留的是 cubeB（X 翻转对齐 C# → bonePivot [10,0,0] - pivot [11,0,0] = [-1,0,0]）
	if m.LocalPosition != [3]float64{-1, 0, 0} {
		t.Fatalf("mesh localPosition = %v, want [-1 0 0]（cubeB 替换 cubeA）", m.LocalPosition)
	}
}

// mergeCubes 直接测：不重叠的 cube 追加，重叠的（origin/size/rotation 全等）替换
func TestMergeCubes(t *testing.T) {
	cubeA := types.Cube2D{Origin: [3]float64{0, 0, 0}, Size: [3]float64{2, 2, 2}, Pivot: [3]float64{1, 1, 1}, UV: [2]float64{0, 0}}
	cubeB := types.Cube2D{Origin: [3]float64{10, 0, 0}, Size: [3]float64{2, 2, 2}, Pivot: [3]float64{11, 1, 1}, UV: [2]float64{0, 0}}

	// 不重叠 → 追加
	merged := mergeCubes([]types.Cube2D{cubeA}, []types.Cube2D{cubeB})
	if len(merged) != 2 {
		t.Fatalf("非重叠合并 = %d, want 2", len(merged))
	}

	// 重叠（同 origin/size/rotation，不同 pivot/uv）→ 替换
	cubeA2 := cubeA
	cubeA2.UV = [2]float64{4, 4}
	merged2 := mergeCubes([]types.Cube2D{cubeA}, []types.Cube2D{cubeA2})
	if len(merged2) != 1 {
		t.Fatalf("重叠合并 = %d, want 1（替换）", len(merged2))
	}
	if merged2[0].UV != [2]float64{4, 4} {
		t.Fatalf("重叠替换后 UV = %v, want [4 4]", merged2[0].UV)
	}
}

// ---- eulerToQuaternion 符号口径 ----

func TestEulerToQuaternionIdentity(t *testing.T) {
	q := eulerToQuaternion(0, 0, 0)
	want := [4]float64{0, 0, 0, 1}
	for i := range q {
		if math.Abs(q[i]-want[i]) > 1e-9 {
			t.Fatalf("identity: got %v, want %v", q, want)
		}
	}
}

// 锁定当前符号口径：eulerToQuaternion(-90,0,0) → 绕 X 轴旋转 -90°
// （若未来与 ysmview 比对发现符号差异，改这里即显形）
func TestEulerToQuaternion90X(t *testing.T) {
	q := eulerToQuaternion(-90, 0, 0)
	if math.Abs(q[0]-(-0.70710678)) > 1e-4 {
		t.Fatalf("90X qx = %v, want ≈ -0.7071", q[0])
	}
	if math.Abs(q[3]-0.70710678) > 1e-4 {
		t.Fatalf("90X qw = %v, want ≈ 0.7071", q[3])
	}
	if math.Abs(q[1]) > 1e-9 || math.Abs(q[2]) > 1e-9 {
		t.Fatalf("90X y/z 应为 0，got %v", q)
	}
}

// cubeIdx ≥ 10 时 meshID 用十进制（回归：string(rune('0'+idx)) 会变成 ':' 等非数字）
func TestMeshIDMultiCube(t *testing.T) {
	var cubes []types.Cube2D
	for i := 0; i < 12; i++ {
		cubes = append(cubes, types.Cube2D{
			Origin: [3]float64{float64(i * 3), 0, 0},
			Size:   [3]float64{1, 1, 1},
			Pivot:  [3]float64{float64(i*3 + 1), 0, 0},
			UV:     [2]float64{0, 0},
		})
	}
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{{
			Name:  "b1",
			Pivot: [3]float64{0, 0, 0},
			Cubes: cubes,
		}},
	}
	out, err := Build(model)
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	var spec Model3DSpec
	if err := json.Unmarshal([]byte(out), &spec); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(spec.Models) == 0 || len(spec.Models[0].MeshGroups) != 12 {
		t.Fatalf("meshes = %d, want 12", len(spec.Models[0].MeshGroups))
	}
	found := false
	for _, m := range spec.Models[0].MeshGroups {
		if m.ID == "b1_10" {
			found = true
		}
		if strings.ContainsAny(m.ID, ":") {
			t.Fatalf("meshID 含异常字符: %s", m.ID)
		}
	}
	if !found {
		t.Fatal("mesh id b1_10 缺失（cubeIdx 10 的十进制 ID）")
	}
}

// ---- ADR-042 §2.1 对齐锁定（2026-08-09 审计）----

// 骨骼层 localPosition X 翻转锁定：bone.pivot=[5,2,-3] 无 parent →
// localPos = {-bp.x, bp.y, bp.z} = {-5,2,-3}（对齐 YSMViewer ConvertBones 与
// ModernYSM calculateBoneMatrix 的 pivotX 取负）。
func TestBuildBoneLocalPosition_XFlip(t *testing.T) {
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{{
			Name:  "b1",
			Pivot: [3]float64{5, 2, -3},
		}},
	}
	out, err := Build(model)
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	var spec Model3DSpec
	if err := json.Unmarshal([]byte(out), &spec); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(spec.Models) == 0 || len(spec.Models[0].Bones) != 1 {
		t.Fatalf("bones = %d, want 1", len(spec.Models[0].Bones))
	}
	lp := spec.Models[0].Bones[0].LocalPosition
	if lp != [3]float64{-5, 2, -3} {
		t.Fatalf("bone localPosition = %v, want [-5 2 -3]（X 翻转对齐）", lp)
	}
}

// 旋转序锁定：eulerToQuaternion 现行口径 = Rz*Ry*Rx（ZYX intrinsic，spec.go:361，
// 对齐 Blockbench euler_order='ZYX' + frontend quaternion.ts，ADR-042 §2.1 裁决）。
// 本测试用独立四元数乘法公式锁定 ZYX 数值，并负向断言与旧 Rx*Ry*Rz 序不同——
// 若未来被改回旧序，数值断言失败即显形（旧版仅断言"与 Java 序不同"，角度符号差恒成立，守卫空转）。
func TestEulerToQuaternion_OrderLock_ZYX(t *testing.T) {
	// 三轴非零欧拉角：Go 口径 Rz(60)*Ry(-45)*Rx(-30) 的四元数（调用方已取反 X/Y）
	q := eulerToQuaternion(-30, -45, 60)
	// 独立参考：q = qz ⊗ qy ⊗ qx（ZYX intrinsic）
	qRef := zyxQuat(-30, -45, 60)
	if diff := quatDiff(q, qRef); diff > 1e-6 {
		t.Fatalf("eulerToQuaternion = %v, want ZYX 参考 %v, diff=%v（旋转序漂移？）", q, qRef, diff)
	}
	// 负向锁定：与旧 Rx*Ry*Rz 序（q = qx ⊗ qy ⊗ qz）数值必须不同，防止回退旧序
	qOld := xyzQuat(-30, -45, 60)
	if diff := quatDiff(q, qOld); diff < 1e-3 {
		t.Fatalf("ZYX 与旧 Rx*Ry*Rz 序四元数不应相同, diff=%v（顺序差异被抹平？）", diff)
	}
	// 纯 X 轴仍应等于 TestEulerToQuaternion90X 口径
	q90 := eulerToQuaternion(-90, 0, 0)
	if math.Abs(q90[0]-(-0.70710678)) > 1e-4 {
		t.Fatalf("90X qx = %v, want ≈ -0.7071", q90[0])
	}
}

// zyxQuat 独立参考：ZYX intrinsic 序四元数 q = qz ⊗ qy ⊗ qx（与 eulerToQuaternion 展开等价但独立推导）。
func zyxQuat(rxDeg, ryDeg, rzDeg float64) [4]float64 {
	return quatMul(quatMul(axisQuat(2, rzDeg), axisQuat(1, ryDeg)), axisQuat(0, rxDeg))
}

// xyzQuat 旧 Rx*Ry*Rz 序参考：q = qx ⊗ qy ⊗ qz（仅测试用，负向锁定防回退）。
func xyzQuat(rxDeg, ryDeg, rzDeg float64) [4]float64 {
	return quatMul(quatMul(axisQuat(0, rxDeg), axisQuat(1, ryDeg)), axisQuat(2, rzDeg))
}

// axisQuat 绕 axis（0=x,1=y,2=z）旋转 deg 度的单位四元数 {x,y,z,w}。
func axisQuat(axis int, deg float64) [4]float64 {
	half := deg * math.Pi / 360.0
	s, c := math.Sin(half), math.Cos(half)
	switch axis {
	case 0:
		return [4]float64{s, 0, 0, c}
	case 1:
		return [4]float64{0, s, 0, c}
	default:
		return [4]float64{0, 0, s, c}
	}
}

// quatMul 四元数乘法（Hamilton 积，{x,y,z,w}）。
func quatMul(a, b [4]float64) [4]float64 {
	ax, ay, az, aw := a[0], a[1], a[2], a[3]
	bx, by, bz, bw := b[0], b[1], b[2], b[3]
	return [4]float64{
		aw*bx + ax*bw + ay*bz - az*by,
		aw*by - ax*bz + ay*bw + az*bx,
		aw*bz + ax*by - ay*bx + az*bw,
		aw*bw - ax*bx - ay*by - az*bz,
	}
}

// quatDiff 两四元数曼哈顿距离（{x,y,z,w}）。
func quatDiff(a, b [4]float64) float64 {
	return math.Abs(a[0]-b[0]) + math.Abs(a[1]-b[1]) + math.Abs(a[2]-b[2]) + math.Abs(a[3]-b[3])
}

