// ===== packs.ClassifyResource 回归护栏（golden + isolation + order）=====
//
// 归属（ADR-144）：原 go/types/classify_test.go，随识别大脑整体下沉到 go/packs。
// 设计目标（对应整合包反复回归的根因）：
//  1. golden：每个语料路径必须稳定判为 expect —— 把"人眼发现回归"变成 CI 提交前拦截。
//  2. isolation（remove-each-type）：移除任一类型后，其余语料分类不得改变（归 victim
//     的用例允许变化）。从结构上证明路由彼此隔离，杜绝"新增类型连坐改掉蓝图"的
//     last-wins 跨类型污染。
//  3. order：shuffle 注册表顺序后语料分类稳定（确定性伪 shuffle，可复现）。配合
//     (priority desc, id asc) 双键裁决，证明收敛后不再依赖注册表顺序。
//
// 语料来源：go/packs/testdata/classify-golden.json（编译期内嵌单一事实源
// resource_types.json 经 LoadRegistry 加载）。重点护栏：
//   - schematics/gear.zip 在仓库根（无 location 上下文）→ blueprint：
//     审计口径=container、导入口径=blueprint 的现行犯修复点（按内容指纹判型）。
//   - random.zip（含 readme.txt，无任一指纹）→ container：反 last-wins 护栏，
//     ".zip" 不再仅靠扩展名落到注册表末位类型。
package packs_test

import (
	"archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/types"
)

// goldenCase 语料条目：纯路径用例（location 路由）留 entries 空；
// 容器指纹用例填 entries，测试内用 archive/zip 现造最小 fixture（不提交二进制）。
type goldenCase struct {
	Path    string   `json:"path"`
	Expect  string   `json:"expect"`
	Entries []string `json:"entries"`
}

func loadGolden(t *testing.T) []goldenCase {
	t.Helper()
	data, err := os.ReadFile("testdata/classify-golden.json")
	if err != nil {
		t.Fatalf("读语料失败: %v", err)
	}
	var cases []goldenCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("解析语料失败: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("语料为空")
	}
	return cases
}

// buildCase：含 entries 的用例在 tmp 下现造最小 zip；location 类仅返回拼接路径
// （ClassifyResource 的 Phase 0/1 仅解析路径字符串，不需真实文件存在）。
func buildCase(t *testing.T, dir string, c goldenCase) string {
	t.Helper()
	full := filepath.Join(dir, c.Path)
	if len(c.Entries) == 0 {
		return full
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("建目录失败: %v", err)
	}
	f, err := os.Create(full)
	if err != nil {
		t.Fatalf("建 zip 失败: %v", err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	for _, e := range c.Entries {
		if _, err := zw.Create(e); err != nil {
			t.Fatalf("写 entry %q 失败: %v", e, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("关闭 zip 失败: %v", err)
	}
	return full
}

// buildAll 一次性构造全部用例的可判定路径，供 baseline/各 victim 迭代复用。
func buildAll(t *testing.T) map[string]string {
	t.Helper()
	tmp := t.TempDir()
	out := map[string]string{}
	for _, c := range loadGolden(t) {
		out[c.Path] = buildCase(t, tmp, c)
	}
	return out
}

// TestClassifyGolden 主回归闸门：每个语料路径必须稳定判为 expect。
func TestClassifyGolden(t *testing.T) {
	reg := types.LoadRegistry()
	built := buildAll(t)
	for _, c := range loadGolden(t) {
		if got := packs.ClassifyResource(built[c.Path], reg); got != c.Expect {
			t.Errorf("ClassifyResource(%q) = %q, 期望 %q", c.Path, got, c.Expect)
		}
	}
}

// TestClassifyIsolation 隔离不变量：移除任一类型后，其余语料分类不得改变
// （归 victim 的用例跳过）。直接证明路由彼此隔离，杜绝 last-wins 跨类型污染。
func TestClassifyIsolation(t *testing.T) {
	base := types.LoadRegistry()
	built := buildAll(t)
	baseline := map[string]string{}
	for _, c := range loadGolden(t) {
		baseline[c.Path] = packs.ClassifyResource(built[c.Path], base)
	}
	for _, victim := range base.ResourceTypes {
		shrunk := removeType(base, victim.ID)
		for _, c := range loadGolden(t) {
			if baseline[c.Path] == victim.ID {
				continue // 归 victim 的条目允许变化
			}
			if got := packs.ClassifyResource(built[c.Path], shrunk); got != baseline[c.Path] {
				t.Errorf("移除类型 %q 后 %q 漂移: %q → %q", victim.ID, c.Path, baseline[c.Path], got)
			}
		}
	}
}

// TestClassifyOrderIndependent 注册表顺序无关：shuffle 后语料分类稳定
// （确定性伪 shuffle，可复现）。配合 (priority desc, id asc) 双键裁决，
// 证明收敛后不再依赖注册表顺序。
func TestClassifyOrderIndependent(t *testing.T) {
	reg := types.LoadRegistry()
	built := buildAll(t)
	ref := map[string]string{}
	for _, c := range loadGolden(t) {
		ref[c.Path] = packs.ClassifyResource(built[c.Path], reg)
	}
	shuffled := shuffle(reg)
	for _, c := range loadGolden(t) {
		if got := packs.ClassifyResource(built[c.Path], shuffled); got != ref[c.Path] {
			t.Errorf("顺序变化后 %q: %q → %q", c.Path, ref[c.Path], got)
		}
	}
}

func removeType(reg *types.ResourceTypeRegistry, id string) *types.ResourceTypeRegistry {
	out := &types.ResourceTypeRegistry{}
	for _, rt := range reg.ResourceTypes {
		if rt.ID != id {
			out.ResourceTypes = append(out.ResourceTypes, rt)
		}
	}
	return out
}

// shuffle 确定性伪 shuffle（黄金比乘法，可复现），用于顺序无关性验证。
func shuffle(reg *types.ResourceTypeRegistry) *types.ResourceTypeRegistry {
	out := &types.ResourceTypeRegistry{
		ResourceTypes: append([]types.ResourceType(nil), reg.ResourceTypes...),
	}
	for i := len(out.ResourceTypes) - 1; i > 0; i-- {
		j := (i * 2654435761) % (i + 1)
		out.ResourceTypes[i], out.ResourceTypes[j] = out.ResourceTypes[j], out.ResourceTypes[i]
	}
	return out
}
