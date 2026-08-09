// ===== go/instance 单测（ADR-003 补充下沉验证）=====
package instance

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func TestBuildSyncItems_Basic(t *testing.T) {
	sub := types.SubDirMap("ysm")
	if sub == "" {
		t.Skip("ysm 无 ScanDir 配置，跳过目录构造测试")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(filepath.Join(base, "inst"), sub)
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(instDir, 0755); err != nil {
		t.Fatal(err)
	}
	// Synced: 两处一致
	_ = os.WriteFile(filepath.Join(globalDir, "m.ysm"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(instDir, "m.ysm"), []byte("x"), 0644)
	// Missing: 全局有、整合包没有
	_ = os.WriteFile(filepath.Join(globalDir, "missing.ysm"), []byte("x"), 0644)
	// Extra: 整合包有、全局没有
	_ = os.WriteFile(filepath.Join(instDir, "extra.ysm"), []byte("x"), 0644)

	ins := &types.VersionInstance{Name: "t", VersionDir: filepath.Join(base, "inst")}
	items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "ysm", Icon: "📦"}}, map[string]string{"ysm": globalDir})
	if len(items) == 0 {
		t.Fatal("应产出同步状态项")
	}

	byName := map[string]types.ResourceSyncItem{}
	for _, it := range items {
		byName[it.Name] = it
	}
	if it, ok := byName["m.ysm"]; !ok || it.Status != types.SyncStatusSynced {
		t.Fatalf("m.ysm 应 Synced: %+v", it)
	}
	if it, ok := byName["missing.ysm"]; !ok || it.Status != types.SyncStatusMissing {
		t.Fatalf("missing.ysm 应 Missing: %+v", it)
	}
	if it, ok := byName["extra.ysm"]; !ok || it.Status != types.SyncStatusOptional {
		t.Fatalf("extra.ysm 应 Optional: %+v", it)
	}
}

func TestBuildSyncItems_EmptyInputs(t *testing.T) {
	// 无资源类型 → 空
	ins := &types.VersionInstance{Name: "t", VersionDir: t.TempDir()}
	if items := BuildSyncItems(ins, nil, map[string]string{}); len(items) != 0 {
		t.Fatalf("无资源类型应返回空，实际 %d", len(items))
	}
	// 资源类型 root 为空 → 跳过该类型
	if items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "ysm", Icon: "📦"}}, map[string]string{"ysm": ""}); len(items) != 0 {
		t.Fatalf("root 为空应跳过，实际 %d", len(items))
	}
}

// ====== isResourcePackFolder ======

func TestIsResourcePackFolder_Yes(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "pack.mcmeta"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if !isResourcePackFolder(dir) {
		t.Error("含 pack.mcmeta 的目录应识别为资源包文件夹")
	}
}

func TestIsResourcePackFolder_No(t *testing.T) {
	dir := t.TempDir()
	if isResourcePackFolder(dir) {
		t.Error("无 pack.mcmeta 的目录不应识别")
	}
}

func TestIsResourcePackFolder_NonExistent(t *testing.T) {
	if isResourcePackFolder("/nonexistent/path") {
		t.Error("不存在的目录不应识别")
	}
}

// P2 修复（code_review）：synced pack.mcmeta 文件夹必须恰好出现一条——
// 主循环（含 isResourcePackFolder 放行）是文件夹唯一来源；兜底 Walk 的文件夹分支
// 已删除，防止同一文件夹被加两次（UI 显示同包双状态 Synced+Optional）
func TestBuildSyncItems_SyncedPackFolderExactlyOnce(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(base, "inst")
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	// 实例侧与全局侧都有同一资源包文件夹（含 pack.mcmeta）→ SyncResources 判 Synced
	instPack := filepath.Join(instDir, "PackA")
	globalPack := filepath.Join(globalDir, "PackA")
	if err := os.MkdirAll(instPack, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(globalPack, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(instPack, "pack.mcmeta"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(globalPack, "pack.mcmeta"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	ins := &types.VersionInstance{VersionDir: base}
	items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "resourcepack", Icon: "🎨"}}, map[string]string{"resourcepack": globalDir})
	count := 0
	for _, it := range items {
		if it.Name == "PackA" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("synced 资源包文件夹应恰好 1 条，实际 %d（%d 总数）", count, len(items))
	}
}
