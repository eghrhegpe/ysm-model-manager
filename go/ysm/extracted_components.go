// extracted_components.go：解压 YSM 的多组件查找（原 extracted.go 拆分，2026-10 文件行数治理）。
// FindComponentsInExtractedYSM 及其子函数（collectDeclaredTexByModel / computeTexSlotForComponent /
// bindPerComponentTex 等）——按模型清单独立组件、perComponent 独立纹理槽位。
package ysm

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
)

// ===== extracted.go 第 4 刀子函数（FindComponentsInExtractedYSM 拆分，2026-08-25）=====

// collectDeclaredTexByModel 解析 files.projectiles / files.vehicles 段：载具/投射物声
// 明纹理（含共享 player skin）。键为 model basename（小写去扩展名）。
// 原 FindComponents L603-642 内联 39 行；升格后若新增声明段（如 attachable）统一扩展。
func collectDeclaredTexByModel(filesObj map[string]json.RawMessage) map[string]declTexInfo {
	out := map[string]declTexInfo{}
	for _, seg := range []string{"projectiles", "vehicles"} {
		segRaw, ok := filesObj[seg]
		if !ok {
			continue
		}
		var segArr []json.RawMessage
		if json.Unmarshal(segRaw, &segArr) != nil {
			continue
		}
		for _, itemRaw := range segArr {
			var item struct {
				Model   json.RawMessage `json:"model"`
				Texture json.RawMessage `json:"texture"`
			}
			if json.Unmarshal(itemRaw, &item) != nil {
				continue
			}
			var modelPath string
			if err := json.Unmarshal(item.Model, &modelPath); err != nil || modelPath == "" {
				continue
			}
			texPath := texPathFromRaw(item.Texture)
			if texPath == "" {
				continue
			}
			mbase := modelBaseNoExt(modelPath)
			if mbase == "" {
				continue
			}
			out[mbase] = declTexInfo{
				relPath: filepath.ToSlash(texPath),
				texBase: texBaseNoExt(texPath),
			}
		}
	}
	return out
}

// sortArrayModelNamesMainFirst 对 array/字符串形 modelNames 做 main 优先稳定排序：
// 拷贝一份（不污染原数组——declPos 依赖原声明序），main 命中的前置，其余保持相对声明顺序。
// map 分支已由 sortMapModelNames(excludeArm=false) 覆盖；两分支合并口径后，
// FindComponents 不再有「array 声明在前→main 不得首位→texSlot 错位」的历史 bug。
func sortArrayModelNamesMainFirst(modelNames []string) []string {
	out := append([]string(nil), modelNames...)
	sort.SliceStable(out, func(i, j int) bool {
		mi := geometry.IsMainModelName(out[i])
		mj := geometry.IsMainModelName(out[j])
		return mi && !mj
	})
	return out
}

// augmentWithModelsDir 补扫 models/ 目录：player.model 未列出的 geometry（投射物/载具
// 等 game entity 组件如 arrow/boat/foxcar）追加到 orderedNames。
// 去重基于小写文件名（避免声明 models/main.json 与 main:main.json 双重录入）；
// 按文件名排序（确定性，与 WASM 解码路径对齐）。
func augmentWithModelsDir(dir string, orderedNames []string) []string {
	seen := make(map[string]bool, len(orderedNames))
	for _, n := range orderedNames {
		seen[strings.ToLower(filepath.Base(n))] = true
	}
	modelsDir := filepath.Join(dir, "models")
	if !isDir(modelsDir) {
		return orderedNames
	}
	entries, err := os.ReadDir(modelsDir)
	if err != nil {
		return orderedNames
	}
	var extra []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
			continue
		}
		if seen[strings.ToLower(e.Name())] {
			continue
		}
		extra = append(extra, filepath.Join("models", e.Name()))
	}
	sort.Strings(extra)
	return append(orderedNames, extra...)
}

// buildPngNameMap 构造 textures/ 同名纹理索引（小写去扩展名 → 文件路径）。
// 未声明组件按 ADR-114 perComponent 语义用**同名纹理**：此前解压目录路径缺这层，
// arrow 等投射物前端 texArr 越界被静默兜底贴错皮肤（wine_fox 根因）。
// 收集复用 collectTextureFiles：递归子目录 + 排除 gui/ + 收 .png/.jpg/.tga
// （扩展名口径与 Geometry 消费方对齐，此前单层 .png 扫描漏子目录同名与 .tga）。
func buildPngNameMap(dir string) map[string]string {
	out := make(map[string]string)
	for _, tf := range collectTextureFiles(filepath.Join(dir, "textures")) {
		key := strings.TrimSuffix(tf.name, filepath.Ext(tf.name))
		if _, exists := out[key]; !exists {
			out[key] = tf.path
		}
	}
	return out
}

// componentSlotInfo 组件→纹理绑定决策产物：texSlot（全局槽）、texName（前端 R1 校验
// 用名，空=跳过）、onDeclTex（是否命中声明序纹理——决定是否走 perComponent 分支）。
type componentSlotInfo struct {
	texSlot   int
	texName   string
	onDeclTex bool
}

// computeTexSlotForComponent 计算单组件的 texSlot / texName / onDeclTex 三要素。
// 规则（与原 L709-772 逐字节一致）：
//   - arm → texSlot=0、texName=""（共用全局 texArr[0]，R1 跳过）
//   - 已声明在声明序范围内 → texSlot=j、texName=texOrderNames[j]、onDeclTex=true
//   - 已声明但超范围（模型多于纹理声明）→ 钳到最后一张声明纹理
//   - 未声明（补扫 / 无纹理声明）→ texSlot=len(texOrderNames)+undeclSeq、按名段
//
// undeclSeq 值传递进出（返回新序号）取代 *int 原地递增——「使用后自增」契约显式化。
func computeTexSlotForComponent(mn, base string, declPos map[string]int, texOrderNames []string, undeclSeq int) (componentSlotInfo, int) {
	isArm := geometry.IsArmModelName(mn)
	tn := strings.ToLower(base)
	info := componentSlotInfo{
		texSlot:   len(texOrderNames) + undeclSeq,
		texName:   tn,
		onDeclTex: false,
	}
	if isArm {
		info.texSlot = 0
		info.texName = ""
		return info, undeclSeq
	}
	if j, declared := declPos[mn]; declared && len(texOrderNames) > 0 {
		info.onDeclTex = j < len(texOrderNames)
		if info.onDeclTex {
			info.texSlot = j
		} else {
			info.texSlot = len(texOrderNames) - 1
		}
	} else {
		undeclSeq++
	}
	if info.texSlot < len(texOrderNames) && texOrderNames[info.texSlot] != "" {
		info.texName = texOrderNames[info.texSlot]
	}
	return info, undeclSeq
}

// componentBindCtx FindComponentsInExtractedYSM 的轮级共享上下文：dir/cleanDir/
// declaredTexByModel/pngNameMap 整轮恒定；comps/texNames 双切片统一在此收口追加，
// 取代原 11 参函数的双指针出参（2026-08-26 审查收敛，对齐 instance.rtypeCtx 先例）。
type componentBindCtx struct {
	dir                string
	cleanDir           string
	declaredTexByModel map[string]declTexInfo
	pngNameMap         map[string]string
	comps              []types.BedrockModel
	texNames           []string
}

// bindPerComponentTex 尝试 perComponent 两条绑定（载具声明纹理→组件同名纹理）：
// 命中时填 ComponentTextures + applyCubeTextures(0) + 空 texName，追加 comps/texNames 并返回 true；
// 未命中返回 false，交由调用方走全局 texSlot 绑定。取代原 11 参自由函数（2026-08-26 审查收敛）。
func (c *componentBindCtx) bindPerComponentTex(gj *types.BedrockModel, candidate, base, texName string) bool {
	// 分支 A：载具/投射物声明纹理（含共享 player skin）——plane 共享皮肤的关键分支
	// （wine_fox 17_mini 根因：此前落全局 texArr 越界贴到 gui 背景）。
	if di, ok := c.declaredTexByModel[strings.ToLower(base)]; ok && di.relPath != "" {
		var cand string
		if filepath.IsAbs(di.relPath) {
			cand = filepath.Clean(di.relPath)
		} else {
			cand = filepath.Clean(filepath.Join(c.dir, di.relPath))
		}
		if strings.HasPrefix(cand, c.cleanDir+string(filepath.Separator)) || cand == c.cleanDir {
			if pngData := readFileLimited(cand); pngData != nil {
				if uri := textureDataURI(cand, pngData); uri != "" {
					gj.ComponentTextures = map[string][]string{base: {uri}}
					gj.SourceName = base
					applyCubeTextures(gj, 0)
					log.Printf("[ysm] 加载模型组件 %q (声明纹理 texIdx=0, texture=%q)", candidate, di.texBase)
					c.texNames = append(c.texNames, "")
					c.comps = append(c.comps, *gj)
					return true
				}
			}
		}
	}
	// 分支 B：组件专属同名纹理兜底（ADR-114 perComponent）
	// texSlot=0 对齐 zip 路径 buildComponents：perComponent 组件用本地 0 槽，
	// 不打虚拟全局槽位 len(texOrderNames)+undeclSeq（否则 arrow 呈 texIdx=6 越界幻觉）。
	// 查找键用 computeTexSlotForComponent 算好的 texName：对**已声明但超范围**组件
	// （模型多于纹理声明）钳到最后一张声明纹理名（共享默认皮肤，02_new_year 回归语义），
	// 对真正未声明组件 = 组件 basename——两种情况都精确复刻原行为，不得改用 base
	// 否则超范围声明组件会错误绑定自己的同名纹理。
	if pngPath, ok := c.pngNameMap[texName]; ok {
		if pngData := readFileLimited(pngPath); pngData != nil {
			if uri := textureDataURI(pngPath, pngData); uri != "" {
				gj.ComponentTextures = map[string][]string{base: {uri}}
				gj.SourceName = base
				applyCubeTextures(gj, 0)
				log.Printf("[ysm] 加载模型组件 %q (组件专属 texIdx=%d, texture=%q)", candidate, 0, filepath.Base(pngPath))
				c.texNames = append(c.texNames, "")
				c.comps = append(c.comps, *gj)
				return true
			}
		}
	}
	return false
}

// FindComponentsInExtractedYSM 多组件解析（YSMViewer 式）：解压目录内每个模型文件独立组件，
// **不合并 bones、不排除 arm**（arm/载具为独立组件）；main 优先排序 + 补扫 models/ 目录
// （projectiles/vehicles 等 player.model 未列出的 geometry 也作为组件）；
// TexSlot = 全局组件序（对齐 WASM 路径 decodeYSMComponentsViaNodeJS）。
// 供 GetModel3DSpec → threejs.BuildMulti 生成多组件 spec。
func FindComponentsInExtractedYSM(ysmJsonPath string) ([]types.BedrockModel, []string) {
	data := readFileLimited(ysmJsonPath)
	if data == nil {
		return nil, nil
	}
	dir := filepath.Dir(ysmJsonPath)
	cleanDir := filepath.Clean(dir)

	// 阶段 ①：parsePlayerModel 统一解析 ysm.json；消费方各自切纹理路径（复刻现状口径：
	// 切 '/\\' + 去 .png/.jpg + 小写——去扩展名喂前端 R1 校验，与 Geometry 带扩展名
	// orderMap 口径天然不同）。filesObj 供 collectDeclaredTexByModel 读 projectiles/vehicles。
	var modelNames []string
	var modelMapOrig map[string]string
	var texOrderNames []string
	var filesObj map[string]json.RawMessage
	if pm := parsePlayerModel(data); pm != nil {
		modelNames = pm.names
		modelMapOrig = pm.mapOrig
		filesObj = pm.filesObj
		for _, d := range pm.texDecl {
			tn := d.value
			if idx := strings.LastIndexAny(tn, "/\\"); idx >= 0 {
				tn = tn[idx+1:]
			}
			tn = strings.TrimSuffix(strings.ToLower(tn), ".png")
			tn = strings.TrimSuffix(tn, ".jpg")
			texOrderNames = append(texOrderNames, tn)
		}
	}

	// 阶段 ②：载具/投射物声明纹理段（39行→collectDeclaredTexByModel 升格）
	declaredTexByModel := collectDeclaredTexByModel(filesObj)

	// 阶段 ③：构造 orderedNames（map→sortMapModelNames；array→sortArrayModelNamesMainFirst）
	var orderedNames []string
	if modelMapOrig != nil {
		orderedNames = sortMapModelNames(modelMapOrig, false) // excludeArm=false：多组件版保留手臂
	} else {
		orderedNames = sortArrayModelNamesMainFirst(modelNames)
	}

	// 阶段 ④：补扫 models/ 目录（22行→augmentWithModelsDir 升格）
	orderedNames = augmentWithModelsDir(dir, orderedNames)

	// 阶段 ⑤：声明序位置（R1 契约）+ textures/ 同名索引（buildPngNameMap 升格）
	declPos := make(map[string]int, len(modelNames))
	for i, n := range modelNames {
		declPos[n] = i
	}
	pngNameMap := buildPngNameMap(dir)

	// 阶段 ⑥：逐组件路径探测 → texSlot 决策 → 绑定 → 追加
	//   - computeTexSlotForComponent：拆分 texSlot 三分支（arm/声明/未声明）巨块
	//   - applyComponentPerComponentTex：拆分 perComponent 两子分支（声明纹理/同名）巨块
	//   - 其余走全局 texSlot 绑定：applyCubeTextures 消除 5 份循环复制
	ctx := &componentBindCtx{
		dir:                dir,
		cleanDir:           cleanDir,
		declaredTexByModel: declaredTexByModel,
		pngNameMap:         pngNameMap,
		texNames:           make([]string, 0, len(orderedNames)), // 保持原预分配：非 nil 空切片 JSON 出 [] 而非 null
	}
	undeclSeq := 0
	for _, mn := range orderedNames {
		candidate, ok := safeJoinModelPath(dir, mn)
		if !ok {
			continue
		}
		geoData := readFileLimited(candidate)
		if geoData == nil {
			continue
		}
		gj := geometry.ParseBedrockGeometry(geoData)
		if gj == nil {
			continue
		}
		base := mn
		if idx := strings.LastIndexAny(base, "/\\"); idx >= 0 {
			base = base[idx+1:]
		}
		base = strings.TrimSuffix(strings.TrimSuffix(base, ".geo.json"), ".json")
		isArm := geometry.IsArmModelName(mn)
		var info componentSlotInfo
		info, undeclSeq = computeTexSlotForComponent(mn, base, declPos, texOrderNames, undeclSeq)

		// perComponent 分支：未声明 + 非 arm → 先试声明纹理→再试同名；命中即 append+continue
		if !info.onDeclTex && !isArm {
			if ctx.bindPerComponentTex(gj, candidate, base, info.texName) {
				continue
			}
		}
		// 全局 texSlot 分支：arm / 已声明 / perComponent 兜底落空
		if isArm {
			ctx.texNames = append(ctx.texNames, "") // arm：前端 R1 校验跳过，走全局 texArr[0]
		} else {
			ctx.texNames = append(ctx.texNames, info.texName)
		}
		gj.SourceName = strings.TrimSuffix(strings.TrimSuffix(base, ".geo.json"), ".json")
		applyCubeTextures(gj, info.texSlot)
		log.Printf("[ysm] 加载模型组件 %q (texIdx=%d, name=%q)", candidate, info.texSlot, gj.SourceName)
		ctx.comps = append(ctx.comps, *gj)
	}
	return ctx.comps, ctx.texNames
}

// looksLikeGeometry 判断字节流是否疑似裸几何元素（含 Bedrock geometry 特征键）。
// 裸几何兜底只应包裹真正的几何 JSON——任意合法 JSON（如 {"files":{...}}）包裹后
// 会被解析为「零骨骼空模型」，与「未找到几何」无法区分
func looksLikeGeometry(data []byte) bool {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(data, &obj); err != nil {
		return false
	}
	for _, key := range []string{"minecraft:geometry", "description", "bones"} {
		if _, ok := obj[key]; ok {
			return true
		}
	}
	return false
}
