package recycle

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

func TestNew(t *testing.T) {
	tm := New("/tmp/testroot")
	if tm.RecycleDir() != filepath.Join("/tmp/testroot", ".recycle") {
		t.Errorf("unexpected recycle dir: %s", tm.RecycleDir())
	}
}

func TestMoveAndRestore(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	src := testutil.CreateTestFile(t, dir, "test.ysm", "test content")
	// 移到回收站
	testutil.NoError(t, tm.Move(src))
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Error("源文件应该已被删除")
	}

	// 列出回收站
	entries := tm.List()
	testutil.Equal(t, len(entries), 1, "回收站应有 1 个文件，得到 %d", len(entries))

	// 恢复
	testutil.NoError(t, tm.Restore(entries[0].Path))
	if _, err := os.Stat(src); os.IsNotExist(err) {
		t.Error("恢复后源文件应存在")
	}
}

func TestDelete(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	src := testutil.CreateTestFile(t, dir, "test.ysm", "delete me")
	testutil.NoError(t, tm.Move(src))
	entries := tm.List()
	testutil.Equal(t, len(entries), 1, "回收站应有 1 个文件")
	testutil.NoError(t, tm.Delete(entries[0].Path))
	if len(tm.List()) != 0 {
		t.Error("删除后回收站应为空")
	}
}

func TestEmpty(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	testutil.CreateTestFile(t, dir, "a.ysm", "a")
	testutil.CreateTestFile(t, dir, "b.ysm", "b")
	tm.Move(filepath.Join(dir, "a.ysm"))
	tm.Move(filepath.Join(dir, "b.ysm"))

	count, err := tm.Empty()
	testutil.NoError(t, err)
	if count != 2 {
		t.Errorf("应清空 2 个文件，得到 %d", count)
	}
	if len(tm.List()) != 0 {
		t.Error("清空后回收站应为空")
	}
}

func TestEmptyWithSubdir(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	// 创建含子目录的文件结构：子目录/subfile.ysm
	subDir := filepath.Join(dir, "subfolder")
	testutil.CreateTestFile(t, subDir, "nested.ysm", "nested content")
	tm.Move(filepath.Join(dir, "subfolder", "nested.ysm"))
	// 回收站中应有子目录结构
	entries := tm.List()
	testutil.Equal(t, len(entries), 1, "回收站应有 1 个文件，得到 %d", len(entries))

	count, err := tm.Empty()
	testutil.NoError(t, err)
	if count != 1 {
		t.Errorf("应清空 1 个文件，得到 %d", count)
	}
	if len(tm.List()) != 0 {
		t.Error("清空后回收站应为空（含子目录场景）")
	}
}

// 陷阱 #8：硬链接（nlink>1）→ 直接删除，不进回收站
func TestMoveHardLink(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	src := testutil.CreateTestFile(t, dir, "link.ysm", "hardlink content")
	link2 := filepath.Join(dir, "link2.ysm")
	if err := os.Link(src, link2); err != nil {
		t.Skipf("os.Link 不可用: %v", err)
	}
	res := tm.MoveEx(src)
	testutil.Equal(t, res.Action, "deleted_link", "硬链接应直接删除（%s）", res.Reason)
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Error("硬链接源应已删除")
	}
	// 另一个链接的数据必须还在（直接删除只断一个链接）
	if _, err := os.Stat(link2); err != nil {
		t.Error("硬链接另一份应保留")
	}
	if len(tm.List()) != 0 {
		t.Error("硬链接不应进回收站")
	}
}

// 陷阱 #8：符号链接 → 直接删除，目标文件不受影响
func TestMoveSymlink(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	target := testutil.CreateTestFile(t, dir, "target.ysm", "target content")
	src := filepath.Join(dir, "sym.ysm")
	if err := os.Symlink(target, src); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}
	res := tm.MoveEx(src)
	testutil.Equal(t, res.Action, "deleted_link", "符号链接应直接删除")
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Error("符号链接应已删除")
	}
	if _, err := os.Stat(target); err != nil {
		t.Error("符号链接目标不应受影响")
	}
}

// 同名文件再次回收 → (1) 后缀
func TestMoveDuplicateName(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	src := testutil.CreateTestFile(t, dir, "dup.ysm", "first")
	testutil.NoError(t, tm.Move(src))
	src2 := testutil.CreateTestFile(t, dir, "dup.ysm", "second")
	testutil.NoError(t, tm.Move(src2))
	entries := tm.List()
	testutil.Equal(t, len(entries), 2, "回收站应有 2 个文件，得到 %d", len(entries))
	found := false
	for _, e := range entries {
		if e.Name == "dup(1).ysm" {
			found = true
		}
	}
	if !found {
		t.Error("重名文件应带 (1) 后缀")
	}
}

// 恢复时目标已存在 → 生成 keep(1).ysm
func TestRestoreConflict(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	src := testutil.CreateTestFile(t, dir, "keep.ysm", "orig")
	testutil.NoError(t, tm.Move(src))
	testutil.CreateTestFile(t, dir, "keep.ysm", "new") // 恢复前在源位置重建
	entries := tm.List()
	testutil.Equal(t, len(entries), 1, "回收站应有 1 个文件")
	testutil.NoError(t, tm.Restore(entries[0].Path))
	if _, err := os.Stat(filepath.Join(dir, "keep(1).ysm")); err != nil {
		t.Error("冲突恢复应生成 keep(1).ysm")
	}
}

// Restore 对非 IsNotExist 错误必须返回而不静默成功——
// 用「恢复目标父路径组件是文件」构造：MkdirAll(dir/sub) 遇同名文件返回 ENOTDIR，
// 旧实现若把这类错误当 IsNotExist 处理会静默降级/死循环，新实现应返回错误
func TestRestoreConflict_NonNotExistError(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	// 嵌套路径移入回收站：dir/sub/keep.ysm → 回收站 sub/keep.ysm（rel 保留层级）
	subDir := filepath.Join(dir, "sub")
	testutil.NoError(t, os.MkdirAll(subDir, 0755))
	src := filepath.Join(subDir, "keep.ysm")
	testutil.NoError(t, os.WriteFile(src, []byte("orig"), 0644))
	testutil.NoError(t, tm.Move(src))
	// 破坏恢复目标：把 sub 目录删掉、换成同名文件 → MkdirAll(dir/sub) 遇文件报 ENOTDIR（非 IsNotExist）
	testutil.NoError(t, os.RemoveAll(subDir))
	testutil.NoError(t, os.WriteFile(subDir, []byte("x"), 0644))
	entries := tm.List()
	testutil.Equal(t, len(entries), 1, "回收站应有 1 个文件")
	err := tm.Restore(entries[0].Path)
	testutil.NotNil(t, err, "恢复应失败（父路径组件是文件，MkdirAll/Stat 报非 IsNotExist 错误）")
}

func TestList_FolderModelGrouped(t *testing.T) {
	// ADR-038 D3.4：文件夹型模型（含 ysm.json 的目录）整组合并显示为单一条目
	dir := t.TempDir()
	tm := New(dir)

	// 构造一个文件夹模型目录：模型A/ysm.json + main.json + textures/
	modelDir := filepath.Join(dir, "模型A")
	testutil.NoError(t, os.MkdirAll(filepath.Join(modelDir, "textures"), 0755))
	testutil.NoError(t, os.WriteFile(filepath.Join(modelDir, "ysm.json"), []byte(`{"spec":1}`), 0644))
	testutil.NoError(t, os.WriteFile(filepath.Join(modelDir, "main.json"), []byte(`{}`), 0644))
	testutil.NoError(t, os.WriteFile(filepath.Join(modelDir, "textures", "skin.png"), []byte("PNG"), 0644))
	// 整组移入回收站
	testutil.NoError(t, tm.Move(modelDir), "整组移入回收站失败")
	// 另放一个单文件模型
	single := testutil.CreateTestFile(t, dir, "single.ysm", "x")
	testutil.NoError(t, tm.Move(single))

	entries := tm.List()
	// 应合并为 2 条：模型A（整组）+ single.ysm（单文件）
	testutil.Equal(t, len(entries), 2, "回收站应有 2 条（整组目录 1 + 单文件 1），实际 %d", len(entries))
	// 找到整组目录条目：Name = 模型A，Path 指向目录（含 ysm.json）
	var groupEntry *types.ModelEntry
	for i := range entries {
		if entries[i].Name == "模型A" {
			groupEntry = &entries[i]
			break
		}
	}
	testutil.NotNil(t, groupEntry, "应存在整组目录条目 模型A")
	// Path 应指向目录本身（而非 ysm.json 单文件）
	testutil.FileExists(t, filepath.Join(groupEntry.Path, "ysm.json"), "整组条目 Path 应指向含 ysm.json 的目录")
	// 整组大小应包含目录内全部文件
	testutil.Equal(t, groupEntry.Size <= 0, false, "整组条目 Size 应大于 0")
	// Restore 应目录级还原：整组回来
	testutil.NoError(t, tm.Restore(groupEntry.Path), "整组还原失败")
	testutil.FileExists(t, filepath.Join(dir, "模型A", "ysm.json"), "整组还原后 ysm.json 应存在")
	testutil.FileExists(t, filepath.Join(dir, "模型A", "textures", "skin.png"), "整组还原后 textures/skin.png 应存在")
}

func TestList_FolderModelNotGrouped(t *testing.T) {
	// ADR-038 D3.4：无 ysm.json 的普通目录不合并，文件仍逐个列出
	dir := t.TempDir()
	tm := New(dir)

	// 普通目录（无 ysm.json）
	plainDir := filepath.Join(dir, "plain")
	testutil.NoError(t, os.MkdirAll(plainDir, 0755))
	plainFile := testutil.CreateTestFile(t, plainDir, "a.ysm", "x")
	testutil.NoError(t, tm.Move(plainFile))

	entries := tm.List()
	// 普通目录内的 .ysm 文件应逐个列出（不合并）
	// 序贯拆分：前一 Equal 失败即 Goexit，下一行的 [0] 索引才安全
	testutil.Equal(t, len(entries), 1, "普通目录文件应逐个列出, 实际 %d", len(entries))
	testutil.Equal(t, entries[0].Name, "a.ysm", "条目应为 a.ysm")
}

// List 扩展名过滤：不支持扩展名的文件不列出；.ban（禁用标记）与支持扩展名列出——
// 被禁用的模型在回收站中仅以 `x.ysm.ban` 存在（禁用 = 改名 .ban），必须可见才可恢复。
func TestList_FiltersUnsupportedAndBan(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	// 三个文件都进回收站：支持的 .ysm、禁用标记 .ban、不支持扩展 .xyz
	testutil.NoError(t, tm.Move(testutil.CreateTestFile(t, dir, "keep.ysm", "x")))
	testutil.NoError(t, tm.Move(testutil.CreateTestFile(t, dir, "disabled.ban", "x")))
	testutil.NoError(t, tm.Move(testutil.CreateTestFile(t, dir, "notes.xyz", "x")))

	entries := tm.List()
	// .ban 与 .ysm 均列出（共 2 条），.xyz 被过滤
	testutil.Equal(t, len(entries), 2, "应列出 keep.ysm + disabled.ban（.xyz 过滤）, 实际 %d 条: %v", len(entries), entries)
	names := map[string]bool{}
	for _, e := range entries {
		names[e.Name] = true
	}
	testutil.Equal(t, names["keep.ysm"] && names["disabled.ban"], true, "应同时列出 keep.ysm 与 disabled.ban, 实际 %v", names)
	testutil.Equal(t, names["notes.xyz"], false, "不支持扩展名 notes.xyz 不应列出")
}

func TestDelete_FolderModelGrouped(t *testing.T) {
	// ADR-038 D3.4：永久删除整组合并条目（Path 指向目录）应成功（os.RemoveAll 目录）
	dir := t.TempDir()
	tm := New(dir)

	// 文件夹模型整组移入回收站
	modelDir := filepath.Join(dir, "模型A")
	testutil.NoError(t, os.MkdirAll(filepath.Join(modelDir, "textures"), 0755))
	testutil.NoError(t, os.WriteFile(filepath.Join(modelDir, "ysm.json"), []byte(`{"spec":1}`), 0644))
	testutil.NoError(t, os.WriteFile(filepath.Join(modelDir, "main.json"), []byte(`{}`), 0644))
	testutil.NoError(t, tm.Move(modelDir), "整组移入回收站失败")

	entries := tm.List()
	testutil.Equal(t, len(entries), 1, "应合并为 1 条, 实际 %d", len(entries))
	// 永久删除整组条目（Path 指向目录）
	testutil.NoError(t, tm.Delete(entries[0].Path), "永久删除整组条目失败")
	// 回收站内目录应已删除
	testutil.FileNotExists(t, entries[0].Path, "整组条目应已删除")
	// 列表应为空
	got := tm.List()
	testutil.Equal(t, len(got), 0, "删除后列表应为空, 实际 %d 条", len(got))
}

// P2 补测（根守卫）：Delete 回收站根目录自身应被拒绝（对齐 Move/Restore 的根级守卫），
// 且 .recycle 目录仍存在
func TestDelete_RootRejected(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	// 先移入一个文件确保 .recycle 目录已存在
	src := testutil.CreateTestFile(t, dir, "test.ysm", "x")
	testutil.NoError(t, tm.Move(src))
	testutil.FileExists(t, tm.RecycleDir(), "前置条件失败：.recycle 目录应存在")

	err := tm.Delete(tm.RecycleDir())
	testutil.NotNil(t, err, "删除回收站根目录应被拒绝")
	testutil.FileExists(t, tm.RecycleDir(), ".recycle 目录应仍存在")
}
