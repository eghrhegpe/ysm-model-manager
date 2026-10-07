// maid_l0_manifest.go：maiden manifest 收集与候选选择（原 maid_l0.go 拆分，2026-10 文件行数治理）。
// collectMaidManifest / parseMaidModelJSON / pickBestMaidGroup / selectBestMaidCandidate——
// 从 zip 内 maid.json / manifest 中挑选命名空间与最佳 maid 组。
package geometry

import (
	"encoding/json"
	"log"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
)

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
	// 空切片保护，避免 candidates[0] panic
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
