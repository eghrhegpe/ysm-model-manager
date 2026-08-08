// Package threejs 根据 YSMViewer ThreeJsPayloadBuilder.cs 移植
// 生成 Three.js 可直接消费的 JSON spec（顶点、法线、UV、骨骼层级全部预计算）
package threejs

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strconv"

	"ysm-model-manager/go/types"
)

// ===== JSON 数据模型 =====

type Model3DSpec struct {
	Models []ModelGroup `json:"models"`
}

type ModelGroup struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	DefaultVisible bool       `json:"defaultVisible"`
	TextureWidth   float64    `json:"textureWidth"`
	TextureHeight  float64    `json:"textureHeight"`
	TextureID      *string    `json:"textureId"`
	Bones          []BoneData `json:"bones"`
	MeshGroups     []MeshData `json:"meshGroups"`
}

type BoneData struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	ParentID      *string    `json:"parentId"`
	LocalPosition [3]float64 `json:"localPosition"`
	LocalRotation [4]float64 `json:"localRotation"` // quaternion [x,y,z,w]
	CubeCount     int        `json:"_cubeCount"`    // 该骨骼挂载的立方体数（前端统计用，underscore 字段）
}

type MeshData struct {
	ID            string     `json:"id"`
	BoneID        string     `json:"boneId"`
	LocalPosition [3]float64 `json:"localPosition"`
	LocalRotation [4]float64 `json:"localRotation"` // quaternion [x,y,z,w]
	Positions     []float64  `json:"positions"`
	Normals       []float64  `json:"normals"`
	Uvs           []float64  `json:"uvs"`
	Indices       []int      `json:"indices"`
	TexIdx        int        `json:"texIdx"` // 纹理槽索引
}

// ===== 构建入口 =====

type vec3 struct{ x, y, z float64 }

// Build 接收已解析的 BedrockModel，生成 Three.js 可直接消费的 JSON spec
func Build(model types.BedrockModel) (string, error) {
	mg, err := buildModelGroup(model, "main", 0)
	if err != nil {
		return "{}", err
	}
	if mg.Bones == nil && mg.MeshGroups == nil {
		return "{}", nil // 无骨骼 → 空 spec
	}
	spec := Model3DSpec{Models: []ModelGroup{mg}}
	data, err := json.Marshal(spec)
	return string(data), err
}

// BuildMulti 多组件 spec：每个组件独立构建为 spec.models 元素（YSMViewer 式多组件同屏）。
// texIdxBase 为组件在全局纹理数组中的起点偏移（组件内 cube.TexSlot 已由解析层全局化）。
// nil/越界时按组件序 i 回退（与 texSlot 连续分配一致，避免 textureId 全 tex_0——P2 修复）。
func BuildMulti(models []types.BedrockModel, texIdxBase []int) (string, error) {
	if len(models) == 0 {
		return "{}", nil
	}
	groups := make([]ModelGroup, 0, len(models))
	for i, m := range models {
		if len(m.Bones) == 0 {
			continue
		}
		base := i
		if i < len(texIdxBase) {
			base = texIdxBase[i]
		}
		mg, err := buildModelGroup(m, fmt.Sprintf("comp_%d", i), base)
		if err != nil {
			return "{}", err
		}
		groups = append(groups, mg)
	}
	if len(groups) == 0 {
		return "{}", nil
	}
	spec := Model3DSpec{Models: groups}
	data, err := json.Marshal(spec)
	return string(data), err
}

// buildModelGroup 单组件 spec 构建核心（Build 与 BuildMulti 共用）。
// compID 为该组件在 models 数组中的 ID；texIdxBase 用于生成组件级 textureId。
func buildModelGroup(model types.BedrockModel, compID string, texIdxBase int) (ModelGroup, error) {
	if len(model.Bones) == 0 {
		return ModelGroup{}, nil
	}
	texW := float64(model.TexWidth)
	if texW == 0 {
		texW = 64
	}
	texH := float64(model.TexHeight)
	if texH == 0 {
		texH = 64
	}

	// 收集 bone pivots 用于层级计算。
	// 同名骨骼的保留规则必须与下方骨骼构建循环的 overwrite 决策**完全一致**：
	// 骨骼循环保留「首次出现」条目，仅当满足 overwrite 条件（无 parent→有 parent，
	// 或同有 parent 且无旋转→有旋转）才被后者替换。
	// 若此处 pivots 按更宽规则（同名且有 parent 即覆盖）预收集，会造成
	// 「bones 保留首次、pivots 用后者」的错位 → cube 整体偏移（bug-chronicle #14 复发形态，P2 修复）。
	type boneFirst struct {
		pivot     vec3
		hasParent bool
		hasRot    bool
	}
	first := make(map[string]boneFirst)
	pivots := make(map[string]vec3)
	for _, b := range model.Bones {
		np := vec3{b.Pivot[0], b.Pivot[1], b.Pivot[2]}
		fi, exists := first[b.Name]
		if !exists {
			first[b.Name] = boneFirst{np, b.Parent != "", b.Rotation[0] != 0 || b.Rotation[1] != 0 || b.Rotation[2] != 0}
			pivots[b.Name] = np
			continue
		}
		newHasParent := b.Parent != ""
		newHasRot := b.Rotation[0] != 0 || b.Rotation[1] != 0 || b.Rotation[2] != 0
		overwrite := (!fi.hasParent && newHasParent) ||
			(fi.hasParent && newHasParent && !fi.hasRot && newHasRot)
		if overwrite {
			pivots[b.Name] = np
			first[b.Name] = boneFirst{np, newHasParent, newHasRot}
		}
	}

	var bones []BoneData
	boneIdx := make(map[string]int)              // name → index in bones[]
	boneDone := make(map[string]bool)            // name → already processed into mesh
	boneCubes := make(map[string][]types.Cube2D) // name → accumulated cubes

	for _, b := range model.Bones {
		bp := pivots[b.Name]

		// 骨骼 local position = (bone.pivot - parent.pivot)，X 翻转对齐 C# ConvertBones（-pivot.x）
		var localPos [3]float64
		if b.Parent != "" {
			if pp, ok := pivots[b.Parent]; ok {
				localPos = [3]float64{pp.x - bp.x, bp.y - pp.y, bp.z - pp.z}
			} else {
				localPos = [3]float64{-bp.x, bp.y, bp.z}
			}
		} else {
			localPos = [3]float64{-bp.x, bp.y, bp.z}
		}

		var localRot [4]float64 = [4]float64{0, 0, 0, 1}
		// 解析骨骼旋转（Blockbench 欧拉角 → 四元数）
		if b.Rotation[0] != 0 || b.Rotation[1] != 0 || b.Rotation[2] != 0 {
			localRot = eulerToQuaternion(-b.Rotation[0], -b.Rotation[1], b.Rotation[2])
		}
		var parentID *string
		if b.Parent != "" {
			parentID = &b.Parent
		}

		// 同名骨骼：保留第一次出现的层级信息，cube 用 mergeCubes 合并（替换重叠、保留非重叠）
		if idx, exists := boneIdx[b.Name]; exists {
			// 去重规则：优先保留数据更完整的骨骼
			existingHasParent := bones[idx].ParentID != nil
			newHasParent := b.Parent != ""
			existingHasRot := bones[idx].LocalRotation != [4]float64{0, 0, 0, 1}
			newHasRot := localRot != [4]float64{0, 0, 0, 1}

			overwrite := (!existingHasParent && newHasParent) ||
				(existingHasParent && newHasParent && !existingHasRot && newHasRot)
			if overwrite {
				bones[idx].ParentID = &b.Parent
				bones[idx].LocalPosition = localPos
				bones[idx].LocalRotation = localRot
				boneCubes[b.Name] = append([]types.Cube2D{}, b.Cubes...)
			} else {
				boneCubes[b.Name] = mergeCubes(boneCubes[b.Name], b.Cubes)
			}
		} else {
			boneIdx[b.Name] = len(bones)
			bones = append(bones, BoneData{
				ID:            b.Name,
				Name:          b.Name,
				ParentID:      parentID,
				LocalPosition: localPos,
				LocalRotation: localRot,
			})
			boneCubes[b.Name] = append([]types.Cube2D{}, b.Cubes...)
		}
	}

	// 第二遍：将合并后的 cube 转为 mesh 数据
	// 注意：即使骨骼没有 cube，也要保留在 bones 列表中（它是子骨骼的父节点）
	var meshes []MeshData
	for _, b := range model.Bones {
		if _, exists := boneIdx[b.Name]; !exists {
			continue // 同名骨骼已合并到第一次出现的条目中
		}
		if boneDone[b.Name] {
			continue
		}
		boneDone[b.Name] = true

		bonePivot, hasPivot := pivots[b.Name]
		if !hasPivot {
			bonePivot = vec3{b.Pivot[0], b.Pivot[1], b.Pivot[2]}
		}
		// 前端统计：该骨骼合并后的立方体数（spec 统计面板"立方体 N 个"依赖 _cubeCount）
		if idx, ok := boneIdx[b.Name]; ok {
			bones[idx].CubeCount = len(boneCubes[b.Name])
		}
		for ci, c := range boneCubes[b.Name] {
			meshData := buildCubeMeshData(c, bonePivot, texW, texH, b.Name, ci)
			if meshData != nil {
				meshes = append(meshes, *meshData)
			}
		}
	}

	// 确保所有骨骼都在 bones 列表中（包括无 cube 的中间骨骼）
	// 1. 收集所有出现在 parent 引用中的骨骼名
	allBoneNames := make(map[string]bool)
	for _, b := range model.Bones {
		allBoneNames[b.Name] = true
		if b.Parent != "" {
			allBoneNames[b.Parent] = true // parent 可能没有 cube，但也必须存在
		}
	}
	// 2. 补充缺失的骨骼（包括纯 parent 引用、无 cube 的中间骨骼）
	for name := range allBoneNames {
		if _, exists := boneIdx[name]; !exists {
			bp, hasPivot := pivots[name]
			var parentName string
			var localPos [3]float64
			found := false
			for _, b := range model.Bones {
				if b.Name == name {
					found = true
					parentName = b.Parent
					if b.Parent != "" {
						if pp, ok := pivots[b.Parent]; ok {
							localPos = [3]float64{pp.x - bp.x, bp.y - pp.y, bp.z - pp.z}
						} else {
							// 父骨骼无 pivot 数据 → 挂到 root，用世界坐标
							parentName = ""
							localPos = [3]float64{-bp.x, bp.y, bp.z}
						}
					} else {
						localPos = [3]float64{-bp.x, bp.y, bp.z}
					}
					break
				}
			}
			if !found {
				// 纯 parent 引用，不在 model.Bones 中
				if !hasPivot {
					log.Printf("[spec] ⚠️ 骨骼 %q 无 pivot（纯 parent 引用）", name)
				}
				// 挂到 root，用世界坐标
				localPos = [3]float64{-bp.x, bp.y, bp.z}
				parentName = ""
			}
			var parentID *string
			if parentName != "" {
				parentID = &parentName
			}
			boneIdx[name] = len(bones)
			bones = append(bones, BoneData{
				ID:            name,
				Name:          name,
				ParentID:      parentID,
				LocalPosition: localPos,
				LocalRotation: [4]float64{0, 0, 0, 1},
			})
		}
	}

	// 后处理：修复断裂的父子链
	boneNameSet := make(map[string]bool)
	for _, b := range bones {
		boneNameSet[b.Name] = true
	}
	for i := range bones {
		if bones[i].ParentID == nil {
			continue
		}
		// 沿父链向上找第一个有 pivot 且在 bones 列表中的祖先
		ancestor := *bones[i].ParentID
		visited := map[string]bool{bones[i].Name: true}
		for {
			_, ancHasPivot := pivots[ancestor]
			if boneNameSet[ancestor] && ancHasPivot {
				break // 找到有效祖先
			}
			// 找 ancestor 的 parent
			found := false
			for _, b := range model.Bones {
				if b.Name == ancestor && b.Parent != "" && !visited[b.Parent] {
					ancestor = b.Parent
					visited[ancestor] = true
					found = true
					break
				}
			}
			if !found {
				ancestor = "" // 链断了，挂到 root
				break
			}
		}

		bp := pivots[bones[i].Name]
		if ancestor != "" {
			ancPivot := pivots[ancestor]
			bones[i].ParentID = &ancestor
			bones[i].LocalPosition = [3]float64{ancPivot.x - bp.x, bp.y - ancPivot.y, bp.z - ancPivot.z}
		} else {
			bones[i].ParentID = nil
			bones[i].LocalPosition = [3]float64{-bp.x, bp.y, bp.z}
		}
	}

	// 后处理：将 RightArm/LeftArm 挂到 Arm 下面（YSMParser 解码 .ysm 后丢失的层级）
	for i := range bones {
		if bones[i].Name == "RightArm" && bones[i].ParentID == nil {
			for j := range bones {
				if bones[j].Name == "Arm" && bones[j].ParentID != nil {
					raPivot := pivots["RightArm"]
					armPivot := pivots["Arm"]
					bones[i].ParentID = &bones[j].Name
					bones[i].LocalPosition = [3]float64{armPivot.x - raPivot.x, raPivot.y - armPivot.y, raPivot.z - armPivot.z}
					break
				}
			}
		}
		if bones[i].Name == "LeftArm" && bones[i].ParentID == nil {
			for j := range bones {
				if bones[j].Name == "Arm" && bones[j].ParentID != nil {
					laPivot := pivots["LeftArm"]
					armPivot := pivots["Arm"]
					bones[i].ParentID = &bones[j].Name
					bones[i].LocalPosition = [3]float64{armPivot.x - laPivot.x, laPivot.y - armPivot.y, laPivot.z - armPivot.z}
					break
				}
			}
		}
	}

	// Texture ID
	var texID *string
	if len(model.Textures) > 0 || model.Texture != "" {
		s := fmt.Sprintf("tex_%d", texIdxBase)
		texID = &s
	}

	// Name 用组件源模型文件名（main/arm/arrow，UI 组件选择器显示），空则回退 compID
	compName := model.SourceName
	if compName == "" {
		compName = compID
	}
	return ModelGroup{
		ID:             compID,
		Name:           compName,
		DefaultVisible: true,
		TextureWidth:   texW,
		TextureHeight:  texH,
		TextureID:      texID,
		Bones:          bones,
		MeshGroups:     meshes,
	}, nil
}

// ===== 立方体几何构建 =====

// 零厚度面修正值（避免 Three.js 渲染零面积面）
const thicknessEpsilon = 0.001

func buildCubeMeshData(c types.Cube2D, bonePivot vec3, texW, texH float64, boneID string, cubeIdx int) *MeshData {
	ox := c.Origin[0]
	oy := c.Origin[1]
	oz := c.Origin[2]
	sx := c.Size[0]
	sy := c.Size[1]
	sz := c.Size[2]
	// Blockbench inflate（像素单位）：origin 各轴 -i、size 各轴 +2i，对齐 Java
	// GeoCube P1-P8 顶点口径（origin.x-inflate .. origin.x+size.x+inflate）。
	// Go 端几何为像素坐标（前端统一 scale 1/16），inflate 直接用像素值，无需 /16。
	// 缺失此字段时老模型（1.10+ Blockbench 导出，如 inflate:0.01/-0.35）尺寸偏小（P2）。
	if c.Inflate != 0 {
		ox -= c.Inflate
		oy -= c.Inflate
		oz -= c.Inflate
		sx += 2 * c.Inflate
		sy += 2 * c.Inflate
		sz += 2 * c.Inflate
	}
	cp := [3]float64{c.Pivot[0], c.Pivot[1], c.Pivot[2]}
	// cube 未显式 pivot（Blockbench 缺省，解析为零值）→ 用 cube 中心作为旋转中心，
	// 对齐 YSMViewer 口径。此前当 [0,0,0] 会让 mesh localPos = bonePivot，与骨骼链
	// 累加（X 翻转后 ≈ -bonePivot）恰好抵消 → 手臂等无 pivot cube 堆到模型原点，
	// fox 解压目录模型 main 手臂消失（P1）。
	if cp == [3]float64{0, 0, 0} {
		cp = [3]float64{ox + sx*0.5, oy + sy*0.5, oz + sz*0.5}
	}
	// 优先用 cube 自身 tex 维度
	if c.CubeTexW > 0 {
		texW = float64(c.CubeTexW)
	}
	if c.CubeTexH > 0 {
		texH = float64(c.CubeTexH)
	}

	// 最小/最大顶点（不取反）
	// 注：零尺寸 cube 不再丢弃（对齐 C# BuildCubeMeshData：零厚度面由下方
	// thicknessEpsilon 修正保留，见 spec_portability 对比 #3）
	fx := ox
	fy := oy
	fz := oz
	tx := ox + sx
	ty := fy + sy
	tz := fz + sz

	cx := (fx + tx) * 0.5
	cy := (fy + ty) * 0.5
	cz := (fz + tz) * 0.5

	hx2 := (tx - fx) * 0.5
	hy2 := (ty - fy) * 0.5
	hz2 := (tz - fz) * 0.5

	// 顶点相对 cube pivot（旋转中心），mesh 位置 = bonePivot - cubePivot（X 翻转对齐 C#）
	lx := cx - hx2 - cp[0]
	ly := cy - hy2 - cp[1]
	lz := cz - hz2 - cp[2]
	hx := cx + hx2 - cp[0]
	hy := cy + hy2 - cp[1]
	hz := cz + hz2 - cp[2]

	// 避免零厚度面
	if lx == hx {
		hx += thicknessEpsilon
	}
	if ly == hy {
		hy += thicknessEpsilon
	}
	if lz == hz {
		hz += thicknessEpsilon
	}

	// 解析 UV
	var faceUVs [6][8]float64 // face order: east,west,up,down,south,north; each face: u0,v0,u1,v0,u0,v1,u1,v1
	hasUV := parseUV(c, &faceUVs, sx, sy, sz, texW, texH)
	// Blockbench mirror：UV 水平翻转（u 方向交换，对齐 Java GeoQuad 的
	// mirror 分支——纹理左右镜像；几何不翻转，YSMParser 解码亦无 mirror 处理佐证）。
	if c.Mirror {
		for fi := 0; fi < 6; fi++ {
			faceUVs[fi][0], faceUVs[fi][2] = faceUVs[fi][2], faceUVs[fi][0]
			faceUVs[fi][4], faceUVs[fi][6] = faceUVs[fi][6], faceUVs[fi][4]
		}
	}

	var positions []float64
	var normals []float64
	var uvs []float64
	var indices []int

	// 6 个面: East, West, Up, Down, South, North
	faceDefs := []struct {
		v [12]float64 // 4 vertices * 3 coords
		n [3]float64  // normal
		f int         // face index
	}{
		{[12]float64{hx, hy, hz, hx, hy, lz, hx, ly, hz, hx, ly, lz}, [3]float64{1, 0, 0}, 0},  // East
		{[12]float64{lx, hy, lz, lx, hy, hz, lx, ly, lz, lx, ly, hz}, [3]float64{-1, 0, 0}, 1}, // West
		{[12]float64{lx, hy, lz, hx, hy, lz, lx, hy, hz, hx, hy, hz}, [3]float64{0, 1, 0}, 2},  // Up
		{[12]float64{lx, ly, hz, hx, ly, hz, lx, ly, lz, hx, ly, lz}, [3]float64{0, -1, 0}, 3}, // Down
		{[12]float64{lx, hy, hz, hx, hy, hz, lx, ly, hz, hx, ly, hz}, [3]float64{0, 0, 1}, 4},  // South
		{[12]float64{hx, hy, lz, lx, hy, lz, hx, ly, lz, lx, ly, lz}, [3]float64{0, 0, -1}, 5}, // North
	}

	for _, fd := range faceDefs {
		bi := len(positions) / 3
		positions = append(positions, fd.v[:]...)
		for i := 0; i < 4; i++ {
			normals = append(normals, fd.n[:]...)
		}
		if hasUV {
			uv := faceUVs[fd.f]
			uvs = append(uvs, uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6], uv[7])
		} else {
			for i := 0; i < 8; i++ {
				uvs = append(uvs, 0)
			}
		}
		indices = append(indices, bi, bi+2, bi+1, bi+2, bi+3, bi+1)
	}

	// Mesh local position = bonePivot - cubePivot（X 翻转对齐 C# ConvertBones；顶点已相对 cubePivot）
	meshID := boneID + "_" + strconv.Itoa(cubeIdx)
	localPos := [3]float64{bonePivot.x - cp[0], cp[1] - bonePivot.y, cp[2] - bonePivot.z}

	// Cube rotation → quaternion (CreateBlockbenchQuaternion)
	localRot := eulerToQuaternion(-c.Rotation[0], -c.Rotation[1], c.Rotation[2])

	return &MeshData{
		ID:            meshID,
		BoneID:        boneID,
		LocalPosition: localPos,
		LocalRotation: localRot,
		Positions:     positions,
		Normals:       normals,
		Uvs:           uvs,
		Indices:       indices,
		TexIdx:        c.TexSlot,
	}
}

// ===== 同名骨骼 cube 合并 =====

const cubeEpsilon = 0.001

// mergeCubes 合并两组 cube：新 cube 中与旧 cube 空间重叠的替换之，不重叠的追加
func mergeCubes(oldCubes, newCubes []types.Cube2D) []types.Cube2D {
	result := make([]types.Cube2D, len(oldCubes))
	copy(result, oldCubes)
	matched := make([]bool, len(oldCubes)) // 标记旧 cube 是否已被替换

	for _, nc := range newCubes {
		found := -1
		for i, oc := range oldCubes {
			if !matched[i] && cubesOverlap(oc, nc) {
				found = i
				break
			}
		}
		if found >= 0 {
			result[found] = nc
			matched[found] = true
		} else {
			result = append(result, nc)
		}
	}
	return result
}

// cubesOverlap 判断两个 cube 是否在空间上重叠（origin + size + rotation 均相等）
func cubesOverlap(a, b types.Cube2D) bool {
	return floatEqual(a.Origin, b.Origin, cubeEpsilon) &&
		floatEqual(a.Size, b.Size, cubeEpsilon) &&
		floatEqual(a.Rotation, b.Rotation, cubeEpsilon)
}

func floatEqual(a, b [3]float64, eps float64) bool {
	for i := 0; i < 3; i++ {
		v := a[i] - b[i]
		if v < 0 {
			v = -v
		}
		if v > eps {
			return false
		}
	}
	return true
}

// ===== UV 解析 =====

// face order: east(0), west(1), up(2), down(3), south(4), north(5)
func parseUV(c types.Cube2D, faces *[6][8]float64, sx, sy, sz, texW, texH float64) bool {
	if c.FaceUV != "" {
		return parseFaceUV(c.FaceUV, faces, texW, texH)
	}
	if len(c.UV) >= 2 {
		return expandBoxUV(c.UV, sx, sy, sz, texW, texH, faces)
	}
	return false
}

// expandBoxUV 对应 YSMViewer MinecraftCubeUV.Expand()
func expandBoxUV(uv [2]float64, sx, sy, sz, texW, texH float64, faces *[6][8]float64) bool {
	u := uv[0]
	v := uv[1]
	x := sx
	y := sy
	z := sz

	// faceUVs[4] = {u0,v0, u1,v0, u0,v1, u1,v1} 对应顶点顺序
	// Face order: East(0), West(1), Up(2), Down(3), South(4), North(5)
	// fw/fh 取绝对值：负值表示纹理方向翻转已体现在面的顶点排列中，
	// UV 坐标的宽度/高度必须为正数，否则纹理镜像
	uvData := []struct {
		fu, fv, fw, fh float64
		f              int
	}{
		{u, v + z, z, y, 0},             // East
		{u + z + x, v + z, z, y, 1},     // West
		{u + z + x, v + z, -x, -z, 2},   // Up
		{u + z + x + x, v, -x, z, 3},    // Down
		{u + z + z + x, v + z, x, y, 4}, // South
		{u + z, v + z, x, y, 5},         // North
	}

	for _, d := range uvData {
		fu := d.fu
		fv := d.fv
		fw := d.fw
		fh := d.fh

		u0 := fu / texW
		v0 := fv / texH
		u1 := (fu + fw) / texW
		v1 := (fv + fh) / texH

		faces[d.f] = [8]float64{u0, v0, u1, v0, u0, v1, u1, v1}
	}
	return true
}

// parseFaceUV 对应 YSMViewer GetFaceUV() — 每面独立 UV
func parseFaceUV(faceUVStr string, faces *[6][8]float64, texW, texH float64) bool {
	var faceData map[string]struct {
		Uv     []float64 `json:"uv"`
		UvSize []float64 `json:"uv_size"`
	}
	if err := json.Unmarshal([]byte(faceUVStr), &faceData); err != nil {
		log.Printf("[threejs] parseFaceUV 失败: %v", err)
		return false
	}

	// face order in JSON: east, west, up, down, south, north
	faceNames := []string{"east", "west", "up", "down", "south", "north"}
	for fi, name := range faceNames {
		fd, ok := faceData[name]
		if !ok || len(fd.Uv) < 2 {
			continue
		}
		fu := fd.Uv[0]
		fv := fd.Uv[1]
		fw := float64(0)
		fh := float64(0)
		if len(fd.UvSize) >= 2 {
			fw = fd.UvSize[0]
			fh = fd.UvSize[1]
		}

		u0 := fu / texW
		v0 := fv / texH
		u1 := (fu + fw) / texW
		v1 := (fv + fh) / texH

		faces[fi] = [8]float64{u0, v0, u1, v0, u0, v1, u1, v1}
	}
	return true
}

// ===== 四元数 =====

// eulerToQuaternion 对应 YSMViewer CreateBlockbenchQuaternion()
// 将欧拉角（度）转为四元数，旋转顺序: Rx * Ry * Rz (Three.js 默认)
// 口径：调用方传入的是已取反角度（X/Y 取反、Z 不取反），等效于 C#
// YsmLoaderService.ConvertBones（-rx,-ry,+rz）+ builder 正角度四元数。
// 历史注记：曾三轴取反（-rx,-ry,-rz），与 C# 在 Z 轴符号相反，
// 渲染对齐对比（tests/port-verification）定位后改为 Z 不取反。
func eulerToQuaternion(rxDeg, ryDeg, rzDeg float64) [4]float64 {
	rx := rxDeg * math.Pi / 180.0
	ry := ryDeg * math.Pi / 180.0
	rz := rzDeg * math.Pi / 180.0

	// 旋转矩阵: M = Rx * Ry * Rz
	cosX := math.Cos(rx)
	sinX := math.Sin(rx)
	cosY := math.Cos(ry)
	sinY := math.Sin(ry)
	cosZ := math.Cos(rz)
	sinZ := math.Sin(rz)

	// Matrix4x4.CreateRotationX(rx) * Matrix4x4.CreateRotationY(ry) * Matrix4x4.CreateRotationZ(rz)
	// 3x3 rotation matrix
	m00 := cosY * cosZ
	m01 := -cosY * sinZ
	m02 := sinY
	m10 := cosX*sinZ + sinX*sinY*cosZ
	m11 := cosX*cosZ - sinX*sinY*sinZ
	m12 := -sinX * cosY
	m20 := sinX*sinZ - cosX*sinY*cosZ
	m21 := sinX*cosZ + cosX*sinY*sinZ
	m22 := cosX * cosY

	// 旋转矩阵 → 四元数
	trace := m00 + m11 + m22
	var qw, qx, qy, qz float64

	if trace > 0 {
		s := 0.5 / math.Sqrt(trace+1.0)
		qw = 0.25 / s
		qx = (m21 - m12) * s
		qy = (m02 - m20) * s
		qz = (m10 - m01) * s
	} else if m00 > m11 && m00 > m22 {
		s := 2.0 * math.Sqrt(1.0+m00-m11-m22)
		qw = (m21 - m12) / s
		qx = 0.25 * s
		qy = (m01 + m10) / s
		qz = (m02 + m20) / s
	} else if m11 > m22 {
		s := 2.0 * math.Sqrt(1.0+m11-m00-m22)
		qw = (m02 - m20) / s
		qx = (m01 + m10) / s
		qy = 0.25 * s
		qz = (m12 + m21) / s
	} else {
		s := 2.0 * math.Sqrt(1.0+m22-m00-m11)
		qw = (m10 - m01) / s
		qx = (m02 + m20) / s
		qy = (m12 + m21) / s
		qz = 0.25 * s
	}

	return [4]float64{qx, qy, qz, qw}
}
