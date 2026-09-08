package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateFlatStorageToGrouped_FlatToGrouped(t *testing.T) {
	base := t.TempDir()
	// 创建扁平结构（按 resource_types.json 的 StorageSubDir）
	flatYsm := filepath.Join(base, "ysm")
	os.MkdirAll(flatYsm, 0755)
	origContent := []byte("x")
	if err := os.WriteFile(filepath.Join(flatYsm, "test.ysm"), origContent, 0644); err != nil {
		t.Fatal(err)
	}

	migrateFlatStorageToGrouped(base)

	// 验证扁平目录已迁移（删除）
	if _, err := os.Stat(flatYsm); !os.IsNotExist(err) {
		t.Errorf("扁平目录 ysm/ 应被迁移删除")
		return
	}

	// 验证分组结构已创建
	groupedYsm := filepath.Join(base, "minecraft-mod", "ysm")
	if _, err := os.Stat(groupedYsm); err != nil {
		t.Errorf("分组目录 minecraft-mod/ysm/ 应被创建: %v", err)
	}

	// 验证文件已迁移且内容一致
	migratedPath := filepath.Join(groupedYsm, "test.ysm")
	migratedData, err := os.ReadFile(migratedPath)
	if err != nil {
		t.Fatalf("迁移后的文件应存在: %v", err)
	}
	if string(migratedData) != string(origContent) {
		t.Errorf("迁移后文件内容不一致: 期望 %q, 实际 %q", origContent, migratedData)
	}
}

func TestMigrateFlatStorageToGrouped_TargetExists(t *testing.T) {
	base := t.TempDir()
	// 目标已存在（分组结构）
	groupedYsm := filepath.Join(base, "minecraft-mod", "ysm")
	os.MkdirAll(groupedYsm, 0755)
	os.WriteFile(filepath.Join(groupedYsm, "existing.ysm"), []byte("x"), 0644)

	// 扁平源也存在（模拟并发创建）
	flatYsm := filepath.Join(base, "ysm")
	os.MkdirAll(flatYsm, 0755)
	os.WriteFile(filepath.Join(flatYsm, "flat.ysm"), []byte("x"), 0644)

	migrateFlatStorageToGrouped(base)

	// 目标应保持不变
	if _, err := os.Stat(filepath.Join(groupedYsm, "existing.ysm")); err != nil {
		t.Errorf("已有文件应保留: %v", err)
	}
	// 扁平源应保留（不覆盖目标）
	if _, err := os.Stat(filepath.Join(flatYsm, "flat.ysm")); err != nil {
		t.Errorf("扁平源不应被删除（目标已存在）: %v", err)
	}
}

func TestMigrateFlatStorageToGrouped_NoFlatDirs(t *testing.T) {
	base := t.TempDir()
	// 无任何目录，不应报错
	migrateFlatStorageToGrouped(base)
	// 静默成功即可
}

func TestMigrateFlatStorageToGrouped_PartialMigration(t *testing.T) {
	base := t.TempDir()
	// 只有 ysm 扁平目录，mmd 不存在
	flatYsm := filepath.Join(base, "ysm")
	os.MkdirAll(flatYsm, 0755)

	migrateFlatStorageToGrouped(base)

	// ysm 应迁移
	groupedYsm := filepath.Join(base, "minecraft-mod", "ysm")
	if _, err := os.Stat(groupedYsm); err != nil {
		t.Errorf("minecraft-mod/ysm/ 应被创建: %v", err)
	}
	// mmd 源不存在，目标不应被创建
	groupedMmd := filepath.Join(base, "mmd", "EntityPlayer")
	if _, err := os.Stat(groupedMmd); !os.IsNotExist(err) {
		t.Errorf("mmd/EntityPlayer/ 不应被创建（源不存在）")
	}
}
