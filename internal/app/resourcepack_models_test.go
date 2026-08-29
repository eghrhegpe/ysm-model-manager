// ===== resourcepack_models_test.go — ADR-080 资源包模型读取绑定测试 =====
package app

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// makePackZip 构建临时资源包 zip（assets/minecraft/models/block/stone.json + 纹理占位）
func makePackZip(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "testpack.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	w := zip.NewWriter(f)
	for name, content := range files {
		entry, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	f.Close()
	return p
}

var packZipFiles = map[string]string{
	"pack.mcmeta": `{"pack":{"pack_format":15,"description":"test"}}`,
	"assets/minecraft/models/block/stone.json":    `{"parent":"minecraft:block/cube_all","textures":{"all":"minecraft:block/stone"}}`,
	"assets/minecraft/models/block/cube_all.json": `{"parent":"block/cube","textures":{"down":"#all","up":"#all","north":"#all","south":"#all","west":"#all","east":"#all"}}`,
	"assets/minecraft/models/item/stone.json":     `{"parent":"minecraft:block/stone"}`,
	"assets/minecraft/textures/block/stone.png":   "PNG-PLACEHOLDER",
	"assets/minecraft/lang/en_us.json":            `{"a":"b"}`,
	"assets/minecraft/models/custom/other.json":   `{}`, // 非 block/item 目录，不应列入
}

func TestListPackModels(t *testing.T) {
	a := &App{}
	p := makePackZip(t, packZipFiles)
	got := a.ListPackModels(p)

	var models []string
	if err := json.Unmarshal([]byte(got), &models); err != nil {
		t.Fatalf("ListPackModels 返回非法 JSON: %v", err)
	}
	if len(models) != 3 {
		t.Fatalf("期望 3 个模型（block/stone + block/cube_all + item/stone），实际 %d: %v", len(models), models)
	}
	// 升序
	want := []string{
		"assets/minecraft/models/block/cube_all.json",
		"assets/minecraft/models/block/stone.json",
		"assets/minecraft/models/item/stone.json",
	}
	for i := range want {
		if models[i] != want[i] {
			t.Errorf("models[%d] = %q，期望 %q", i, models[i], want[i])
		}
	}
}

func TestListPackModels_NonZip(t *testing.T) {
	a := &App{}
	// 非 zip 路径（如 .7z 无模型或不存在文件）→ "[]"
	if got := a.ListPackModels(filepath.Join(t.TempDir(), "notexist.zip")); got != "[]" {
		t.Errorf("不存在文件期望 []，实际 %q", got)
	}
}

func TestReadPackEntry(t *testing.T) {
	a := &App{}
	p := makePackZip(t, packZipFiles)

	got := a.ReadPackEntry(p, "assets/minecraft/models/block/stone.json")
	if got == "" {
		t.Fatal("stone.json 读取为空")
	}
	// 返回值为 base64，解码后应含 cube_all parent 引用
	raw, err := base64.StdEncoding.DecodeString(got)
	if err != nil {
		t.Fatalf("返回值不是合法 base64: %v", err)
	}
	if !strings.Contains(string(raw), "cube_all") {
		t.Errorf("解码内容应含 cube_all 引用，实际 %q", string(raw))
	}
}

func TestReadPackEntry_Guard(t *testing.T) {
	a := &App{}
	p := makePackZip(t, packZipFiles)
	// 路径穿越/非法条目一律拒绝
	for _, entry := range []string{
		"../etc/passwd",
		"pack.mcmeta",       // 非 assets/ 前缀
		"assets/..%2f..%2f", // 含 ..
		"assets\\minecraft", // 反斜杠
		"assets/minecraft/models/block/missing.json", // 不存在
	} {
		if got := a.ReadPackEntry(p, entry); got != "" {
			t.Errorf("非法条目 %q 应返回空，实际非空", entry)
		}
	}
}

// packDetailZipFiles 含带 elements 的模型 JSON（block/stone 3 个立方体、block/door 1 个）
var packDetailZipFiles = map[string]string{
	"assets/minecraft/models/block/stone.json":  `{"parent":"minecraft:block/cube_all","textures":{"all":"minecraft:block/stone"}}`,
	"assets/minecraft/models/block/door.json":   `{"parent":"block/cube","elements":[{"from":[0,0,0],"to":[16,16,16]}]}`,
	"assets/minecraft/models/block/wall.json":   `{"parent":"block/cube","elements":[{"from":[0,0,0],"to":[8,16,16]},{"from":[8,0,0],"to":[16,16,16]},{"from":[0,0,0],"to":[16,8,16]}]}`,
	"assets/minecraft/models/item/stone.json":   `{"parent":"minecraft:block/stone"}`,
	"assets/minecraft/textures/block/stone.png": "PNG-PLACEHOLDER",
}

// listPackModelDetail 解析 ListPackModelsDetail 的 JSON 结构
func unmarshalPackDetail(t *testing.T, raw string) struct {
	Models []PackModelDetail `json:"models"`
	Total  int               `json:"total"`
} {
	t.Helper()
	var out struct {
		Models []PackModelDetail `json:"models"`
		Total  int               `json:"total"`
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("ListPackModelsDetail 返回非法 JSON: %v", err)
	}
	return out
}

func TestListPackModelsDetail(t *testing.T) {
	a := &App{}
	p := makePackZip(t, packDetailZipFiles)
	got := a.ListPackModelsDetail(p)
	res := unmarshalPackDetail(t, got)

	if res.Total != 4 {
		t.Fatalf("期望 4 个模型，实际 total=%d: %v", res.Total, res.Models)
	}
	if len(res.Models) != 4 {
		t.Fatalf("期望 4 条 models，实际 %d: %v", len(res.Models), res.Models)
	}
	// 立方体数：block/stone 无 elements=0，door=1，wall=3，item/stone 0
	cubesByPath := map[string]int{}
	for _, m := range res.Models {
		cubesByPath[m.Path] = m.Cubes
	}
	if cubesByPath["assets/minecraft/models/block/door.json"] != 1 {
		t.Errorf("door 立方体数应 1，实际 %d", cubesByPath["assets/minecraft/models/block/door.json"])
	}
	if cubesByPath["assets/minecraft/models/block/wall.json"] != 3 {
		t.Errorf("wall 立方体数应 3，实际 %d", cubesByPath["assets/minecraft/models/block/wall.json"])
	}
	if cubesByPath["assets/minecraft/models/block/stone.json"] != 0 {
		t.Errorf("stone 无 elements 立方体数应 0，实际 %d", cubesByPath["assets/minecraft/models/block/stone.json"])
	}
	// 升序
	for i := 1; i < len(res.Models); i++ {
		if res.Models[i].Path < res.Models[i-1].Path {
			t.Errorf("models 应升序，[%d]=%q < [%d]=%q", i, res.Models[i].Path, i-1, res.Models[i-1].Path)
		}
	}
}

func TestListPackModelsDetail_Cap(t *testing.T) {
	a := &App{}
	// 造 250 个模型（> 封顶 200）验证封顶 + total 全量
	files := map[string]string{}
	for i := 0; i < 250; i++ {
		// 补零保证升序稳定（m000..m249）
		name := fmt.Sprintf("assets/minecraft/models/block/m%03d.json", i)
		files[name] = `{"elements":[{"from":[0,0,0],"to":[16,16,16]}]}`
	}
	p := makePackZip(t, files)
	got := a.ListPackModelsDetail(p)
	res := unmarshalPackDetail(t, got)

	if res.Total != 250 {
		t.Errorf("total 应 250，实际 %d", res.Total)
	}
	if len(res.Models) != packModelDetailCap {
		t.Errorf("封顶应 %d 条，实际 %d", packModelDetailCap, len(res.Models))
	}
}

func TestListPackModelsDetail_NonZip(t *testing.T) {
	a := &App{}
	raw := a.ListPackModelsDetail(filepath.Join(t.TempDir(), "notexist.zip"))
	var out struct {
		Models []PackModelDetail `json:"models"`
		Total  int               `json:"total"`
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("不存在文件期望合法 JSON，实际 %q", raw)
	}
	if out.Total != 0 || len(out.Models) != 0 {
		t.Errorf("不存在文件期望空清单，实际 total=%d models=%d", out.Total, len(out.Models))
	}
}

func TestPackModelElementsCount_Edge(t *testing.T) {
	// 畸形 JSON → 0（不 panic）
	if got := packModelElementsCount([]byte("not-json{")); got != 0 {
		t.Errorf("畸形 JSON 期望 0，实际 %d", got)
	}
	if got := packModelElementsCount([]byte(`null`)); got != 0 {
		t.Errorf("null 期望 0，实际 %d", got)
	}
	// elements 非数组（异常形状）→ 0
	if got := packModelElementsCount([]byte(`{"elements":42}`)); got != 0 {
		t.Errorf("elements 非数组期望 0，实际 %d", got)
	}
	// 空数组 → 0
	if got := packModelElementsCount([]byte(`{"elements":[]}`)); got != 0 {
		t.Errorf("空 elements 期望 0，实际 %d", got)
	}
	// 正常 → 数量
	if got := packModelElementsCount([]byte(`{"elements":[{},{}]}`)); got != 2 {
		t.Errorf("2 elements 期望 2，实际 %d", got)
	}
	// 无视多余字段（parent/textures/display 不影响）
	if got := packModelElementsCount([]byte(`{"parent":"block/cube","textures":{},"elements":[{"from":[0,0,0],"to":[16,16,16]}]}`)); got != 1 {
		t.Errorf("带 parent/textures 期望 1，实际 %d", got)
	}
}

func TestListPackModelsDetail_InvalidEntriesExcluded(t *testing.T) {
	// 容器内混入非 block/item 目录模型 → 不列入（对齐 ListPackModels 口径）
	a := &App{}
	files := map[string]string{
		"pack.mcmeta":                           `{"pack":{"pack_format":15}}`,
		"assets/minecraft/models/custom/x.json": `{"elements":[{}]}`, // 非 block/item 目录，不应列入
		"assets/minecraft/models/block/ok.json": `{"elements":[{}]}`,
		"other/outside.json":                    `{"elements":[{}]}`,
	}
	p := makePackZip(t, files)
	raw := a.ListPackModelsDetail(p)
	res := unmarshalPackDetail(t, raw)
	if res.Total != 1 {
		t.Fatalf("期望仅 1 个 block 模型（custom/outside 不入列），实际 total=%d: %v", res.Total, res.Models)
	}
	if len(res.Models) != 1 || res.Models[0].Path != "assets/minecraft/models/block/ok.json" {
		t.Errorf("期望仅 ok.json，实际 %v", res.Models)
	}
}
