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

// defaultTexSize 纹理尺寸缺失（texW/texH==0）时的默认值（对齐 YSMViewer 兜底）
const defaultTexSize = 64

// ===== JSON 数据模型 =====

type Model3DSpec struct {
	Models []ModelGroup `json:"models"`
	// TexArrOrder 组件序纹理名数组（R1 契约，GetModel3DSpec 注入）。
	// 必须在此声明：typed 返回链（json.Unmarshal → Wails 序列化）会丢弃
	// 结构体外字段——缺失曾致 perComponent 纹理/契约校验在前端静默失效（回归 936169b1）。
	TexArrOrder []string `json:"texArrOrder,omitempty"`
	// ComponentTextures 组件名 → 声明纹理 base64 数组（ADR-114 perComponent，
	// zip/7z/解压目录三路同源注入）。同上，缺失即前端纹理绑定回落全局槽错贴。
	ComponentTextures map[string][]string `json:"componentTextures,omitempty"`
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
	Glow          bool       `json:"glow"`          // 发光骨骼（名前缀 "ysmGlow"），前端设 emissive
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

// ===== 常量 =====

// thicknessEpsilon 零厚度面修正值（避免 Three.js 渲染零面积面）
const thicknessEpsilon = 0.001

// cubeEpsilon mergeCubes 重叠判定 epsilon
const cubeEpsilon = 0.001

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
	if err != nil {
		return "{}", fmt.Errorf("threejs.Build marshal spec: %w", err)
	}
	return string(data), nil
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
	if err != nil {
		return "{}", fmt.Errorf("threejs.BuildMulti marshal spec: %w", err)
	}
	return string(data), nil
}

// buildModelGroup 单组件 spec 构建核心（Build 与 BuildMulti 共用）。
// 委托给 spec-bones.go 中的纯函数组装。
func buildModelGroup(model types.BedrockModel, compID string, texIdxBase int) (ModelGroup, error) {
	if len(model.Bones) == 0 {
		return ModelGroup{}, nil
	}
	texW := float64(model.TexWidth)
	if texW == 0 {
		texW = defaultTexSize
	}
	texH := float64(model.TexHeight)
	if texH == 0 {
		texH = defaultTexSize
	}

	pivots, _ := collectBonePivots(model)
	bones, boneIdx, boneCubes := assembleBones(model, pivots)
	boneByName := buildBoneByNameIndex(model)
	var meshes []MeshData
	meshes, bones = assembleMeshes(bones, boneIdx, boneCubes, pivots, model, texW, texH)
	bones = fillMissingBones(bones, boneIdx, pivots, boneByName, model)
	bones = repairBrokenParentChain(bones, pivots, boneByName, model)
	bones = attachArms(bones, pivots)

	var texID *string
	if len(model.Textures) > 0 || model.Texture != "" {
		s := fmt.Sprintf("tex_%d", texIdxBase)
		texID = &s
	}
	compName := model.SourceName
	if compName == "" {
		compName = compID
	}
	// 全组件默认可见：UI「全部组件」初始选中态须与渲染一致——「仅 main 默认可见」
	// 会让主体不叫 main 的拆分模型（部分车万女仆等）整组隐藏，打开一片空。
	// 视锥剔除 bbox 已只计可见子树（frustum-cull 修复②），全亮无「载具撑大 box→闪烁」顾虑。
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

// buildCubeMeshData 立方体几何构建（测试直接调用，保留为导出符号）。
// 委托给 spec-cube.go 中的纯函数组装。
func buildCubeMeshData(c types.Cube2D, bonePivot vec3, texW, texH float64, boneID string, cubeIdx int) *MeshData {
	// 入口有限性检查
	for _, v := range []float64{
		c.Origin[0], c.Origin[1], c.Origin[2],
		c.Size[0], c.Size[1], c.Size[2],
		c.Pivot[0], c.Pivot[1], c.Pivot[2],
		c.Inflate,
	} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			log.Printf("[threejs] 跳过非法 cube（非有限数值）bone=%s cube=%d val=%v", boneID, cubeIdx, v)
			return nil
		}
	}

	ox, oy, oz, sx, sy, sz := applyInflate(c)
	if !checkFinite(ox, oy, oz, sx, sy, sz) {
		log.Printf("[threejs] 跳过非法 cube（inflate 运算溢出）bone=%s cube=%d", boneID, cubeIdx)
		return nil
	}
	sx, sy, sz = clampThickness(sx, sy, sz)
	cp := resolveCubePivot(c, ox, oy, oz, sx, sy, sz)
	fx, fy, fz, tx, ty, tz := computeBounds(ox, oy, oz, sx, sy, sz)
	if !checkFinite(tx, ty, tz) {
		log.Printf("[threejs] 跳过非法 cube（顶点派生溢出）bone=%s cube=%d", boneID, cubeIdx)
		return nil
	}
	lx, ly, lz, hx, hy, hz := computeLocalVertices(fx, fy, fz, tx, ty, tz, cp[0], cp[1], cp[2])
	if !checkFinite(lx, ly, lz, hx, hy, hz) {
		log.Printf("[threejs] 跳过非法 cube（顶点相对 pivot 溢出）bone=%s cube=%d", boneID, cubeIdx)
		return nil
	}
	lx, ly, lz, hx, hy, hz = fixZeroThickness(lx, ly, lz, hx, hy, hz)

	// 优先用 cube 自身 tex 维度
	if c.CubeTexW > 0 {
		texW = float64(c.CubeTexW)
	}
	if c.CubeTexH > 0 {
		texH = float64(c.CubeTexH)
	}

	// 解析 UV
	var faceUVs [6][8]float64
	hasUV := parseUV(c, &faceUVs, c.Size[0], c.Size[1], c.Size[2], texW, texH)
	if c.Mirror {
		for fi := 0; fi < 6; fi++ {
			faceUVs[fi][0], faceUVs[fi][2] = faceUVs[fi][2], faceUVs[fi][0]
			faceUVs[fi][4], faceUVs[fi][6] = faceUVs[fi][6], faceUVs[fi][4]
		}
	}

	positions, normals, uvs, indices := packFaceVertices(lx, ly, lz, hx, hy, hz, faceUVs, hasUV)

	localPos := computeMeshLocalPos(bonePivot, cp)
	if !checkFinite(localPos[0], localPos[1], localPos[2]) {
		log.Printf("[threejs] 跳过非法 cube（mesh localPos 溢出）bone=%s cube=%d", boneID, cubeIdx)
		return nil
	}

	localRot := eulerToQuaternion(-c.Rotation[0], -c.Rotation[1], c.Rotation[2])
	meshID := boneID + "_" + strconv.Itoa(cubeIdx)
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

// mergeCubes 合并两组 cube：新 cube 中与旧 cube 空间重叠的替换之，不重叠的追加
func mergeCubes(oldCubes, newCubes []types.Cube2D) []types.Cube2D {
	result := make([]types.Cube2D, len(oldCubes))
	copy(result, oldCubes)
	matched := make([]bool, len(oldCubes))
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

func parseUV(c types.Cube2D, faces *[6][8]float64, sx, sy, sz, texW, texH float64) bool {
	if c.FaceUV != "" {
		if parseFaceUV(c.FaceUV, faces, texW, texH) {
			return true
		}
		if len(c.UV) >= 2 {
			return expandBoxUV(c.UV, sx, sy, sz, texW, texH, faces)
		}
		return false
	}
	if len(c.UV) >= 2 {
		return expandBoxUV(c.UV, sx, sy, sz, texW, texH, faces)
	}
	return false
}

func expandBoxUV(uv [2]float64, sx, sy, sz, texW, texH float64, faces *[6][8]float64) bool {
	if texW <= 0 || texH <= 0 {
		return false
	}
	u, v := uv[0], uv[1]
	type uvData struct {
		fu, fv, fw, fh float64
		f              int
	}
	data := []uvData{
		{u, v + sz, sz, sy, 0}, {u + sz + sx, v + sz, sz, sy, 1},
		{u + sz + sx, v + sz, -sx, -sz, 2}, {u + sz + sx + sx, v, -sx, sz, 3},
		{u + sz + sz + sx, v + sz, sx, sy, 4}, {u + sz, v + sz, sx, sy, 5},
	}
	for _, d := range data {
		// 四角 quad：顶点序 (u0,v0)(u1,v0)(u0,v1)(u1,v1)——对齐前端 cube-mesh.ts 与
		// spec-builder.ts；此前写成对角重复 [u0,v0,u1,v1,u0,v0,u1,v1]，导致每面
		// UV 退化为对角线性渐变（纹理被压成一条对角线 → 糊/纯色/方向怪异）。
		// 前两个顶点是面上的 u0、后两个是 u1（v0 行在前、v1 行在后）。
		faces[d.f] = [8]float64{
			d.fu / texW, d.fv / texH, (d.fu + d.fw) / texW, d.fv / texH,
			d.fu / texW, (d.fv + d.fh) / texH, (d.fu + d.fw) / texW, (d.fv + d.fh) / texH,
		}
	}
	return true
}

func parseFaceUV(faceUVStr string, faces *[6][8]float64, texW, texH float64) bool {
	var faceData map[string]struct {
		Uv     []float64 `json:"uv"`
		UvSize []float64 `json:"uv_size"`
	}
	if err := json.Unmarshal([]byte(faceUVStr), &faceData); err != nil {
		log.Printf("[threejs] parseFaceUV 失败: %v", err)
		return false
	}
	faceNames := []string{"east", "west", "up", "down", "south", "north"}
	parsed := false
	for fi, name := range faceNames {
		fd, ok := faceData[name]
		if !ok || len(fd.Uv) < 2 {
			continue
		}
		if texW <= 0 || texH <= 0 {
			return false
		}
		fu, fv := fd.Uv[0], fd.Uv[1]
		fw, fh := float64(0), float64(0)
		if len(fd.UvSize) >= 2 {
			fw, fh = fd.UvSize[0], fd.UvSize[1]
		}
		// 四角 quad：顶点序 (u0,v0)(u1,v0)(u0,v1)(u1,v1)——同 expandBoxUV 修复（对角
		// 重复会导致面内 UV 退化为对角渐变，纹理糊/纯色/方向怪异）。
		faces[fi] = [8]float64{
			fu / texW, fv / texH, (fu + fw) / texW, fv / texH,
			fu / texW, (fv + fh) / texH, (fu + fw) / texW, (fv + fh) / texH,
		}
		parsed = true
	}
	return parsed
}

// ===== 四元数工具 =====

func eulerToQuaternion(rxDeg, ryDeg, rzDeg float64) [4]float64 {
	rx := rxDeg * math.Pi / 180.0
	ry := ryDeg * math.Pi / 180.0
	rz := rzDeg * math.Pi / 180.0
	cosX := math.Cos(rx)
	sinX := math.Sin(rx)
	cosY := math.Cos(ry)
	sinY := math.Sin(ry)
	cosZ := math.Cos(rz)
	sinZ := math.Sin(rz)
	// M = Rz * Ry * Rx (ZYX intrinsic order) — 对齐 Blockbench euler_order='ZYX' + frontend quaternion.ts (ADR-042 §2.1)
	// 展开式：M = Rz(cz,sz) × Ry(cy,sy) × Rx(cx,sx)
	m00 := cosZ * cosY
	m01 := cosZ*sinY*sinX - sinZ*cosX
	m02 := cosZ*sinY*cosX + sinZ*sinX
	m10 := sinZ * cosY
	m11 := sinZ*sinY*sinX + cosZ*cosX
	m12 := sinZ*sinY*cosX - cosZ*sinX
	m20 := -sinY
	m21 := cosY * sinX
	m22 := cosY * cosX
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

func isIdentityQuat(q [4]float64) bool {
	const eps = 1e-9
	return math.Abs(q[0]) < eps && math.Abs(q[1]) < eps && math.Abs(q[2]) < eps && math.Abs(q[3]-1) < eps
}

func hasBoneRotation(rot [3]float64) bool {
	return !isIdentityQuat(eulerToQuaternion(-rot[0], -rot[1], rot[2]))
}
