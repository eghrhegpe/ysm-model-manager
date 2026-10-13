package registry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"
	"ysm-model-manager/internal/testutil"
)

// 容器扩展名判定（IsContainerExt / ContainerExts）：
// .zip/.7z 是通用容器（ADR-067），类型归属必须走内容指纹，容器集合单源在此。
// ADR-269-d1：值集事实源已迁入 resource_types.json 顶层 containerExts 声明，
// 两函数改为**派生自注册表**（atomic 缓存按实例指针失效）；下面三组测试分别锁
// 派生性、字段级基线回退、与逐字行为口径（大小写 / 无点 / 前缀碰撞）。
func TestIsContainerExt(t *testing.T) {
	t.Parallel()
	cases := []struct {
		ext  string
		want bool
	}{
		{".zip", true},
		{".ZIP", true},
		{".Zip", true},
		{".7z", true},
		{".7Z", true},
		{".ysm", false},
		{".pmx", false},
		{".nbt", false},
		{"zip", false},   // 无点前缀不算扩展名
		{"", false},      // 空串
		{".zipp", false}, // 前缀碰撞不得误判
	}
	for _, c := range cases {
		if got := IsContainerExt(c.ext); got != c.want {
			t.Errorf("IsContainerExt(%q) = %v, want %v", c.ext, got, c.want)
		}
	}
}

func TestContainerExts_SetStable(t *testing.T) {
	t.Parallel()
	got := ContainerExts()
	want := []string{".zip", ".7z"}
	if !cmp.Equal(got, want) {
		t.Errorf("ContainerExts() = %v, want %v", got, want)
	}
	// 集合语义：每个返回的扩展名都应被 IsContainerExt 判定为容器
	for _, e := range got {
		if !IsContainerExt(e) {
			t.Errorf("ContainerExts() 成员 %q 未被 IsContainerExt 判定为容器", e)
		}
	}
}

// ===== ADR-269-d1：containerExts 派生契约 =====

// writeContainerRegistry 把带自定义 containerExts 的注册表写入临时文件并指向它。
func writeContainerRegistry(t *testing.T, payload string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "resource_types.json")
	testutil.NoError(t, os.WriteFile(path, []byte(payload), 0o644), "write payload")
	SetRegistryPath(path)
	t.Cleanup(func() { SetRegistryPath("") })
}

// 派生性（判别力核心）：payload 声明 containerExts=[".rar"] 时，判定必须跟着注册表走——
// .rar 是容器、.zip 不是。若实现仍返回硬编码 [.zip .7z]，本用例当场红。
func TestContainerExts_DerivesFromRegistryPayload(t *testing.T) {
	writeContainerRegistry(t, `{
		"containerExts": [".rar"],
		"resourceTypes": [{"id":"rarpack","name":"rar包","icon":"x","group":"other",
			"extensions":[".rar"],"storageSubDir":"rarpacks","instanceDir":"rar",
			"instanceLevel":false,"preview":"none","detector":"extension"}]
	}`)
	if got := ContainerExts(); !cmp.Equal(got, []string{".rar"}) {
		t.Errorf("ContainerExts() = %v, want [.rar]（应派生自注册表声明）", got)
	}
	if !IsContainerExt(".rar") {
		t.Error(`IsContainerExt(".rar") = false，want true`)
	}
	if !IsContainerExt(".RAR") {
		t.Error(`IsContainerExt(".RAR") = false，大小写不敏感应成立`)
	}
	if IsContainerExt(".zip") {
		t.Error(`IsContainerExt(".zip") = true，本 payload 未声明 .zip 为容器`)
	}
}

// 字段级基线回退：payload 合法（resourceTypes 非空）但**不带 containerExts 字段**时，
// 容器集合回退嵌入基线（= 根 json 的 [.zip .7z]）而不是空集合——
// 「未声明」≠「声明为空」：空集合会让 importer/packs/findinst 的容器判定静默翻转，
// 与 LoadRegistry 对空注册表回退基线（BUG-1/4）同一条保守方向。
func TestContainerExts_FallsBackToBaselineWhenFieldMissing(t *testing.T) {
	writeContainerRegistry(t, `{
		"resourceTypes": [{"id":"ysm","name":"YSM","icon":"x","group":"other",
			"extensions":[".ysm"],"storageSubDir":"ysm","instanceDir":"models",
			"instanceLevel":false,"preview":"3d","detector":"ysm"}]
	}`)
	got := ContainerExts()
	want := []string{".zip", ".7z"}
	if !cmp.Equal(got, want) {
		t.Errorf("缺 containerExts 字段时应回退基线: got %v, want %v", got, want)
	}
	if !IsContainerExt(".zip") {
		t.Error(`基线回退后 IsContainerExt(".zip") 应为 true`)
	}
}

// 缓存失效对账：两次 SetRegistryPath 换 payload，容器集合必须随实例指针重建
// （同 extensions_map_test.go 对 extSet 的防 sync.Once 永久缓存契约）。
func TestContainerExts_CacheInvalidatesOnRegistrySwap(t *testing.T) {
	writeContainerRegistry(t, `{"containerExts":[".aaa"],"resourceTypes":[{"id":"a","name":"a","icon":"x","group":"other","extensions":[".aaa"],"storageSubDir":"a","instanceDir":"a","instanceLevel":false,"preview":"none","detector":"extension"}]}`)
	testutil.Equal(t, IsContainerExt(".aaa"), true, "首个注册表应认 .aaa")
	// 换到另一 payload（.bbb）——旧实例缓存不得存活
	writeContainerRegistry(t, `{"containerExts":[".bbb"],"resourceTypes":[{"id":"b","name":"b","icon":"x","group":"other","extensions":[".bbb"],"storageSubDir":"b","instanceDir":"b","instanceLevel":false,"preview":"none","detector":"extension"}]}`)
	if !IsContainerExt(".bbb") {
		t.Error("切换后应认 .bbb（缓存未按实例指针重建）")
	}
	if IsContainerExt(".aaa") {
		t.Error("切换后不得仍认 .aaa（旧实例缓存存活）")
	}
}

// 真实根 JSON 必须带 containerExts 声明（防生成链/手工编辑漏字段导致长期靠回退活着）。
func TestContainerExts_RootJSONDeclaresField(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "resource_types.json"))
	testutil.NoError(t, err, "read root json")
	var reg ResourceTypeRegistry
	testutil.NoError(t, json.Unmarshal(raw, &reg), "parse root json")
	if !cmp.Equal(reg.ContainerExts, []string{".zip", ".7z"}) {
		t.Errorf("根 resource_types.json 的 containerExts = %v, want [.zip .7z]", reg.ContainerExts)
	}
}
