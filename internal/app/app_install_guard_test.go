// ===== 根级守卫测试（技术债排期 #1-3 的回归护栏，code_review P3 补测）=====
// MoveToRecycle 整仓入回收站 / findRecycleRoot 段语义——注入 configCache 提供 roots
package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// guardedApp 构造注入 configCache 的 App（各资源根指向 temp 子目录）
func guardedApp(t *testing.T) (*App, string) {
	t.Helper()
	base := t.TempDir()
	ysm := filepath.Join(base, "ysm")
	if err := os.MkdirAll(ysm, 0755); err != nil {
		t.Fatal(err)
	}
	a := &App{}
	a.configMu.Lock()
	a.configCache = types.AppConfig{
		FilesRoot:        base,
		ResourcepackRoot: filepath.Join(base, "resourcepacks"),
		ShaderpackRoot:   filepath.Join(base, "shaderpacks"),
		SchematicRoot:    filepath.Join(base, "schematics"),
		MmdRoot:          filepath.Join(base, "mmd"),
		VrcRoot:          filepath.Join(base, "vrc"),
	}
	a.configLoaded = true
	a.configMu.Unlock()
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
