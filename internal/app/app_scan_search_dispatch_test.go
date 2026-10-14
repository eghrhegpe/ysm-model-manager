// ===== SearchModels 分流语义测试（ADR-343 刀 2：无条件排除修正 + 按 Type 分流）=====
// 数据实证背景（2026-10-14）：旧实现 modelMatchesFilters 首行 BoneCount==0 无条件排除——
// 4 条目实证库中「不带任何过滤的搜索」也丢掉资源包/音效包 2 条 zip（蒸发无告警）。
// 刀 2 语义：数值条件未设置 → 候选全量直通（零值几何，不蒸发）；数值条件已设置 →
// 仅几何系类型（registry GeometrySearchable 声明）进分析器，非几何系显式排除不白解析。
package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// writeMaidModelFixture 造一个可被几何管线解析的女仆包 zip：
// assets/<ns>/maid_model.json（L0 清单，形式 A）+ 单骨骼几何 + 纹理。
// detect 走嵌套模式（entryDir=assets + entryFiles 命中）→ Type=maid-model（geometrySearchable）。
func writeMaidModelFixture(t *testing.T, dir, name string) string {
	t.Helper()
	geo := fmt.Sprintf(
		`{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"%s","texture_width":64,"texture_height":64},"bones":[{"name":"%s_body","pivot":[0,0,0],"cubes":[{"origin":[-4,0,-4],"size":[8,8,8]}]}]}]}`,
		name, name)
	manifest := fmt.Sprintf(
		`{"pack_name":"%s","model":[{"name":"%s","model":"models/entity/%s.json","texture":"textures/entity/%s.png"}]}`,
		name, name, name, name)
	return writeTestZip(t, dir, name+".zip", map[string]string{
		fmt.Sprintf("assets/%s/maid_model.json", name):              manifest,
		fmt.Sprintf("assets/%s/models/entity/%s.json", name, name):  geo,
		fmt.Sprintf("assets/%s/textures/entity/%s.png", name, name): "PNG",
	})
}

// TestSearchModels_NoNumeric_IncludesUnparseable：无数值条件 → 无解析能力条目照返
// （旧「无条件排除」的误伤面已修；资源包 zip 不再是蒸发而是零值直通）
func TestSearchModels_NoNumeric_IncludesUnparseable(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	neutral := filepath.Join(base, "misc")
	if err := os.MkdirAll(neutral, 0o755); err != nil {
		t.Fatal(err)
	}
	writeYsmModelFixture(t, ysmRoot, "hero", 5)
	writeTestZip(t, neutral, "mystery.zip", map[string]string{"readme.txt": "no geometry here"})

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, types.SearchFilters{})
	if len(results) != 2 {
		t.Fatalf("无数值条件应返回全部 2 条（zip 不蒸发），got %d", len(results))
	}
	byName := make(map[string]types.SearchResult, len(results))
	for _, r := range results {
		byName[r.Name] = r
	}
	if got, ok := byName["mystery.zip"]; !ok || got.BoneCount != 0 {
		t.Errorf("未知内容 zip 应零值直通（不解析不蒸发），got %+v（ok=%v）", got, ok)
	}
	if got, ok := byName["hero"]; !ok || got.BoneCount != 0 {
		t.Errorf("直通路径不分析，ysm 条目几何字段亦为零值（消费端 omitempty = 无几何数据），got %+v", got)
	}
	// 刀 3：Type 随结果下发——占位值原样透传（container = 内容未识别，不猜）
	if got := byName["mystery.zip"].Type; got != "container" {
		t.Errorf("未知内容 zip 的 Type 应为 container 占位（诚实透传），got %q", got)
	}
	if got := byName["hero"].Type; got != "ysm" {
		t.Errorf("ysm 条目 Type 应为 ysm，got %q", got)
	}
}

// TestSearchModels_Numeric_ExcludesNonGeometryType：数值条件 → 非几何系类型显式排除
// （资源包/音效包不进分析器——不白解析、不触发 WASM 失败日志；几何系照跑）
func TestSearchModels_Numeric_ExcludesNonGeometryType(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	neutral := filepath.Join(base, "misc")
	if err := os.MkdirAll(neutral, 0o755); err != nil {
		t.Fatal(err)
	}
	writeYsmModelFixture(t, ysmRoot, "hero", 5)
	// 女仆包 zip：Type 派生为 maid-model（geometrySearchable）→ 数值搜索应命中（B 案端到端）
	writeMaidModelFixture(t, neutral, "maid_reimu")
	// 未知内容 zip：Type=container 占位 → 数值搜索显式排除
	writeTestZip(t, neutral, "mystery.zip", map[string]string{"readme.txt": "no geometry here"})

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, types.SearchFilters{MinBones: 1})
	names := make([]string, 0, len(results))
	maideHit := false
	for _, r := range results {
		names = append(names, r.Name)
		if strings.Contains(r.Name, "maid_reimu") {
			maideHit = true
		}
		if strings.Contains(r.Name, "mystery") {
			t.Errorf("未知内容 zip（Type=container）不得进数值搜索，结果含 %v", names)
		}
	}
	if len(results) != 2 {
		t.Fatalf("数值搜索应命中 2 条（ysm + maid），got %v（%v）", len(results), names)
	}
	if !maideHit {
		t.Errorf("maid-model zip 应可被数值搜索命中（几何管线解析 L0 清单），结果 %v", names)
	}
	// 刀 3：Type 随结果下发——数值路径的结果必为几何系类型（分流保证，无占位值混入）
	for _, r := range results {
		if r.Type == "" {
			t.Errorf("数值路径结果 %s 的 Type 不应为空（分流后均为几何系类型），got %+v", r.Name, r)
		}
	}
	typeByName := make(map[string]string, len(results))
	for _, r := range results {
		typeByName[r.Name] = r.Type
	}
	if got := typeByName["maid_reimu.zip"]; got != "maid-model" {
		t.Errorf("maid 包数值命中条目的 Type 应为 maid-model，got %q", got)
	}
	if got := typeByName["hero"]; got != "ysm" {
		t.Errorf("ysm 条目 Type 应为 ysm，got %q", got)
	}
}

// ===== MMD 数值搜索端到端（ADR-346 刀 2：统计级解析接进 SearchModels 数值路径）=====

// writePmxStatsFixture 造一个统计级可解析的 PMX（bone_count 头声明 + texsize 直读）
func writePmxStatsFixture(t *testing.T, dir, name string, bones int) string {
	t.Helper()
	doc := `<?xml version="1.0" encoding="utf-8"?>` +
		`<model bone_count="` + itoaPmx(bones) + `" vertex_count="1">` +
		`<name>` + name + `</name><meta></meta>` +
		`<bone></bone><material><name>m</name></material>` +
		`<texture><name>t0</name><texsize>64,64</texsize></texture>` +
		`</model>`
	p := filepath.Join(dir, name+".pmx")
	if err := os.WriteFile(p, []byte(doc), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func itoaPmx(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}

// TestSearchModels_MmdStatsNumeric：MMD 族条目进数值路径（统计级：骨骼+纹理可用，
// cube 恒 0 诚实值——cube 条件天然筛掉 MMD；无数值条件时全量直通不解析）
func TestSearchModels_MmdStatsNumeric(t *testing.T) {
	base := t.TempDir()
	epDir := filepath.Join(base, "3d-skin", "EntityPlayer")
	if err := os.MkdirAll(epDir, 0o755); err != nil {
		t.Fatal(err)
	}
	ysmRoot := filepath.Join(base, "ysm", "models")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	writePmxStatsFixture(t, epDir, "miku", 4)
	writeYsmModelFixture(t, ysmRoot, "hero", 5)

	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 无数值条件：直通（MMD 零值几何，不解析不蒸发）
	results := a.SearchModels(base, types.SearchFilters{})
	if len(results) != 2 {
		t.Fatalf("无过滤应返回 2 条，got %d", len(results))
	}
	for _, r := range results {
		if r.Name == "miku.pmx" && (r.BoneCount != 0 || r.Type != "EntityPlayer") {
			t.Errorf("直通路径 MMD 条目应零值 + Type=EntityPlayer，got %+v", r)
		}
	}

	// minBones=2：MMD 统计级解析命中（bone=4 ≥ 2）+ ysm 命中（bone=5）
	results = a.SearchModels(base, types.SearchFilters{MinBones: 2})
	if len(results) != 2 {
		t.Fatalf("minBones=2 应命中 2 条（mmd 4 骨 + ysm 5 骨），got %+v", results)
	}
	var miku *types.SearchResult
	for i := range results {
		if results[i].Name == "miku.pmx" {
			miku = &results[i]
		}
	}
	if miku == nil {
		t.Fatalf("minBones=2 结果缺 miku（MMD 统计级解析未生效），got %+v", results)
	}
	if miku.BoneCount != 4 || miku.TexWidth != 64 || miku.CubeCount != 0 {
		t.Errorf("MMD 统计结果 = %+v，期望 bone=4 tex=64 cube=0（cube 诚实零值）", miku)
	}

	// minCubes=1：MMD cube=0 被筛（诚实排除），ysm（cube=5）留
	results = a.SearchModels(base, types.SearchFilters{MinCubes: 1})
	if len(results) != 1 || results[0].Name != "hero" {
		t.Fatalf("minCubes=1 应只留 ysm（MMD cube 零值诚实排除），got %+v", results)
	}
}
