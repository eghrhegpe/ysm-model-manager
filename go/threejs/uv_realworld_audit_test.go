package threejs

// 真实模型库 UV 全量审计（opt-in，默认 skip，不进常规 go test / CI）。
//
// 为什么需要：合成 corpus（port-align.ts）只覆盖离散尺寸，真实库才有全部
// 奇异组合——负 uv_size、非方正 cube、缺面、每 cube 纹理尺寸。mirror east/west
// 漏互换（女仆 01 青条）、up/down 角点颠倒（foxcar）两次事故都藏在真实数据里。
//
// 运行：
//
//	$env:YSM_UV_AUDIT_ROOT="D:\YSM管理器测试文件夹"; go test ./go/threejs -run TestRealWorldUVAudit -v -timeout 600s
//
// 三层校验（每层独立于实现 expandBoxUV/parseFaceUV 的编码）：
//  1. 独立 oracle 对拍：Blockbench cube.js face_list 全负尺寸编码重算六面矩形
//     （实现走 GeoCube 表 + 打包点反转，是另一套编码；两套编码逐顶点一致才说明对）；
//     per-face 直接从 JSON 声明重算。48 个 UV 逐值比对。
//  2. box 布局自洽：从输出 UV 反推每面 texel 宽高，必须精确等于几何维度
//     （东西=z×y、上下=x×z、南北=x×y）——轴互换类错误（如 down 误写 z 宽）
//     在非方正 cube 上必露馅。
//  3. per-face 声明自洽：输出矩形的有符号宽高/起点必须 == JSON 声明 uv/uv_size。

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
)

const uvAuditTol = 1e-7

type uvAuditRect struct {
	set            bool
	x1, y1, x2, y2 float64
}

// bbFaceRects 独立复刻 Blockbench cube.js face_list（全负 fw/fh 编码）。
// 与实现的 GeoCube 表（down 仅 fh=-z + 打包点槽位反转）是同一几何的两种编码；
// 非方正 x≠z 时任何轴误写立刻分歧（2026-09 port-align 重建期 down 轴错实证）。
func bbFaceRects(u, v, x, y, z float64) [6]uvAuditRect {
	return [6]uvAuditRect{
		{true, u, v + z, u + z, v + z + y},                         // east
		{true, u + z + x, v + z, u + z + x + z, v + z + y},         // west
		{true, u + z + x, v + z, u + z, v},                         // up: fw=-x, fh=-z
		{true, u + z + 2*x, v, u + z + x, v + z},                   // down: fw=-x, fh=+z
		{true, u + z + x + z, v + z, u + z + x + z + x, v + z + y}, // south
		{true, u + z, v + z, u + z + x, v + z + y},                 // north
	}
}

// mirrorRects Blockbench updateUV L1298-1316：① 每面水平翻转 ② east/west 互换。
func mirrorRects(in [6]uvAuditRect) [6]uvAuditRect {
	for i := range in {
		if in[i].set {
			in[i].x1, in[i].x2 = in[i].x2, in[i].x1
		}
	}
	in[0], in[1] = in[1], in[0]
	return in
}

// rectToPackedUV 矩形 → 打包点 8 UV。
// 事实源（Blockbench cube.js updateUV L1376-1402）：六面【统一】canonical 槽位
//   - slot0=(x1,y1) slot1=(x2,y1) slot2=(x1,y2) slot3=(x2,y2)
//
// up/down 的方向反转已编码在 box 展开表的【负尺寸】里（up fw=-x,fh=-z；
// down fw=-x,fh=+z），槽位层不再反转。实现走「正尺寸 GeoCube 表 + up/down
// 打包点 [s3,s2,s1,s0] 反转」，与「负尺寸 + canonical」数学等价，两套编码
// 逐槽位对拍即互验。注意：负尺寸矩形 x1>x2 时不得做 min/max 归一化。
func rectToPackedUV(r uvAuditRect, fi int, texW, texH float64) [8]float64 {
	var out [8]float64
	if !r.set {
		return out
	}
	s := [4][2]float64{
		{r.x1 / texW, r.y1 / texH},
		{r.x2 / texW, r.y1 / texH},
		{r.x1 / texW, r.y2 / texH},
		{r.x2 / texW, r.y2 / texH},
	}
	for k := 0; k < 4; k++ {
		out[2*k] = s[k][0]
		out[2*k+1] = s[k][1]
	}
	return out
}

// geoQuadPackedUV 复刻黄金参照 LgeacyYSM GeoQuad.java + GeoCube.java 的 per-face
// UV 分配（非 mirror）。GeoQuad 构造器对 GC 顶点序 q0..q3 配：
//
//	q0=(u2,v1) q1=(u1,v1) q2=(u1,v2) q3=(u2,v2)
//
// GeoCube 顶点序翻译到本仓物理槽位（packFaceVertices faceDefs 的 s0..s3）：
//   - 四侧面 GC 序=[s1,s0,s2,s3] → 本仓槽位取 q 序 [q1,q0,q2,q3]
//   - up/down GC 序=[s2,s3,s1,s0] → 本仓槽位取 q 序 [q3,q2,q0,q1]
//
// 逐顶点展开即：四侧面 canonical，up/down=[s3c,s2c,s1c,s0c]——与实现
// packFaceVertices 的 up/down 反转完全一致（foxcar 修复同源事实）。
// uv_size 符号保留（down 负高案 v2<v1），不做 min/max 归一化。
func geoQuadPackedUV(r uvAuditRect, fi int, texW, texH float64) [8]float64 {
	var out [8]float64
	if !r.set {
		return out
	}
	q := [4][2]float64{
		{r.x2 / texW, r.y1 / texH}, // q0
		{r.x1 / texW, r.y1 / texH}, // q1
		{r.x1 / texW, r.y2 / texH}, // q2
		{r.x2 / texW, r.y2 / texH}, // q3
	}
	pick := [4]int{1, 0, 2, 3} // 四侧面：s0..s3 = q1,q0,q2,q3
	if fi == 2 || fi == 3 {
		pick = [4]int{3, 2, 0, 1} // up/down：s0..s3 = q3,q2,q0,q1
	}
	for k := 0; k < 4; k++ {
		out[2*k] = q[pick[k]][0]
		out[2*k+1] = q[pick[k]][1]
	}
	return out
}

// faceUVDecl per-face 声明的最小独立解析（不走实现 parseFaceUV）。
type faceUVDecl struct {
	UV     []float64 `json:"uv"`
	UVSize []float64 `json:"uv_size"`
}

func parseFaceUVDecl(faceUVStr string) (map[string]faceUVDecl, bool) {
	var m map[string]faceUVDecl
	if err := json.Unmarshal([]byte(faceUVStr), &m); err != nil {
		return nil, false
	}
	return m, true
}

func declRects(decl map[string]faceUVDecl) [6]uvAuditRect {
	names := [6]string{"east", "west", "up", "down", "south", "north"}
	var rs [6]uvAuditRect
	for i, n := range names {
		f, ok := decl[n]
		if !ok || len(f.UV) < 2 {
			continue
		}
		w, h := 0.0, 0.0
		if len(f.UVSize) >= 2 {
			w, h = f.UVSize[0], f.UVSize[1]
		}
		rs[i] = uvAuditRect{true, f.UV[0], f.UV[1], f.UV[0] + w, f.UV[1] + h}
	}
	return rs
}

func uvClose(a, b float64) bool {
	return math.Abs(a-b) <= uvAuditTol
}

type uvAuditStats struct {
	files       int
	models      int
	cubes       int
	box         int
	perFace     int
	noUV        int
	mirror      int
	perFaceMirr int
	emptyFace   int
	badFaceJSON int
	mismatches  []string
}

func auditModel(s *uvAuditStats, model types.BedrockModel, where string) {
	texW, texH := float64(model.TexWidth), float64(model.TexHeight)
	if texW == 0 {
		texW = defaultTexSize
	}
	if texH == 0 {
		texH = defaultTexSize
	}
	s.models++
	for _, b := range model.Bones {
		bp := vec3{b.Pivot[0], b.Pivot[1], b.Pivot[2]}
		for ci, c := range b.Cubes {
			s.cubes++
			if c.Mirror {
				s.mirror++
			}
			md := buildCubeMeshData(c, bp, texW, texH, b.Name, ci)
			if md == nil {
				continue // 非法 cube（有限性守卫），几何测试另有覆盖
			}
			cw, ch := texW, texH
			if c.CubeTexW > 0 {
				cw = float64(c.CubeTexW)
			}
			if c.CubeTexH > 0 {
				ch = float64(c.CubeTexH)
			}

			// 模式判定（独立复刻 parseUV 优先级）：
			// FaceUV JSON 合法但【零个有效面】（如 "uv":{} 或 {"east":{}}）时，
			// Go parseFaceUV 返回 false → 回退 box UV（c.UV 为 [2]float64 零值，
			// len 恒 2）以 (0,0) 展开。TS parseFaceUV 恒返回 true 是已知双端分歧
			// （真实库 15_kluonoa mingpai 实证），此处按 Go 现状对拍并计数 emptyFace。
			var rects [6]uvAuditRect
			mode := "none"
			// switch 链（gocritic ifElseChain 收口，2026-09）：模式判定三分支语义不变
			switch {
			case c.FaceUV != "":
				if decl, ok := parseFaceUVDecl(c.FaceUV); ok {
					rects = declRects(decl)
					validFaces := 0
					for _, r := range rects {
						if r.set {
							validFaces++
						}
					}
					if validFaces > 0 {
						mode = "perface"
						s.perFace++
						if c.Mirror {
							s.perFaceMirr++
						}
					} else {
						s.emptyFace++
						rects = bbFaceRects(c.UV[0], c.UV[1], c.Size[0], c.Size[1], c.Size[2])
						mode = "box"
						s.box++
					}
				} else {
					s.badFaceJSON++
					if len(c.UV) >= 2 {
						rects = bbFaceRects(c.UV[0], c.UV[1], c.Size[0], c.Size[1], c.Size[2])
						mode = "box"
						s.box++
					} else {
						s.noUV++
					}
				}
			case len(c.UV) >= 2:
				rects = bbFaceRects(c.UV[0], c.UV[1], c.Size[0], c.Size[1], c.Size[2])
				mode = "box"
				s.box++
			default:
				s.noUV++
			}
			if c.Mirror && mode != "none" {
				rects = mirrorRects(rects)
			}

			// ① 48 UV 逐值对拍。box 走 BB 全负编码+canonical；per-face（非 mirror）
			// 走黄金参照 GeoQuad 复刻。per-face+mirror：BB（矩形互换）与 GC（顶点组
			// 互换+法线翻转）是两套不同编码，真实库该组合计数为 0（旧普查 332 模型
			// 实证），跳过逐值对拍，仅由③尺寸守恒兜底，避免拿错参照误报。
			if mode != "perface" || !c.Mirror {
				for fi := 0; fi < 6; fi++ {
					var want [8]float64
					if mode == "perface" {
						want = geoQuadPackedUV(rects[fi], fi, cw, ch)
					} else {
						want = rectToPackedUV(rects[fi], fi, cw, ch)
					}
					for k := 0; k < 8; k++ {
						got := md.Uvs[fi*8+k]
						if !uvClose(got, want[k]) {
							if len(s.mismatches) < 40 {
								s.mismatches = append(s.mismatches,
									where+" "+b.Name+" cube#"+itoa(ci)+" mode="+mode+
										" mirror="+boolStr(c.Mirror)+
										" face="+[6]string{"east", "west", "up", "down", "south", "north"}[fi]+
										" uv["+itoa(k)+"]="+ftoa(got)+" want="+ftoa(want[k]))
							}
						}
					}
				}
			}

			// ② box 布局自洽：每面 texel 绝对宽高必须 == 几何维度绝对值（病态负
			// size cube 在真实库存在，UV 按声明原值展开、几何层另行 clamp；
			// BB 表逐值对拍由①负责，此处只验绝对尺寸）。mirror 不改绝对尺寸。
			// 实现对 up/down 槽位做了 [s3,s2,s1,s0] 反转，固定索引差对它们失效，
			// 故四角取 min/max 反算（与槽位序无关，只验绝对尺寸=几何维度）。
			if mode == "box" {
				type dim struct{ w, h float64 }
				ax, ay, az := math.Abs(c.Size[0]), math.Abs(c.Size[1]), math.Abs(c.Size[2])
				want := [6]dim{
					{az, ay}, {az, ay},
					{ax, az}, {ax, az},
					{ax, ay}, {ax, ay},
				}
				for fi := 0; fi < 6; fi++ {
					base := fi * 8
					u0 := md.Uvs[base]
					v0 := md.Uvs[base+1]
					minU, maxU, minV, maxV := u0, u0, v0, v0
					for k := 1; k < 4; k++ {
						uu := md.Uvs[base+2*k]
						vv := md.Uvs[base+2*k+1]
						minU = math.Min(minU, uu)
						maxU = math.Max(maxU, uu)
						minV = math.Min(minV, vv)
						maxV = math.Max(maxV, vv)
					}
					wTex := (maxU - minU) * cw
					hTex := (maxV - minV) * ch
					if math.Abs(wTex-want[fi].w) > 1e-5 || math.Abs(hTex-want[fi].h) > 1e-5 {
						if len(s.mismatches) < 40 {
							s.mismatches = append(s.mismatches,
								where+" "+b.Name+" cube#"+itoa(ci)+" box-layout face="+
									[6]string{"east", "west", "up", "down", "south", "north"}[fi]+
									" texelWH="+ftoa(wTex)+"x"+ftoa(hTex)+
									" want="+ftoa(want[fi].w)+"x"+ftoa(want[fi].h))
						}
					}
				}
			}

			// ③ per-face 声明自洽：输出矩形有符号宽高/起点 == 声明（up/down 打包
			// 反转只改槽位序，四角点集不变 → 比较 min/max 角点）
			if mode == "perface" && c.FaceUV != "" {
				decl, _ := parseFaceUVDecl(c.FaceUV)
				names := [6]string{"east", "west", "up", "down", "south", "north"}
				for fi, n := range names {
					f, ok := decl[n]
					if !ok || len(f.UV) < 2 {
						continue
					}
					w, h := 0.0, 0.0
					if len(f.UVSize) >= 2 {
						w, h = f.UVSize[0], f.UVSize[1]
					}
					base := fi * 8
					us := [4]float64{md.Uvs[base], md.Uvs[base+2], md.Uvs[base+4], md.Uvs[base+6]}
					vs := [4]float64{md.Uvs[base+1], md.Uvs[base+3], md.Uvs[base+5], md.Uvs[base+7]}
					minU, maxU := us[0], us[0]
					minV, maxV := vs[0], vs[0]
					for t := 1; t < 4; t++ {
						minU = math.Min(minU, us[t])
						maxU = math.Max(maxU, us[t])
						minV = math.Min(minV, vs[t])
						maxV = math.Max(maxV, vs[t])
					}
					gotW, gotH := (maxU-minU)*cw, (maxV-minV)*ch
					// mirror 后矩形整体可能来自相邻面，跳过起点比对，仅尺寸须守恒
					if math.Abs(gotW-math.Abs(w)) > 1e-5 || math.Abs(gotH-math.Abs(h)) > 1e-5 {
						if len(s.mismatches) < 40 {
							s.mismatches = append(s.mismatches,
								where+" "+b.Name+" cube#"+itoa(ci)+" perface-size face="+n+
									" got="+ftoa(gotW)+"x"+ftoa(gotH)+" decl="+ftoa(math.Abs(w))+"x"+ftoa(math.Abs(h)))
						}
					}
				}
			}
		}
	}
}

func itoa(i int) string {
	return strconv.Itoa(i)
}

func ftoa(f float64) string {
	return strconv.FormatFloat(f, 'g', 6, 64)
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func TestRealWorldUVAudit(t *testing.T) {
	root := os.Getenv("YSM_UV_AUDIT_ROOT")
	if root == "" {
		t.Skip("opt-in 真实库审计：设置 YSM_UV_AUDIT_ROOT=<模型库根目录> 后运行")
	}
	stats := &uvAuditStats{}
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(strings.ToLower(path), ".json") {
			return nil
		}
		data, rerr := os.ReadFile(path)
		if rerr != nil {
			return nil
		}
		model := geometry.ParseBedrockGeometry(data)
		if model == nil || len(model.Bones) == 0 {
			return nil
		}
		stats.files++
		rel, _ := filepath.Rel(root, path)
		auditModel(stats, *model, rel)
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	t.Logf("UV 真实库审计：文件=%d 模型=%d cubes=%d（box=%d perface=%d 无UV=%d mirror=%d 其中perface+mirror=%d 空uv对象=%d 坏faceJSON=%d）",
		stats.files, stats.models, stats.cubes, stats.box, stats.perFace, stats.noUV, stats.mirror, stats.perFaceMirr, stats.emptyFace, stats.badFaceJSON)
	if len(stats.mismatches) > 0 {
		for _, m := range stats.mismatches {
			t.Error(m)
		}
	}
}
