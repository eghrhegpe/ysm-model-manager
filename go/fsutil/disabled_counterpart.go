// disabled_counterpart.go：路径「禁用孪生形态」谓词——与 relink_backup.go 同族
// （路径形态判定收在 fsutil，供 go/instance 与 go/sync 共用，禁止各包内联拼后缀）。
// 后缀表归 go/types/registry（单一事实源）；依赖方向 fsutil → registry 无环（registry 不引 fsutil）。
//
// 全部谓词都**限定目录**（孪生必须是目录）：目录粒度启禁（模型夹 X/ ↔ X.disabled/）是
// 「整夹改名」，与同名杂散**文件**（恰好叫 X.disabled）不是一回事——按杂散文件把活跃夹
// 整夹改名/拒绝推送是数据事故（复核 P2-1 实证）。
package fsutil

import (
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/types/registry"
)

// pathExists 存在性判定（文件或目录）。
func pathExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// dirExists 目录判定（文件不算：杂散同名文件不得当禁用载体）。
func dirExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
}

// DisabledTwinForms 一次报告 path 的两种**目录**形态（并发/重复探测的单一入口）：
//   - activeOK：path 自身是目录（活跃形态）
//   - twin/twinOK：path+禁用后缀（.disabled 优先、.ban 兼容）是目录（禁用载体形态）
//
// 两个布尔**互相独立**——这正是复核 P1-1 的教训：把「活跃存在」短路进载体探测，
// 会让「活跃与载体并存」这一状态不可见，调用方于是把并存当成「应活跃」，
// 强制启用用户既有的禁用载体。需要「并存」判据的调用方（如 toggle 的目录决策）
// 必须用本函数，禁用 DisabledDirCounterpart（它对并存返回 false，是给「只要一个答案」的场景用）。
func DisabledTwinForms(path string) (activeOK bool, twin string, twinOK bool) {
	if path == "" {
		return false, "", false
	}
	activeOK = dirExists(path)
	for _, sfx := range registry.DisableSuffixes() {
		if c := path + sfx; c != path && dirExists(c) {
			return activeOK, c, true
		}
	}
	return activeOK, "", false
}

// DisabledDirCounterpart 返回 path 的**禁用孪生目录**：path 自身不是目录、而 path+禁用后缀
// 是**目录**时返回后者与 true；否则 ("", false)。
//
// 用途（ADR-345 D1/D2）：单答案场景（「这个位置当前是不是一个禁用载体」）。
// 语义边界：活跃形态是目录时恒不命中（活跃即当前真值）；**并存也返回 false**——需要区分
// 并存的调用方请用 DisabledTwinForms（复核 P1-1 死分支的根因就是这个短路被当成了判据）；
// 孪生必须是目录——同名杂散文件不构成「整夹被禁用」的意图（复核 P2-1）。
func DisabledDirCounterpart(path string) (string, bool) {
	activeOK, twin, twinOK := DisabledTwinForms(path)
	if !activeOK && twinOK {
		return twin, true
	}
	return "", false
}

// DisabledAncestorPath 沿 root→target 的路径段逐级探测「禁用孪生目录」，命中即返回
// **改写后的实际路径**（被禁用的那一级换成孪生，其余段原样拼在其下）与 true。
//
// 为什么必须上溯祖先（ADR-345 D3/D4，复核 P1-2 实证）：实例把**容器夹**整体禁用
// （`custom/X.disabled/`，X 自身非模型夹、模型夹在其下 `X/sub`）时，只查单元自身路径
// （`custom/X/sub` 与其孪生 `custom/X/sub.disabled`）全都落空 → 面板把子项全判 missing
// 撑成「待推送」、推送再新建活跃 `custom/X/sub/…`，`X.disabled/` 残留 = 复活 + 同模型两份。
//
// 语义边界：target 必须在 root 内（否则 false）；任一级的孪生必须是目录（同 DisabledDirCounterpart）；
// target 自身存在时沿路全部命中「存在」→ 返回 false（活跃路径即真值）。
func DisabledAncestorPath(root, target string) (string, bool) {
	if root == "" || target == "" {
		return "", false
	}
	root = filepath.Clean(root)
	target = filepath.Clean(target)
	rel, err := filepath.Rel(root, target)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	segs := strings.Split(rel, string(filepath.Separator))
	cur := root
	for i, seg := range segs {
		if seg == "" {
			continue
		}
		next := filepath.Join(cur, seg)
		activeOK, twin, twinOK := DisabledTwinForms(next)
		if activeOK {
			cur = next
			continue
		}
		if !twinOK {
			return "", false
		}
		out := twin
		for _, rest := range segs[i+1:] {
			if rest != "" {
				out = filepath.Join(out, rest)
			}
		}
		return out, true
	}
	return "", false
}
