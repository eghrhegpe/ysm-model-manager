// ===== 解压后 YSM 模型目录中的 geometry/纹理查找 =====
// 当用户点击 ysm.json（解压后的 YSM 模型目录）时，
// 需要在此目录中搜索 geometry JSON 文件和纹理文件。
package ysm

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
)

// maxReadSize 解压目录读取上限——对齐 zip 路径每条目 50MB（ADR-033 截断防线），
// 防超大 ysm.json/geometry/纹理整体拖入内存（P2 审计：原 os.ReadFile 无界，
// 与 zip 路径 50MB 口径不一致；geometry.ParseBedrockGeometry 的 100MB 上限是
// 整文件读入后才检查，防不了分配）
const maxReadSize = types.MaxReadLimit

// readFileLimited 受限读取：超限/失败返回 nil（+1 探测，不静默截断）
func readFileLimited(path string) []byte {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	return fsutil.ReadLimitedEntry(f, maxReadSize)
}

// declTexInfo 载具/投射物声明的纹理（相对 ysm.json 目录路径 + 小写 basename）。
type declTexInfo struct {
	relPath string // 相对 ysm.json 目录的纹理路径（如 textures/skin.png）
	texBase string // 小写 basename 去扩展名（如 skin）
}

// texPathFromRaw 从 texture 声明（{"uv":...} 或裸字符串）提取纹理路径。
func texPathFromRaw(raw json.RawMessage) string {
	s := strings.TrimSpace(string(raw))
	if strings.HasPrefix(s, `{`) {
		var obj struct {
			Uv string `json:"uv"`
		}
		if json.Unmarshal(raw, &obj) == nil && obj.Uv != "" {
			return obj.Uv
		}
		var str string
		if json.Unmarshal(raw, &str) == nil {
			return str
		}
		return ""
	}
	var sval string
	if json.Unmarshal(raw, &sval) == nil {
		return sval
	}
	return ""
}

// modelBaseNoExt 模型文件名去目录/去扩展名（小写），作为纹理声明映射键。
func modelBaseNoExt(p string) string {
	base := filepath.ToSlash(p)
	if i := strings.LastIndex(base, "/"); i >= 0 {
		base = base[i+1:]
	}
	base = strings.TrimSuffix(base, ".geo.json")
	base = strings.TrimSuffix(base, ".json")
	return strings.ToLower(base)
}

// textureDataURI 按文件扩展名派生 data URI MIME（.png→image/png、.jpg/.jpeg→image/jpeg）。
// .tga 非 Web 图像格式，浏览器解码器不认 → 返回空串，调用方跳过 perComponent data-URI
// 分支、落回全局 texArr 路径（避免产出 data:image/png;base64,<TGA 字节> 的坏 URI）。
func textureDataURI(path string, data []byte) string {
	mime := ""
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		mime = "image/png"
	case ".jpg", ".jpeg":
		mime = "image/jpeg"
	}
	if mime == "" {
		return ""
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// texBaseNoExt 纹理文件名去目录/去扩展名（小写）。
func texBaseNoExt(p string) string {
	base := filepath.ToSlash(p)
	if i := strings.LastIndex(base, "/"); i >= 0 {
		base = base[i+1:]
	}
	base = strings.TrimSuffix(base, ".png")
	base = strings.TrimSuffix(base, ".jpg")
	return strings.ToLower(base)
}

// texDeclItem 表示 player.texture 声明数组中的一项；value 为原始纹理路径/名
// （obj 取 .uv，裸取字符串原样），isStr 标记来源——Geometry 消费方据此复刻现状
// 两分支不同裁剪（obj 切 '/\\'、裸仅切 '/'）。
type texDeclItem struct {
	value string
	isStr bool // true = 裸字符串，false = {"uv":...} 对象
}

// playerModel 是 files.player 段解析结果的字段集合（parsePlayerModel 返回）。
type playerModel struct {
	names    []string
	mapOrig  map[string]string
	texDecl  []texDeclItem
	filesObj map[string]json.RawMessage // projectiles/vehicles 段复用（Components 专属）
}

// playerModel 是 ysm.json files.player 段解析结果，供 FindGeometryInExtractedYSM/
// FindComponentsInExtractedYSM 共用（消灭历史重复解析）。model 声明抛回 basename 序；
// texture 声明抛回【原始值，不做裁剪/去扩展名/转小写】——规范化留在各消费方，因两个
// 消费方口径天然不同（Geometry 带扩展名做 orderMap 键、Components 去扩展名喂前端 R1）。
func parsePlayerModel(data []byte) *playerModel {
	var ysmRoot struct {
		Spec  int             `json:"spec"`
		Files json.RawMessage `json:"files"`
	}
	if err := json.Unmarshal(data, &ysmRoot); err != nil {
		return nil
	}
	var filesObj map[string]json.RawMessage
	if err := json.Unmarshal(ysmRoot.Files, &filesObj); err != nil {
		return nil
	}
	pm := &playerModel{filesObj: filesObj}
	for key, val := range filesObj {
		if key != "player" {
			continue
		}
		var player struct {
			Model   json.RawMessage `json:"model"`
			Texture json.RawMessage `json:"texture"`
		}
		if err := json.Unmarshal(val, &player); err != nil {
			log.Printf("[ysm] 解析 player 失败: %v", err)
			continue
		}
		// model 三分支（原逻辑逐字搬迁，无行为差异）
		if len(player.Model) > 0 {
			modelRaw := string(player.Model)
			trimmed := strings.TrimSpace(modelRaw)
			if strings.HasPrefix(trimmed, `{`) {
				// map 格式：JSON 对象**写入序**即 Bedrock 声明序（main 通常最先声明）。
				// Go map 丢失写入序，必须 json.Decoder Token 流式保序遍历（P2 修复）。
				mm := make(map[string]string)
				dec := json.NewDecoder(bytes.NewReader(player.Model))
				if tok, err := dec.Token(); err == nil && tok == json.Delim('{') {
					for dec.More() {
						keyTok, err := dec.Token()
						if err != nil {
							break
						}
						key, _ := keyTok.(string)
						var val string
						// 非字符串 value（数字/对象/数组）Decode 报错且已消费完该值；
						// 若 break 则后续好键（main 等）全部丢失 → 跳过继续（declPos 保序）
						if err := dec.Decode(&val); err != nil {
							continue
						}
						if val != "" {
							pm.names = append(pm.names, val)
							mm[key] = val
						}
					}
				}
				pm.mapOrig = mm
			} else if strings.HasPrefix(trimmed, `[`) {
				var arr []string
				if json.Unmarshal(player.Model, &arr) == nil {
					pm.names = arr
				}
			} else {
				pm.names = append(pm.names, strings.Trim(trimmed, `"`))
			}
		}
		// texture 数组：抛回原始值（含来源标记），裁剪留各消费方
		if len(player.Texture) > 0 {
			texRaw := string(player.Texture)
			if strings.HasPrefix(strings.TrimSpace(texRaw), `[`) {
				var arr []json.RawMessage
				if json.Unmarshal(player.Texture, &arr) == nil {
					for _, item := range arr {
						s := strings.TrimSpace(string(item))
						if strings.HasPrefix(s, `{`) {
							var obj struct {
								Uv string `json:"uv"`
							}
							if json.Unmarshal(item, &obj) == nil && obj.Uv != "" {
								pm.texDecl = append(pm.texDecl, texDeclItem{value: obj.Uv})
							}
						} else {
							var sval string
							if json.Unmarshal(item, &sval) == nil && sval != "" {
								pm.texDecl = append(pm.texDecl, texDeclItem{value: sval, isStr: true})
							}
						}
					}
				}
			}
		}
	}
	return pm
}

// texFile 已发现的纹理文件（全路径 + 小写 basename 含扩展名）。
type texFile struct {
	path string
	name string // 小写 basename（含扩展名，如 skin.png）
}

// collectTextureFiles 递归收集解压目录下的纹理文件（.png/.jpg/.tga），
// 排除 gui/ 子目录（YSM 的 gui_background/封面等非模型贴图，曾污染全局 texArr
// 导致 plane 等共享皮肤组件错绑——wine_fox 17_mini 根因，geometry/组件两消费方
// 共用同一遍历避免两次 WalkDir 口径漂移）。返回按遍历序（深度优先稳定序）。
func collectTextureFiles(texDir string) []texFile {
	var files []texFile
	if d, err := os.Stat(texDir); err == nil && d.IsDir() {
		filepath.WalkDir(texDir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				if strings.EqualFold(d.Name(), "gui") {
					return filepath.SkipDir
				}
				return nil
			}
			ext := strings.ToLower(filepath.Ext(d.Name()))
			if ext == ".png" || ext == ".jpg" || ext == ".tga" {
				files = append(files, texFile{path: path, name: strings.ToLower(d.Name())})
			}
			return nil
		})
	}
	return files
}

// ===== extracted.go 公共 helper（第 3/4 刀 FindGeometry/FindComponents 复用，2026-08-25）=====

// safeJoinModelPath 按 3 种前缀（空 / models/ / models\）探测 ysm 模型文件，
// 找到第一个存在的路径并做路径穿越防护（确保拼接结果仍在 dir 内）。
// 返回 (探测到的完整路径, 是否合法)。两函数**共用唯一探测口径**，避免
// FindGeometry/FindComponents 历史上各写一份造成口径漂移（如新增前缀忘同步）。
func safeJoinModelPath(dir, mn string) (string, bool) {
	cleanDir := filepath.Clean(dir)
	for _, sub := range []string{"", "models/", "models\\"} {
		candidate := filepath.Join(dir, sub, mn)
		candidate = filepath.Clean(candidate)
		if !strings.HasPrefix(candidate, cleanDir+string(filepath.Separator)) && candidate != cleanDir {
			log.Printf("[ysm] 拒绝路径越界模型文件: %q (期望在 %q 内)", candidate, cleanDir)
			continue
		}
		if _, err := os.Stat(candidate); err == nil {
			return candidate, true
		}
	}
	return "", false
}

// applyCubeTextures 给 BedrockModel 所有 bones 的所有 cubes 赋 TexSlot、CubeTexW、CubeTexH。
// 历史上 extracted.go:FindGeometry（L361-367/L428-433）、FindComponents（L747-753/L771-778/L799-805）
// 5 处完全复制 4 行循环。升格一处，全仓调用，消除 5 份 20 行复制+口径漂移风险。
func applyCubeTextures(gj *types.BedrockModel, texSlot int) {
	for bi := range gj.Bones {
		for ci := range gj.Bones[bi].Cubes {
			gj.Bones[bi].Cubes[ci].TexSlot = texSlot
			gj.Bones[bi].Cubes[ci].CubeTexW = gj.TexWidth
			gj.Bones[bi].Cubes[ci].CubeTexH = gj.TexHeight
		}
	}
}

// sortMapModelNames 从 player.model map 构造有序模型路径列表：
//   - main 键强制首位；其余键按字符串稳定排序（消除 Go map 遍历随机性）
//   - excludeArm=true 时排除 geometry.IsArmModelName 命中的项（FindGeometry 全身合并版剔除手臂，
//     避免 pivot 与 main 手臂错位；FindComponents 多组件版保留为独立组件）
func sortMapModelNames(modelMapOrig map[string]string, excludeArm bool) []string {
	var ordered []string
	if mainPath, ok := modelMapOrig["main"]; ok {
		ordered = append(ordered, mainPath)
	}
	var others []string
	for k, v := range modelMapOrig {
		if k == "main" {
			continue
		}
		if excludeArm && geometry.IsArmModelName(v) {
			continue
		}
		others = append(others, k)
	}
	sort.Strings(others)
	for _, k := range others {
		ordered = append(ordered, modelMapOrig[k])
	}
	return ordered
}

// maxFallbackGeoProbes 兜底 3（resolveBedrockGeometryFallback WalkDir）最多尝试解析的
// .json 候选数：畸形大目录防逐个 readFileLimited+Parse 的宽度 DoS，超限即 SkipAll 停扫。
const maxFallbackGeoProbes = 20

// resolveBedrockGeometryFallback 封装 4 条兜底解析链（逐字节保留原行为）：
//  1. fallbackParseDirect：ysm.json 自身直接 Parse（可能含 format_version + minecraft:geometry 标准段）
//  2. fallbackParseWrapped：{"minecraft":{"geometry":[...]}} 包裹段（TLM 简化包实际格式）
//  3. fallbackWalkDir：递归子目录（限 10 层，排除 animations/controller/avatar）找第一个合法 geo JSON
//  4. fallbackParseBare：looksLikeGeometry 裸 geometry 元素兜底（避免把纯 {"files":{...}} 错包裹成零骨骼）
//
// 原 FindGeometry 内联 111 行（L382-449），升格后第 4 刀若新增兜底也共用。
func resolveBedrockGeometryFallback(data []byte, ysmPath, dir string) *types.BedrockModel {
	if m := fallbackParseDirect(data); m != nil {
		return m
	}
	if m := fallbackParseWrapped(data); m != nil {
		return m
	}
	if m := fallbackWalkDir(dir, ysmPath); m != nil {
		return m
	}
	return fallbackParseBare(data)
}

// fallbackParseDirect 兜底 1：ysm.json 自身直接解析（可能是标准 geometry JSON，如极简自定义包）
func fallbackParseDirect(data []byte) *types.BedrockModel {
	return geometry.ParseBedrockGeometry(data)
}

// fallbackParseWrapped 兜底 2：minecraft.geometry[] 包装段（TLM 简化自定义包常见格式）
func fallbackParseWrapped(data []byte) *types.BedrockModel {
	var root struct {
		Minecraft struct {
			Geometry []json.RawMessage `json:"geometry"`
		} `json:"minecraft"`
	}
	if err := json.Unmarshal(data, &root); err == nil && len(root.Minecraft.Geometry) > 0 {
		wrapped := append([]byte(`{"format_version":"1.12.0","minecraft:geometry":[`), root.Minecraft.Geometry[0]...)
		wrapped = append(wrapped, ']', '}')
		return geometry.ParseBedrockGeometry(wrapped)
	}
	return nil
}

// fallbackWalkDir 兜底 3：WalkDir 子目录递归扫 10 层（排除 animations/controller/avatar），
// .json 解析候选数封顶 maxFallbackGeoProbes（畸形大目录防逐个 readFile+Parse DoS）。
// 命中第 1 个合法 geo JSON 即返回（texSlot=0，与原内联口径一致）。
func fallbackWalkDir(dir, ysmPath string) *types.BedrockModel {
	excludeDirs := map[string]bool{"animations": true, "controller": true, "avatar": true}
	var found *types.BedrockModel
	probes := 0
	filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			log.Printf("[ysm] WalkDir 错误 (忽略): %v", err)
			return nil
		}
		if found != nil {
			return filepath.SkipAll
		}
		if d.IsDir() {
			if excludeDirs[strings.ToLower(d.Name())] {
				return filepath.SkipDir
			}
			rel, relErr := filepath.Rel(dir, path)
			if relErr == nil && strings.Count(rel, string(filepath.Separator)) > 10 {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.EqualFold(path, ysmPath) {
			return nil
		}
		if strings.HasSuffix(strings.ToLower(path), ".json") {
			probes++
			if probes > maxFallbackGeoProbes {
				log.Printf("[ysm] 兜底扫描候选超 %d 个, 停止: %s", maxFallbackGeoProbes, dir)
				return filepath.SkipAll
			}
			geoData := readFileLimited(path)
			if geoData != nil {
				if gj := geometry.ParseBedrockGeometry(geoData); gj != nil {
					applyCubeTextures(gj, 0) // WalkDir 命中第 1 个，texSlot=0 与原 L428 同口径
					found = gj
				}
			}
		}
		return nil
	})
	return found
}

// fallbackParseBare 兜底 4：bare geometry 元素（looksLikeGeometry 特征命中）。
// 包装为 minecraft:geometry 数组段后 Parse——失败返回 nil（命中但非法也只是 nil）。
func fallbackParseBare(data []byte) *types.BedrockModel {
	if !looksLikeGeometry(data) {
		return nil
	}
	wrapped := append([]byte(`{"format_version":"1.12.0","minecraft:geometry":[`), data...)
	wrapped = append(wrapped, ']', '}')
	return geometry.ParseBedrockGeometry(wrapped)
}

// sortTexFilesByOrder 按 ysm.json texOrder 声明序重排 texFiles（声明的排前面；未声明的按原遍历序放后面）。
// 原 FindGeometry L469-482 内联 14 行。升格后若第 4 刀要按声明序排序组件纹理也可复用。
func sortTexFilesByOrder(texFiles []texFile, texOrderNames []string) {
	if len(texOrderNames) == 0 {
		return
	}
	orderMap := make(map[string]int, len(texOrderNames))
	for i, n := range texOrderNames {
		orderMap[n] = i
	}
	sort.SliceStable(texFiles, func(i, j int) bool {
		oi, hasI := orderMap[texFiles[i].name]
		oj, hasJ := orderMap[texFiles[j].name]
		if hasI && hasJ {
			return oi < oj
		}
		return hasI
	})
}

// readTexFilesWithNames 读取 texFiles 对应的原始字节，同时产出纹理名（小写去扩展名）。
// 原 FindGeometry L484-496 内联 13 行：逐文件 readFileLimited、长度为 0 跳、3 种扩展名依次剥。
// 第 4 刀若直接消费字节数组或前端纹理名数组可直接复用。
func readTexFilesWithNames(texFiles []texFile) ([][]byte, []string) {
	var texData [][]byte
	var texNames []string
	for _, tf := range texFiles {
		b := readFileLimited(tf.path)
		if len(b) > 0 {
			bn := tf.name
			bn = strings.TrimSuffix(bn, ".png")
			bn = strings.TrimSuffix(bn, ".jpg")
			bn = strings.TrimSuffix(bn, ".tga")
			texData = append(texData, b)
			texNames = append(texNames, bn)
		}
	}
	return texData, texNames
}

// collectAllTexFiles 合并「collectTextureFiles 递归 textures/ + textures/ 为空时 ysm 同级目录兜底
// （只读一层）」两阶段。原 FindGeometry L452-467 内联 16 行；统一口径避免两路径漂移。
func collectAllTexFiles(dir string) []texFile {
	texDir := filepath.Join(dir, "textures")
	files := collectTextureFiles(texDir)
	if len(files) > 0 {
		return files
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if ext == ".png" || ext == ".jpg" {
			files = append(files, texFile{
				path: filepath.Join(dir, e.Name()),
				name: strings.ToLower(e.Name()),
			})
		}
	}
	return files
}

// FindGeometryInExtractedYSM 在解压后的 YSM 模型目录中查找 geometry 和纹理
// ysmJsonPath: ysm.json 的完整路径
// 返回: 合并后的 BedrockModel（不含纹理 base64），纹理原始字节
func FindGeometryInExtractedYSM(ysmJsonPath string) (*types.BedrockModel, [][]byte) {
	data := readFileLimited(ysmJsonPath)
	if data == nil {
		return nil, nil
	}
	dir := filepath.Dir(ysmJsonPath)

	// 阶段 ①：parsePlayerModel 统一解析 ysm.json；消费方各自切纹理路径（复刻现状口径：
	// obj 切 '/\\'、裸字符串仅切 '/'）——两消费方口径不同，规范化留消费方
	var modelNames []string
	var modelMapOrig map[string]string
	var texOrderNames []string
	if pm := parsePlayerModel(data); pm != nil {
		modelNames = pm.names
		modelMapOrig = pm.mapOrig
		for _, d := range pm.texDecl {
			tn := d.value
			if idx := strings.LastIndex(tn, "/"); idx >= 0 {
				tn = tn[idx+1:]
			}
			if !d.isStr { // obj 风格再额外切反斜杠；裸字符串仅斜杠
				if idx := strings.LastIndex(tn, "\\"); idx >= 0 {
					tn = tn[idx+1:]
				}
			}
			texOrderNames = append(texOrderNames, strings.ToLower(tn))
		}
	}

	// 阶段 ②：构造 orderedNames。map 分支 → sortMapModelNames(排除 arm)；
	// array 分支 → 按 modelNames 声明序逐个排除 arm（保持顺序，array 分支未排序）。
	var orderedNames []string
	if modelMapOrig != nil {
		orderedNames = sortMapModelNames(modelMapOrig, true) // excludeArm: 全身合并版去手臂
	} else {
		for _, n := range modelNames {
			if !geometry.IsArmModelName(n) {
				orderedNames = append(orderedNames, n)
			}
		}
	}

	// 阶段 ③：按有序名加载模型文件 → 合并骨骼；TexSlot = 序 i，钳到 len(texOrder)-1
	var geoJSON *types.BedrockModel
	maxTexIdx := len(texOrderNames) - 1
	if maxTexIdx < 0 {
		maxTexIdx = 0
	}
	for i, mn := range orderedNames {
		candidate, ok := safeJoinModelPath(dir, mn)
		if !ok {
			continue
		}
		ti := i
		if ti > maxTexIdx {
			ti = maxTexIdx
		}
		log.Printf("[ysm] 加载模型文件 %q (texIdx=%d)", candidate, ti)
		if geoData := readFileLimited(candidate); geoData != nil {
			if gj := geometry.ParseBedrockGeometry(geoData); gj != nil {
				applyCubeTextures(gj, ti)
				if geoJSON == nil {
					geoJSON = gj
				} else {
					geoJSON.Bones = append(geoJSON.Bones, gj.Bones...)
					geoJSON.BoneCount += gj.BoneCount
					geoJSON.CubeCount += gj.CubeCount
				}
			}
		}
	}

	// 阶段 ④：4 层兜底链（ysm 自身解析 / minecraft:geometry 包装 / WalkDir / bare fallback）
	if geoJSON == nil {
		geoJSON = resolveBedrockGeometryFallback(data, ysmJsonPath, dir)
	}

	// 阶段 ⑤：纹理收集 → 声明序重排 → 读数据 → 附 TextureNames（前端列表消费）
	texFiles := collectAllTexFiles(dir)
	sortTexFilesByOrder(texFiles, texOrderNames)
	texData, texNames := readTexFilesWithNames(texFiles)
	if geoJSON != nil {
		geoJSON.TextureNames = texNames
	}

	return geoJSON, texData
}

// isDir 判断路径是否为目录
func isDir(path string) bool {
	fi, err := os.Stat(path)
	return err == nil && fi.IsDir()
}

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
// 会被解析为「零骨骼空模型」，与「未找到几何」无法区分（子代理审计 P 级发现）
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
