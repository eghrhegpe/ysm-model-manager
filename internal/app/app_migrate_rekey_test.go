// 启动扁平→分组迁移后标签键跟随（审计 G2 收口，2026-10-11）。
// 老版本用户的标签键在扁平旧路径（base/ysm/...）；升级启动时目录被搬到分组结构
// （base/minecraft-mod/ysm/...），裸 os.Rename 使旧路径标签键全成**永久孤儿**
// （ListByTag 出死路径、同名重建复活旧标签——rekey/prune 派生闸只盯 go/fileops
// 导出面，裸 os 调用天然不可见）。测试：预置老版本标签库 → 跑迁移+跟随入口 →
// 旧键删、分组新键带标签。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

func TestMigrateAndRekey_TagsFollowGroupedMigration(t *testing.T) {
	base := t.TempDir()
	// 升级前的老扁平存储：ysm/modelA/{ysm.json, sub/face.png}（ysm 夹模型标签打在 ysm.json）
	flatYsm := filepath.Join(base, "ysm", "modelA", "ysm.json")
	flatTex := filepath.Join(base, "ysm", "modelA", "sub", "face.png")
	touch(t, flatYsm)
	touch(t, flatTex)

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	// 模拟老版本留下的标签库（键在扁平路径——绑定守卫认的仓库根是分组新根，
	// 扁平路径 SetModelTags 会被拒，直接落 store 层）
	store := a.getTagsStore()
	if err := store.SetTags(flatYsm, []string{"主"}); err != nil {
		t.Fatal(err)
	}
	if err := store.SetTags(flatTex, []string{"纹理"}); err != nil {
		t.Fatal(err)
	}

	// 启动入口：迁移 + 标签跟随
	a.migrateAndRekey(base)

	groupedRoot := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	newYsm := filepath.Join(groupedRoot, "modelA", "ysm.json")
	newTex := filepath.Join(groupedRoot, "modelA", "sub", "face.png")
	if _, err := os.Lstat(newYsm); err != nil {
		t.Fatalf("文件应真实迁到分组新落点: %v", err)
	}
	if got, _ := store.GetTags(newYsm); len(got) != 1 || got[0] != "主" {
		t.Errorf("迁移后新 ysm.json 键应继承标签，实得 %v", got)
	}
	if got, _ := store.GetTags(newTex); len(got) != 1 || got[0] != "纹理" {
		t.Errorf("迁移后新子文件键应继承标签，实得 %v", got)
	}
	if got, _ := store.GetTags(flatYsm); len(got) != 0 {
		t.Errorf("旧扁平路径键应已删（move 语义删旧键），实得 %v", got)
	}
	if got, _ := store.GetTags(flatTex); len(got) != 0 {
		t.Errorf("旧扁平路径子文件键应已删，实得 %v", got)
	}
}

func TestMigrateAndRekey_TargetExistsKeepsTags(t *testing.T) {
	// 分组目标已存在（并发/手工已建）→ 不迁移不 rekey，旧键原样留在扁平路径
	base := t.TempDir()
	flat := filepath.Join(base, "ysm", "a.ysm")
	touch(t, flat)
	if err := os.MkdirAll(filepath.Join(base, registry.GroupStorageRoot("ysm")), 0o755); err != nil {
		t.Fatal(err)
	}

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	store := a.getTagsStore()
	if err := store.SetTags(flat, []string{"驻留"}); err != nil {
		t.Fatal(err)
	}

	a.migrateAndRekey(base)

	if got, _ := store.GetTags(flat); len(got) != 1 {
		t.Errorf("目标已存在未迁移，旧键应保留，实得 %v", got)
	}
}

func TestMigrateFlatStorageToGrouped_ReturnsMigratedPairs(t *testing.T) {
	// 对返回契约：成功迁移返回 (旧,新) 绝对路径对；无迁移场景返回空
	base := t.TempDir()
	touch(t, filepath.Join(base, "ysm", "a.ysm"))
	pairs := migrateFlatStorageToGrouped(base)
	if len(pairs) != 1 {
		t.Fatalf("应返回 1 对迁移路径，实得 %d", len(pairs))
	}
	wantFrom := filepath.Join(base, "ysm")
	wantTo := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if pairs[0][0] != wantFrom || pairs[0][1] != wantTo {
		t.Errorf("pair 应为 (扁平源, 分组目标) 绝对路径，实得 %v", pairs[0])
	}
	// 第二次运行：目标已存在 → 无迁移 → 空（幂等，防重复 rekey 把键搬回旧位）
	if pairs2 := migrateFlatStorageToGrouped(base); len(pairs2) != 0 {
		t.Errorf("目标已存在应返回空，实得 %v", pairs2)
	}
}
