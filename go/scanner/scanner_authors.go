// scanner_authors.go：作者提取与聚合（原 scanner.go 拆分，2026-10 文件行数治理）。
// stripDisableSuffix / extractAuthor / ListModelAuthors / ScanLocalAuthors / mergeOrAppendCreator——
// 从 Lite 扫描结果中提取作者名，聚合成 WorkshopCreator 列表。
package scanner

import (
	"sort"
	"strings"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

func stripDisableSuffix(name string) string {
	return registry.StripDisableSuffix(name)
}

// extractAuthor 从文件名提取 [作者] 前缀（无前缀或格式非法返回空串）
func extractAuthor(name string) string {
	name = stripDisableSuffix(name)
	if !strings.HasPrefix(name, "[") {
		return ""
	}
	idx := strings.Index(name, "]")
	if idx <= 0 {
		return ""
	}
	author := name[1:idx]
	if author == "" {
		return ""
	}
	return author
}

// ListModelAuthors 从扫描条目提取 [作者] 前缀统计（按出现次数降序）
func ListModelAuthors(entries []types.ModelEntry) []types.AuthorInfo {
	type authorData struct {
		Count      int
		SampleFile string
	}
	authors := map[string]*authorData{}
	for _, e := range entries {
		if author := extractAuthor(e.Name); author != "" {
			if _, ok := authors[author]; !ok {
				authors[author] = &authorData{SampleFile: e.Path}
			}
			authors[author].Count++
		}
	}
	var result []types.AuthorInfo
	for name, ad := range authors {
		result = append(result, types.AuthorInfo{Name: name, Count: ad.Count, SampleFile: ad.SampleFile})
	}
	// SliceStable + Name 兜底：count 并列时输出顺序确定（与 ScanLocalAuthors 的
	// rtype 字典序遍历口径一致，防同输入不同输出）
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Count != result[j].Count {
			return result[i].Count > result[j].Count
		}
		return result[i].Name < result[j].Name
	})
	return result
}

// ScanLocalAuthors 扫描各资源类型根目录，从文件名提取 [作者]（roots: rtype→root）
func ScanLocalAuthors(roots map[string]string) []types.WorkshopCreator {
	seen := map[string]bool{}
	// nameIndex 作者名 → result 下标，O(1) 定位同名 creator，避免 mergeOrAppendCreator
	// 每次线性扫描（O(作者数×文件数) 随仓库规模二次放大，大库首屏作者提取热路径）。
	nameIndex := map[string]int{}
	var result []types.WorkshopCreator

	// roots 为 map，迭代序随机会导致跨类型合并的 Type 拼接顺序不稳定
	// （同输入不同输出，flaky 测试/缓存/UI 展示均受影响）——按 rtype 字典序遍历保证确定性
	rtypes := sortedRTypeKeys(roots)

	for _, rtype := range rtypes {
		root := roots[rtype]
		if root == "" {
			continue
		}
		// 轻量遍历：作者提取只看文件名，跳过 Info+哈希（大库冷扫主瓶颈，见 ScanEntriesLite）
		entries := ScanEntriesLite(root)
		for _, e := range entries {
			author := extractAuthor(e.Name)
			if author == "" {
				continue
			}
			mergeOrAppendCreator(&result, author, rtype, seen, nameIndex)
		}
	}
	return result
}

// sortedRTypeKeys 返回按字典序排序的 rtype 键列表，保证遍历确定性。
// 空 roots 返回 nil（range 零步循环，不影响结果）。
func sortedRTypeKeys(roots map[string]string) []string {
	rtypes := make([]string, 0, len(roots))
	for rtype := range roots {
		rtypes = append(rtypes, rtype)
	}
	sort.Strings(rtypes)
	return rtypes
}

// mergeOrAppendCreator 把 (author, rtype) 对合并进 result。seen 为 author@rtype 去重表，
// 已见过直接跳过；未见过则在 result 中找同名 creator：找到则追加 rtype 标签（按 ";" 分段精确
// 比较，防 rtype 子串关系误判），找不到则 append 新 WorkshopCreator。
// nameIndex 作者名 → result 下标，O(1) 定位同名 creator（替代原线性扫描，避免大库首屏
// 作者提取路径 O(作者数×文件数) 二次放大）。seen 已保证同 (author,rtype) 只到一次，
// 故 nameIndex 命中即代表该 author 的首条 creator 已存在，直接复用其下标追加 type。
func mergeOrAppendCreator(result *[]types.WorkshopCreator, author, rtype string, seen map[string]bool, nameIndex map[string]int) {
	key := author + "@" + rtype
	if seen[key] {
		return
	}
	seen[key] = true
	// 合并已有的 type 标签（O(1) 定位同名 creator）
	if existing, ok := nameIndex[author]; ok {
		// 追加类型标签（按 ";" 分段精确比较，防 rtype 子串关系误判，防御范式③）
		for _, seg := range strings.Split((*result)[existing].Type, ";") {
			if seg == rtype {
				return
			}
		}
		(*result)[existing].Type += ";" + rtype
		return
	}
	idx := len(*result)
	*result = append(*result, types.WorkshopCreator{
		Name: author,
		// Desc 留空（不写「来自本地仓库」这类界面文案）：本结果会被前端并入创作者列表，
		// 语言串进数据面即随 SaveWorkshopCreatorsBySite 落盘，且写死中文会让 en/ja 用户看到
		// 中文。展示层按 _fromLocal 标记取当前语言（锐评 P0-2 治本，web 侧 web-community.ts 同口径）。
		Desc: "",
		Type: rtype,
	})
	nameIndex[author] = idx
}
