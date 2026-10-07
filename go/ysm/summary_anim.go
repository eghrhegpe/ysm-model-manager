// summary_anim.go：YSM 摘要动画组构建（原 summary.go 拆分，2026-10 文件行数治理）。
// appendAnimGroupsAndConfigs / buildAnimGroup / buildLooseAnimGroup / collectClassifiedItemKeys /
// collectLooseAnimKeys——from ysm.json 的 animClassify/expression 构建 AnimGroup 列表。
package ysm

import (
	"encoding/json"
	"sort"
	"strings"
)

func appendAnimGroupsAndConfigs(root *ysmRoot, summary *YsmSummary) {
	if root.Properties == nil {
		return
	}
	props := root.Properties

	// 动画分组（extra_animation_classify）
	for _, g := range props.ExtraAnimClassify {
		if group, ok := buildAnimGroup(props, g); ok {
			summary.AnimGroups = append(summary.AnimGroups, group)
		}
	}

	// 兜底：extra_animation 中未被分类的直接动画（非 # 开头的值）
	if group, ok := buildLooseAnimGroup(props); ok {
		summary.AnimGroups = append(summary.AnimGroups, group)
	}

	// 配置菜单（extra_animation_buttons → 模型配置/自定义表情）
	for _, b := range props.ExtraAnimButtons {
		summary.ConfigMenus = append(summary.ConfigMenus, ConfigMenu{
			ID:       b.ID,
			Name:     b.Name,
			Controls: extractControlTypes(b.ConfigForms),
		})
	}
}

// buildAnimGroup 构造单个「其他动画」分组。返回 ok=false 表示该组项全是内部引用
// （# 开头）——此时不产出空组，整组跳过。
func buildAnimGroup(props *ysmProperties, g ysmAnimClassify) (AnimGroup, bool) {
	// 用 extra_animation 的 value（中文名）替换 raw id
	var displayItems []string
	if len(g.ExtraAnimation) > 0 {
		displayItems = extractDisplayValues(g.ExtraAnimation)
	}
	if len(displayItems) == 0 {
		return AnimGroup{}, false
	}
	return AnimGroup{
		ID:    g.ID,
		Name:  resolveAnimGroupName(props, g),
		Items: displayItems,
	}, true
}

// resolveAnimGroupName 取分组显示名：name 为空时从 properties.extra_animation 中
// 按 "#"+id 查找中文名，查不到保持空串（原逻辑，纯解析无副作用）。
func resolveAnimGroupName(props *ysmProperties, g ysmAnimClassify) string {
	if g.Name != "" || len(props.ExtraAnimation) == 0 {
		return g.Name
	}
	var eaMap map[string]interface{}
	if json.Unmarshal(props.ExtraAnimation, &eaMap) != nil {
		return g.Name
	}
	if s, ok := eaMap["#"+g.ID].(string); ok {
		return s
	}
	return g.Name
}

// buildLooseAnimGroup 兜底组：extra_animation 中未被任何分组分类的直接动画。
// 无候选时不产出组（避免面板出现空的「其他动画」）。
func buildLooseAnimGroup(props *ysmProperties) (AnimGroup, bool) {
	if len(props.ExtraAnimation) == 0 {
		return AnimGroup{}, false
	}
	var eaMap map[string]interface{}
	_ = json.Unmarshal(props.ExtraAnimation, &eaMap) // 非法形态 → nil map，range 零次迭代安全跳过
	looseKeys := collectLooseAnimKeys(eaMap, collectClassifiedItemKeys(props))
	if len(looseKeys) == 0 {
		return AnimGroup{}, false
	}
	looseAnims := make([]string, 0, len(looseKeys))
	for _, k := range looseKeys {
		looseAnims = append(looseAnims, eaMap[k].(string))
	}
	return AnimGroup{ID: "_loose", Name: "其他动画", Items: looseAnims}, true
}

// collectClassifiedItemKeys 汇总已被各分组声明的动画键，供 loose 兜底去重——
// 同一动画不得既出现在分类组又重复出现在「其他动画」里。
func collectClassifiedItemKeys(props *ysmProperties) map[string]bool {
	classifiedItems := make(map[string]bool)
	for _, g := range props.ExtraAnimClassify {
		if len(g.ExtraAnimation) == 0 {
			continue
		}
		for k := range extractKeySet(g.ExtraAnimation) {
			classifiedItems[k] = true
		}
	}
	return classifiedItems
}

// collectLooseAnimKeys 收集「未分类的直接动画」键并排序返回。
// 计算属性：跳过 # 前缀的内部引用键、已分类键、非字符串值、空值与 # 开头的值。
// 按键排序：map 遍历序不定，固定顺序防 parity golden 对账 flaky（同 commit dfa190b8 已修过同款）。
func collectLooseAnimKeys(eaMap map[string]interface{}, classifiedItems map[string]bool) []string {
	var looseKeys []string
	for k := range eaMap {
		if strings.HasPrefix(k, "#") {
			continue
		}
		if classifiedItems[k] {
			continue
		}
		if _, ok := eaMap[k].(string); !ok {
			continue
		}
		s := eaMap[k].(string)
		if s == "" || strings.HasPrefix(s, "#") {
			continue
		}
		looseKeys = append(looseKeys, k)
	}
	sort.Strings(looseKeys)
	return looseKeys
}

// ===== 辅助函数 =====
