// Package threejs 根据 YSMViewer ThreeJsPayloadBuilder.cs 移植
// 生成 Three.js 可直接消费的 JSON spec（顶点、法线、UV、骨骼层级全部预计算）
package threejs

import (
	"encoding/json"
	"fmt"
	"math"
	"ysm-model-manager/go/types"
)

func itoa(i int) string     { return fmt.Sprint(i) }
func ftoa(v [3]float64) string { return fmt.Sprintf("[%.4f,%.4f,%.4f]", v[0], v[1], v[2]) }
func ftoa3(v vec3) string       { return fmt.Sprintf("[%.4f,%.4f,%.4f]", v.x, v.y, v.z) }
func ftoaRot(v [4]float64) string { return fmt.Sprintf("[%.4f,%.4f,%.4f,%.4f]", v[0], v[1], v[2], v[3]) }
func ptrStr(p *string) string {
	if p == nil {
		return "nil"
	}
	return *p
}

// ===== JSON 数据模型 =====

type Model3DSpec struct {
	Models []ModelGroup `json:"models"`
	Debug  []string      `json:"_debug,omitempty"`
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
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	ParentID      *string   `json:"parentId"`
	LocalPosition [3]float64 `json:"localPosition"`
	LocalRotation [4]float64 `json:"localRotation"` // quaternion [x,y,z,w]
}

type MeshData struct {
	ID            string    `json:"id"`
	BoneID        string    `json:"boneId"`
	LocalPosition [3]float64 `json:"localPosition"`
	LocalRotation [4]float64 `json:"localRotation"` // quaternion [x,y,z,w]
	Positions     []float64  `json:"positions"`
	Normals       []float64  `json:"normals"`
	Uvs           []float64  `json:"uvs"`
	Indices       []int      `json:"indices"`
}

// ===== 构建入口 =====

type vec3 struct{ x, y, z float64 }

// Build 接收已解析的 BedrockModel，生成 Three.js 可直接消费的 JSON spec
func Build(model types.BedrockModel) (string, error) {
	if len(model.Bones) == 0 {
		return "{}", nil
	}
	texW := float64(model.TexWidth)
	if texW == 0 {
		texW = 64
	}
	texH := float64(model.TexHeight)
	if texH == 0 {
		texH = 64
	}

	// 收集 bone pivots 用于层级计算（同名骨骼优先保留有 parent 的 pivot）
	// 多文件合并时，main.json 的骨骼有正确层级，应覆盖 arm.json 的扁平版本
	pivots := make(map[string]vec3)
	for _, b := range model.Bones {
		np := vec3{-b.Pivot[0], b.Pivot[1], b.Pivot[2]}
		if _, exists := pivots[b.Name]; !exists {
			pivots[b.Name] = np
		} else if b.Parent != "" {
			// 同名骨骼且当前有 parent → 用当前 pivot 覆盖（main.json 的正确层级优先）
			pivots[b.Name] = np
		}
	}

	var bones []BoneData
	var meshes []MeshData
	boneIdx := make(map[string]int) // name → index in bones[]
	var debugLog []string
	debugLog = append(debugLog, "总骨骼数="+itoa(len(model.Bones)))

	for _, b := range model.Bones {
		bp := pivots[b.Name]

		// 骨骼 local position = (bone.pivot - parent.pivot)
		var localPos [3]float64
		if b.Parent != "" {
			if pp, ok := pivots[b.Parent]; ok {
				localPos = [3]float64{bp.x - pp.x, bp.y - pp.y, bp.z - pp.z}
			} else {
				localPos = [3]float64{bp.x, bp.y, bp.z}
			}
		} else {
			localPos = [3]float64{bp.x, bp.y, bp.z}
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

		// 同名骨骼：保留第一次出现的层级信息，仅追加 cubes
		if idx, exists := boneIdx[b.Name]; exists {
			debugLog = append(debugLog, "重复="+b.Name+" 现有parent="+ptrStr(bones[idx].ParentID)+" 新parent="+b.Parent+" rot="+ftoaRot(localRot))
			// 如果现有骨骼没有 parent 但当前骨骼有 parent → 补全层级
			// 多文件合并时，arm.json 的扁平骨骼先到，main.json 的正确层级后到
			if bones[idx].ParentID == nil && b.Parent != "" {
				bones[idx].ParentID = &b.Parent
				bones[idx].LocalPosition = localPos
				// 也更新 rotation（有 parent 的骨骼可能有不同的旋转）
				bones[idx].LocalRotation = localRot
				debugLog = append(debugLog, "  补全parent="+b.Parent+" localPos="+ftoa(localPos)+" rot="+ftoaRot(localRot))
			} else if b.Parent != "" {
				debugLog = append(debugLog, "  未更新：现有parent非空或新parent为空")
			}
		} else {
			debugLog = append(debugLog, "新增="+b.Name+" parent="+b.Parent+" pivot="+ftoa3(bp))
			boneIdx[b.Name] = len(bones)
			bones = append(bones, BoneData{
				ID:            b.Name,
				Name:          b.Name,
				ParentID:      parentID,
				LocalPosition: localPos,
				LocalRotation: localRot,
			})
		}

		// 所有 cube 全部追加（同名骨骼的 cube 也纳入）
		// 使用统一的 bone pivot（首次出现的 pivot），确保所有 cube 相对于同一根骨骼位置
		bonePivot, hasPivot := pivots[b.Name]
		if !hasPivot {
			bonePivot = vec3{-b.Pivot[0], b.Pivot[1], b.Pivot[2]}
		}
		for ci, c := range b.Cubes {
			meshData := buildCubeMeshData(c, bonePivot, texW, texH, b.Name, ci)
			if meshData != nil {
				meshes = append(meshes, *meshData)
			}
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
					bones[i].LocalPosition = [3]float64{raPivot.x - armPivot.x, raPivot.y - armPivot.y, raPivot.z - armPivot.z}
					debugLog = append(debugLog, "后处理: RightArm->Arm localPos="+ftoa(bones[i].LocalPosition))
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
					bones[i].LocalPosition = [3]float64{laPivot.x - armPivot.x, laPivot.y - armPivot.y, laPivot.z - armPivot.z}
					debugLog = append(debugLog, "后处理: LeftArm->Arm localPos="+ftoa(bones[i].LocalPosition))
					break
				}
			}
		}
	}

	// Texture ID
	var texID *string
	if len(model.Textures) > 0 || model.Texture != "" {
		s := "tex_0"
		texID = &s
	}

	spec := Model3DSpec{
		Models: []ModelGroup{{
			ID:             "main",
			Name:           "main",
			DefaultVisible: true,
			TextureWidth:   texW,
			TextureHeight:  texH,
			TextureID:      texID,
			Bones:          bones,
			MeshGroups:     meshes,
		}},
		Debug: debugLog,
	}

	data, err := json.Marshal(spec)
	return string(data), err
}

// ===== 立方体几何构建 =====

func buildCubeMeshData(c types.Cube2D, bonePivot vec3, texW, texH float64, boneID string, cubeIdx int) *MeshData {
	ox := -c.Origin[0]
	oy := c.Origin[1]
	oz := c.Origin[2]
	sx := c.Size[0]
	sy := c.Size[1]
	sz := c.Size[2]

	if sx == 0 || sy == 0 || sz == 0 {
		return nil
	}

	cp := [3]float64{-c.Pivot[0], c.Pivot[1], c.Pivot[2]}

	// 计算最小/最大顶点（相对于 cube pivot）
	fx := ox - sx // from x
	fy := oy
	fz := oz
	tx := fx + sx // to x = ox
	ty := fy + sy
	tz := fz + sz

	cx := (fx + tx) * 0.5 // center x
	cy := (fy + ty) * 0.5
	cz := (fz + tz) * 0.5

	hx2 := (tx - fx) * 0.5 // half size x
	hy2 := (ty - fy) * 0.5
	hz2 := (tz - fz) * 0.5

	// min/max relative to cube pivot
	lx := cx - hx2 - cp[0] // low x
	ly := cy - hy2 - cp[1]
	lz := cz - hz2 - cp[2]
	hx := cx + hx2 - cp[0] // high x
	hy := cy + hy2 - cp[1]
	hz := cz + hz2 - cp[2]

	// 避免零厚度面
	if lx == hx {
		hx += 0.001
	}
	if ly == hy {
		hy += 0.001
	}
	if lz == hz {
		hz += 0.001
	}

	// 解析 UV
	var faceUVs [6][8]float64 // face order: east,west,up,down,south,north; each face: u0,v0,u1,v0,u0,v1,u1,v1
	hasUV := parseUV(c, &faceUVs, sx, sy, sz, texW, texH)

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
		{[12]float64{hx, hy, hz, hx, hy, lz, hx, ly, hz, hx, ly, lz}, [3]float64{1, 0, 0}, 0}, // East
		{[12]float64{lx, hy, lz, lx, hy, hz, lx, ly, lz, lx, ly, hz}, [3]float64{-1, 0, 0}, 1}, // West
		{[12]float64{lx, hy, lz, hx, hy, lz, lx, hy, hz, hx, hy, hz}, [3]float64{0, 1, 0}, 2},   // Up
		{[12]float64{lx, ly, hz, hx, ly, hz, lx, ly, lz, hx, ly, lz}, [3]float64{0, -1, 0}, 3},  // Down
		{[12]float64{lx, hy, hz, hx, hy, hz, lx, ly, hz, hx, ly, hz}, [3]float64{0, 0, 1}, 4},   // South
		{[12]float64{hx, hy, lz, lx, hy, lz, hx, ly, lz, lx, ly, lz}, [3]float64{0, 0, -1}, 5},  // North
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

	// Mesh local position = (cube.pivot - bone.pivot)
	meshID := boneID + "_" + string(rune('0'+cubeIdx))
	localPos := [3]float64{cp[0] - bonePivot.x, cp[1] - bonePivot.y, cp[2] - bonePivot.z}

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
	}
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
	uvData := []struct {
		fu, fv, fw, fh float64
		f              int
	}{
		{u, v + z, z, y, 0},               // East
		{u + z + x, v + z, z, y, 1},        // West
		{u + z + x, v + z, -x, -z, 2},      // Up
		{u + z + x + x, v, -x, z, 3},       // Down
		{u + z + z + x, v + z, x, y, 4},    // South
		{u + z, v + z, x, y, 5},            // North
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
		Uv      []float64 `json:"uv"`
		UvSize  []float64 `json:"uv_size"`
	}
	if err := json.Unmarshal([]byte(faceUVStr), &faceData); err != nil {
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
			if fw < 0 {
				fw = -fw
			}
			if fh < 0 {
				fh = -fh
			}
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
// 将欧拉角（度）转为四元数，旋转顺序: Rx * Ry * Rz
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
