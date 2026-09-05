// ===== ToggleEnable 统一启禁单测（兄弟会话裁定：无 rtype，纯路径包含判定）=====
// 修复「资源包/整合包内路径被 ToggleModelEnable 的 ysmRoot 守卫拒绝」——
// 用户报错：对 D:\...\minecraft\resourcepacks\3D-muskets.zip 启禁 → "拒绝操作仓库外路径"。
package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

func TestToggleEnable(t *testing.T) {
	base := t.TempDir()
	mc := t.TempDir()
	cfg := types.AppConfig{
		FilesRoot: base,
		McRoot:    mc,
		CustomRoots: map[string]string{
			"resourcepack": filepath.Join(base, "rp"),
		},
	}
	a := repoApp(t, cfg)

	// GetRepoRoot("ysm") = FilesRoot/{GroupStorageRoot("ysm")}（ADR-092 两层路由）
	ysmRoot := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}

	t.Run("整合包内资源包可启禁（McRoot，原 ToggleModelEnable 拒绝场景）", func(t *testing.T) {
		pack := filepath.Join(mc, "resourcepacks", "3D-muskets.zip")
		if err := os.MkdirAll(filepath.Dir(pack), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(pack, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		enabled, err := a.ToggleEnable(pack)
		if err != nil {
			t.Fatalf("整合包内资源包应可启禁: %v", err)
		}
		if enabled {
			t.Error("首次切换应为禁用态（false）")
		}
		if _, err := os.Stat(pack + ".disabled"); err != nil {
			t.Errorf("应生成 .disabled: %v", err)
		}
		// 再切换恢复
		enabled2, err := a.ToggleEnable(pack + ".disabled")
		if err != nil {
			t.Fatal(err)
		}
		if !enabled2 {
			t.Error("恢复后应为启用态（true）")
		}
		if _, err := os.Stat(pack); err != nil {
			t.Errorf("应移除 .disabled 恢复原文件: %v", err)
		}
	})

	t.Run("仓库内 ysm 模型可启禁（落在 ysmRoot 子根）", func(t *testing.T) {
		f := filepath.Join(ysmRoot, "狐狸", "狐狸.ysm")
		if err := os.MkdirAll(filepath.Dir(f), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		enabled, err := a.ToggleEnable(f)
		if err != nil {
			t.Fatalf("仓库内 ysm 应可启禁: %v", err)
		}
		if enabled {
			t.Error("首次应为禁用态（false）")
		}
		if _, err := os.Stat(f + ".disabled"); err != nil {
			t.Errorf("应生成 .disabled: %v", err)
		}
	})

	t.Run("仓库内 resourcepack（CustomRoots 覆写）可启禁", func(t *testing.T) {
		rpRoot := cfg.CustomRoots["resourcepack"]
		if err := os.MkdirAll(rpRoot, 0o755); err != nil {
			t.Fatal(err)
		}
		f := filepath.Join(rpRoot, "a.zip")
		if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		enabled, err := a.ToggleEnable(f)
		if err != nil {
			t.Fatalf("CustomRoots 内资源包应可启禁: %v", err)
		}
		if enabled {
			t.Error("首次应为禁用态（false）")
		}
	})

	t.Run("仓库外路径拒绝", func(t *testing.T) {
		outside := filepath.Join(t.TempDir(), "x.ysm")
		if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		_, err := a.ToggleEnable(outside)
		if err == nil {
			t.Fatal("仓库外路径应拒绝")
		}
		if !strings.Contains(err.Error(), "拒绝操作仓库外路径") {
			t.Errorf("错误应含仓库外提示, got %v", err)
		}
	})

	t.Run("path==仓库子根拒绝（ysmRoot 根守卫）", func(t *testing.T) {
		_, err := a.ToggleEnable(ysmRoot)
		if err == nil {
			t.Fatal("对仓库子根启禁应拒绝")
		}
		if !strings.Contains(err.Error(), "资源根目录") {
			t.Errorf("错误应含根目录提示, got %v", err)
		}
	})

	t.Run("path==FilesRoot 根拒绝", func(t *testing.T) {
		_, err := a.ToggleEnable(base)
		if err == nil {
			t.Fatal("对 FilesRoot 根启禁应拒绝")
		}
		if !strings.Contains(err.Error(), "资源根目录") {
			t.Errorf("错误应含根目录提示, got %v", err)
		}
	})
}
