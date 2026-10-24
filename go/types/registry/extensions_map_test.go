package registry

import (
	"os"
	"path/filepath"
	"testing"
	"ysm-model-manager/internal/testutil"
)

// 扩展名集合 map 缓存（IsSupportedExt/ShouldHashExt 性能收敛）行为锁定：
// 基本正确性 + 大小写不敏感 + 随注册表实例失效重建。
// 防回归点：若未来误用 sync.Once 永久缓存 map，SetRegistryPath 切换后
// 本测试的「重建」断言会红——缓存必须以注册表实例指针为失效 key。

func TestExtSetCache_BasicCorrectness(t *testing.T) {
	testutil.Equal(t, IsSupportedExt(".ysm"), true, "IsSupportedExt('.ysm') 应为 true")
	testutil.Equal(t, IsSupportedExt(".YSM"), true, "IsSupportedExt('.YSM') 应为 true（大小写不敏感）")
	testutil.Equal(t, IsSupportedExt(".definitely_unknown_ext_xyz"), false, "未知扩展名应为 false")
	// ShouldHashExt 保持注册表 hashable 语义：正例 .ysm（PinnedList 已锁定 hashable），
	// 负例 .txt（非 hashable 类型）——防 hashSet 半区被复制粘贴成 extSet 后仍全绿
	// （code_review P3：原 `_ = ShouldHashExt(".ysm")` 丢弃返回值，行为锁定形同虚设）
	testutil.Equal(t, ShouldHashExt(".ysm"), true, "ShouldHashExt('.ysm') 应为 true（注册表 hashable 驱动）")
	testutil.Equal(t, ShouldHashExt(".txt"), false, "ShouldHashExt('.txt') 应为 false（非 hashable 类型）")
}

func TestExtSetCache_RebuildOnRegistrySwap(t *testing.T) {
	dir := t.TempDir()
	reg1 := filepath.Join(dir, "r1.json")
	if err := os.WriteFile(reg1, []byte(`{"resourceTypes":[{"id":"alpha","extensions":[".aaa"],"hashable":true,"storageSubDir":"alpha"}]}`), 0644); err != nil {
		testutil.NoError(t, err)
	}
	reg2 := filepath.Join(dir, "r2.json")
	if err := os.WriteFile(reg2, []byte(`{"resourceTypes":[{"id":"beta","extensions":[".bbb"],"hashable":true,"storageSubDir":"beta"}]}`), 0644); err != nil {
		testutil.NoError(t, err)
	}

	SetRegistryPath(reg1)
	defer SetRegistryPath("")
	_ = LoadRegistry()
	testutil.Equal(t, IsSupportedExt(".aaa"), true, "r1 下 IsSupportedExt('.aaa') 应为 true")
	testutil.Equal(t, IsSupportedExt(".bbb"), false, "r1 下 IsSupportedExt('.bbb') 应为 false")
	// hashSet 半区同样随实例重建（reg1 声明 hashable:true）
	testutil.Equal(t, ShouldHashExt(".aaa"), true, "r1 下 ShouldHashExt('.aaa') 应为 true（hashable 声明）")
	testutil.Equal(t, ShouldHashExt(".bbb"), false, "r1 下 ShouldHashExt('.bbb') 应为 false")

	// 切换注册表 → 扩展名集合缓存必须随实例失效重建（extSet 与 hashSet 双半区）
	SetRegistryPath(reg2)
	_ = LoadRegistry()
	testutil.Equal(t, IsSupportedExt(".bbb"), true, "切到 r2 后 IsSupportedExt('.bbb') 应为 true（缓存需随注册表实例重建）")
	testutil.Equal(t, IsSupportedExt(".aaa"), false, "切到 r2 后 IsSupportedExt('.aaa') 应为 false")
	testutil.Equal(t, ShouldHashExt(".bbb"), true, "切到 r2 后 ShouldHashExt('.bbb') 应为 true（hashSet 需随实例重建）")
	testutil.Equal(t, ShouldHashExt(".aaa"), false, "切到 r2 后 ShouldHashExt('.aaa') 应为 false")
}
