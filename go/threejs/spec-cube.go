package threejs

import (
	"math"

	"ysm-model-manager/go/types"
)

// ===== 立方体几何纯函数 =====

// applyInflate 应用 Blockbench inflate 变换（origin 各轴 -i, size 各轴 +2i）。
func applyInflate(c types.Cube2D) (ox, oy, oz, sx, sy, sz float64) {
	ox, oy, oz = c.Origin[0], c.Origin[1], c.Origin[2]
	sx, sy, sz = c.Size[0], c.Size[1], c.Size[2]
	// Blockbench parseCube L662: from[0] = -(from[0] + size[0])
	// Bedrock JSON cube.origin 是"左下角"，Blockbench 内部 X 镜像到"右下角"。
	// 咱们骨骼 pivot X 翻号（computeBoneLocalPos），cube origin 也必须 X 翻号对齐。
	ox = -(ox + sx)
	if c.Inflate != 0 {
		ox -= c.Inflate
		oy -= c.Inflate
		oz -= c.Inflate
		sx += 2 * c.Inflate
		sy += 2 * c.Inflate
		sz += 2 * c.Inflate
	}
	return ox, oy, oz, sx, sy, sz
}

// clampThickness 负 size 统一 clamp 到 ≥ thicknessEpsilon。
func clampThickness(sx, sy, sz float64) (float64, float64, float64) {
	if sx < thicknessEpsilon {
		sx = thicknessEpsilon
	}
	if sy < thicknessEpsilon {
		sy = thicknessEpsilon
	}
	if sz < thicknessEpsilon {
		sz = thicknessEpsilon
	}
	return sx, sy, sz
}

// resolveCubePivot 解析 cube pivot：未显式设置时用 cube 中心。
func resolveCubePivot(c types.Cube2D, ox, oy, oz, sx, sy, sz float64) [3]float64 {
	cp := [3]float64{c.Pivot[0], c.Pivot[1], c.Pivot[2]}
	// Blockbench parseCube L659: cube 旋转中心 X 翻号（origin[0] *= -1）
	// 与顶点 X 镜像（ox = -(ox+sx)）配套，保证 cube 绕正确中心旋转。
	cp[0] = -cp[0]
	if !c.PivotSet {
		cp = [3]float64{ox + sx*0.5, oy + sy*0.5, oz + sz*0.5}
	}
	return cp
}

// computeBounds 计算最小/最大顶点。
func computeBounds(ox, oy, oz, sx, sy, sz float64) (fx, fy, fz, tx, ty, tz float64) {
	fx, fy, fz = ox, oy, oz
	tx = ox + sx
	ty = oy + sy
	tz = oz + sz
	return fx, fy, fz, tx, ty, tz
}

// computeLocalVertices 计算中心/半宽/相对 pivot 顶点。
func computeLocalVertices(fx, fy, fz, tx, ty, tz, cp0, cp1, cp2 float64) (lx, ly, lz, hx, hy, hz float64) {
	cx := (fx + tx) * 0.5
	cy := (fy + ty) * 0.5
	cz := (fz + tz) * 0.5
	hx2 := (tx - fx) * 0.5
	hy2 := (ty - fy) * 0.5
	hz2 := (tz - fz) * 0.5
	lx = cx - hx2 - cp0
	ly = cy - hy2 - cp1
	lz = cz - hz2 - cp2
	hx = cx + hx2 - cp0
	hy = cy + hy2 - cp1
	hz = cz + hz2 - cp2
	return lx, ly, lz, hx, hy, hz
}

// fixZeroThickness 零厚度面修正。
func fixZeroThickness(lx, ly, lz, hx, hy, hz float64) (float64, float64, float64, float64, float64, float64) {
	if lx == hx {
		hx += thicknessEpsilon
	}
	if ly == hy {
		hy += thicknessEpsilon
	}
	if lz == hz {
		hz += thicknessEpsilon
	}
	return lx, ly, lz, hx, hy, hz
}

// packFaceVertices 拼装 6 面顶点数组（positions/normals/uvs/indices）。
func packFaceVertices(lx, ly, lz, hx, hy, hz float64, faceUVs [6][8]float64, hasUV bool) (positions, normals, uvs []float64, indices []int) {
	faceDefs := []struct {
		v [12]float64
		n [3]float64
		f int
	}{
		{[12]float64{hx, hy, hz, hx, hy, lz, hx, ly, hz, hx, ly, lz}, [3]float64{1, 0, 0}, 0},
		{[12]float64{lx, hy, lz, lx, hy, hz, lx, ly, lz, lx, ly, hz}, [3]float64{-1, 0, 0}, 1},
		{[12]float64{lx, hy, lz, hx, hy, lz, lx, hy, hz, hx, hy, hz}, [3]float64{0, 1, 0}, 2},
		{[12]float64{lx, ly, hz, hx, ly, hz, lx, ly, lz, hx, ly, lz}, [3]float64{0, -1, 0}, 3},
		{[12]float64{lx, hy, hz, hx, hy, hz, lx, ly, hz, hx, ly, hz}, [3]float64{0, 0, 1}, 4},
		{[12]float64{hx, hy, lz, lx, hy, lz, hx, ly, lz, lx, ly, lz}, [3]float64{0, 0, -1}, 5},
	}
	for _, fd := range faceDefs {
		bi := len(positions) / 3
		positions = append(positions, fd.v[:]...)
		for i := 0; i < 4; i++ {
			normals = append(normals, fd.n[:]...)
		}
		if hasUV {
			uv := faceUVs[fd.f]
			// up/down 角点重排（foxcar per-face 贴图颠倒修复，2026-09；黄金参照
			// upstream/LgeacyYesSteveModel 的 GeoCube.java + GeoQuad.java）：
			// GeoCube 物理顶点序 up=[P4,P8,P7,P3]、down=[P1,P5,P6,P2]，本仓为
			// up=[P3,P7,P4,P8]、down=[P2,P6,P1,P5]（= canonical 位 [3,2,0,1]）。
			// faceUVs 存 canonical 槽位 s0=(u1,v1) s1=(u2,v1) s2=(u1,v2) s3=(u2,v2)
			// （四侧面直接可用），up/down 必须反转槽位序 [s3,s2,s1,s0] 才与物理顶点
			// 对齐；mirror 在 canonical 槽位交换 u 后经同一重排自然水平镜像。
			if fd.f == 2 || fd.f == 3 {
				uv = [8]float64{uv[6], uv[7], uv[4], uv[5], uv[2], uv[3], uv[0], uv[1]}
			}
			uvs = append(uvs, uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6], uv[7])
		} else {
			for i := 0; i < 8; i++ {
				uvs = append(uvs, 0)
			}
		}
		indices = append(indices, bi, bi+2, bi+1, bi+2, bi+3, bi+1)
	}
	return positions, normals, uvs, indices
}

// computeMeshLocalPos 计算 mesh 本地位置。
// cp[0] 已 X 翻号（= -Pivot[0]），所以 localPos[0] = bonePivot.x + cp[0]
// = bonePivot.x - Pivot[0]（对齐 Blockbench mesh.position = cube.origin - parent.origin）。
func computeMeshLocalPos(bonePivot vec3, cp [3]float64) [3]float64 {
	return [3]float64{bonePivot.x + cp[0], cp[1] - bonePivot.y, cp[2] - bonePivot.z}
}

// checkFinite 复查有限性（用于入口守卫和派生运算后复查）。
func checkFinite(vals ...float64) bool {
	for _, v := range vals {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return true
}
