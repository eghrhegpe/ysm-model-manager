// ===== Go-TS 方块配色表对拍（ADR-154 pilot 2：双端互锁 + 生成物过期检测）=====
// 前端 voxel-colors-data.json 是「由 Go 源一次性生成」的生成物，但 go/litematic/gen
// 只生成 block_ids_data.go，voxel-colors-data.json 无复跑生成器——生成物会过期。
// 本测试把 data.json 当作双端共享契约：Go 侧用源码表逐键验证 data.json 的值
// （TS 侧 frontend/src/parsers/voxel-colors.parity.test.ts 读同一 data.json 断言
// mapColor/resolveBlockName 输出）。Go 改 blockColorMap/blockVariantNames 而
// data.json 未重新生成 → 本测试红（生成物过期检测器）。
//
// 已捕获的真实漂移（修复见 data.json）：118:3 曾为 "minecraft:cauldront"（typo），
// Go 源码正确返回 "minecraft:cauldron"——生成物无溯源 + 无对拍的双实现漂移实证。
package litematic

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

type voxelDataFixture struct {
	Color   map[string]string `json:"BLOCK_COLOR_MAP"`
	Variant map[string]string `json:"BLOCK_VARIANT_NAMES"`
}

// repoRootFromLitematicPkg 从包目录逐级向上找仓库根（go test cwd = 包目录）。
func repoRootFromLitematicPkg(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	for d := dir; ; d = filepath.Dir(d) {
		if _, err := os.Stat(filepath.Join(d, "frontend", "src", "parsers", "voxel-colors-data.json")); err == nil {
			return d
		}
		if filepath.Dir(d) == d {
			break
		}
	}
	t.Fatalf("未找到 voxel-colors-data.json（从 %q 向上）", dir)
	return ""
}

func loadVoxelDataFixture(t *testing.T) *voxelDataFixture {
	t.Helper()
	root := repoRootFromLitematicPkg(t)
	raw, err := os.ReadFile(filepath.Join(root, "frontend", "src", "parsers", "voxel-colors-data.json"))
	if err != nil {
		t.Fatalf("读取 voxel-colors-data.json: %v", err)
	}
	var f voxelDataFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("解析 voxel-colors-data.json: %v", err)
	}
	if len(f.Color) == 0 || len(f.Variant) == 0 {
		t.Fatal("voxel-colors-data.json 表为空（防空转守卫）")
	}
	return &f
}

// TestParity_VoxelColorMap 全量对拍：data.json 每个 color key 的期望值
// 必须等于 Go MapColor 输出（生成物未过期 + TS 数据源正确）。
func TestParity_VoxelColorMap(t *testing.T) {
	f := loadVoxelDataFixture(t)
	for name, want := range f.Color {
		if got := MapColor(name); got != want {
			t.Errorf("MapColor(%q) = %q, data.json 期望 %q（生成物过期或 Go 表漂移）", name, got, want)
		}
	}
}

// TestParity_VoxelBlockVariant 全量对拍：data.json 每个 id:data 变体的期望值
// 必须等于 Go ResolveBlockName 输出。
func TestParity_VoxelBlockVariant(t *testing.T) {
	f := loadVoxelDataFixture(t)
	for key, want := range f.Variant {
		var id int
		var data int
		if _, err := fmt.Sscanf(key, "%d:%d", &id, &data); err != nil {
			t.Errorf("data.json 含非法变体 key %q", key)
			continue
		}
		if got := ResolveBlockName(id, byte(data)); got != want {
			t.Errorf("ResolveBlockName(%d,%d) = %q, data.json 期望 %q（生成物过期或 Go 表漂移）", id, data, got, want)
		}
	}
}

// TestParity_VoxelColorKeyCoverage 反向覆盖：data.json 的颜色表键必须 ⊆ Go 源码表键
// （Go 新增了方块而 data.json 没补 → 前端丢色。Go 表只增不删语义下，反向用
// blockColorMap 探测缺键；blockVariantNames 同理按前缀归并抽查）。
func TestParity_VoxelColorKeyCoverage(t *testing.T) {
	f := loadVoxelDataFixture(t)
	// Go 源码表键集合（同包直接访问私有表）
	colorKeys := make(map[string]bool, len(f.Color))
	for k := range blockColorMap {
		colorKeys[k] = true
	}
	var missingColor []string
	for k := range f.Color {
		if !colorKeys[k] {
			missingColor = append(missingColor, k)
		}
	}
	if len(missingColor) > 0 {
		t.Errorf("data.json 颜色表含 Go 源码表没有的键（%v）——生成物超前，需重生成", missingColor[:min(len(missingColor), 5)])
	}
	// data.json 颜色表不得缺 Go 源码表键（Go 增补了方块而 data.json 未同步）
	var missingInData []string
	for k := range blockColorMap {
		if _, ok := f.Color[k]; !ok {
			missingInData = append(missingInData, k)
		}
	}
	if len(missingInData) > 0 {
		t.Errorf("data.json 颜色表缺 Go 源码表键 %d 个（前 %v）——生成物过期，需重生成", len(missingInData), missingInData[:min(len(missingInData), 5)])
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
