// ===== 解压后 YSM 模型目录中的 geometry/纹理查找 =====
// 当用户点击 ysm.json（解压后的 YSM 模型目录）时，
// 需要在此目录中搜索 geometry JSON 文件和纹理文件。
// 2026-10 拆分：原 936 行按职责分为 extracted.go（本文件：基础工具 + fallback + FindGeometry）/
// extracted_components.go（FindComponents 多组件查找）。
// 2026-10 二次拆分：FindGeometryInExtractedYSM 主入口移入 extracted_find.go。
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
	"ysm-model-manager/go/types/registry"
)

// maxReadSize 解压目录读取上限——对齐 zip 路径每条目 50MB（ADR-033 截断防线），
// 防超大 ysm.json/geometry/纹理整体拖入内存（P2 审计：原 os.ReadFile 无界，
// 与 zip 路径 50MB 口径不一致；geometry.ParseBedrockGeometry 的 100MB 上限是
// 整文件读入后才检查，防不了分配）
const maxReadSize = registry.MaxReadLimit

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
// MIME 派生委托 registry.TextureMIME（单一事实源），避免各处硬编码 switch 漂移。
func textureDataURI(path string, data []byte) string {
	mime := registry.TextureMIME(filepath.Ext(path))
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
	// JSON 对象键唯一 → "player" 至多命中一次，原先的 range + key 过滤等价于直接取值
	playerRaw, ok := filesObj["player"]
	if !ok {
		return pm
	}
	var player struct {
		Model   json.RawMessage `json:"model"`
		Texture json.RawMessage `json:"texture"`
	}
	if err := json.Unmarshal(playerRaw, &player); err != nil {
		log.Printf("[ysm] 解析 player 失败: %v", err)
		return pm
	}
	parsePlayerModelNames(player.Model, pm)
	parsePlayerTextureDecl(player.Texture, pm)
	return pm
}

// parsePlayerModelNames 解析 files.player.model 三分支（原逻辑逐字搬迁，无行为差异）。
func parsePlayerModelNames(raw json.RawMessage, pm *playerModel) {
	if len(raw) == 0 {
		return
	}
	trimmed := strings.TrimSpace(string(raw))
	switch {
	case strings.HasPrefix(trimmed, `{`):
		// map 格式：JSON 对象**写入序**即 Bedrock 声明序（main 通常最先声明）。
		names, mm := parseModelOrderedMap(raw)
		pm.names = append(pm.names, names...)
		pm.mapOrig = mm
	case strings.HasPrefix(trimmed, `[`):
		var arr []string
		if json.Unmarshal(raw, &arr) == nil {
			pm.names = arr
		}
	default:
		pm.names = append(pm.names, strings.Trim(trimmed, `"`))
	}
}

// parseModelOrderedMap 解析 model 对象的声明序。
// Go map 丢失写入序，必须 json.Decoder Token 流式保序遍历（P2 修复）。
// 非字符串 value（数字/对象/数组）Decode 报错且已消费完该值；
// 若 break 则后续好键（main 等）全部丢失 → 跳过继续（declPos 保序）。
func parseModelOrderedMap(raw json.RawMessage) (names []string, mm map[string]string) {
	mm = make(map[string]string)
	dec := json.NewDecoder(bytes.NewReader(raw))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return names, mm
	}
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			break
		}
		key, _ := keyTok.(string)
		var val string
		if err := dec.Decode(&val); err != nil {
			continue
		}
		if val != "" {
			names = append(names, val)
			mm[key] = val
		}
	}
	return names, mm
}

// parsePlayerTextureDecl 解析 files.player.texture 数组：抛回原始值（含来源标记），
// 裁剪留各消费方（Geometry 带扩展名做 orderMap 键、Components 去扩展名喂前端 R1）。
func parsePlayerTextureDecl(raw json.RawMessage, pm *playerModel) {
	if len(raw) == 0 {
		return
	}
	if !strings.HasPrefix(strings.TrimSpace(string(raw)), `[`) {
		return
	}
	var arr []json.RawMessage
	if json.Unmarshal(raw, &arr) != nil {
		return
	}
	for _, item := range arr {
		if it, ok := parseTexDeclItem(item); ok {
			pm.texDecl = append(pm.texDecl, it)
		}
	}
}

// parseTexDeclItem 解析单项纹理声明：对象取 .uv，裸字符串原样。
// isStr 标记来源，供消费方复刻两分支不同裁剪（obj 切 '/\'、裸仅切 '/'）。
func parseTexDeclItem(item json.RawMessage) (texDeclItem, bool) {
	s := strings.TrimSpace(string(item))
	if strings.HasPrefix(s, `{`) {
		var obj struct {
			Uv string `json:"uv"`
		}
		if json.Unmarshal(item, &obj) == nil && obj.Uv != "" {
			return texDeclItem{value: obj.Uv}, true
		}
		return texDeclItem{}, false
	}
	var sval string
	if json.Unmarshal(item, &sval) == nil && sval != "" {
		return texDeclItem{value: sval, isStr: true}, true
	}
	return texDeclItem{}, false
}

// texFile 已发现的纹理文件（全路径 + 小写 basename 含扩展名）。
type texFile struct {
	path string
	name string // 小写 basename（含扩展名，如 skin.png）
}

// collectTextureFiles 递归收集解压目录下的纹理文件（.png/.jpg/.jpeg/.tga），
// 排除 gui/ 子目录（YSM 的 gui_background/封面等非模型贴图，曾污染全局 texArr
// 导致 plane 等共享皮肤组件错绑——wine_fox 17_mini 根因，geometry/组件两消费方
// 共用同一遍历避免两次 WalkDir 口径漂移）。返回按遍历序（深度优先稳定序）。
// 扩展名口径委托 registry.IsTextureExt（单一事实源），含 .jpeg——此前漏收导致
// summary 计数与 avatar 提取认 .jpeg、但几何侧收集漏收的漂移。
func collectTextureFiles(texDir string) []texFile {
	var files []texFile
	if d, err := os.Stat(texDir); err == nil && d.IsDir() {
		_ = fsutil.SafeWalk(texDir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				if strings.EqualFold(d.Name(), "gui") {
					return filepath.SkipDir
				}
				return nil
			}
			if registry.IsTextureExt(filepath.Ext(d.Name())) {
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
	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
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
