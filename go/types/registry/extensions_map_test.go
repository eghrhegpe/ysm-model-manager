package types

import (
	"os"
	"path/filepath"
	"testing"
)

// 扩展名集合 map 缓存（IsSupportedExt/ShouldHashExt 性能收敛）行为锁定：
// 基本正确性 + 大小写不敏感 + 随注册表实例失效重建。
// 防回归点：若未来误用 sync.Once 永久缓存 map，SetRegistryPath 切换后
// 本测试的「重建」断言会红——缓存必须以注册表实例指针为失效 key。

func TestExtSetCache_BasicCorrectness(t *testing.T) {
	if !IsSupportedExt(".ysm") {
		t.Fatal("IsSupportedExt('.ysm') 应为 true")
	}
	if !IsSupportedExt(".YSM") {
		t.Fatal("IsSupportedExt('.YSM') 应为 true（大小写不敏感）")
	}
	if IsSupportedExt(".definitely_unknown_ext_xyz") {
		t.Fatal("未知扩展名应为 false")
	}
	// ShouldHashExt 保持注册表 hashable 语义：正例 .ysm（PinnedList 已锁定 hashable），
	// 负例 .txt（非 hashable 类型）——防 hashSet 半区被复制粘贴成 extSet 后仍全绿
	// （code_review P3：原 `_ = ShouldHashExt(".ysm")` 丢弃返回值，行为锁定形同虚设）
	if !ShouldHashExt(".ysm") {
		t.Fatal("ShouldHashExt('.ysm') 应为 true（注册表 hashable 驱动）")
	}
	if ShouldHashExt(".txt") {
		t.Fatal("ShouldHashExt('.txt') 应为 false（非 hashable 类型）")
	}
}

func TestExtSetCache_RebuildOnRegistrySwap(t *testing.T) {
	dir := t.TempDir()
	reg1 := filepath.Join(dir, "r1.json")
	if err := os.WriteFile(reg1, []byte(`{"resourceTypes":[{"id":"alpha","extensions":[".aaa"],"hashable":true,"storageSubDir":"alpha"}]}`), 0644); err != nil {
		t.Fatal(err)
	}
	reg2 := filepath.Join(dir, "r2.json")
	if err := os.WriteFile(reg2, []byte(`{"resourceTypes":[{"id":"beta","extensions":[".bbb"],"hashable":true,"storageSubDir":"beta"}]}`), 0644); err != nil {
		t.Fatal(err)
	}

	SetRegistryPath(reg1)
	defer SetRegistryPath("")
	_ = LoadRegistry()
	if !IsSupportedExt(".aaa") {
		t.Fatal("r1 下 IsSupportedExt('.aaa') 应为 true")
	}
	if IsSupportedExt(".bbb") {
		t.Fatal("r1 下 IsSupportedExt('.bbb') 应为 false")
	}
	// hashSet 半区同样随实例重建（reg1 声明 hashable:true）
	if !ShouldHashExt(".aaa") {
		t.Fatal("r1 下 ShouldHashExt('.aaa') 应为 true（hashable 声明）")
	}
	if ShouldHashExt(".bbb") {
		t.Fatal("r1 下 ShouldHashExt('.bbb') 应为 false")
	}

	// 切换注册表 → 扩展名集合缓存必须随实例失效重建（extSet 与 hashSet 双半区）
	SetRegistryPath(reg2)
	_ = LoadRegistry()
	if !IsSupportedExt(".bbb") {
		t.Fatal("切到 r2 后 IsSupportedExt('.bbb') 应为 true（缓存需随注册表实例重建）")
	}
	if IsSupportedExt(".aaa") {
		t.Fatal("切到 r2 后 IsSupportedExt('.aaa') 应为 false")
	}
	if !ShouldHashExt(".bbb") {
		t.Fatal("切到 r2 后 ShouldHashExt('.bbb') 应为 true（hashSet 需随实例重建）")
	}
	if ShouldHashExt(".aaa") {
		t.Fatal("切到 r2 后 ShouldHashExt('.aaa') 应为 false")
	}
}
