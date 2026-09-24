// ===== go/threejs 补充单测：parseUV 回退链 + buildModelGroup 边界分支 =====
package threejs

import (
	"encoding/json"
	"math"
	"testing"

	"ysm-model-manager/go/types"
)

// ====== parseUV / parseFaceUV ======

// FaceUV 解析失败但存在 box UV → 回退 expandBoxUV（保留纹理，不全零塌色块）
func TestParseUV_FaceUVFailFallsBackToBoxUV(t *testing.T) {
	var faces [6][8]float64
	c := types.Cube2D{FaceUV: "{not valid json", UV: [2]float64{0, 0}}
	ok := parseUV(c, &faces, 8, 8, 8, 64, 64)
	if !ok {
		t.Fatal("FaceUV 失败 + box UV 存在 → 应回退 expandBoxUV 并返回 true")
	}
	// east face: u0 = 0/64, v0 = (0+8)/64 = 0.125
	if faces[0][0] != 0 || faces[0][1] != 0.125 {
		t.Errorf("回退后 east face u0,v0 = %f,%f, 期望 0,0.125", faces[0][0], faces[0][1])
	}
}

// parseFaceUV 的 texW/texH ≤ 0 守卫：除零产生 +Inf UV，应显式拒绝
func TestParseFaceUV_ZeroTexGuard(t *testing.T) {
	var faces [6][8]float64
	uv := `{"east":{"uv":[0,0],"uv_size":[8,8]}}`
	if ok := parseFaceUV(uv, &faces, 0, 64); ok {
		t.Error("texW=0 应返回 false")
	}
	if ok := parseFaceUV(uv, &faces, 64, -1); ok {
		t.Error("texH<0 应返回 false")
	}
}

// FaceUV 为合法 JSON 但无可识别面（{"foo":...}）→ parseFaceUV 不得伪成功
// （此前恒 return true → parseUV 跳过 expandBoxUV 回退，整面 UV 归零塌色块）
func TestParseFaceUV_ValidButNoFaces(t *testing.T) {
	var faces [6][8]float64
	uv := `{"unknown":{"uv":[0,0],"uv_size":[8,8]}}`
	if ok := parseFaceUV(uv, &faces, 64, 64); ok {
		t.Error("合法 JSON 但无可识别面应返回 false（触发 box UV 回退）")
	}
	// 拒绝路径不得写入任何 face 值
	for fi, face := range faces {
		if face != [8]float64{} {
			t.Errorf("face[%d] 在拒绝路径被写入: %v", fi, face)
		}
	}
}

// TestParseFaceUV_QuadVertexOrder 锁定 b62f5913 修复（parseFaceUV 侧）：
// parseFaceUV 写入的 [8]float64 四角顶点序必须是
//
//	[u0,v0, u1,v0, u0,v1, u1,v1]
//
// 而非对角重复 [u0,v0, u1,v1, u0,v0, u1,v1]——后者导致每面 UV
// 退化为对角线性渐变（纹理被压成一条对角线）。
//
// 用例：east 面 uv=[0,8] uv_size=[8,8]，texW=texH=64。
//
//	期望四角（归一化后）：
//	  [0]=u0=0/64=0       [1]=v0=8/64=0.125
//	  [2]=u1=8/64=0.125    [3]=v0=0.125（与 [1] 同行）
//	  [4]=u0=0             [5]=v1=16/64=0.25
//	  [6]=u1=0.125         [7]=v1=0.25
//	关键不变量：[1]==[3]（顶点 0、1 同 v0 行）且 [5]==[7]（顶点 2、3 同 v1 行）。
//	对角重复 bug 下 [1]!=[3]（v0 vs v1）→ 此断言捕获回归。
func TestParseFaceUV_QuadVertexOrder(t *testing.T) {
	var faces [6][8]float64
	uv := `{"east":{"uv":[0,8],"uv_size":[8,8]}}`
	if !parseFaceUV(uv, &faces, 64, 64) {
		t.Fatal("parseFaceUV 应返回 true")
	}
	east := faces[0]
	want := [8]float64{0, 0.125, 0.125, 0.125, 0, 0.25, 0.125, 0.25}
	for i := 0; i < 8; i++ {
		if math.Abs(east[i]-want[i]) > 1e-9 {
			t.Errorf("East face[%d] = %v, 期望 %v (四角顶点序 [u0,v0,u1,v0,u0,v1,u1,v1])", i, east[i], want[i])
		}
	}
	// 不变量：顶点 0、1 同 v0 行；顶点 2、3 同 v1 行
	if east[1] != east[3] {
		t.Errorf("顶点 0、1 的 v 不同 (%v vs %v)——对角重复回归", east[1], east[3])
	}
	if east[5] != east[7] {
		t.Errorf("顶点 2、3 的 v 不同 (%v vs %v)——对角重复回归", east[5], east[7])
	}
	// 顶点 0、2 同 u0 列；顶点 1、3 同 u1 列
	if east[0] != east[4] {
		t.Errorf("顶点 0、2 的 u 不同 (%v vs %v)——列对齐破坏", east[0], east[4])
	}
	if east[2] != east[6] {
		t.Errorf("顶点 1、3 的 u 不同 (%v vs %v)——列对齐破坏", east[2], east[6])
	}
}

// TestBuildCubeMeshData_FaceUVUpDownCornerOrder 锁定 per-face UV 的 up/down 角点定向
// （foxcar 贴图颠倒事故 2026-09）：
// 黄金参照 GeoCube.java（up=[P4,P8,P7,P3] / down=[P1,P5,P6,P2]）+ GeoQuad.java
// （非 mirror：vert0=(u2,v1),vert1=(u1,v1),vert2=(u1,v2),vert3=(u2,v2)）。
// 我们 packFaceVertices 自己的顶点序（up [P3,P7,P4,P8] / down [P2,P6,P1,P5]）下，
// up/down 必须按 [vert0=(u2,v2),vert1=(u1,v2),vert2=(u2,v1),vert3=(u1,v1)] 铺 UV，
// 四个侧面（east/west/south/north）才是 (u1,v1),(u2,v1),(u1,v2),(u2,v2)。
// 早期 parseFaceUV 对 6 面同序 → per-face 模型顶面/底面贴图前后颠倒；face-split
// 按错区域采 alpha 又连带误判透明（被遮盖面隐藏）。
//
// 用例 texW=texH=64：
//   - up   uv=[0,8]  uv_size=[8,8]（正尺寸，Blockbench up 惯例 533/543）
//     u1=0, u2=0.125, v1=0.125, v2=0.25
//   - down uv=[8,16] uv_size=[8,-8]（负尺寸，foxcar down 544/544 全负）
//     u1=0.125, u2=0.25, v1=0.25, v2=0.125（有符号，不做 min/max 归一化）
//   - east uv=[0,8] uv_size=[8,8] → 侧面序保持不变
func TestBuildCubeMeshData_FaceUVUpDownCornerOrder(t *testing.T) {
	faceUV := `{"east":{"uv":[0,8],"uv_size":[8,8]},` +
		`"up":{"uv":[0,8],"uv_size":[8,8]},` +
		`"down":{"uv":[8,16],"uv_size":[8,-8]}}`
	c := types.Cube2D{
		Origin: [3]float64{0, 0, 0}, Size: [3]float64{8, 8, 8},
		Pivot: [3]float64{4, 4, 4}, PivotSet: true,
		FaceUV: faceUV,
	}
	md := buildCubeMeshData(c, vec3{}, 64, 64, "b1", 0)
	if md == nil {
		t.Fatal("buildCubeMeshData 返回 nil")
	}
	// 每面 4 顶点 × 2 UV = 8；面序 east/west/up/down/south/north
	assertFaceUV(t, md.Uvs, 0, [8]float64{0, 0.125, 0.125, 0.125, 0, 0.25, 0.125, 0.25}, "east(side)")
	assertFaceUV(t, md.Uvs, 2, [8]float64{0.125, 0.25, 0, 0.25, 0.125, 0.125, 0, 0.125}, "up(reversed)")
	assertFaceUV(t, md.Uvs, 3, [8]float64{0.25, 0.125, 0.125, 0.125, 0.25, 0.25, 0.125, 0.25}, "down(negative-size reversed)")
}

// TestBuildCubeMeshData_BoxUVUpDownParity 重构 expandBoxUV 为 GeoCube 原始 face 表后，
// box UV 的 up/down 打包结果必须与旧「负 fw/fh 技巧」逐字节一致（box 模型零回归）。
// 8³ cube @ uv[0,0]，tex64：
//   - up 原始表 (u+z, v, x, z) = (8,0,8,8)：u1=.125,u2=.25,v1=0,v2=.125
//   - down 原始表 (u+z+x, v+z, x, -z) = (16,8,8,-8)：u1=.25,u2=.375,v1=.125,v2=0
func TestBuildCubeMeshData_BoxUVUpDownParity(t *testing.T) {
	c := types.Cube2D{
		Origin: [3]float64{0, 0, 0}, Size: [3]float64{8, 8, 8},
		Pivot: [3]float64{4, 4, 4}, PivotSet: true,
		UV: [2]float64{0, 0},
	}
	md := buildCubeMeshData(c, vec3{}, 64, 64, "b1", 0)
	if md == nil {
		t.Fatal("buildCubeMeshData 返回 nil")
	}
	assertFaceUV(t, md.Uvs, 2, [8]float64{0.25, 0.125, 0.125, 0.125, 0.25, 0, 0.125, 0}, "box up")
	assertFaceUV(t, md.Uvs, 3, [8]float64{0.375, 0, 0.25, 0, 0.375, 0.125, 0.25, 0.125}, "box down")
}

// mirror per-face up：canonical 槽位水平翻转（u1↔u2）后再走 up 重排，
// 等价于每顶点采样位置水平镜像（[（u1,v2）,（u2,v2）,（u1,v1）,（u2,v1）]）。
func TestBuildCubeMeshData_FaceUVUpMirror(t *testing.T) {
	faceUV := `{"up":{"uv":[0,8],"uv_size":[8,8]}}`
	c := types.Cube2D{
		Origin: [3]float64{0, 0, 0}, Size: [3]float64{8, 8, 8},
		Pivot: [3]float64{4, 4, 4}, PivotSet: true,
		FaceUV: faceUV, Mirror: true,
	}
	md := buildCubeMeshData(c, vec3{}, 64, 64, "b1", 0)
	if md == nil {
		t.Fatal("buildCubeMeshData 返回 nil")
	}
	assertFaceUV(t, md.Uvs, 2, [8]float64{0, 0.25, 0.125, 0.25, 0, 0.125, 0.125, 0.125}, "mirrored up")
}

// TestBuildCubeMeshData_BoxMirrorEastWestSwap 锁定 box UV mirror 的完整 Blockbench
// 语义（女仆 01_taisho_maid 左臂青条事故 2026-09，普查实证 3439 个 mirror cube
// 全走 box UV 路径）。黄金参照 upstream/blockbench-master js/outliner/types/cube.js
// updateUV box_uv + mirror_uv 分支（L1298-1316），mirror 是两步：
//  1. 每面矩形自身水平翻转（from.x += size.x; size.x *= -1）；
//  2. east 与 west 的 (from,size) 整体互换——物理 east 面贴 west 矩形翻转后的 UV。
//
// 旧实现只做步骤 1（每面 canonical 槽位 u 交换），缺步骤 2 → 对称件左右臂贴图
// 互换。up/down 不参与互换（Blockbench face_list 只交换 face_list[0]/[1]）。
//
// 用例 8³ cube @ box uv=[0,0]，tex64。非 mirror box 展开（face 序
// east/west/up/down/south/north，fu 分别 0/16/8/16/24/8）经「互换 + 逐面翻转」后
// 的**打包结果**（up/down 仍走角点反转）：
func TestBuildCubeMeshData_BoxMirrorEastWestSwap(t *testing.T) {
	c := types.Cube2D{
		Origin: [3]float64{0, 0, 0}, Size: [3]float64{8, 8, 8},
		Pivot: [3]float64{4, 4, 4}, PivotSet: true,
		UV:     [2]float64{0, 0},
		Mirror: true,
	}
	md := buildCubeMeshData(c, vec3{}, 64, 64, "b1", 0)
	if md == nil {
		t.Fatal("buildCubeMeshData 返回 nil")
	}
	// east = west 原矩形（fu=16 → u∈[.25,.375]）翻转：s0/s2 取右缘 .375，s1/s3 取左缘 .25
	assertFaceUV(t, md.Uvs, 0, [8]float64{0.375, 0.125, 0.25, 0.125, 0.375, 0.25, 0.25, 0.25}, "mirror east(=west flipped)")
	// west = east 原矩形（fu=0 → u∈[0,.125]）翻转：s0/s2 取右缘 .125，s1/s3 取左缘 0
	assertFaceUV(t, md.Uvs, 1, [8]float64{0.125, 0.125, 0, 0.125, 0.125, 0.25, 0, 0.25}, "mirror west(=east flipped)")
	// up/down 不互换，只自翻转，再走角点反转（与 Blockbench face_list 镜像表逐顶点核对）
	assertFaceUV(t, md.Uvs, 2, [8]float64{0.125, 0.125, 0.25, 0.125, 0.125, 0, 0.25, 0}, "mirror up(self flip)")
	assertFaceUV(t, md.Uvs, 3, [8]float64{0.25, 0, 0.375, 0, 0.25, 0.125, 0.375, 0.125}, "mirror down(self flip)")
	// south/north 同样只自翻转
	assertFaceUV(t, md.Uvs, 4, [8]float64{0.5, 0.125, 0.375, 0.125, 0.5, 0.25, 0.375, 0.25}, "mirror south(self flip)")
	assertFaceUV(t, md.Uvs, 5, [8]float64{0.25, 0.125, 0.125, 0.125, 0.25, 0.25, 0.125, 0.25}, "mirror north(self flip)")

	// 关键回归断言：mirror east 必须等于**非 mirror west** 的逐面翻转值，
	// 而非非 mirror east 自己翻转（旧错误行为）。
	plain := buildCubeMeshData(types.Cube2D{
		Origin: [3]float64{0, 0, 0}, Size: [3]float64{8, 8, 8},
		Pivot: [3]float64{4, 4, 4}, PivotSet: true,
		UV: [2]float64{0, 0},
	}, vec3{}, 64, 64, "b1", 0)
	if md.Uvs[0] != plain.Uvs[8+2] || md.Uvs[2] != plain.Uvs[8+0] {
		t.Errorf("mirror east u 应取自非 mirror west 翻转: 得 %v/%v, 期望 %v/%v",
			md.Uvs[0], md.Uvs[2], plain.Uvs[8+2], plain.Uvs[8+0])
	}
	if md.Uvs[0] == plain.Uvs[2] {
		t.Errorf("mirror east 不得只翻转自己（缺 east/west 互换回归）: u0=%v 与非 mirror east u1=%v 相同",
			md.Uvs[0], plain.Uvs[2])
	}
}

func assertFaceUV(t *testing.T, uvs []float64, face int, want [8]float64, label string) {
	t.Helper()
	base := face * 8
	for i := 0; i < 8; i++ {
		if math.Abs(uvs[base+i]-want[i]) > 1e-9 {
			t.Fatalf("%s face uvs[%d] = %v, 期望 %v（完整面=%v）", label, i, uvs[base+i], want[i], uvs[base:base+8])
		}
	}
}

// FaceUV 合法但无可识别面 + 存在 box UV → parseUV 回退 expandBoxUV（保留纹理，不全零）
func TestParseUV_FaceUVNoFacesFallsBackToBoxUV(t *testing.T) {
	var faces [6][8]float64
	c := types.Cube2D{FaceUV: `{"unknown":{"uv":[0,0]}}`, UV: [2]float64{0, 0}}
	ok := parseUV(c, &faces, 8, 8, 8, 64, 64)
	if !ok {
		t.Fatal("FaceUV 无可识别面 + box UV 存在 → 应回退 expandBoxUV 并返回 true")
	}
	// east face（expandBoxUV 口径）: u0 = 0/64, v0 = (0+8)/64 = 0.125
	if faces[0][0] != 0 || faces[0][1] != 0.125 {
		t.Errorf("回退后 east face u0,v0 = %f,%f, 期望 0,0.125", faces[0][0], faces[0][1])
	}
}

// ====== buildModelGroup ======

// TexWidth/TexHeight 缺失（0）→ 默认 64（上游兜底口径，防止除零 UV）
func TestBuildModelGroup_ZeroTexDimDefaults(t *testing.T) {
	model := types.BedrockModel{
		Bones: []types.Bone2D{{
			Name:  "b1",
			Pivot: [3]float64{0, 0, 0},
			Cubes: []types.Cube2D{{Origin: [3]float64{0, 0, 0}, Size: [3]float64{8, 8, 8}, UV: [2]float64{0, 0}}},
		}},
	}
	mg, err := buildModelGroup(model, "main", 0)
	if err != nil {
		t.Fatal(err)
	}
	if mg.TextureWidth != 64 || mg.TextureHeight != 64 {
		t.Fatalf("TexWidth/Height 为 0 应默认 64, got %v x %v", mg.TextureWidth, mg.TextureHeight)
	}
}

// 骨骼 parent 指向 model.Bones 中不存在的骨骼（纯 parent 引用）：
// localPos 走「父无 pivot → 世界坐标」分支；缺失骨骼被补充挂 root；
// 断裂父子链修复后子骨骼也挂 root（parentID 归 nil）
func TestBuildModelGroup_PureParentReference(t *testing.T) {
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{{
			Name:   "b1",
			Parent: "ghost",
			Pivot:  [3]float64{5, 2, -3},
			Cubes:  []types.Cube2D{{Origin: [3]float64{0, 0, 0}, Size: [3]float64{2, 2, 2}, UV: [2]float64{0, 0}}},
		}},
	}
	mg, err := buildModelGroup(model, "main", 0)
	if err != nil {
		t.Fatal(err)
	}
	// 补充缺失骨骼：ghost 进 bones，无 pivot → 挂 root
	foundGhost := false
	for _, b := range mg.Bones {
		switch b.Name {
		case "ghost":
			foundGhost = true
			if b.ParentID != nil {
				t.Fatalf("纯 parent 引用骨骼应挂 root（无 parent）: %v", *b.ParentID)
			}
		case "b1":
			if b.ParentID != nil {
				t.Fatalf("断裂父子链应修复为挂 root: %v", *b.ParentID)
			}
			if b.LocalPosition != [3]float64{-5, 2, -3} {
				t.Fatalf("b1 localPosition = %v, want [-5 2 -3]（父无 pivot 走世界坐标）", b.LocalPosition)
			}
		}
	}
	if !foundGhost {
		t.Fatal("ghost 骨骼应被补充进 bones 列表")
	}
}

// 同名骨骼且不满足 overwrite（均无 parent）→ mergeCubes 合并 cube 列表
// （非替换：不重叠 cube 全部保留），骨骼条目只留一条
func TestBuildModelGroup_DuplicateNameMergeNoOverwrite(t *testing.T) {
	cubeA := types.Cube2D{Origin: [3]float64{0, 0, 0}, Size: [3]float64{2, 2, 2}, Pivot: [3]float64{1, 1, 1}, UV: [2]float64{0, 0}}
	cubeB := types.Cube2D{Origin: [3]float64{10, 0, 0}, Size: [3]float64{2, 2, 2}, Pivot: [3]float64{11, 1, 1}, UV: [2]float64{0, 0}}
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{
			{Name: "dup", Pivot: [3]float64{0, 0, 0}, Cubes: []types.Cube2D{cubeA}},
			{Name: "dup", Pivot: [3]float64{0, 0, 0}, Cubes: []types.Cube2D{cubeB}},
		},
	}
	mg, err := buildModelGroup(model, "main", 0)
	if err != nil {
		t.Fatal(err)
	}
	boneCount := 0
	for _, b := range mg.Bones {
		if b.Name == "dup" {
			boneCount++
		}
	}
	if boneCount != 1 {
		t.Fatalf("同名骨骼应合并为 1 条, got %d", boneCount)
	}
	// 两个 cube 空间不重叠 → mergeCubes 追加 → 2 个 mesh
	if len(mg.MeshGroups) != 2 {
		t.Fatalf("非重叠 cube 应合并为 2 个 mesh, got %d", len(mg.MeshGroups))
	}
}

// RightArm/LeftArm 无 parent 且存在带 parent 的 Arm → 挂到 Arm 下面
// （YSMParser 解码 .ysm 后丢失的层级修复）
func TestBuildModelGroup_ArmAttach(t *testing.T) {
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{
			{Name: "root", Pivot: [3]float64{0, 0, 0}},
			{Name: "Arm", Parent: "root", Pivot: [3]float64{0, 10, 0}},
			{Name: "RightArm", Pivot: [3]float64{4, 10, 0}},
			{Name: "LeftArm", Pivot: [3]float64{-4, 10, 0}},
		},
	}
	mg, err := buildModelGroup(model, "main", 0)
	if err != nil {
		t.Fatal(err)
	}
	parents := map[string]string{}
	for _, b := range mg.Bones {
		if b.ParentID != nil {
			parents[b.Name] = *b.ParentID
		}
	}
	if parents["RightArm"] != "Arm" || parents["LeftArm"] != "Arm" {
		t.Fatalf("RightArm/LeftArm 应挂到 Arm: parents = %v", parents)
	}
}

// ====== buildCubeMeshData 守卫分支 ======

// 入口有限性守卫：输入含 NaN → 跳过该 cube（返回 nil，防 NaN 穿透 JSON）
func TestBuildCubeMeshData_EntryNaNGuard(t *testing.T) {
	c := types.Cube2D{Origin: [3]float64{math.NaN(), 0, 0}, Size: [3]float64{8, 8, 8}}
	if md := buildCubeMeshData(c, vec3{}, 64, 64, "b1", 0); md != nil {
		t.Fatal("NaN 输入应返回 nil")
	}
}

// 顶点相对 pivot 运算溢出（origin=-1e308, pivot=1e308 → lx=-2e308 为 -Inf）→ 跳过
func TestBuildCubeMeshData_VertexRelPivotOverflow(t *testing.T) {
	c := types.Cube2D{
		Origin:   [3]float64{-1e308, 0, 0},
		Size:     [3]float64{8, 8, 8},
		Pivot:    [3]float64{1e308, 0, 0},
		PivotSet: true,
	}
	if md := buildCubeMeshData(c, vec3{}, 64, 64, "b1", 0); md != nil {
		t.Fatal("顶点相对 pivot 溢出应返回 nil")
	}
}

// 零厚度面修正：巨大 origin + 微小 size 时 ox+sx 浮点舍入回退（tx==fx → hx2==0）
// → lx==hx 命中 thicknessEpsilon 修正分支（三轴分别验证）
func TestBuildCubeMeshData_ZeroThicknessFloatRounding(t *testing.T) {
	cubes := []types.Cube2D{
		{Origin: [3]float64{1e15, 0, 0}, Size: [3]float64{0.001, 8, 8}}, // X 轴零厚度
		{Origin: [3]float64{0, 1e15, 0}, Size: [3]float64{8, 0.001, 8}}, // Y 轴零厚度
		{Origin: [3]float64{0, 0, 1e15}, Size: [3]float64{8, 8, 0.001}}, // Z 轴零厚度
	}
	for i, c := range cubes {
		md := buildCubeMeshData(c, vec3{}, 64, 64, "b1", i)
		if md == nil {
			t.Fatalf("cube %d 应保留（零厚度面被 thicknessEpsilon 修正）", i)
		}
		// 修正后顶点不得含 NaN/Inf
		for _, v := range md.Positions {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				t.Fatalf("cube %d 顶点含非法值 %f", i, v)
			}
		}
	}
}

// hasUV=false 分支：texW=0 → expandBoxUV 拒绝 → UV 全零填充（不产出 NaN）
func TestBuildCubeMeshData_NoUVZeroFill(t *testing.T) {
	c := types.Cube2D{Origin: [3]float64{0, 0, 0}, Size: [3]float64{8, 8, 8}, UV: [2]float64{0, 0}}
	md := buildCubeMeshData(c, vec3{}, 0, 64, "b1", 0) // texW=0
	if md == nil {
		t.Fatal("texW=0 时 cube 仍应构建（UV 降级全零）")
	}
	for _, u := range md.Uvs {
		if u != 0 {
			t.Fatalf("texW=0 时 UV 应全零填充, got %f", u)
		}
	}
}

// mesh localPos 运算溢出（bonePivot=1e308 - cp=-1e308 → 2e308 为 +Inf）→ 跳过
func TestBuildCubeMeshData_LocalPosOverflow(t *testing.T) {
	c := types.Cube2D{
		Origin:   [3]float64{0, 0, 0},
		Size:     [3]float64{8, 8, 8},
		Pivot:    [3]float64{-1e308, 0, 0},
		PivotSet: true,
	}
	// resolveCubePivot X 翻号：cp[0] = -Pivot[0] = -(-1e308) = +1e308
	// computeMeshLocalPos 用 bonePivot.x + cp[0] = 1e308 + 1e308 = 2e308 → 溢出
	if md := buildCubeMeshData(c, vec3{1e308, 0, 0}, 64, 64, "b1", 0); md != nil {
		t.Fatal("mesh localPos 溢出应返回 nil")
	}
}

// ====== BuildMulti 空组件 ======

// 组件无骨骼 → 跳过该组件（不产出空 models 条目）
func TestBuildMulti_SkipEmptyComponent(t *testing.T) {
	empty := types.BedrockModel{TexWidth: 64}
	valid := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{{
			Name:  "b1",
			Pivot: [3]float64{0, 0, 0},
			Cubes: []types.Cube2D{{Origin: [3]float64{0, 0, 0}, Size: [3]float64{8, 8, 8}, UV: [2]float64{0, 0}}},
		}},
	}
	out, err := BuildMulti([]types.BedrockModel{empty, valid}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var spec Model3DSpec
	if err := json.Unmarshal([]byte(out), &spec); err != nil {
		t.Fatal(err)
	}
	if len(spec.Models) != 1 || spec.Models[0].ID != "comp_1" {
		t.Fatalf("空组件应被跳过, models = %d (ID=%q)", len(spec.Models), func() string {
			if len(spec.Models) > 0 {
				return spec.Models[0].ID
			}
			return ""
		}())
	}
}

// 全部组件为空 → 空 spec
func TestBuildMulti_AllEmpty(t *testing.T) {
	out, err := BuildMulti([]types.BedrockModel{{}, {}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if out != "{}" {
		t.Fatalf("全空组件应返回 {}, got %q", out)
	}
}
