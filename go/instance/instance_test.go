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
