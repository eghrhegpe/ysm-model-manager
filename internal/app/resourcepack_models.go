// ===== 资源包 block/item 模型读取绑定（ADR-080 PackModelAdapter）=====
// ListPackModels 枚举容器内模型 JSON 条目；ReadPackEntry 读单条目内容（base64）。
// 复用 container.Reader（ADR-068），统一支持 .zip / 目录 / .7z。

package app

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"sort"
	"strings"

	"ysm-model-manager/go/container"
)

// maxPackEntrySize 单条目读取上限（64MB）：模型 JSON 远小于此，纹理 PNG 亦足够。
const maxPackEntrySize = 64 << 20

// packModelDetailCap 模型清单封顶条数（防大包：数百+ 模型时只解析前 N 条立方体数，
// total 报告全量；前端清单懒加载，超限只显示 total）。
const packModelDetailCap = 200

// PackModelDetail 单模型清单项（path + 立方体数，供详情页模型清单区）。
// Path 为容器内条目路径（升序）；Cubes = JSON elements 数组长度（无 elements 为 0）。
type PackModelDetail struct {
	Path  string `json:"path"`
	Cubes int    `json:"cubes"`
}

// packModelElementsCount 数 JSON 模型 elements 数组长度（Java block/item model：
// 每个 element 一个立方体；无 elements（纯 parent 模板如 cube_all）为 0）。
func packModelElementsCount(data []byte) int {
	var m struct {
		Elements []json.RawMessage `json:"elements"`
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return 0
	}
	return len(m.Elements)
}

// packModelEntryMatch 判定条目是否为 block/item 模型 JSON：
// assets/<ns>/models/{block,item}/**/*.json（含子目录，如 door/fence_gate）
func packModelEntryMatch(name string) bool {
	n := strings.ToLower(name)
	if !strings.HasPrefix(n, "assets/") || !strings.HasSuffix(n, ".json") {
		return false
	}
	idx := strings.Index(n, "/models/")
	if idx < 0 {
		return false
	}
	rest := n[idx+len("/models/"):]
	return strings.HasPrefix(rest, "block/") || strings.HasPrefix(rest, "item/")
}

// packEntrySafe 条目路径守卫：必须 assets/ 开头，禁止 .. / 反斜杠 / 绝对路径（防穿越）。
func packEntrySafe(name string) bool {
	n := strings.ToLower(name)
	if !strings.HasPrefix(n, "assets/") {
		return false
	}
	if strings.Contains(n, "..") || strings.Contains(n, "\\") || strings.HasPrefix(n, "/") {
		return false
	}
	return true
}

// ListPackModels 枚举资源包容器内的 block/item 模型 JSON 条目路径（升序）。
// 失败或无模型返回 "[]"（前端据此回退缩略图通道）。
func (a *App) ListPackModels(path string) string {
	r, err := container.Open(path)
	if err != nil {
		log.Printf("[packs] ListPackModels 打开失败 %s: %v", path, err)
		return "[]"
	}
	defer r.Close()
	seen := map[string]bool{}
	var out []string
	for _, e := range r.Entries() {
		if e.IsDir() {
			continue
		}
		n := e.Name()
		if packModelEntryMatch(n) && !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	sort.Strings(out)
	return marshalJSON("ListPackModels", out, "[]")
}

// ListPackModelsDetail 枚举资源包容器内的 block/item 模型（升序）+ 立方体数（elements 长度）。
// 失败或无模型返回 {"models":[],"total":0}。封顶前 packModelDetailCap 条带 cubes（防大包
// 全量解析），total 报告全量模型数——前端超限只显示 total。跨类型路由：详情页模型清单区
// 经此一屏拿到「路径 + 立方体数」，点击单模型直达 pack-model-adapter 3D（ADR-131 P3）。
func (a *App) ListPackModelsDetail(path string) string {
	r, err := container.Open(path)
	if err != nil {
		log.Printf("[packs] ListPackModelsDetail 打开失败 %s: %v", path, err)
		return marshalJSON("ListPackModelsDetail", packDetailList{Models: []PackModelDetail{}}, "{}")
	}
	defer r.Close()
	seen := map[string]bool{}
	// 单次遍历同时收集「全量清单」与「name→entry 索引」：cubes 解析直取句柄，
	// 避免每条模型全量重扫 Entries（O(models×entries) → O(entries)）。
	byName := map[string]container.Entry{}
	var all []string
	for _, e := range r.Entries() {
		if e.IsDir() {
			continue
		}
		n := e.Name()
		if packModelEntryMatch(n) && !seen[n] {
			seen[n] = true
			all = append(all, n)
			byName[n] = e
		}
	}
	sort.Strings(all)
	out := packDetailList{Total: len(all)}
	if len(all) > packModelDetailCap {
		all = all[:packModelDetailCap]
	}
	out.Models = make([]PackModelDetail, 0, len(all))
	for _, n := range all {
		cubes := 0
		if data := readPackEntry(byName[n]); len(data) > 0 {
			cubes = packModelElementsCount(data)
		}
		out.Models = append(out.Models, PackModelDetail{Path: n, Cubes: cubes})
	}
	return marshalJSON("ListPackModelsDetail", out, "{}")
}

// packDetailList ListPackModelsDetail 返回值。
type packDetailList struct {
	Models []PackModelDetail `json:"models"`
	Total  int               `json:"total"`
}

// readPackEntry 读取已解析的容器条目原始字节（packEntrySafe 守卫复用 ReadPackEntry 口径；
// entry 来自 ListPackModelsDetail 单次遍历的 byName 索引，O(1) 直取，不再全量重扫）。
// 返回 nil 表示条目非法/读取失败/超限。
func readPackEntry(e container.Entry) []byte {
	if !packEntrySafe(e.Name()) {
		return nil
	}
	rc, err := e.Open()
	if err != nil {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(rc, maxPackEntrySize))
	rc.Close()
	if err != nil {
		return nil
	}
	return data
}

// ReadPackEntry 读取容器内条目内容（base64 字符串）。
// entry 非法/缺失/超限返回空串（前端渲染兜底跳过）。
func (a *App) ReadPackEntry(path, entry string) string {
	if !packEntrySafe(entry) {
		log.Printf("[packs] ReadPackEntry 非法条目 %q", entry)
		return ""
	}
	r, err := container.Open(path)
	if err != nil {
		log.Printf("[packs] ReadPackEntry 打开失败 %s: %v", path, err)
		return ""
	}
	defer r.Close()
	for _, e := range r.Entries() {
		if e.IsDir() || !strings.EqualFold(e.Name(), entry) {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			return ""
		}
		data, err := io.ReadAll(io.LimitReader(rc, maxPackEntrySize))
		rc.Close()
		if err != nil {
			log.Printf("[packs] ReadPackEntry 读取失败 %s/%s: %v", path, entry, err)
			return ""
		}
		return base64.StdEncoding.EncodeToString(data)
	}
	log.Printf("[packs] ReadPackEntry 条目不存在 %s/%s", path, entry)
	return ""
}
