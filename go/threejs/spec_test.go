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
	// mesh localPosition = X 翻转对齐 C#（ConvertBones）→ bonePivot - cubePivot = [0,0,0] - [4,4,4]
	if !strings.Contains(out, `"localPosition":[-4,4,4]`) {
		t.Fatalf("mesh localPosition mismatch: %s", out)
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

// 旋转序锁定：eulerToQuaternion 当前口径 = Rx*Ry*Rz（spec.go:699，对齐 YSMViewer C#
// ThreeJsPayloadBuilder）；ModernYSM Java 侧 JOML 右乘连调 rotateZ→rotateY→rotateX
// 等价 Rz*Ry*Rx，顺序相反（ADR-042 §2.1 审计 ⚠️ 待视觉裁决）。本测试锁定 Go 现行口径，
// 防止未来按 Java 盲改破坏 ADR-041 已对齐的 C# 基准；若裁决改为 Java 序，改这里即显形。
func TestEulerToQuaternion_OrderLock_RxRyRz(t *testing.T) {
	// 三轴非零欧拉角：Go 口径 Rx(30)*Ry(45)*Rz(60) 的四元数
	q := eulerToQuaternion(-30, -45, 60) // 调用方已取反 X/Y（ConvertBones 约定）
	// 与 Java Rz(60)*Ry(45)*Rx(30) 顺序不同 → 数值不相等（锁定差异存在）
	qJavaOrder := eulerToQuaternionJavaOrder(30, 45, 60)
	diff := math.Abs(q[0]-qJavaOrder[0]) + math.Abs(q[1]-qJavaOrder[1]) +
		math.Abs(q[2]-qJavaOrder[2]) + math.Abs(q[3]-qJavaOrder[3])
	if diff < 1e-3 {
		t.Fatalf("Go(Rx*Ry*Rz) 与 Java(Rz*Ry*Rx) 四元数不应相同，diff=%v（顺序差异被抹平？）", diff)
	}
	// 锁定 Go 现行数值（防止意外漂移）：对纯 X 轴仍应等于 TestEulerToQuaternion90X 口径
	q90 := eulerToQuaternion(-90, 0, 0)
	if math.Abs(q90[0]-(-0.70710678)) > 1e-4 {
		t.Fatalf("90X qx = %v, want ≈ -0.7071", q90[0])
	}
}

// eulerToQuaternionJavaOrder 复现 ModernYSM calculateBoneMatrix 的旋转序
// （rotateZ → rotateY → rotateX 右乘 = Rz*Ry*Rx），用于对比锁定测试。
// 仅测试用，不进生产路径。
func eulerToQuaternionJavaOrder(rxDeg, ryDeg, rzDeg float64) [4]float64 {
	rx := rxDeg * math.Pi / 180.0
	ry := ryDeg * math.Pi / 180.0
	rz := rzDeg * math.Pi / 180.0
	cosX, sinX := math.Cos(rx), math.Sin(rx)
	cosY, sinY := math.Cos(ry), math.Sin(ry)
	cosZ, sinZ := math.Cos(rz), math.Sin(rz)
	// M = Rz * Ry * Rx（Java 右乘连调顺序）
	m00 := cosY * cosZ
	m01 := cosX*sinZ + sinX*sinY*cosZ
	m02 := sinX*sinZ - cosX*sinY*cosZ
	m10 := -cosY * sinZ
	m11 := cosX*cosZ - sinX*sinY*sinZ
	m12 := sinX*cosZ + cosX*sinY*sinZ
	m20 := sinY
	m21 := -sinX * cosY
	m22 := cosX * cosY
	trace := m00 + m11 + m22
	if trace > 0 {
		s := 0.5 / math.Sqrt(trace+1.0)
		return [4]float64{(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s}
	}
	if m00 > m11 && m00 > m22 {
		s := 2.0 * math.Sqrt(1.0+m00-m11-m22)
		return [4]float64{0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s}
	}
	if m11 > m22 {
		s := 2.0 * math.Sqrt(1.0+m11-m00-m22)
		return [4]float64{(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s}
	}
	s := 2.0 * math.Sqrt(1.0+m22-m00-m11)
	return [4]float64{(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s}
}
