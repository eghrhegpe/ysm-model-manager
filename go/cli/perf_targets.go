package cli

// perf_targets.go — 基准测试的目标集解析（ADR-262 D3：目标集由 Go 侧从 registry 派生）。
//
// 立因（2026-09-17）：`single-bench` 此前只能吃单个 `--model`，没有「按资源类型挑样本、挑几个」
// 的统一入口（用户原话：「该统一设置挑选多少个模型的不设置」）。目标集解析放在这里，
// 发现权复用 `scanner.ScanEntries`（**发现权单点**，registry 驱动），不另立扩展名白名单——
// 目录式模型（解包 YSM 目录）由 scanner 折叠为 `<dir>/ysm.json` 条目，天然被覆盖。

import (
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types/registry"
)

// cliAnalyzableRtype CLI 侧**真正能分析**的资源类型白名单（不是「能发现」的白名单）。
//
// 只有 YSM 有 CLI 分析链路：`.ysm` 走 WASM 解码、`.zip/.7z` 走 geometry 容器解析、
// 目录式走 `ysm.FindComponentsInExtractedYSM`（`app.App.LoadModelComponents` 的 `.json` 分支）。
// PMX/PMD/VRM/FBX/GLTF 等的解析器只在**前端 3D adapter**里（Three.js 生态），CLI 拿到只会
// 得到空模型 —— 于是「阶段耗时」全是空数据。矩阵必须显式区分这两类，否则会把空模型数据
// 当实测展示（与 gui-flow 对 PMX 跳过 ④⑤⑥ 的口径同源）。
//
// 新增类型的 CLI 分析链路时，同步登记此表，并把该类型的期望阶段集合写进样本清单。
var cliAnalyzableRtype = map[string]bool{
	"ysm": true,
}

// scanBenchTargets 按资源类型扫描基准目标集：发现 → 类型过滤 → 确定性排序 → 取前 N。
//
// rtype 为空时退化为「所有 CLI 可分析类型」（用于自动挑首个模型，如 health --bench / perf-snapshot）。
// rtype 非空时按该类型过滤（即使该类型 CLI 不可分析也返回——由调用方标注 unsupported，
// 而不是静默丢掉，否则「按类型跑矩阵」会得到空结果而无任何解释）。
//
// 排序用路径字典序而非扫描序：Walk 顺序依文件系统而变，测试与 AI 断言需要可复现的目标集。
func scanBenchTargets(filesRoot, rtype string, maxModels int) []string {
	if filesRoot == "" || maxModels < 1 {
		return nil
	}
	reg := registry.LoadRegistry()
	var out []string
	for _, e := range scanner.ScanEntries(filesRoot) {
		got := classifyForScan(e.Path, strings.ToLower(filepath.Ext(e.Path)), reg)
		if rtype != "" {
			if got != rtype {
				continue
			}
		} else if !cliAnalyzableRtype[got] {
			continue
		}
		out = append(out, e.Path)
	}
	sort.Strings(out)
	if len(out) > maxModels {
		out = out[:maxModels]
	}
	return out
}
