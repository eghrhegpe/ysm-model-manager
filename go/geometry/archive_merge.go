// archive_merge.go：Bedrock Geometry 合并逻辑（原 archive.go 拆分，2026-10 文件行数治理）。
// buildSubModels / mergeGeoFiles / mergeParsedGeos / buildTexIdxMap 等——多 geo 文件与 manifest 清单合并为单一模型。
// 时序约束：buildSubModels 须在 sortByTexOrder 之后调用（L0 TexSlot 用 orderMap 换算排序后槽位）。
package geometry

import (
	"path/filepath"
	"strings"

	"ysm-model-manager/go/types"
)

func buildSubModels(geo *types.BedrockModel, ctx subModelCtx) {
	// L0：Name 取自 manifest，SourcePath 是 zip 内绝对路径，TexSlot 对应 manifest 下标
	if len(ctx.maidManifest) > 0 {
		l0Subs := make([]types.SubModel, 0, len(ctx.maidManifest))
		for i, item := range ctx.maidManifest {
			if item.Name == "" {
				continue
			}
			// SourcePath 用实际解析到的 zip 路径（形式 B model_id 推断时 item.Model 为空，
			// 直接拼 maidNs 会得到命名空间目录 → 单角色匹配必失败，静默回退全量合并模型）；
			// 未解析到则留空 → 前端 subPath undefined 走兜底。
			// TexSlot 用条目纹理在排序后纹理数组的下标（texNameByItem → orderMap），
			// 而非 manifest 下标（纹理解析失败的条目会使 l0Pngs 收缩、下标漂移）。
			slot := 0
			if tn, ok := ctx.texNameByItem[i]; ok {
				if s, ok2 := ctx.orderMap[tn]; ok2 {
					slot = s
				}
			}
			l0Subs = append(l0Subs, types.SubModel{
				Name:       item.Name,
				SourcePath: ctx.resolvedPathByItem[i],
				TexSlot:    slot,
			})
		}
		if len(l0Subs) > 0 {
			geo.SubModels = l0Subs
		}
	}
	if len(geo.SubModels) == 0 && len(ctx.geoFiles) > 0 {
		// L1 兜底：从 geoFiles 派生（Name=basename 去 .geo.json/.json 后缀）
		l1Subs := make([]types.SubModel, 0, len(ctx.geoFiles))
		for i, gf := range ctx.geoFiles {
			subName := filepath.ToSlash(gf.name)
			if idx := strings.LastIndex(subName, "/"); idx >= 0 {
				subName = subName[idx+1:]
			}
			subName = strings.TrimSuffix(subName, ".geo.json")
			subName = strings.TrimSuffix(subName, ".json")
			slot := i
			if slot >= len(ctx.pngs) && len(ctx.pngs) > 0 {
				slot = len(ctx.pngs) - 1
			}
			l1Subs = append(l1Subs, types.SubModel{
				Name:       subName,
				SourcePath: gf.name,
				TexSlot:    slot,
			})
		}
		geo.SubModels = l1Subs
	}
}

// deriveModelTexOrder 派生 model/tex 声明序（② 阶段）：
// texOrder 先 player.texture、后 projectiles/vehicles/arrow（模型版口径：保留扩展名）；
// modelOrder player 模型先、投射物模型后，与 texOrder 同序，保证 texIdxMap 位置绑定不错位。
// 口径后处理复刻原内联（不在此改）：
//   - player.texture：uv 对象剥反斜杠、裸字符串不剥（历史不对称，isUV 标记形态）；
//     仅小写、不去扩展名。
//   - projectiles 纹理：texBasenameNoExt（去目录+小写+去扩展名）单点复用；vehicles 段
//     horse+mule 都指向同张图时去重，避免重复追加导致后续纹理 texSlot 偏移（minecart 采样到 boat.png）。
//
// texCategories 与 texOrder 严格同序（player/投射物分类），供前端纹理列表按序显示。
// projModels 只收 model 非空的条目。
func deriveModelTexOrder(md ysmArchiveData) (modelOrder, texOrder, texCategories []string, projModels []projEntry) {
	projModels = make([]projEntry, 0, len(md.ProjModels))
	// texOrder：player.texture 先、projectiles/vehicles/arrow 后（模型版口径：保留扩展名）。
	for _, t := range md.PlayerTexs {
		tn := playerTexBasename(t)
		texOrder = append(texOrder, strings.ToLower(tn))
		texCategories = append(texCategories, "player")
	}
	for _, pm := range md.ProjModels {
		if pm.texName != "" {
			tn := texBasenameNoExt(pm.texName)
			alreadyIn := false
			for _, ex := range texOrder {
				if ex == tn {
					alreadyIn = true
					break
				}
			}
			if !alreadyIn {
				texOrder = append(texOrder, tn)
				cat := pm.section
				if cat == "" {
					cat = "projectile"
				}
				texCategories = append(texCategories, cat)
			}
		}
		if pm.model != "" {
			projModels = append(projModels, pm)
		}
	}
	// modelOrder：player 模型先、投射物模型后（与 texOrder 同序）
	modelOrder = append(modelOrder, md.ModelOrder...)
	for _, pm := range projModels {
		modelOrder = append(modelOrder, pm.model)
	}
	return modelOrder, texOrder, texCategories, projModels
}

// mergeGeoFiles 解析全部 geoFiles 并合并骨骼进单个 BedrockModel，配 tex 槽位绑定。
// 纯数据变换，不改顺序：解析序 = geoFiles 传入序（调用方须先 sortByModelOrder）。
// 三阶段收编（2026-09 锐评清膘）：buildModelTexName → buildTexIdxMap → mergeParsedGeos。
//   - 每个 cube 记来源文件的 tex 尺寸（CubeTexW/H）；geo 级 TexWidth/Height 取最大。
//   - texIdxMap：模型 basename → texOrder 槽位（声明纹理名命中优先，modelOrder 序号兜底钳制）。
//     查询/构建键同口径（texIdxKey），Windows 混合大小写 zip 不归一化会让 texIdxMap
//     永不命中 → TexSlot 绑定失效。
func mergeGeoFiles(geoFiles []geoEntry, modelOrder, texOrder []string, projModels []projEntry) *types.BedrockModel {
	modelTexName := buildModelTexName(projModels)
	texCount := len(texOrder)
	if texCount == 0 {
		texCount = len(modelOrder)
	}
	texIdxMap := buildTexIdxMap(modelOrder, texOrder, modelTexName, texCount)
	return mergeParsedGeos(geoFiles, texIdxMap)
}

// buildModelTexName 模型 basename → 声明的纹理名（小写 basename 去扩展名）。
// texIdxMap 构建时用它查 texOrder 位置分配 texSlot，而非按 modelOrder 序号
// 截断——避免 plane.json（共用 texture.png）被截断到 arrow.png 槽位。
func buildModelTexName(projModels []projEntry) map[string]string {
	modelTexName := make(map[string]string, len(projModels))
	for _, pm := range projModels {
		mp := compBaseName(pm.model)
		// texName: 小写 basename 去扩展名（口径与 texBasenameNoExt 同）
		// key 统一小写：查询端 bn 来自 modelOrder（L0 路径已小写），projModel 声明
		// 可能含大写——大小写敏感会让声明纹理名查表 miss → texSlot 绑定失效。
		modelTexName[strings.ToLower(mp)] = texBasenameNoExt(pm.texName)
	}
	return modelTexName
}

// texIdxKey 模型路径 → texIdxMap 查询键：ToSlash 归一化 + 去目录 + 小写 + 去 .json/.geo.json。
// TrimSuffix 顺序 .json 先、.geo.json 后——与 compBaseName（.geo.json 先）不同：
// 对 "x.geo.json" 保留 ".geo" 后缀（构建端与查询端同口径故能命中），勿合并。
// 供 buildTexIdxMap（构建端）与 mergeParsedGeos（查询端）共用，原两处逐字相同剥离块。
func texIdxKey(p string) string {
	p = filepath.ToSlash(p)
	if idx := strings.LastIndex(p, "/"); idx >= 0 {
		p = p[idx+1:]
	}
	return strings.ToLower(strings.TrimSuffix(strings.TrimSuffix(p, ".json"), ".geo.json"))
}

// buildTexIdxMap 模型 basename → texOrder 槽位：声明纹理名命中优先，modelOrder 序号兜底钳制。
// modelOrder 为空时返回空 map（原逻辑 len(modelOrder)==0 分支跳过构建）。
func buildTexIdxMap(modelOrder, texOrder []string, modelTexName map[string]string, texCount int) map[string]int {
	texIdxMap := make(map[string]int)
	if len(modelOrder) == 0 {
		return texIdxMap
	}
	for i, p := range modelOrder {
		bn := texIdxKey(p)
		// 优先按声明的纹理名查 texOrder 位置；查不到再按 modelOrder 序号兜底
		ti := -1
		if texName, ok := modelTexName[bn]; ok && texName != "" {
			for j, tn := range texOrder {
				if tn == texName {
					ti = j
					break
				}
			}
		}
		if ti < 0 {
			ti = i
			if ti >= texCount {
				ti = texCount - 1
			}
		}
		texIdxMap[bn] = ti
	}
	return texIdxMap
}

// mergeParsedGeos 解析全部 geoFiles 并合并骨骼进单个 BedrockModel，配 tex 槽位绑定。
// 纯数据变换，不改顺序：解析序 = geoFiles 传入序（调用方须先 sortByModelOrder）。
//   - 每个 cube 记来源文件的 tex 尺寸（CubeTexW/H）；geo 级 TexWidth/Height 取最大。
//   - texIdxMap 由调用方构建（buildTexIdxMap），键口径 texIdxKey。
func mergeParsedGeos(geoFiles []geoEntry, texIdxMap map[string]int) *types.BedrockModel {
	var geo *types.BedrockModel
	for _, gf := range geoFiles {
		g := ParseBedrockGeometry(gf.data)
		if g == nil || g.BoneCount == 0 {
			continue
		}
		// 每个 cube 记住来源文件 tex 维度
		for bi := range g.Bones {
			for ci := range g.Bones[bi].Cubes {
				g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
				g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
			}
		}
		// 按模型文件位置设置 cube 纹理索引
		// geoName 与 texIdxMap 构建端 bn 同口径（texIdxKey）。
		geoName := texIdxKey(gf.name)
		if ti, hasTex := texIdxMap[geoName]; hasTex {
			for bi := range g.Bones {
				for ci := range g.Bones[bi].Cubes {
					g.Bones[bi].Cubes[ci].TexSlot = ti
				}
			}
		}
		if geo == nil {
			geo = g
		} else {
			geo.Bones = append(geo.Bones, g.Bones...)
			geo.BoneCount += g.BoneCount
			geo.CubeCount += g.CubeCount
			if g.TexWidth > geo.TexWidth {
				geo.TexWidth = g.TexWidth
			}
			if g.TexHeight > geo.TexHeight {
				geo.TexHeight = g.TexHeight
			}
		}
	}
	return geo
}

// parseModelFromEntries 共享主体：ysm.json 解析 + model/texture 顺序 + geo/png/anim 收集，
// 构建 BedrockModel。logTag 用于日志前缀（"zip" / "7z"）。
//
// 清单分层（L0 权威 → L1 兜底）：
//
//	L0：maid_model.json model[] / model_list[] 数组（TLM 自有结构）
//	    —— 条目支持两种形式：
//	     (a) 完整路径：{name, model, texture} （直接指向 zip 内相对路径）
//	     (b) model_id：{name, model_id} （从 model_id 去命名空间前缀 + 候选路径字典推断 zip 路径）
//	L1：遍历 zip 内 .json 枚举 + 文件名排序（无 L0 或 L0 非法时启用）
//
// 多命名空间处理：zip 内可能存在多个 maid_model.json（如 credits_authors 致谢清单 + 主包清单），
// 选 model/model_list 条目数最长者作为主命名空间（"最长清单即主包" 启发式）。
//
// L0 生效时：geoFiles / pngs / modelOrder / texOrder 全部从清单派生，多余的文件
// （如 junk_geo.json、外来命名空间内容）一律丢弃，避免顺序/纹理绑定被污染。
