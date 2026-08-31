// ===== 从压缩包中提取并解析 Bedrock Geometry =====
// 支持 ZIP（YSM 标准格式）和 7z 格式。容器打开统一走 go/container（ADR-068）。
package geometry

import (
	"encoding/base64"
	"encoding/json"
	"log"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// maxExtractSize 单个文件最大读取大小（ZIP/7z 内文件），防止 ZIP 炸弹
// 共享 types.MaxReadLimit（索引 6.7+5.2，与 fileops/ysm 的 50MB 上限单点）
const maxExtractSize = types.MaxReadLimit

// IsArmModelName 判断模型文件是否为第一人称手持视角的独立手臂几何
// （arm.json / arm.geo.json）。
//
// 权威来源（ModernYSM MainModelData）：main 和 arm 是 models 列表里的两个
// 独立 GeoModel（get(0)=main, get(1)=arm），两者共用同一套 textureMap
// （files.player.texture），通过 textureIndex 选皮肤。arm 的几何与 main 的
// 手臂几何不同（pivot/位置不同），用于游戏内第一人称手持物品视角
// （RenderFirstPlayerBackground 用 renderPartMask=3 渲染 armModel）。
//
// 合并版（ParseFromZip）在全身第三人称预览中不需要 arm 的第一人称手臂几何，
// 剔除避免错位；组件版（ParseComponentsFromZip / FindComponentsInExtractedYSM）
// 保留 arm 作为独立组件，供多组件切换查看。
//
// 导出单点（2026-08-26 审查收敛）：go/ysm 解压目录路径原有一份逐字节相同副本
// （连本注释都各抄一份），跨包复制靠注释同步必漂移——统一引此处。
// modelBaseName 取模型文件基名（小写、去路径分隔符、去 .json），供 IsArmModelName /
// IsMainModelName 统一复用——原两函数体逐字重复且各自抄同一段注释，跨点修改必漂移。
func modelBaseName(name string) string {
	base := strings.ToLower(name)
	if idx := strings.LastIndexAny(base, "/\\"); idx >= 0 {
		base = base[idx+1:]
	}
	return strings.TrimSuffix(base, ".json")
}

// baseName 去路径分隔符（/ 与 \ 兼容）取文件基名，供纹理名归一化复用（collectPngEntries /
// collectMergedFiles 原各抄一份逐字相同的剥离块）。
func baseName(name string) string {
	if idx := strings.LastIndex(name, "/"); idx >= 0 {
		name = name[idx+1:]
	}
	if idx := strings.LastIndex(name, "\\"); idx >= 0 {
		name = name[idx+1:]
	}
	return name
}

func IsArmModelName(name string) bool {
	return modelBaseName(name) == "arm" || modelBaseName(name) == "arm.geo"
}

// filterArmModels 移除模型顺序表中的第一人称手臂模型占位。
//
// 合并版（ParseFromZip）把所有模型骨骼合并成一个 BedrockModel 渲染，
// arm.json 的第一人称手臂几何在此场景下不需要，且其 pivot 与 main 的
// 手臂不同会导致错位，因此剔除。组件版不走此过滤——arm 作为独立组件保留
// （见 IsArmModelName 注释的权威来源）。
func filterArmModels(order []string) []string {
	out := make([]string, 0, len(order))
	for _, p := range order {
		if !IsArmModelName(p) {
			out = append(out, p)
		}
	}
	return out
}

// coverCandidateNames 封面候选名（根目录，不带路径前缀）——MC 生态封面约定，
// 资源包/女仆包/整合包通用：pack.png 优先，回退 cover/preview/thumbnail。
// 与 fileops.FindPreviewImage 的散图候选（preview.png/cover.png/thumbnail.png）口径一致，
// 一套命名约定贯通 zip 内与 zip 外。
var coverCandidateNames = []string{
	"pack.png",
	"cover.png",
	"preview.png",
	"thumbnail.png",
}

// extractFirstPNG 从容器读取器中提取预览 PNG（ZIP/7z 共用）：
// 先精确匹配根目录封面候选（pack.png/cover.png/preview.png/thumbnail.png），
// 无封面候选时回退"枚举序第一张 PNG"（旧行为，兼容无封面 zip）。
// 封面候选与位置无关：pack.png 排在 assets/ 纹理之后也能被优先选中。
func extractFirstPNG(r container.Reader) []byte {
	entries := r.Entries()
	// 第一遍：根目录封面候选名优先（顶层条目，不带路径分隔符）
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := strings.ToLower(e.Name())
		if !strings.ContainsAny(name, "/\\") && contains(coverCandidateNames, name) {
			if buf := readPNGEntry(e); len(buf) > 0 {
				return buf
			}
		}
	}
	// 第二遍：回退第一张 PNG（旧行为）
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if strings.HasSuffix(strings.ToLower(e.Name()), ".png") {
			if buf := readPNGEntry(e); len(buf) > 0 {
				return buf
			}
		}
	}
	return nil
}

// readPNGEntry 读取单条 PNG 条目内容（大小受限，防 ZIP 炸弹）。
func readPNGEntry(e container.Entry) []byte {
	rc, err := e.Open()
	if err != nil {
		return nil
	}
	defer rc.Close()
	return fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
}

// contains 字符串切片成员判定。
func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// ExtractFirstPNGFromZip 从 ZIP 中提取第一张 PNG 图片（用于快速预览）
func ExtractFirstPNGFromZip(data []byte, size int64) []byte {
	r, err := container.OpenZipBytes(data, size)
	if err != nil {
		return nil
	}
	defer r.Close()
	return extractFirstPNG(r)
}

// ExtractFirstPNGFrom7z 从 7z 中提取第一张 PNG 图片（用于快速预览）
func ExtractFirstPNGFrom7z(data []byte, size int64) []byte {
	r, err := container.Open7zBytes(data, size)
	if err != nil {
		return nil
	}
	defer r.Close()
	return extractFirstPNG(r)
}

type geoEntry struct {
	name string
	data []byte
}

// l0NamedEntry 是 resolveL0 的 basename 模糊匹配索引条目。
// 升格自 resolveL0 内匿名 struct，避免闭包外无法声明类型签名。
type l0NamedEntry struct {
	path string
	e    container.Entry
}

// l0BasenameIndex 封装「basename 索引懒构建」：仅当 resolver 走到 basename 回扫
// 分支（候选字典未命中）时才真正扫描命名空间下 entries，保持原 lazyBuildBasenameIdx
// 的懒语义不提前支付 O(N·basename 拆分) 成本。
type l0BasenameIndex struct {
	entries []container.Entry
	maidNs  string
	geo     map[string][]l0NamedEntry
	png     map[string][]l0NamedEntry
	built   bool
}

// build 执行一次真实构建（幂等，built 后直接返回已构建索引）
func (b *l0BasenameIndex) build() (geo, png map[string][]l0NamedEntry) {
	if b.built {
		return b.geo, b.png
	}
	b.geo = map[string][]l0NamedEntry{}
	b.png = map[string][]l0NamedEntry{}
	for _, e := range b.entries {
		low := strings.ToLower(e.Name())
		if !strings.HasPrefix(low, b.maidNs) {
			continue
		}
		rel := low[len(b.maidNs):]
		if strings.HasSuffix(low, ".json") {
			if types.IsYsmEntryJSON(filepath.Base(rel)) ||
				strings.HasSuffix(rel, "maid_model.json") ||
				strings.HasSuffix(rel, "maid_chair.json") ||
				strings.HasSuffix(rel, "maid_sound.json") ||
				strings.Contains(rel, "animation") ||
				strings.Contains(rel, "controller") {
				continue
			}
			base := filepath.Base(rel)
			base = strings.TrimSuffix(base, ".geo.json")
			base = strings.TrimSuffix(base, ".json")
			b.geo[base] = append(b.geo[base], l0NamedEntry{path: low, e: e})
		} else if strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg") {
			base := strings.TrimSuffix(filepath.Base(rel), filepath.Ext(filepath.Base(rel)))
			b.png[base] = append(b.png[base], l0NamedEntry{path: low, e: e})
		}
	}
	b.built = true
	return b.geo, b.png
}

// classifyFileInventory 识别 zip 内所有文件的归属（parseGlobalResources 轻量版：
// 只识别不解析，Go 端承担文件识别能力，前端消费准确归属清单，不再事后按文件名猜）。
// 纯新增能力，不改变既有收集（animJSONs/pngs 等数组内容不动，零 fallback 干扰）。
// maxClassifyEntries classifyFileInventory 的条目数封顶（R29 P2-1）。
// 恶意归档塞入数十万微小条目可导致 FileInventory 占用数 GB 内存。
// 10000 条对正常 YSM 包绰绰有余（典型包 <500 条），超限即停止并标记不完整。
const maxClassifyEntries = 10000

func classifyFileInventory(entries []container.Entry) *types.FileInventory {
	inv := &types.FileInventory{}
	matched := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		low := strings.ToLower(e.Name())
		appended := false
		switch {
		case strings.HasSuffix(low, ".animation_controller.json"):
			inv.Controllers = append(inv.Controllers, e.Name())
			appended = true
		case strings.HasSuffix(low, ".animation.json"):
			inv.Animations = append(inv.Animations, e.Name())
			appended = true
		case strings.HasSuffix(low, ".lang"):
			inv.LangFiles = append(inv.LangFiles, e.Name())
			appended = true
		case strings.HasSuffix(low, ".inc"):
			inv.IncFiles = append(inv.IncFiles, e.Name())
			appended = true
		case (strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && strings.Contains(low, "avatar/"):
			inv.Avatars = append(inv.Avatars, e.Name())
			appended = true
		case strings.HasSuffix(low, ".json") && !types.IsYsmEntryJSON(filepath.Base(e.Name())) && isLegacyGeometryName(low):
			inv.LegacyModels = append(inv.LegacyModels, e.Name())
			appended = true
		}
		// R29 code_review P3-1：仅计 matched 条目，避免 10000 个 .bin 垃圾条目耗尽配额
		if appended {
			matched++
			if matched >= maxClassifyEntries {
				log.Printf("[geometry] classifyFileInventory 达到 matched 条目数封顶 %d, 后续条目跳过", maxClassifyEntries)
				inv.Truncated = true
				break
			}
		}
	}
	return inv
}

// legacyGeometryNames 旧格式几何文件基名（无 ysm.json 场景）。含 .geo 变体：
// 与 IsMainModelName/IsArmModelName 同口径（code review P3：main.geo.json 等
// 会被当 geometry 解析但此前漏分类）；package-level 避免 per-entry 重建分配（P3）。
var legacyGeometryNames = []string{"main", "main.geo", "arm", "arm.geo", "arrow", "info"}

// isLegacyGeometryName 旧格式几何文件名约定（Modern YSM parseLegacyFormat 同口径：
// 无 ysm.json 的包以 main/arm/arrow/info 等固定名作为模型声明）
func isLegacyGeometryName(lowPath string) bool {
	// zip 内路径恒为正斜杠，不能用 filepath.Base（Windows 按 \ 分割会失效）
	if i := strings.LastIndexByte(lowPath, '/'); i >= 0 {
		lowPath = lowPath[i+1:]
	}
	base := strings.TrimSuffix(lowPath, ".json")
	for _, n := range legacyGeometryNames {
		if base == n {
			return true
		}
	}
	return false
}

// parseLegacyMetadata 旧格式 info.json 元数据（无 ysm.json 场景；Modern YSM
// parseLegacyMetadata 同口径——name/tips/license(字符串)/authors(字符串数组)）。
// 缺失/畸形返回 nil（容错，不阻断解析）；license 字符串映射为 License{Type}。
func parseLegacyMetadata(entries []container.Entry) *types.YsmMetadata {
	for _, e := range entries {
		// 只匹配根级 info.json（旧格式约定单个根文件）：嵌套/无关 *info.json
		// （textures/skin_info.json、assets/<ns>/info.json 等）不参与（code review P2）
		if e.IsDir() || !strings.EqualFold(e.Name(), "info.json") {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			continue
		}
		buf := fsutil.ReadLimitedEntry(rc, maxExtractSize)
		if len(buf) == 0 {
			continue
		}
		var info struct {
			Name    string   `json:"name"`
			Tips    string   `json:"tips"`
			License string   `json:"license"`
			Authors []string `json:"authors"`
		}
		if err := json.Unmarshal(buf, &info); err != nil {
			continue
		}
		m := &types.YsmMetadata{Name: info.Name, Tips: info.Tips}
		if info.License != "" {
			m.License = &types.YsmLicense{Type: info.License}
		}
		for _, a := range info.Authors {
			if a != "" {
				m.Authors = append(m.Authors, types.YsmAuthor{Name: a})
			}
		}
		if m.Name != "" || m.Tips != "" || m.License != nil || len(m.Authors) > 0 {
			return m
		}
		// 空占位（{}）不 return——继续找后续候选（code review P2：一个空 info.json
		// 不得抑制同 archive 中其他有效候选；根级仅一个时最终落到循环末 return nil）
	}
	return nil
}

// projEntry 收集投射物/载具模型路径 + 声明的纹理名，
// texIdxMap 构建时用 texName 查 texOrder 位置分配 texSlot。
// section 为来源段名（"projectile"/"vehicle"/"arrow"），供 TextureCategories 分类。
type projEntry struct {
	model   string
	texName string // 声明的纹理名（小写 basename 去扩展名）
	section string // 来源段名
}

// collectArchiveFiles 从压缩包收集 ysm.json 映射/模型文件/纹理（合并版与组件版共用）。
// 与 ParseFromZip 原内联逻辑等价，但 geoFiles **不排除 arm**（arm 过滤由合并版调用方
// filterArmModels 做；组件版需要 arm 作为独立组件）。entries 现为 container.Entry（ADR-068）。
// 新增返回值 modelTexName：模型路径(ToSlash)→声明纹理名(小写basename去扩)，用于组件版
// 按 basename 直接查表，避免 texOrder 去重后索引漂移。
// collectedArchive 归档条目的分类收集产物，收敛 collectArchiveFiles 的 7 个位置返回值。
// 包内私有：跨包复用类型才进 go/types/，此结构仅 archive.go 内部消费。
type collectedArchive struct {
	modelOrder   []string
	texOrder     []string
	geoFiles     []geoEntry
	pngs         [][]byte
	pngNames     []string
	animJSONs    []string
	modelTexName map[string]string
}

func collectArchiveFiles(entries []container.Entry) collectedArchive {
	// ysm.json 统一解析（结构解码共享；口径后处理留在本函数，清单版：player.texture 去扩展名）
	md := parseYsmArchive(entries, "[geometry]")

	texOrder := buildTexOrderFromPlayerTexs(md.PlayerTexs)
	texOrder = appendUniqueProjTexs(texOrder, md.ProjModels)

	// modelOrder：player 模型先、投射物模型后（与 texOrder 同序，texIdxMap 位置绑定不错位）
	modelOrder := append([]string(nil), md.ModelOrder...)
	for _, pm := range md.ProjModels {
		if pm.model != "" {
			modelOrder = append(modelOrder, pm.model)
		}
	}

	maidNs := detectMaidNs(entries)
	geoFiles, animJSONs := collectGeoAnimEntries(entries, maidNs)
	pngs, pngNames := collectPngEntries(entries, maidNs)

	return collectedArchive{
		modelOrder:   modelOrder,
		texOrder:     texOrder,
		geoFiles:     geoFiles,
		pngs:         pngs,
		pngNames:     pngNames,
		animJSONs:    animJSONs,
		modelTexName: md.ModelTexName,
	}
}

// buildTexOrderFromPlayerTexs 从 player.texture 声明构建 texOrder 前段。
// uv 对象剥反斜杠、裸字符串不剥（复刻原内联不对称）；先小写再去 .png/.jpg 扩展名。
func buildTexOrderFromPlayerTexs(playerTexs []playerTex) []string {
	texOrder := make([]string, 0, len(playerTexs))
	for _, t := range playerTexs {
		tn := t.path
		if idx := strings.LastIndex(tn, "/"); idx >= 0 {
			tn = tn[idx+1:]
		}
		if t.isUV {
			if idx := strings.LastIndex(tn, "\\"); idx >= 0 {
				tn = tn[idx+1:]
			}
		}
		tn = trimTexExt(strings.ToLower(tn))
		texOrder = append(texOrder, tn)
	}
	return texOrder
}

// appendUniqueProjTexs 把投射物/载具声明的纹理去重追加到 texOrder。
// 去重原因：vehicles 段 horse+mule 都指向 foxcar.png，重复追加会导致后续
// 纹理 texSlot 偏移（minecart 采样到 boat.png）。
func appendUniqueProjTexs(texOrder []string, projModels []projEntry) []string {
	for _, pm := range projModels {
		if pm.texName == "" {
			continue
		}
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
		}
	}
	return texOrder
}

// detectMaidNs 组件版命名空间选择：与合并版 collectMaidManifest 同口径
// （"最长清单即主包"，selectBestMaidCandidate）——多命名空间包组件视图与
// 合并预览选中的 ns 不再分叉（2026-08-26 审查统一；此前取条目序首个，
// zip 内多清单时两条路径口径分叉）。无 maid_model.json 时返回空串。
func detectMaidNs(entries []container.Entry) string {
	ns, _ := collectMaidManifest(entries, "")
	return ns
}

// jsonEntryPass 判断 entry 是否通过 json 收集前置过滤：非目录 .json、非 ysm 入口、
// 通过 maidNs 命名空间过滤（排除 maid_model/chair/sound 配置）。collectGeoAnimEntries
// 与 collectAnimJSONs 共用，避免过滤逻辑重复（ADR-140 L3）。
func jsonEntryPass(e container.Entry, maidNs string) bool {
	low := strings.ToLower(e.Name())
	if !strings.HasSuffix(low, ".json") || e.IsDir() {
		return false
	}
	if types.IsYsmEntryJSON(filepath.Base(e.Name())) {
		return false
	}
	// maid-model 命名空间过滤：只处理首个 namespace 的 entity JSON
	if maidNs != "" {
		if !strings.HasPrefix(low, maidNs) || strings.HasSuffix(low, "maid_model.json") || strings.HasSuffix(low, "maid_chair.json") || strings.HasSuffix(low, "maid_sound.json") {
			return false
		}
	}
	return true
}

// collectAnimJSONs 遍历 entries，收集 animation/controller JSON 字符串（geo/png 不物化）。
// 过滤口径（ysm 入口 / maidNs 命名空间 / maid_model·chair·sound 配置）与
// collectGeoAnimEntries 动画分支逐字节一致；ns 过滤置 Open 之前，无 reader 泄漏。
// 供 collectGeoAnimEntries（全量路径）与 collectAnimEntriesOnly（L0 命中路径）共用，
// 避免动画收集逻辑重复（ADR-140 L3）。
func collectAnimJSONs(entries []container.Entry, maidNs string) []string {
	var animJSONs []string
	for _, e := range entries {
		if !jsonEntryPass(e, maidNs) {
			continue
		}
		low := strings.ToLower(e.Name())
		if !strings.Contains(low, "animation") && !strings.Contains(low, "controller") {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			continue
		}
		// ReadLimitedEntry 内部已 Close；+1 探测，超限返回 nil（ADR-033）
		buf := fsutil.ReadLimitedEntry(rc, maxExtractSize)
		if len(buf) > 10 {
			animJSONs = append(animJSONs, string(buf))
		}
	}
	return animJSONs
}

// collectGeoAnimEntries 遍历 entries，收集 geometry JSON（geoFiles）和
// animation/controller JSON（animJSONs）。排除 ysm.json 入口、非 maidNs 的文件、
// maid_model/chair/sound 配置 JSON。anim 部分委托 collectAnimJSONs（单一来源），
// 本函数只额外物化 geo（不含 arm 过滤——组件版需要；合并版由调用方 filterArmModels 过滤）。
func collectGeoAnimEntries(entries []container.Entry, maidNs string) ([]geoEntry, []string) {
	animJSONs := collectAnimJSONs(entries, maidNs)
	var geoFiles []geoEntry
	for _, e := range entries {
		if !jsonEntryPass(e, maidNs) {
			continue
		}
		low := strings.ToLower(e.Name())
		// animation/controller 已由 collectAnimJSONs 收集，这里只物化 geo
		if strings.Contains(low, "animation") || strings.Contains(low, "controller") {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			continue
		}
		buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
		geoFiles = append(geoFiles, geoEntry{name: e.Name(), data: buf})
	}
	return geoFiles, animJSONs
}

// collectAnimEntriesOnly 仅收集动画/控制器 JSON 字符串（geo/png 不物化）。
// L0 命中路径专用：清单生效时 geoFiles/pngs 全部由清单派生，全量物化纯属
// 浪费——故本函数只委托 collectAnimJSONs，绝不触碰 geo 物化（无 I/O 回归，
// 与 collectGeoAnimEntries 动画分支逐字节一致）。
func collectAnimEntriesOnly(entries []container.Entry, maidNs string) []string {
	return collectAnimJSONs(entries, maidNs)
}

// collectPngEntries 遍历 entries，收集非 avatar/ 非 gui/ 的 png/jpg 纹理。
// 输出按 pngs[idx] ↔ pngNames[idx] 对齐；文件名已 basename 化并去扩展名。
func collectPngEntries(entries []container.Entry, maidNs string) ([][]byte, []string) {
	var pngs [][]byte
	var pngNames []string
	for _, e := range entries {
		low := strings.ToLower(e.Name())
		if !((strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && !e.IsDir() && !strings.Contains(low, "avatar/") && !strings.Contains(low, "gui/")) {
			continue
		}
		// maid-model 命名空间过滤：只收集首个 namespace 的纹理
		if maidNs != "" && !strings.HasPrefix(low, maidNs) {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			continue
		}
		pngData := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
		// 与 .ysm 解压路径口径对齐：不按尺寸过滤小纹理（64×64 合法贴图可 <4KB），
		// 头像/预览图仅由 avatar/ 路径与基名前缀排除
		if len(pngData) == 0 {
			continue
		}
		name := baseName(e.Name())
		name = trimTexExt(name)
		pngNames = append(pngNames, name)
		pngs = append(pngs, pngData)
	}
	return pngs, pngNames
}

// maidManifestItem 对应 L0 maid_model.json model[] / model_list[] 的单条
// 支持两种描述形式，两个字段组合使用：
//   - 形式 A（完整路径，老/自定义包）：Model + Texture 直接给出相对路径
//   - 形式 B（model_id，TLM 原生）：ModelID = "namespace:name" → 通过路径字典推断
type maidManifestItem struct {
	Name    string `json:"name"`
	Model   string `json:"model"`    // 相对命名空间根的路径（形式 A）
	Texture string `json:"texture"`  // 相对路径（形式 A）
	ModelID string `json:"model_id"` // TLM 标准："namespace:name"（形式 B）
}

// maidNsCandidate 是单个 maid_model.json 解析后的候选结果
type maidNsCandidate struct {
	ns       string
	manifest []maidManifestItem
	count    int
}

// maidGroupWrapper 对应 maid_model.json 中 pack/chair/decor 分组的两种清单格式
type maidGroupWrapper struct {
	Model     []maidManifestItem `json:"model"`
	ModelList []maidManifestItem `json:"model_list"`
}

// maidManifestRaw 是 maid_model.json 的完整解析结构
// TLM 真实格式：{pack_name, pack:{model_list:[...]}, chair:{model_list:[...]}}
// 自定义简化格式：{model:[...]} 或 {model_list:[...]}
type maidManifestRaw struct {
	Model     []maidManifestItem `json:"model"`
	ModelList []maidManifestItem `json:"model_list"`
	Pack      maidGroupWrapper   `json:"pack"`
	Chair     maidGroupWrapper   `json:"chair"`
	Decor     maidGroupWrapper   `json:"decor"`
}

// collectMaidManifest 遍历所有 maid_model.json，选"清单最长者"为真正的命名空间。
// 从 parseModelFromEntries 的 L0 清单收集子域收编（只搬逻辑、不改行为），
// 返回命名空间前缀（含尾部 /）与清单；无 maid_model.json 时 maidNs 为空、manifest 为 nil。
func collectMaidManifest(entries []container.Entry, logPrefix string) (string, []maidManifestItem) {
	var candidates []maidNsCandidate
	for _, e := range entries {
		low := strings.ToLower(e.Name())
		if strings.HasSuffix(low, "/maid_model.json") {
			if cand, ok := parseMaidModelJSON(e, low); ok {
				candidates = append(candidates, cand)
			}
		}
	}
	var maidNs string
	var maidManifest []maidManifestItem // 非 nil 且 len>0 表示 L0 生效
	if len(candidates) > 0 {
		best := selectBestMaidCandidate(candidates)
		maidNs = best.ns
		maidManifest = best.manifest
		if logPrefix != "" {
			log.Printf("%s maid-model 命名空间: %s（L0 清单 %d 条 / 候选共 %d 个）",
				logPrefix, maidNs, len(maidManifest), len(candidates))
		}
	}
	return maidNs, maidManifest
}

// parseMaidModelJSON 解析单个 maid_model.json 条目为候选。
// low 是已转小写的 e.Name()，用于拆路径取命名空间。
// 解析层级：顶层 / pack / chair / decor 四处都可能含 model/model_list，
// 分别收集，取条目数最大的那个作为此命名空间的清单来源。
func parseMaidModelJSON(e container.Entry, low string) (maidNsCandidate, bool) {
	parts := strings.Split(low, "/")
	if len(parts) < 3 {
		return maidNsCandidate{}, false
	}
	ns := strings.Join(parts[:len(parts)-1], "/") + "/"
	rc, err := e.Open()
	if err != nil {
		return maidNsCandidate{}, false
	}
	buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
	var raw maidManifestRaw
	if json.Unmarshal(buf, &raw) != nil {
		return maidNsCandidate{}, false
	}
	groups := [][]maidManifestItem{
		pickBestMaidGroup(maidGroupWrapper{Model: raw.Model, ModelList: raw.ModelList}),
		pickBestMaidGroup(raw.Pack),
		pickBestMaidGroup(raw.Chair),
		pickBestMaidGroup(raw.Decor),
	}
	bestGroup := groups[0]
	for _, g := range groups[1:] {
		if len(g) > len(bestGroup) {
			bestGroup = g
		}
	}
	return maidNsCandidate{
		ns:       ns,
		manifest: bestGroup,
		count:    len(bestGroup),
	}, true
}

// pickBestMaidGroup 在同一分组的 model[] 与 model_list[] 两种格式中选条目更多者。
// 两字段都空时返回 nil。
func pickBestMaidGroup(g maidGroupWrapper) []maidManifestItem {
	if len(g.Model) >= len(g.ModelList) {
		return g.Model
	}
	return g.ModelList
}

// selectBestMaidCandidate 从候选中选"清单最长者"（启发式：条目数最长 = 主包清单）。
// 候选空时返回零值。
func selectBestMaidCandidate(candidates []maidNsCandidate) maidNsCandidate {
	// R29 P2-2：空切片保护，避免 candidates[0] panic
	if len(candidates) == 0 {
		return maidNsCandidate{}
	}
	best := candidates[0]
	for _, c := range candidates[1:] {
		if c.count > best.count {
			best = c
		}
	}
	return best
}

// l0Resolved 是 L0 清单驱动解析的产物。覆盖判定不对称是现状红线：
// geoFiles 等覆盖看 hit（等价旧 len(l0GeoFiles)>0），而 parseModelFromEntries 的
// SubModels 分支只看清单非空——重构时不得"顺手统一"成一致，否则改行为。
type l0Resolved struct {
	geoFiles           []geoEntry
	pngs               [][]byte
	pngNames           []string
	modelOrder         []string
	texOrder           []string
	texCategories      []string
	resolvedPathByItem map[int]string
	texNameByItem      map[int]string
	hit                bool
}

// ----- resolveL0 子函数（升格自原闭包 2026-08-25）-----

// l0ModelCandidates / l0TextureCandidates：model_id 推断时的候选路径模板，
// 按"真实包常见度"排序，找到第一个存在的 zip entry 即停。升格为包级 var
// 仅因 resolveL0Model/resolveL0Texture 两 resolver 对称共享，不改变语义。
var l0ModelCandidates = []string{
	"models/entity/<N>.json",
	"models/main/<N>.json",
	"models/<N>.json",
	"models/entity/<N>.geo.json",
	"geckolib/models/entity/<N>.json",
	"models/block/<N>.json",
	"<N>.json",
}
var l0TextureCandidates = []string{
	"textures/entity/<N>.png",
	"textures/main/<N>.png",
	"textures/<N>.png",
	"geckolib/textures/entity/<N>.png",
	"textures/entity/<N>.jpg",
}

// l0BuildPathIndex 把 entries 按「小写 zip 绝对路径」建 O(1) 索引。
// 纯搬移原 resolveL0 头部的 entryByPath 构建循环。
func l0BuildPathIndex(entries []container.Entry) map[string]container.Entry {
	m := make(map[string]container.Entry, len(entries))
	for _, e := range entries {
		m[strings.ToLower(e.Name())] = e
	}
	return m
}

// l0ExtractName 从 model_id "ns:name" 取 name 部分；空则返回 fallback。
// 纯函数（原闭包 extractName 升格）。
func l0ExtractName(modelID, fallback string) string {
	if modelID == "" {
		return fallback
	}
	if idx := strings.Index(modelID, ":"); idx >= 0 {
		return modelID[idx+1:]
	}
	return modelID
}

// l0StripNsPrefix 若 value 形如 "nsBase:path" 且 path 非绝对路径，
// 去掉 nsBase: 前缀后返回 path；否则原样透传。对应 droneeee 一类的混合写法：
// "model": "droneeee:models/entity/x.json"。纯函数（原闭包 stripNsPrefix 升格）。
func l0StripNsPrefix(value, nsBase string) string {
	if nsBase == "" || value == "" {
		return value
	}
	if idx := strings.Index(value, ":"); idx >= 0 {
		if value[:idx] == nsBase && !filepath.IsAbs(value[idx+1:]) {
			return value[idx+1:]
		}
	}
	return value
}

// l0TryCandidates 从候选模板（含 <N> 占位）里找第一个存在的 zip entry。
// 返回 (entry, 小写 absPath, 是否命中)。原闭包 tryCandidates 升格。
func l0TryCandidates(baseName string, templates []string, maidNs string,
	entryByPath map[string]container.Entry) (container.Entry, string, bool) {
	for _, t := range templates {
		rel := strings.ReplaceAll(t, "<N>", baseName)
		abs := strings.ToLower(maidNs + strings.TrimPrefix(rel, "/"))
		if e, ok := entryByPath[abs]; ok {
			return e, abs, true
		}
	}
	return nil, "", false
}

// l0ResolveModel 解析 L0 条目的模型路径，返回 zip 内小写绝对路径（空=未命中）。
// 优先级：形式 A 显式路径 → model_id 候选字典 → basename 模糊回扫。
// 原闭包 resolveL0Model 升格：basename 索引由 bIdx.build() 懒构建保留原语义。
func l0ResolveModel(item maidManifestItem, maidNs, nsBase, logPrefix string,
	entryByPath map[string]container.Entry, bIdx *l0BasenameIndex) string {
	modelRel := l0StripNsPrefix(item.Model, nsBase)
	if modelRel != "" {
		modelAbs := strings.ToLower(maidNs + strings.TrimPrefix(filepath.ToSlash(modelRel), "/"))
		if _, ok := entryByPath[modelAbs]; ok {
			log.Printf("%s L0 形式A 模型: %s → %s", logPrefix, item.Model, modelAbs)
			return modelAbs
		}
	}
	mid := item.ModelID
	if mid == "" && strings.Contains(item.Model, ":") && !filepath.IsAbs(item.Model) {
		mid = item.Model
	}
	if mid != "" {
		namePart := l0ExtractName(mid, "")
		if namePart != "" {
			if _, abs, hit := l0TryCandidates(namePart, l0ModelCandidates, maidNs, entryByPath); hit {
				log.Printf("%s L0 形式B 模型(候选): %s → %s", logPrefix, mid, abs)
				return abs
			}
			geoIdx, _ := bIdx.build()
			if match, ok := geoIdx[namePart]; ok && len(match) > 0 {
				log.Printf("%s L0 形式B 模型(basename回扫): %s → %s", logPrefix, mid, match[0].path)
				return match[0].path
			}
			log.Printf("%s L0 模型未命中: %s", logPrefix, mid)
		}
	}
	return ""
}

// l0ResolveTexture 解析 L0 条目的纹理路径，返回 zip 内小写绝对路径（空=未命中）。
// 优先级：形式 A 显式路径 → model_id 候选字典 → basename 模糊回扫。
// 原闭包 resolveL0Texture 升格：与 l0ResolveModel 三段回退链严格对称。
func l0ResolveTexture(item maidManifestItem, maidNs, nsBase, logPrefix string,
	entryByPath map[string]container.Entry, bIdx *l0BasenameIndex, _modelAbs string) string {
	textureRel := l0StripNsPrefix(item.Texture, nsBase)
	if textureRel != "" {
		texAbs := strings.ToLower(maidNs + strings.TrimPrefix(filepath.ToSlash(textureRel), "/"))
		if _, ok := entryByPath[texAbs]; ok {
			log.Printf("%s L0 形式A 纹理: %s → %s", logPrefix, item.Texture, texAbs)
			return texAbs
		}
	}
	mid := item.ModelID
	if mid != "" {
		namePart := l0ExtractName(mid, "")
		if namePart != "" {
			if _, abs, hit := l0TryCandidates(namePart, l0TextureCandidates, maidNs, entryByPath); hit {
				log.Printf("%s L0 形式B 纹理(候选): %s → %s", logPrefix, mid, abs)
				return abs
			}
			_, pngIdx := bIdx.build()
			if match, ok := pngIdx[namePart]; ok && len(match) > 0 {
				log.Printf("%s L0 形式B 纹理(basename回扫): %s → %s", logPrefix, mid, match[0].path)
				return match[0].path
			}
			log.Printf("%s L0 纹理未命中: %s", logPrefix, mid)
		}
	}
	return ""
}

// applyL0ManifestItem 把单条 manifest 的解析结果（modelAbs/texAbs）落实到 res
// 数组：两段 Open→Read→append 对称代码原在主循环内联各写一份，现在合并。
// 行为逐字节保持原循环：Open 失败静默跳、buf 为空跳、ARM 模型被 IsArmModelName
// 排除、纹理 pngNames 取 LastIndex("/") 后缀、texNameByItem 小写——一处不动。
func applyL0ManifestItem(res *l0Resolved, i int, maidNs string,
	entryByPath map[string]container.Entry, modelAbs, texAbs string) {
	if modelAbs != "" {
		if e, ok := entryByPath[modelAbs]; ok {
			if rc, err := e.Open(); err == nil {
				buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
				if len(buf) > 0 && !IsArmModelName(e.Name()) {
					res.geoFiles = append(res.geoFiles, geoEntry{name: e.Name(), data: buf})
					res.modelOrder = append(res.modelOrder, modelAbs[len(maidNs):])
					res.resolvedPathByItem[i] = modelAbs
				}
			}
		}
	}
	if texAbs != "" {
		if e, ok := entryByPath[texAbs]; ok {
			if rc, err := e.Open(); err == nil {
				pngData := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
				if len(pngData) > 0 {
					tn := e.Name()
					if idx := strings.LastIndex(tn, "/"); idx >= 0 {
						tn = tn[idx+1:]
					}
					tn = strings.TrimSuffix(tn, filepath.Ext(tn))
					res.pngs = append(res.pngs, pngData)
					res.pngNames = append(res.pngNames, tn)
					res.texOrder = append(res.texOrder, strings.ToLower(filepath.Base(texAbs)))
					res.texNameByItem[i] = strings.ToLower(tn)
				}
			}
		}
	}
}

// resolveL0 从 L0 清单派生 geoFiles/pngs/modelOrder/texOrder（权威顺序），只收清单引用的条目。
// 从 parseModelFromEntries 的 L0 解析+覆盖子域收编（只搬逻辑、不改行为）；manifest 为空返回零值。
func resolveL0(entries []container.Entry, maidNs string, manifest []maidManifestItem, logPrefix string) l0Resolved {
	if len(manifest) == 0 {
		return l0Resolved{resolvedPathByItem: map[int]string{}, texNameByItem: map[int]string{}}
	}
	// 入口只做四件事：①建路径索引 / ②实例化懒 basename 索引（不立刻扫）
	// ③算 nsBase / ④预分配 + 调子函数。主循环 ~12 行，纯调度。
	entryByPath := l0BuildPathIndex(entries)
	bIdx := &l0BasenameIndex{entries: entries, maidNs: maidNs}

	var nsBase string
	if strings.HasPrefix(maidNs, "assets/") {
		nsBase = strings.TrimPrefix(maidNs, "assets/")
		nsBase = strings.TrimSuffix(nsBase, "/")
	}

	res := l0Resolved{
		geoFiles:           make([]geoEntry, 0, len(manifest)),
		pngs:               make([][]byte, 0, len(manifest)),
		pngNames:           make([]string, 0, len(manifest)),
		modelOrder:         make([]string, 0, len(manifest)),
		texOrder:           make([]string, 0, len(manifest)),
		resolvedPathByItem: make(map[int]string, len(manifest)),
		texNameByItem:      make(map[int]string, len(manifest)),
	}

	for i, item := range manifest {
		modelAbs := l0ResolveModel(item, maidNs, nsBase, logPrefix, entryByPath, bIdx)
		texAbs := l0ResolveTexture(item, maidNs, nsBase, logPrefix, entryByPath, bIdx, modelAbs)
		applyL0ManifestItem(&res, i, maidNs, entryByPath, modelAbs, texAbs)
	}

	// 只有清单至少命中了 1 个模型才用 L0 覆盖（空命中视为清单与 zip 内容脱节，回退 L1）。
	// texCategories 同步重建（统一 "player"）——命中判定 + 分类两条规则保留逐字节原行为。
	if len(res.geoFiles) > 0 {
		res.hit = true
		res.texCategories = make([]string, len(res.texOrder))
		for i := range res.texCategories {
			res.texCategories[i] = "player"
		}
	}
	return res
}

// collectMergedFiles 合并版遍历收集：从 entries 拾取 geo/model/动画/纹理（模型版口径）。
// 与 collectArchiveFiles（清单版/组件版）口径分叉，勿并：
//   - 本函数 geoFiles 排 arm（合并版 exclude）；collectArchiveFiles 不排（组件版要）。
//   - 本函数仅收集、不做声明序；排序由调用方各阶段负责。
//
// 行为保持原内联循环逐字节不变（纯搬移，不改逻辑）：
//   - maid-model 命名空间过滤置于 Open 之前 + 动画分支之前（与 collectArchiveFiles
//     同口径）——被拒条目不 Open（无 reader 泄漏）+ 外来命名空间的动画/控制器 JSON 一并跳过。
//   - 动画/控制器 JSON 走 fsutil.ReadLimitedEntry（+1 探测，超限返回 nil；ADR-033
//     陷阱：原 io.ReadAll(io.LimitReader) 无 +1 探测，恰好 50MB 被截断后静默下发）。
//   - IsArmModelName 检查发生在 Open+Read 之后（保持原序，勿"顺手优化"成先判断再读）。
func collectMergedFiles(entries []container.Entry, maidNs string) (geoFiles []geoEntry, animJSONs []string, pngs [][]byte, pngNames []string) {
	for _, e := range entries {
		low := strings.ToLower(e.Name())
		if strings.HasSuffix(low, ".json") && !e.IsDir() {
			if types.IsYsmEntryJSON(filepath.Base(e.Name())) {
				continue
			}
			if maidNs != "" {
				if !strings.HasPrefix(low, maidNs) || strings.HasSuffix(low, "maid_model.json") || strings.HasSuffix(low, "maid_chair.json") || strings.HasSuffix(low, "maid_sound.json") {
					continue
				}
			}
			if strings.Contains(low, "animation") || strings.Contains(low, "controller") {
				rc, err := e.Open()
				if err != nil {
					continue
				}
				buf := fsutil.ReadLimitedEntry(rc, maxExtractSize)
				if len(buf) > 10 {
					animJSONs = append(animJSONs, string(buf))
				}
				continue
			}
			rc, err := e.Open()
			if err != nil {
				continue
			}
			buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
			if IsArmModelName(e.Name()) {
				continue // 排除第一人称手臂模型 arm.json（与 main 手臂重叠 → 双手臂）
			}
			geoFiles = append(geoFiles, geoEntry{name: e.Name(), data: buf})
		}
		if (strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && !e.IsDir() && !strings.Contains(low, "avatar/") && !strings.Contains(low, "gui/") {
			// maid-model 命名空间过滤：只收集首个 namespace 的纹理
			if maidNs != "" && !strings.HasPrefix(low, maidNs) {
				continue
			}
			rc, err := e.Open()
			if err != nil {
				continue
			}
			pngData := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
			// 与 .ysm 解压路径口径对齐：不按尺寸过滤小纹理（64×64 合法贴图可 <4KB），
			// 头像/预览图仅由 avatar/ 路径与基名前缀排除
			if len(pngData) > 0 {
				name := baseName(e.Name())
				pngNames = append(pngNames, trimTexExt(name))
				pngs = append(pngs, pngData)
			}
		}
	}
	return geoFiles, animJSONs, pngs, pngNames
}

// sortByModelOrder 将 geoFiles 按声明序排序：main/player 模型先、投射物后，未声明项稳定落尾。
// 查询键与 orderMap 键同口径（"\\"→"/" 归一化 + 小写化）：Windows 工具产出的条目名可能
// 含反斜杠/混合大小写，未归一化会让声明序排序失效（code review P3）。
func sortByModelOrder(geoFiles []geoEntry, modelOrder []string) {
	if len(modelOrder) == 0 {
		return
	}
	orderMap := make(map[string]int, len(modelOrder))
	for i, p := range modelOrder {
		// key 统一小写：L0 路径已小写（modelAbs[len(maidNs):]），查询键是 zip 条目原始
		// 大小写——大小写敏感会 miss → 声明序排序失效。
		orderMap[strings.ToLower(filepath.ToSlash(p))] = i
	}
	sort.SliceStable(geoFiles, func(i, j int) bool {
		ai, oki := orderMap[strings.ToLower(filepath.ToSlash(geoFiles[i].name))]
		aj, okj := orderMap[strings.ToLower(filepath.ToSlash(geoFiles[j].name))]
		if oki && okj {
			return ai < aj
		}
		return oki
	})
}

// sortByTexOrder 纹理按声明序排序：pngs 与 pngNames 同步重排（同一 orderMap；两切片的
// 比较器同口径，未声明纹理稳定落尾 hasI 分支）。
// 返回 orderMap（texOrder 去扩展名 → 声明下标）；调用方须在 tex 排序后、buildSubModels
// 之前拿到它——L0 SubModel.TexSlot 需按排序后槽位换算，此先后为隐式时序约束，勿松动。
// key 口径：texOrder 条目是「小写 basename 含扩展名」，查询 key 是 pngNames（已去扩展名），
// 故先 TrimSuffix 再入 map，否则 key 永不命中（原死代码陷阱，已修）。
func sortByTexOrder(texOrder []string, pngs [][]byte, pngNames []string) map[string]int {
	orderMap := make(map[string]int, len(texOrder))
	if len(texOrder) == 0 {
		return orderMap
	}
	for i, n := range texOrder {
		orderMap[trimTexExt(n)] = i
	}
	// 两切片比较器同口径（键均为 pngNames），提取共享闭包消除逐字重复。
	less := func(i, j int) bool {
		oi, hasI := orderMap[strings.ToLower(pngNames[i])]
		oj, hasJ := orderMap[strings.ToLower(pngNames[j])]
		if hasI && hasJ {
			return oi < oj
		}
		return hasI
	}
	sort.SliceStable(pngs, less)
	sort.SliceStable(pngNames, less)
	return orderMap
}

// buildSubModels 构建 SubModels 清单（L0 manifest 优先 → L1 兜底派生于 geoFiles），写入 geo。
// 隐式时序约束：必须在 sortByTexOrder 之后调用——L0 TexSlot 用 texNameByItem → orderMap
// 换算「排序后」槽位（orderMap 由 sortByTexOrder 返回）；先拆此先后会改行为。
// L0「覆盖判定不对称」红线：SubModels 分支只看 len(maidManifest)>0（不看 resolveL0.hit），
// 与 geoFiles 等覆盖判定（看 hit）不一致，此为现状事实，勿"顺手统一"。
// geo 必须非 nil（调用方已判）；geoFiles 按声明序已排好（sortByModelOrder 先于本函数）。
func buildSubModels(geo *types.BedrockModel, maidManifest []maidManifestItem, resolvedPathByItem, texNameByItem map[int]string, orderMap map[string]int, geoFiles []geoEntry, pngs [][]byte) {
	// L0：Name 取自 manifest，SourcePath 是 zip 内绝对路径，TexSlot 对应 manifest 下标
	if len(maidManifest) > 0 {
		l0Subs := make([]types.SubModel, 0, len(maidManifest))
		for i, item := range maidManifest {
			if item.Name == "" {
				continue
			}
			// SourcePath 用实际解析到的 zip 路径（形式 B model_id 推断时 item.Model 为空，
			// 直接拼 maidNs 会得到命名空间目录 → 单角色匹配必失败，静默回退全量合并模型）；
			// 未解析到则留空 → 前端 subPath undefined 走兜底。
			// TexSlot 用条目纹理在排序后纹理数组的下标（texNameByItem → orderMap），
			// 而非 manifest 下标（纹理解析失败的条目会使 l0Pngs 收缩、下标漂移）。
			slot := 0
			if tn, ok := texNameByItem[i]; ok {
				if s, ok2 := orderMap[tn]; ok2 {
					slot = s
				}
			}
			l0Subs = append(l0Subs, types.SubModel{
				Name:       item.Name,
				SourcePath: resolvedPathByItem[i],
				TexSlot:    slot,
			})
		}
		if len(l0Subs) > 0 {
			geo.SubModels = l0Subs
		}
	}
	if len(geo.SubModels) == 0 && len(geoFiles) > 0 {
		// L1 兜底：从 geoFiles 派生（Name=basename 去 .geo.json/.json 后缀）
		l1Subs := make([]types.SubModel, 0, len(geoFiles))
		for i, gf := range geoFiles {
			subName := filepath.ToSlash(gf.name)
			if idx := strings.LastIndex(subName, "/"); idx >= 0 {
				subName = subName[idx+1:]
			}
			subName = strings.TrimSuffix(subName, ".geo.json")
			subName = strings.TrimSuffix(subName, ".json")
			slot := i
			if slot >= len(pngs) && len(pngs) > 0 {
				slot = len(pngs) - 1
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
		tn := t.path
		if idx := strings.LastIndex(tn, "/"); idx >= 0 {
			tn = tn[idx+1:]
		}
		if t.isUV {
			if idx := strings.LastIndex(tn, "\\"); idx >= 0 {
				tn = tn[idx+1:]
			}
		}
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
//   - 每个 cube 记来源文件的 tex 尺寸（CubeTexW/H）；geo 级 TexWidth/Height 取最大。
//   - texIdxMap：模型 basename → texOrder 槽位（声明纹理名命中优先，modelOrder 序号兜底钳制）。
//     查询/构建键同口径（"\\"→"/" 归一化 + 小写化 + 去 .json/.geo.json 后缀），Windows
//     混合大小写 zip 不归一化会让 texIdxMap 永不命中 → TexSlot 绑定失效（code review P3）。
func mergeGeoFiles(geoFiles []geoEntry, modelOrder, texOrder []string, projModels []projEntry) *types.BedrockModel {
	// 建立模型文件→纹理索引映射
	texIdxMap := make(map[string]int)
	texCount := len(texOrder)
	if texCount == 0 {
		texCount = len(modelOrder)
	}
	// modelTexName: 模型 basename → 声明的纹理名（小写 basename 去扩展名）。
	// texIdxMap 构建时用它查 texOrder 位置分配 texSlot，而非按 modelOrder 序号
	// 截断——避免 plane.json（共用 texture.png）被截断到 arrow.png 槽位。
	modelTexName := make(map[string]string, len(projModels))
	for _, pm := range projModels {
		mp := pm.model
		if idx := strings.LastIndex(mp, "/"); idx >= 0 {
			mp = mp[idx+1:]
		}
		if idx := strings.LastIndex(mp, "\\"); idx >= 0 {
			mp = mp[idx+1:]
		}
		mp = strings.TrimSuffix(strings.TrimSuffix(mp, ".geo.json"), ".json")
		// texName: 小写 basename 去扩展名（收敛自内联，口径与 texBasenameNoExt 同）
		// key 统一小写：查询端 bn 来自 modelOrder（L0 路径已小写），projModel 声明
		// 可能含大写——大小写敏感会让声明纹理名查表 miss → texSlot 绑定失效。
		modelTexName[strings.ToLower(mp)] = texBasenameNoExt(pm.texName)
	}
	if len(modelOrder) > 0 {
		for i, p := range modelOrder {
			p = filepath.ToSlash(p)
			if idx := strings.LastIndex(p, "/"); idx >= 0 {
				p = p[idx+1:]
			}
			bn := strings.ToLower(strings.TrimSuffix(strings.TrimSuffix(p, ".json"), ".geo.json"))
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
	}

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
		// geoName 须先归一化 "\\"→"/" 再取 basename，且统一小写（与 texIdxMap 构建端 bn 同口径）。
		geoName := filepath.ToSlash(gf.name)
		if idx := strings.LastIndex(geoName, "/"); idx >= 0 {
			geoName = geoName[idx+1:]
		}
		geoName = strings.ToLower(strings.TrimSuffix(strings.TrimSuffix(geoName, ".json"), ".geo.json"))
		ti, hasTex := texIdxMap[geoName]
		if hasTex {
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
func parseModelFromEntries(entries []container.Entry, logTag string) (*types.BedrockModel, [][]byte, []string, []geoEntry) {
	logPrefix := "[geometry]"
	if logTag != "zip" {
		logPrefix = logPrefix + " " + logTag
	}

	// maidNs / maidManifest：L0 清单收集（命名空间选择 + 清单提取）已收编 collectMaidManifest
	maidNs, maidManifest := collectMaidManifest(entries, logPrefix)
	// manifest 下标 → 实际解析到的 zip 路径 / 纹理名（resolveL0 填充、SubModels 构建消费）；
	// 由 resolveL0 统一返回非 nil map，无需提前 make
	var resolvedPathByItem map[int]string
	var texNameByItem map[int]string
	var geo *types.BedrockModel
	var pngs [][]byte
	var pngNames []string
	var animJSONs []string
	var ysmMeta types.YsmMetadata // ysm.json metadata 段（return 前挂到 geo）

	// ysm.json 统一解析（结构解码共享；口径后处理留在本函数）。metadata 段单独容错：
	// 失败仅忽略（保持零值不挂载），核心解析不受影响。
	md := parseYsmArchive(entries, logPrefix)
	if len(md.Metadata) > 0 {
		if err := json.Unmarshal(md.Metadata, &ysmMeta); err != nil {
			log.Printf("%s metadata 段解析失败（忽略）: %v", logPrefix, err)
			ysmMeta = types.YsmMetadata{} // 失败即清零：Go json 部分填充会残留非 nil 指针（如 License），防误挂载
		}
	}

	// model/tex 声明序派生（② 阶段）：player 纹理先、投射物后；modelOrder 与 texOrder 同序
	modelOrder, texOrder, texCategories, projModels := deriveModelTexOrder(*md)

	var geoFiles []geoEntry

	// ===== 1.5 L0 清单先行判定（2026-08-26 审查重构）=====
	// 此前顺序是「collectMergedFiles 全量物化 geo+png → resolveL0 判定」，L0 包
	// 白付一次全量 IO+内存后整套丢弃、applyL0ManifestItem 再把清单引用文件重读
	// 一遍。现改为先探清单：hit 只补收动画字符串（轻量，geo/png 不物化），miss
	// 才走全量遍历——geoFiles/pngs/pngNames/modelOrder/texOrder/texCategories
	// 的最终来源与覆盖判定完全不变。
	l0 := resolveL0(entries, maidNs, maidManifest, logPrefix)
	if l0.hit {
		animJSONs = collectAnimEntriesOnly(entries, maidNs)
		geoFiles = l0.geoFiles
		pngs = l0.pngs
		pngNames = l0.pngNames
		modelOrder = l0.modelOrder
		texOrder = l0.texOrder
		texCategories = l0.texCategories
	} else {
		// 遍历收集 geo/动画/纹理（模型版口径；排 arm）已收编 collectMergedFiles
		geoFiles, animJSONs, pngs, pngNames = collectMergedFiles(entries, maidNs)
	}
	resolvedPathByItem = l0.resolvedPathByItem
	texNameByItem = l0.texNameByItem

	// 移除第一人称手臂模型占位：避免 arm.json 占据 texIdx 槽位导致 main 纹理错位
	modelOrder = filterArmModels(modelOrder)

	// geoFiles 声明序排序（已收编 sortByModelOrder）
	sortByModelOrder(geoFiles, modelOrder)

	// 建立模型文件→纹理索引映射并合并骨骼至 bedModel（已收编 mergeGeoFiles）
	geo = mergeGeoFiles(geoFiles, modelOrder, texOrder, projModels)

	// 纹理声明序排序（已收编 sortByTexOrder；orderMap 供 L0 SubModel.TexSlot 按排序后槽位换算）
	orderMap := sortByTexOrder(texOrder, pngs, pngNames)
	// 纹理名与 pngs 同序（同一循环收集 + 同一 orderMap 排序），供前端纹理列表显示
	if geo != nil {
		geo.TextureNames = pngNames

		// texCategories 与 texOrder 同序，需要按 pngNames 排序后的顺序重排
		if len(texCategories) > 0 && len(texOrder) > 0 {
			ordered := make([]string, len(pngNames))
			for i, pn := range pngNames {
				// 在 texOrder 中找到 pngNames[i] 对应的位置，取同位置的 texCategories。
				// texOrder 已小写（475/495 行），pngNames 保留 zip 原始大小写——比较须
				// 大小写不敏感（同函数 958/966 行排序比较器均已 ToLower，此处保持口径一致）。
				lowPn := strings.ToLower(pn)
				for j, tn := range texOrder {
					bn := trimTexExt(tn)
					if bn == lowPn || strings.ToLower(tn) == lowPn {
						if j < len(texCategories) {
							ordered[i] = texCategories[j]
						}
						break
					}
				}
			}
			geo.TextureCategories = ordered
		}

		// SubModels 清单（L0 manifest 优先 → L1 兜底）已收编 buildSubModels
		buildSubModels(geo, maidManifest, resolvedPathByItem, texNameByItem, orderMap, geoFiles, pngs)
	}
	// 顺带返回过滤后的 geoFiles（L0/L1 口径、排 arm）：ParseFromZipEntry 复用同一趟解析
	// 的 geoFiles 做 subPath 匹配，避免二次全量遍历（审核 P3）
	if geo != nil && (ysmMeta.Name != "" || ysmMeta.Tips != "" || len(ysmMeta.Authors) > 0 || ysmMeta.License != nil || len(ysmMeta.Links) > 0) {
		geo.Metadata = &ysmMeta
	}
	if geo != nil {
		geo.FileInventory = classifyFileInventory(entries)
	}
	// 旧格式兜底：无 ysm.json（或 ysm.json 无 metadata）时从 info.json 补元数据
	// （Modern YSM parseLegacyFormat 同口径；已挂 metadata 不覆盖）
	if geo != nil && geo.Metadata == nil {
		geo.Metadata = parseLegacyMetadata(entries)
	}
	return geo, pngs, animJSONs, geoFiles
}

// ParseFromZip 从 ZIP 字节中解析 Bedrock Geometry 并提取纹理和动画。
func ParseFromZip(data []byte, size int64) (*types.BedrockModel, [][]byte, []string) {
	geo, pngs, anims, _ := parseModelFromArchive(data, size, false)
	return geo, pngs, anims
}

// ParseFrom7z 从 7z 字节中解析 Bedrock Geometry 并提取纹理。
func ParseFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte) {
	geo, pngs, _, _ := parseModelFromArchive(data, size, true)
	return geo, pngs
}

// ParseFromZipEntry 按 subPath（zip 内路径，L0 SubModel.SourcePath 口径）解析单个 geometry 文件。
// 不合并多角色 bones，直接返回单角色 BedrockModel；纹理 pngs 仍全量返回（切换角色只是换骨骼，不换纹理集合）。
// 命中失败 → geo=nil。调用方需自行兜底（如回到全量合并解析）。
//
// subPath 匹配策略（与 L0 SubModel.SourcePath 生成口径一致，三层降级命中）：
//  1. 精确（lower + ToSlash）zip entry 路径命中
//  2. 对 subPath 去掉 "assets/<ns>/" 前缀后，再精确/相对命名空间前缀命中
//  3. basename 模糊（去 .json/.geo.json，或只截取 lastSegment 去后缀，按 geoFiles basename 字典取首条）
func ParseFromZipEntry(data []byte, size int64, subPath string) (*types.BedrockModel, [][]byte) {
	return parseFromArchiveEntry(data, size, subPath, false)
}

// ParseFrom7zEntry 对应 ParseFromZipEntry 的 7z 版本；subPath 匹配策略完全一致。
func ParseFrom7zEntry(data []byte, size int64, subPath string) (*types.BedrockModel, [][]byte) {
	return parseFromArchiveEntry(data, size, subPath, true)
}

// matchGeoEntryBySubPath 从 geoFiles 中挑一个匹配 subPath 的条目。
// subPath 为空 → 未命中。匹配策略：exact ToSlash lower → 命名空间相对 → basename（去 json/geo.json）
func matchGeoEntryBySubPath(geoFiles []geoEntry, subPath string) (geoEntry, bool) {
	if subPath == "" {
		return geoEntry{}, false
	}
	sp := strings.ToLower(filepath.ToSlash(subPath))
	// 1) exact full path
	for _, gf := range geoFiles {
		if strings.ToLower(filepath.ToSlash(gf.name)) == sp {
			return gf, true
		}
	}
	// 2) 命名空间前缀剥离（subPath 形如 assets/droneeee/models/entity/x.json
	//    而 geoFiles 里的 name 也可能写绝对路径或不含 assets 前缀的相对路径——
	//    先去掉 assets/<ns>/ 段再互相比对）
	trimAssets := func(p string) string {
		p = strings.ToLower(filepath.ToSlash(p))
		if strings.HasPrefix(p, "assets/") {
			// 截到第二个 "/" 之后（assets/<ns>/xxx → xxx）
			if rest := strings.TrimPrefix(p, "assets/"); strings.Contains(rest, "/") {
				return rest[strings.Index(rest, "/")+1:]
			}
		}
		// 去掉任意首段 "xxx/"（命名空间前缀去头）
		if idx := strings.Index(p, "/"); idx >= 0 && idx+1 < len(p) {
			return p[idx+1:]
		}
		return p
	}
	spRel := trimAssets(sp)
	if spRel != sp {
		for _, gf := range geoFiles {
			if trimAssets(gf.name) == spRel {
				return gf, true
			}
		}
	}
	// 3) basename 模糊：去 .json/.geo.json 后 basename 相等
	geoBase := func(p string) string {
		p = strings.ToLower(filepath.ToSlash(p))
		if idx := strings.LastIndex(p, "/"); idx >= 0 {
			p = p[idx+1:]
		}
		p = strings.TrimSuffix(p, ".geo.json")
		p = strings.TrimSuffix(p, ".json")
		return p
	}
	spBase := geoBase(sp)
	if spBase == "" {
		return geoEntry{}, false
	}
	for _, gf := range geoFiles {
		if geoBase(gf.name) == spBase {
			return gf, true
		}
	}
	return geoEntry{}, false
}

// IsMainModelName 判断模型文件是否为主组件（main.json / main.geo.json）。
// 导出供 wasm 多组件路径（decodeYSMComponentsViaNodeJS）与 zip 路径统一 main 判定口径。
func IsMainModelName(name string) bool {
	return modelBaseName(name) == "main" || modelBaseName(name) == "main.geo"
}

// ParseComponentsFromZip 多组件解析（YSMViewer 式）：zip 内每个模型文件独立组件，
// 含 arm/载具等组件（不合并、不排除）；main 优先排序，perComponent 独立纹理。
// 供 threejs.BuildMulti 生成多组件 spec。
func ParseComponentsFromZip(data []byte, size int64) ([]types.BedrockModel, []string, error) {
	return parseComponentsFromArchive(data, size, false)
}

// parseComponentsFromArchive 多组件解析统一实现（zip/7z）：collectArchiveFiles →
// buildComponents → classifyFileInventory。收敛 ParseComponentsFromZip/7z 的分形双份——
// 8-22 FileInventory 下沉后 collect/build/classify 循环在 zip/7z 各写一遍，改一处漏一处
// 即行为分叉（提交 eghrhegpe 0b1ceec0 以来两次同构累积）。
func parseComponentsFromArchive(data []byte, size int64, sevenZip bool) ([]types.BedrockModel, []string, error) {
	r, err := openArchiveBytes(data, size, sevenZip)
	if err != nil {
		return nil, nil, err
	}
	defer r.Close()
	collected := collectArchiveFiles(r.Entries())
	models, texNames := buildComponents(collected.geoFiles, collected.modelOrder, collected.texOrder, collected.pngs, collected.pngNames, collected.modelTexName)
	// 文件归属清单（只识别不解析）：每个组件挂同一容器清单，前端取任一组件即可得
	inv := classifyFileInventory(r.Entries())
	for i := range models {
		models[i].FileInventory = inv // 值类型 range 副本不写回，须按索引
	}
	return models, texNames, nil
}

// buildComponents 组件化收集：每组件独立纹理（ADR-114 perComponent）。
// cube.TexSlot = 0（每组件用自己的第 0 张），不再全局 texOrder 位置分配。
// ComponentTextures[componentName] = [declaredTexBase64]，前端按组件名查纹理。
func buildComponents(geoFiles []geoEntry, modelOrder, texOrder []string, pngs [][]byte, pngNames []string, modelTexName map[string]string) ([]types.BedrockModel, []string) {
	orderMap, pngNameMap := buildOrderAndPngIndex(modelOrder, pngNames)
	sortGeoFilesMainFirst(geoFiles, orderMap, modelOrder)

	var comps []types.BedrockModel
	// texNames = texArr **期望序**（契约校验：前端 texArr 来自元数据，序 = texOrderNames
	// 优先 + 其余按名；texNames[i] = texArr 第 i 个的期望名 = texOrder[i]，越界用 basename）。
	// 注意：texNames 索引是 texArr 连续索引（与组件解析跳过无关——texArr 来自元数据，
	// 不因组件跳过而收缩）；长度 = 成功组件数，契约比对 Math.min 截断，未解析组件槽位不比对。
	texNames := make([]string, 0, len(geoFiles))
	// ADR-114 perComponent：每组件独立纹理，cube.TexSlot=0（用自己的第 0 张）。
	// texOrder 仅用于查"组件声明的纹理名"，不再作为全局槽位索引。
	// compTex 在循环内创建，避免所有组件共享同一个 map 引用（否则每个组件的
	// ComponentTextures 都会包含所有已处理组件的条目）。
	for _, gf := range geoFiles {
		g := ParseBedrockGeometry(gf.data)
		if g == nil || g.BoneCount == 0 {
			continue
		}
		compName := extractCompName(gf.name)
		isArm := IsArmModelName(gf.name)

		// 查组件声明的纹理名：按 basename 直接查 modelTexName 映射，不再依赖 modelOrder 索引。
		// 修复 wine_fox 根因：texOrder 去重后长度 < modelOrder，按索引查表会错位。
		declaredTexName := resolveComponentTexName(compName, gf.name, modelTexName, pngNameMap, isArm)
		texBase64 := encodeTextureBase64(declaredTexName, pngNameMap, pngs)

		// 每组件 cube.TexSlot=0（perComponent，用自己的第 0 张纹理）
		applyPerComponentTexSlot(g)

		// 填 ComponentTextures[compName] = [texBase64]
		// arm 不填（与 main 共用全局 texArr[0] 皮肤，见 isArm 分支注释）
		compTex := make(map[string][]string)
		if texBase64 != "" && !isArm {
			compTex[compName] = []string{texBase64}
		}

		// texNames[i] = 组件声明的纹理名（无声明用 basename）
		// arm 的 texNames 置空（前端 R1 校验跳过空值，arm 走全局 texArr[0]）
		tn := compName
		if declaredTexName != "" {
			tn = declaredTexName
		}
		if isArm {
			tn = ""
		}
		g.SourceName = compName
		g.ComponentTextures = compTex
		texNames = append(texNames, tn)
		comps = append(comps, *g)
	}
	return comps, texNames
}

// buildOrderAndPngIndex 构建 modelOrder 排序索引和 pngNames 名称索引。
// orderMap：model 的 slash 路径 → 在 modelOrder 中的序号（用于稳定排序）；
// 键统一小写（对齐合并版 sortByModelOrder 双侧 ToLower 口径）：Windows 工具
// 产出的混合大小写条目名未归一化会让声明序静默失效退化为字典序（2026-08-26 审查修复）。
// pngNameMap：纹理名（小写 basename 去扩展名）→ pngs 数组索引
func buildOrderAndPngIndex(modelOrder, pngNames []string) (map[string]int, map[string]int) {
	orderMap := make(map[string]int, len(modelOrder))
	for i, p := range modelOrder {
		orderMap[strings.ToLower(filepath.ToSlash(p))] = i
	}
	pngNameMap := make(map[string]int, len(pngNames))
	for i, n := range pngNames {
		pngNameMap[strings.ToLower(n)] = i
	}
	return orderMap, pngNameMap
}

// sortGeoFilesMainFirst 对 geoFiles 做稳定排序：main 优先 + modelOrder 相对序；
// modelOrder 为空（ysm.json 无 player.model 声明或解析失败）时回退
// IsMainModelName 优先 + 路径字典序——与 WASM 路径同口径（P2）。
func sortGeoFilesMainFirst(geoFiles []geoEntry, orderMap map[string]int, modelOrder []string) {
	sort.SliceStable(geoFiles, func(i, j int) bool {
		mi := IsMainModelName(geoFiles[i].name)
		mj := IsMainModelName(geoFiles[j].name)
		if mi != mj {
			return mi
		}
		if len(modelOrder) > 0 {
			ai, oki := orderMap[strings.ToLower(filepath.ToSlash(geoFiles[i].name))]
			aj, okj := orderMap[strings.ToLower(filepath.ToSlash(geoFiles[j].name))]
			if oki && okj {
				return ai < aj
			}
			if oki != okj {
				return oki
			}
		}
		return geoFiles[i].name < geoFiles[j].name
	})
}

// trimTexExt 去纹理扩展名（.png/.jpg，区分大小写后缀原样剥离）。
// 全文多处「basename 化 + 去扩展」链的公共尾原子；是否 ToLower/basename 由调用点自定。
func trimTexExt(s string) string {
	return strings.TrimSuffix(strings.TrimSuffix(s, ".png"), ".jpg")
}

// extractCompName 从 geoEntry 路径提取组件名（去目录、去 .geo.json/.json 扩展名）。
// 例：models/entity/foxcar.geo.json → foxcar；arm.json → arm
func extractCompName(entryName string) string {
	geoName := filepath.ToSlash(entryName)
	if idx := strings.LastIndex(geoName, "/"); idx >= 0 {
		geoName = geoName[idx+1:]
	}
	return strings.TrimSuffix(strings.TrimSuffix(geoName, ".geo.json"), ".json")
}

// resolveComponentTexName 解析组件声明的纹理名，返回可直接查 pngNameMap 的 key。
// 四级 fallback（按优先级）：
//  1. modelTexName[完整 slash 路径] — ysm.json 精确声明
//  2. modelTexName[compName] — 路径前缀被 strip 时按 basename 兜底
//  3. pngNameMap[compName] — 未声明时同名纹理兜底（对齐 YSMViewer 每组件独立纹理）
//  4. pngNameMap 前缀匹配（_ / - 分隔）— maid_model 多合一包后缀 _1/_2/_3
//
// arm 组件直接返回空串（与 main 共用全局 player.texture，不走 perComponent 纹理）。
// 三叉戟灰根因修复：投射物/子组件未声明纹理时 compTex 曾无条目——本函数第 3 级兜底补上。
func resolveComponentTexName(compName, entryName string, modelTexName map[string]string, pngNameMap map[string]int, isArm bool) string {
	if isArm {
		return ""
	}
	declaredTexName := ""
	if modelTexName != nil {
		declaredTexName = modelTexName[filepath.ToSlash(entryName)]
	}
	// fallback：按 compName 查（path 前缀可能被 strip，如 "models/foxcar.json" → 查不到）
	if declaredTexName == "" && modelTexName != nil {
		declaredTexName = modelTexName[compName]
	}
	if declaredTexName != "" {
		return declaredTexName
	}
	// 未声明纹理的组件：同名 basename 纹理兜底
	if _, ok := pngNameMap[compName]; ok {
		return compName
	}
	// 前缀匹配兜底：maid_model 多合一女仆包纹理名带 _1/_2/_3 后缀
	// （asuma_toki → asuma_toki_1）。候选收集后按字典序取最小——map 迭代序
	// 随机，直接 for-range 首个命中会让同一输入不同运行绑到不同纹理
	// （确定性修复，与 parse.go geometry.* 键选取同口径）
	compLower := strings.ToLower(compName)
	var hits []string
	for pn := range pngNameMap {
		if strings.HasPrefix(pn, compLower+"_") || strings.HasPrefix(pn, compLower+"-") {
			hits = append(hits, pn)
		}
	}
	if len(hits) > 0 {
		sort.Strings(hits)
		return hits[0]
	}
	return ""
}

// encodeTextureBase64 按声明的纹理名查 pngNameMap，找到即编码为 data URL。
// 未命中或 declaredTexName 为空时返回空串。
func encodeTextureBase64(declaredTexName string, pngNameMap map[string]int, pngs [][]byte) string {
	if declaredTexName == "" {
		return ""
	}
	idx, ok := pngNameMap[declaredTexName]
	if !ok || idx >= len(pngs) {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngs[idx])
}

// applyPerComponentTexSlot 把模型内所有 cube 的 TexSlot 置 0（ADR-114 perComponent：
// 每组件用自己的第 0 张纹理），同时把 CubeTexW/CubeTexH 对齐模型级尺寸。
func applyPerComponentTexSlot(g *types.BedrockModel) {
	for bi := range g.Bones {
		for ci := range g.Bones[bi].Cubes {
			g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
			g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
			g.Bones[bi].Cubes[ci].TexSlot = 0
		}
	}
}

// ParseComponentsFrom7z 多组件解析（7z 版）：与 ParseComponentsFromZip 同构，
// 复用 parseComponentsFromArchive（含 arm、main 优先、perComponent 独立纹理）。
func ParseComponentsFrom7z(data []byte, size int64) ([]types.BedrockModel, []string, error) {
	return parseComponentsFromArchive(data, size, true)
}

// ===== zip/7z 双份路径收敛（8-22 功能冲刺遗留的分形重复）=====
// 六入口原先各写 OpenZipBytes/Open7zBytes，7z 失败日志也双份；FileInventory/SubModels/
// projectiles 每上新功能都要 zip/7z 各改一遍。收敛后单一打开点 + 单一实现，改 bug 只改一处。

// openArchiveBytes 统一 zip/7z 字节打开；7z 失败保留日志（对齐历史 ParseFrom7z/Entry 口径）。
func openArchiveBytes(data []byte, size int64, sevenZip bool) (container.Reader, error) {
	if sevenZip {
		r, err := container.Open7zBytes(data, size)
		if err != nil {
			log.Printf("[geometry] 打开 7z 失败: %v", err)
			return nil, err
		}
		return r, nil
	}
	return container.OpenZipBytes(data, size)
}

// archiveLogTag 供 parseModelFromEntries 的 logTag 参数：zip/7z 版统一口径。
func archiveLogTag(sevenZip bool) string {
	if sevenZip {
		return "7z"
	}
	return "zip"
}

// parseModelFromArchive 单模型合并解析统一实现（zip/7z）：open + parseModelFromEntries。
// 返回 (geo, pngs, animJSONs, 过滤后 geoFiles)；ParseFromZip 消费前三者，
// ParseFromZipEntry 复用第 4 位 geoFiles 做 subPath 匹配——签名各自不变。
func parseModelFromArchive(data []byte, size int64, sevenZip bool) (*types.BedrockModel, [][]byte, []string, []geoEntry) {
	r, err := openArchiveBytes(data, size, sevenZip)
	if err != nil {
		return nil, nil, nil, nil
	}
	defer r.Close()
	return parseModelFromEntries(r.Entries(), archiveLogTag(sevenZip))
}

// parseFromArchiveEntry 单角色按 subPath 解析统一实现（zip/7z）：open + parseModelFromEntries
// 一趟拿 pngs + 过滤后 geoFiles（不再二次 collectArchiveFiles，审核 P3），再 matchGeoEntryBySubPath。
func parseFromArchiveEntry(data []byte, size int64, subPath string, sevenZip bool) (*types.BedrockModel, [][]byte) {
	if subPath == "" {
		return nil, nil
	}
	r, err := openArchiveBytes(data, size, sevenZip)
	if err != nil {
		return nil, nil
	}
	defer r.Close()
	entries := r.Entries()
	// PNG 全量须与 ParseFromZip 同口径：L0 清单过滤（否则 SubModel.TexSlot = i 会指错纹理数组下标）。
	_, pngs, _, geoFiles := parseModelFromEntries(entries, archiveLogTag(sevenZip))
	if len(geoFiles) == 0 {
		return nil, pngs
	}
	if gf, ok := matchGeoEntryBySubPath(geoFiles, subPath); ok {
		g := ParseBedrockGeometry(gf.data)
		if g != nil {
			return g, pngs
		}
	}
	return nil, pngs
}
