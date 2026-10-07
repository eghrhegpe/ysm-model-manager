// archive_collect.go：压缩包内条目合并收集与排序（原 archive.go 二次拆分，2026-10 文件行数治理）。
// collectMergedFiles / mergedCollector / mergedJSONAccepted / mergedTextureRejected /
// sortByModelOrder / sortByTexOrder——按 maid 命名空间把 zip 内几何/动画/纹理归并到合并收集器。
package geometry

import (
	"log"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types/registry"
)

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
