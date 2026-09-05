// ===== 根级守卫测试（技术债排期 #1-3 的回归护栏，code_review P3 补测）=====
// MoveToRecycle 整仓入回收站 / findRecycleRoot 段语义——注入 configCache 提供 roots
package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// guardedApp 构造注入 configCache 的 App（各资源根指向 temp 子目录），复用 repoApp 注入样板
func guardedApp(t *testing.T) (*App, string) {
	t.Helper()
	base := t.TempDir()
	// ADR-092 两层路由：ysm 根在 FilesRoot/{group}/{storageSubDir}
	ysm := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(ysm, 0755); err != nil {
		t.Fatal(err)
	}
	a := repoApp(t, types.AppConfig{
		FilesRoot:        base,
		ResourcepackRoot: filepath.Join(base, "resourcepacks"),
		ShaderpackRoot:   filepath.Join(base, "shaderpacks"),
		SchematicRoot:    filepath.Join(base, "schematics"),
		MmdRoot:          filepath.Join(base, "mmd"),
		VrcRoot:          filepath.Join(base, "vrc"),
	})
	return a, ysm
}

func TestMoveToRecycle_RootRejected(t *testing.T) {
	a, ysm := guardedApp(t)
	err := a.MoveToRecycle(ysm)
	if err == nil {
		t.Fatal("MoveToRecycle(资源根) 应拒绝")
	}
	if !strings.Contains(err.Error(), "资源根目录整体移入回收站") {
		t.Fatalf("应提示根级拒绝, got %v", err)
	}
	// 根目录未被移走（.recycle 不应出现在根本身下）
	if _, err := os.Stat(filepath.Join(ysm, ".recycle")); err == nil {
		t.Fatal("根目录不得被移入回收站")
	}
}

func TestFindRecycleRoot_RootNotMatched(t *testing.T) {
	a, ysm := guardedApp(t)
	// src == root → 不判命中（返回 ""，调用方 fallback ysmRoot 后 Clean 相等拒绝）
	if got := a.findRecycleRoot(ysm); got != "" {
		t.Fatalf("src==root 不应判命中, got %q", got)
	}
	// src 在根内合法子目录 → 命中
	sub := filepath.Join(ysm, "..foo", "m.ysm") // ..foo 合法名（精确段比较不误拒）
	if got := a.findRecycleRoot(sub); got != ysm {
		t.Fatalf("..foo 子目录应命中根, got %q", got)
	}
	// 外部路径 → 不命中
	outside := filepath.Join(filepath.Dir(ysm), "..", "outside", "x.ysm")
	if got := a.findRecycleRoot(outside); got != "" {
		t.Fatalf("外部路径不应命中, got %q", got)
	}
}

// TestFindRecycleRoot_CustomRootsIncluded 回归护栏（codereview 批次3 P2）：
// migrateLegacyConfigFields 已清空废弃字段（ResourcepackRoot 等），回收站根列表
// 必须纳入 CustomRoots——否则迁移后 MMD/VRC 等自定义根下的回收条目静默消失。
func TestFindRecycleRoot_CustomRootsIncluded(t *testing.T) {
	a, _ := guardedApp(t)
	// 注入与迁移后状态一致的 configCache：废弃字段已清空，CustomRoots 为唯一事实源
	mmdCustom := filepath.Join(t.TempDir(), "mmd-custom")
	if err := os.MkdirAll(mmdCustom, 0755); err != nil {
		t.Fatal(err)
	}
	cfg := types.AppConfig{
		FilesRoot:   a.configCache.FilesRoot,
		CustomRoots: map[string]string{"mmd": mmdCustom},
	}
	a.configCache = cfg

	inCustom := filepath.Join(mmdCustom, "model", "char.pmx")
	if got := a.findRecycleRoot(inCustom); got != mmdCustom {
		t.Fatalf("CustomRoots 内的文件应命中自定义根, got %q want %q", got, mmdCustom)
	}
	// allRecycleRoots 同样须包含 CustomRoots 条目（ListRecycleBin/Restore 等依赖它）
	roots := a.allRecycleRoots(cfg)
	found := false
	for _, r := range roots {
		if r == mmdCustom {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("allRecycleRoots 应包含 CustomRoots 条目 %q, got %v", mmdCustom, roots)
	}
}
