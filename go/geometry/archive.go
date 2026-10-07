// ===== 从压缩包中提取并解析 Bedrock Geometry =====
// 支持 ZIP（YSM 标准格式）和 7z 格式。容器打开统一走 go/container（ADR-068）。
// 2026-10 拆分：原 1373 行按职责分为 archive.go（本文件：基础工具 + 文件收集 + 排序）/
// archive_merge.go（模型合并）/ archive_parse.go（主解析入口 + zip/7z 收敛）/ archive_components.go（多组件解析）。
package geometry

import (
	"encoding/json"
	"log"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// maxExtractSize 单个文件最大读取大小（ZIP/7z 内文件），防止 ZIP 炸弹
// 共享 registry.MaxReadLimit（索引 6.7+5.2，与 fileops/ysm 的 50MB 上限单点）
const maxExtractSize = registry.MaxReadLimit

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
	return strings.TrimSuffix(baseName(strings.ToLower(name)), ".json")
}

// baseName 去路径分隔符（/ 与 \ 兼容）取文件基名。全文 basename 剥离的公共原子：
// modelBaseName / texBasenameNoExt / compBaseName / collectMergedFiles / collectPngEntries 等
// 均复用，原 collectPngEntries / collectMergedFiles 各抄一份逐字相同的剥离块已收敛。
// 注：extractFirstPNG 不调本函数（它用 strings.ContainsAny 检测根目录，非 basename 剥离）。
func baseName(name string) string {
	if idx := strings.LastIndexAny(name, "/\\"); idx >= 0 {
		return name[idx+1:]
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
		if !strings.ContainsAny(name, "/\\") && slices.Contains(coverCandidateNames, name) {
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
	defer func() { _ = rc.Close() }()
	return fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
}

// ExtractFirstPNGFromZip 从 ZIP 中提取第一张 PNG 图片（用于快速预览）
func ExtractFirstPNGFromZip(data []byte, size int64) []byte {
	r, err := container.OpenZipBytes(data, size)
	if err != nil {
		return nil
	}
	defer func() { _ = r.Close() }()
	return extractFirstPNG(r)
}

// ExtractFirstPNGFrom7z 从 7z 中提取第一张 PNG 图片（用于快速预览）
func ExtractFirstPNGFrom7z(data []byte, size int64) []byte {
	r, err := container.Open7zBytes(data, size)
	if err != nil {
		return nil
	}
	defer func() { _ = r.Close() }()
	return extractFirstPNG(r)
}

type geoEntry struct {
	name string
	data []byte
}

// subModelCtx 封装 buildSubModels 的上下文参数，避免 7 参数堆叠。
// L0 来源：maidManifest + resolvedPathByItem + texNameByItem（来自 l0Resolved）
// L1 来源：geoFiles + pngs（来自 l0Resolved 或 collectMergedFiles）
// orderMap 由 sortByTexOrder 在调用前填充，buildSubModels 内部读取。
type subModelCtx struct {
	maidManifest       []maidManifestItem
	resolvedPathByItem map[int]string
	texNameByItem      map[int]string
	orderMap           map[string]int
	geoFiles           []geoEntry
	pngs               [][]byte
}

// classifyFileInventory 识别 zip 内所有文件的归属（parseGlobalResources 轻量版：
// 只识别不解析，Go 端承担文件识别能力，前端消费准确归属清单，不再事后按文件名猜）。
// 纯新增能力，不改变既有收集（animJSONs/pngs 等数组内容不动，零 fallback 干扰）。
// maxClassifyEntries classifyFileInventory 的条目数封顶。
// 恶意归档塞入数十万微小条目可导致 FileInventory 占用数 GB 内存。
// 10000 条对正常 YSM 包绰绰有余（典型包 <500 条），超限即停止并标记不完整。
const maxClassifyEntries = 10000

// maxMaterializeEntries / maxMaterializeBytes 物化循环的条目/累计字节双封顶
// 防恶意归档塞数十万微小条目占数 GB 内存（collectPngEntries/collectGeoAnimEntries/
// collectMergedFiles/collectAnimJSONs 把每条 PNG/geo 物化进内存，需条目+字节双封顶）。
// 正常 YSM 包条目 <500、
// 纹理累计 <100MB，5000 条 / 512MB 上限绰绰有余；超限截断并留日志（畸形输入
// 防御，合法包不触发）。截断仅作用于当次物化集合，不影响既有收集结构。
const (
	maxMaterializeEntries = 5000
	maxMaterializeBytes   = 512 << 20
)

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
		case strings.HasSuffix(low, ".json") && !registry.IsYsmEntryJSON(filepath.Base(e.Name())) && isLegacyGeometryName(low):
			inv.LegacyModels = append(inv.LegacyModels, e.Name())
			appended = true
		}
		// 仅计 matched 条目，避免 10000 个 .bin 垃圾条目耗尽配额
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
// 与 IsMainModelName/IsArmModelName 同口径（main.geo.json 等会被当 geometry 解析但此前漏分类）；
// package-level 避免 per-entry 重建分配。
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
		// （textures/skin_info.json、assets/<ns>/info.json 等）不参与
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
		// 空占位（{}）不 return——继续找后续候选；一个空 info.json 不得抑制同 archive 中其他有效候选
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
		tn := playerTexBasename(t)
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
//
// 2026-10 拆解：原单函数 32 复杂度按「条目分派 / 准入过滤 / 三条物化通道」切成
// mergedCollector 游标 + 具名 helper。条目枚举序、过滤先后（命名空间过滤先于 Open）、
// 三条通道的封顶 break 语义逐条不变——只搬移，不改判据。
func collectMergedFiles(entries []container.Entry, maidNs string) (geoFiles []geoEntry, animJSONs []string, pngs [][]byte, pngNames []string) {
	c := &mergedCollector{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		c.collectMergedEntry(e, maidNs)
		if c.stop {
			// 原实现在条目循环里直接 break：三条通道任一触顶即整体停止，
			// 后续条目（含纹理）一律不再收——语义由游标带出，勿改成只跳单通道。
			break
		}
	}
	return c.geoFiles, c.animJSONs, c.pngs, c.pngNames
}

// mergedCollector 合并版收集游标：三个物化集合 + geo/纹理共用的 totalBytes 与
// 动画独立的 animBytes 两个累计计数。stop 承载原 `break` 语义——若把 break 写进
// switch case，它只跳 switch 不跳条目循环（经典陷阱），故用游标显式带出。
type mergedCollector struct {
	geoFiles   []geoEntry
	animJSONs  []string
	pngs       [][]byte
	pngNames   []string
	totalBytes int64
	animBytes  int64
	stop       bool
}

// collectMergedEntry 单条目分派：.json 走「动画/控制器 vs geometry」二选一，
// 纹理（.png/.jpg）走独立通道。两条互斥（同一条目名不可能既是 .json 又是 .png），
// 与原实现「两个并列 if + 各自 !e.IsDir() 卫语句」等价（目录已在调用点前置跳过）。
func (c *mergedCollector) collectMergedEntry(e container.Entry, maidNs string) {
	low := strings.ToLower(e.Name())
	switch {
	case strings.HasSuffix(low, ".json"):
		if !mergedJSONAccepted(low, maidNs) {
			return
		}
		if strings.Contains(low, "animation") || strings.Contains(low, "controller") {
			c.appendMergedAnimJSON(e)
			return
		}
		c.appendMergedGeoFile(e)
	case strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg"):
		if mergedTextureRejected(low, maidNs) {
			return
		}
		c.appendMergedTexture(e)
	}
}

// mergedJSONAccepted .json 条目的合并版准入裁决（返回 false 即不 Open、不入列）：
//   - YSM 入口清单 ysm.json 不参与合并收集。判定走 IsYsmEntryJSON（EqualFold），
//     故对已小写化的条目名取 basename 与对原名取 basename 等价（YSM.JSON 同样被拒）。
//   - maidNs 非空时只收首个命名空间，并排除三份女仆清单
//     （maid_model / maid_chair / maid_sound）——过滤先于 Open，被拒条目无 reader 泄漏。
func mergedJSONAccepted(low, maidNs string) bool {
	if registry.IsYsmEntryJSON(filepath.Base(low)) {
		return false
	}
	if maidNs == "" {
		return true
	}
	if !strings.HasPrefix(low, maidNs) {
		return false
	}
	return !strings.HasSuffix(low, "maid_model.json") &&
		!strings.HasSuffix(low, "maid_chair.json") &&
		!strings.HasSuffix(low, "maid_sound.json")
}

// mergedTextureRejected 纹理条目的合并版排除：avatar/ 与 gui/ 路径（头像/预览图）
// + maidNs 非空时的非首个命名空间。
func mergedTextureRejected(low, maidNs string) bool {
	if strings.Contains(low, "avatar/") || strings.Contains(low, "gui/") {
		return true
	}
	return maidNs != "" && !strings.HasPrefix(low, maidNs)
}

// appendMergedAnimJSON 动画/控制器 JSON 物化。ADR-033 陷阱：必须走
// fsutil.ReadLimitedEntry（+1 探测，超限返回 nil 即跳过），不得退回
// io.ReadAll(io.LimitReader)——恰好 50MB 的条目会被截断后静默下发。len(buf) > 2 为原判据。
func (c *mergedCollector) appendMergedAnimJSON(e container.Entry) {
	rc, err := e.Open()
	if err != nil {
		return
	}
	buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
	if len(buf) <= 2 {
		return
	}
	c.animJSONs = append(c.animJSONs, string(buf))
	c.animBytes += int64(len(buf))
	// 条目/累计字节双封顶：与 collectPngEntries 同构
	if len(c.animJSONs) >= maxMaterializeEntries || c.animBytes >= maxMaterializeBytes {
		log.Printf("[geometry] collectMergedFiles 动画达到物化封顶 (entries=%d bytes=%d), 截断", len(c.animJSONs), c.animBytes)
		c.stop = true
	}
}

// appendMergedGeoFile geometry JSON 物化。IsArmModelName 判定置于 Open+Read 之后
// （保持原序，勿"顺手优化"成先判断再读）：排除第一人称手臂模型 arm.json，它与 main
// 的手臂几何重叠会渲染成双手臂。nil/空 buf 不占物化槽位（F-4 防御）。
func (c *mergedCollector) appendMergedGeoFile(e container.Entry) {
	rc, err := e.Open()
	if err != nil {
		return
	}
	buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
	if len(buf) == 0 {
		return // nil/空 buf 不占物化槽位（F-4 防御）
	}
	if IsArmModelName(e.Name()) {
		return // 排除第一人称手臂模型 arm.json（与 main 手臂重叠 → 双手臂）
	}
	c.geoFiles = append(c.geoFiles, geoEntry{name: e.Name(), data: buf})
	c.totalBytes += int64(len(buf))
	if len(c.geoFiles) >= maxMaterializeEntries || c.totalBytes >= maxMaterializeBytes {
		log.Printf("[geometry] collectMergedFiles geo 达到物化封顶 (entries=%d bytes=%d), 截断", len(c.geoFiles), c.totalBytes)
		c.stop = true
	}
}

// appendMergedTexture 纹理物化：与 .ysm 解压路径口径对齐——不按尺寸过滤小纹理
// （64×64 合法贴图可 <4KB），头像/预览图仅由 avatar/ 与 gui/ 路径排除
// （见 mergedTextureRejected），不靠尺寸阈值。
func (c *mergedCollector) appendMergedTexture(e container.Entry) {
	rc, err := e.Open()
	if err != nil {
		return
	}
	pngData := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
	if len(pngData) == 0 {
		return
	}
	pngNames := baseName(e.Name())
	c.pngNames = append(c.pngNames, trimTexExt(pngNames))
	c.pngs = append(c.pngs, pngData)
	c.totalBytes += int64(len(pngData))
	if len(c.pngs) >= maxMaterializeEntries || c.totalBytes >= maxMaterializeBytes {
		log.Printf("[geometry] collectMergedFiles 纹理达到物化封顶 (entries=%d bytes=%d), 截断", len(c.pngs), c.totalBytes)
		c.stop = true
	}
}

// sortByModelOrder 将 geoFiles 按声明序排序：main/player 模型先、投射物后，未声明项稳定落尾。
// 查询键与 orderMap 键同口径（"\\"→"/" 归一化 + 小写化）：Windows 工具产出的条目名可能
// 含反斜杠/混合大小写，未归一化会让声明序排序失效。
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
	// 注意：pngNames 与 pngs 同步被本 less 排序，预计算小写 key 会随元素位移失同步，
	// 必须每次比较实时 strings.ToLower(pngNames[i])（正确优先于微优化）。
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
