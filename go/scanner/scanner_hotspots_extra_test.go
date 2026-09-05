// ===== go/scanner 热点补测（覆盖缺口：invalidateKeyVersion / ScanLocalAuthors 分支 /
// GenerateRepoIndex 错误路径 / .github 与 .disabled 跳过 / 超大文件哈希跳过）=====
package scanner

import (
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// ====== invalidateKeyVersion ======

// TestInvalidateKeyVersion 原子版本戳递增：同 key 连续失效两次 → 版本为 2
// （源码中该函数当前无调用方，属防御性工具函数，直接白盒测试锁定行为）
func TestInvalidateKeyVersion(t *testing.T) {
	key := "test-invalidate-key-version"
	// 从干净状态开始（防止其它测试残留同 key）
	keyVersions.Delete(key)
	invalidateKeyVersion(key)
	invalidateKeyVersion(key)

	v, ok := keyVersions.Load(key)
	if !ok {
		t.Fatal("失效后 key 应存在")
	}
	if got := v.(*atomic.Uint64).Load(); got != 2 {
		t.Errorf("版本戳 = %d, 期望 2（两次递增）", got)
	}
}

// ====== InvalidatePath 边界 ======

// TestInvalidatePath_EmptyKey 空/全空白 key 早退：不 panic、无副作用
func TestInvalidatePath_EmptyKey(t *testing.T) {
	InvalidatePath("")
	InvalidatePath("   ")
}

// TestInvalidatePath_UnscannedKey 从未扫描过的目录：兜底递增自身版本，不 panic
func TestInvalidatePath_UnscannedKey(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "never-scanned")
	InvalidatePath(dir)
	// 失效后再扫描应正常（不被残留版本戳影响）
	if got := len(ScanEntries(dir)); got != 0 {
		t.Errorf("空目录扫描应 0 个, got %d", got)
	}
}

// ====== ScanEntries 跳过分支 ======

// TestScanEntries_GithubDirSkipped .github 目录整树跳过（与 CI genindex 口径一致）
func TestScanEntries_GithubDirSkipped(t *testing.T) {
	dir := t.TempDir()
	ghDir := filepath.Join(dir, ".github")
	if err := os.MkdirAll(filepath.Join(ghDir, "workflows"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ghDir, "workflows", "script.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "normal.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	entries := ScanEntries(dir)
	if len(entries) != 1 || entries[0].Name != "normal.ysm" {
		t.Fatalf("应只扫到 normal.ysm（.github 跳过）, got %+v", entries)
	}
}

// TestScanEntries_DisabledRestored .disabled 后缀恢复原扩展名（与 .ban 同族）
func TestScanEntries_DisabledRestored(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "model.ysm.disabled"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt.disabled"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	entries := ScanEntries(dir)
	if len(entries) != 1 {
		t.Fatalf("应只扫到 model.ysm.disabled（恢复 .ysm）, got %+v", entries)
	}
	if entries[0].Ext != ".ysm" {
		t.Errorf("Ext = %q, 期望 .ysm（.disabled 恢复原扩展名）", entries[0].Ext)
	}
	if entries[0].Name != "model.ysm.disabled" {
		t.Errorf("Name = %q, 期望保留原文件名 model.ysm.disabled", entries[0].Name)
	}
}

// TestScanEntries_WalkRootFailed 根目录不存在 → walkFailed 标记：返回空且不写缓存
// （与「目录真空」区分——失败结果不得带 30s TTL 假缓存）
func TestScanEntries_WalkRootFailed(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "does-not-exist")
	entries, hit := ScanEntriesWithHit(missing)
	if len(entries) != 0 {
		t.Errorf("不存在的目录应返回空, got %d", len(entries))
	}
	if hit {
		t.Error("根目录 walk 失败不应命中缓存")
	}
	// 再次扫描仍不命中（失败结果未被缓存）
	if _, hit2 := ScanEntriesWithHit(missing); hit2 {
		t.Error("失败结果不应被写入缓存")
	}
}

// TestScanEntries_HashSkippedOversize 超大文件（> MaxImportSize）跳过哈希：
// 条目保留、Hash 为空、记录留痕日志（稀疏文件，零磁盘占用）
func TestScanEntries_HashSkippedOversize(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "big.ysm")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(registry.MaxImportSize + 1); err != nil {
		t.Fatal(err)
	}
	f.Close()

	entries := ScanEntries(dir)
	if len(entries) != 1 {
		t.Fatalf("超大文件仍应是条目, got %d", len(entries))
	}
	if entries[0].Hash != "" {
		t.Errorf("超大文件哈希应为空（跳过）, got %q", entries[0].Hash)
	}
}

// ====== ComputeFileHash 补充 ======

// TestComputeFileHash_Oversize 文件超过 MaxImportSize → 直接返回空（不读内容）
func TestComputeFileHash_Oversize(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "big.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(registry.MaxImportSize + 1); err != nil {
		t.Fatal(err)
	}
	f.Close()

	if got := ComputeFileHash(p); got != "" {
		t.Errorf("超大文件应返回空哈希, got %q", got)
	}
}

// ====== ScanLocalAuthors 分支全覆盖 ======

// findCreatorByName 辅助：按名查找创作者（roots map 迭代序随机，不能按索引断言）
func findCreatorByName(list []types.WorkshopCreator, name string) *types.WorkshopCreator {
	for i := range list {
		if list[i].Name == name {
			return &list[i]
		}
	}
	return nil
}

// TestScanLocalAuthors_Branches 覆盖作者提取全部分支：
// 新建 / 同 root 去重 / .ban 剥后缀 / 无 [ 前缀 / 缺 ] / 空作者 / 跨类型合并 Type
func TestScanLocalAuthors_Branches(t *testing.T) {
	ysmDir := t.TempDir()
	mmdDir := t.TempDir()
	files := []struct{ dir, name string }{
		{ysmDir, "[作者E]模型.ysm"},     // 新建 creator（含哈希计算）
		{ysmDir, "[作者E]模型2.ysm"},    // 同 root 同作者 → seen 去重
		{ysmDir, "[作者F]模型.ysm.ban"}, // .ban 剥后缀后提取
		{ysmDir, "无作者.ysm"},         // 无 [ 前缀 → 跳过
		{ysmDir, "[作者G.ysm"},        // 有 [ 无 ] → idx<=0 跳过
		{ysmDir, "[]模型.ysm"},        // 空作者 → 跳过
		{mmdDir, "[作者E]模型.pmx"},     // 跨类型（EntityPlayer）→ 合并 Type
		{mmdDir, "无作者.pmx"},         // 另一 root 的无 [ 前缀 → 跳过
	}
	for _, f := range files {
		if err := os.WriteFile(filepath.Join(f.dir, f.name), []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	creators := ScanLocalAuthors(map[string]string{
		"ysm":          ysmDir,
		"EntityPlayer": mmdDir,
		"vrc":          "", // 空 root → 跳过
	})
	if len(creators) != 2 {
		t.Fatalf("应 2 个创作者（作者E 合并类型 / 作者F）, got %d: %+v", len(creators), creators)
	}
	e := findCreatorByName(creators, "作者E")
	if e == nil {
		t.Fatalf("缺少 作者E: %+v", creators)
	}
	// 跨类型合并：Type 须同时含 ysm 与 EntityPlayer（集合断言，不依赖拼接顺序——
	// 源码已按 rtype 字典序保证确定性输出，顺序变化不应破坏本用例）
	for _, want := range []string{"ysm", "EntityPlayer"} {
		if !strings.Contains(e.Type, want) {
			t.Errorf("作者E Type = %q, 应包含 %q（跨类型合并）", e.Type, want)
		}
	}
	if e.Desc != "来自本地仓库" {
		t.Errorf("作者E Desc = %q, 期望 '来自本地仓库'", e.Desc)
	}
	fc := findCreatorByName(creators, "作者F")
	if fc == nil {
		t.Fatalf("缺少 作者F: %+v", creators)
	}
	if fc.Type != "ysm" {
		t.Errorf("作者F Type = %q, 期望 'ysm'", fc.Type)
	}
}

// ====== GenerateRepoIndex 错误路径 ======

// TestGenerateRepoIndex_WriteError repoPath 是文件 → 写 index.json.tmp 失败
func TestGenerateRepoIndex_WriteError(t *testing.T) {
	dir := t.TempDir()
	repoPath := filepath.Join(dir, "repo-file")
	if err := os.WriteFile(repoPath, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	_, err := GenerateRepoIndex(repoPath)
	if err == nil {
		t.Fatal("repoPath 为文件时应返回错误（无法写 index.json）")
	}
}

// TestGenerateRepoIndex_RenameError index.json 预置为目录 → rename 原子替换失败，
// .tmp 残留应被清理
func TestGenerateRepoIndex_RenameError(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "index.json"), 0755); err != nil {
		t.Fatal(err)
	}
	_, err := GenerateRepoIndex(dir)
	if err == nil {
		t.Fatal("index.json 为目录时应返回错误")
	}
	if _, statErr := os.Stat(filepath.Join(dir, "index.json.tmp")); !os.IsNotExist(statErr) {
		t.Error("rename 失败后 .tmp 应被清理")
	}
}

// TestGenerateRepoIndex_WorkflowExists workflow 已存在 → 不重写（保留原内容）
func TestGenerateRepoIndex_WorkflowExists(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	wfPath := filepath.Join(dir, ".github", "workflows", "generate-index.yml")
	if err := os.MkdirAll(filepath.Dir(wfPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(wfPath, []byte("existing content"), 0644); err != nil {
		t.Fatal(err)
	}

	indexPath, err := GenerateRepoIndex(dir)
	if err != nil {
		t.Fatalf("GenerateRepoIndex() = %v", err)
	}
	if indexPath != filepath.Join(dir, "index.json") {
		t.Errorf("indexPath = %q", indexPath)
	}
	data, err := os.ReadFile(wfPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "existing content" {
		t.Errorf("workflow 应保留原内容, got %q", string(data))
	}
	// index.json 已生成且含 a.ysm
	idx, err := os.ReadFile(filepath.Join(dir, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(idx), "a.ysm") {
		t.Errorf("index.json 应含 a.ysm: %s", idx)
	}
}

// TestGenerateRepoIndex_MkdirAllError .github 是文件 → workflow 目录创建失败：
// index.json 仍成功生成，workflow 静默跳过
func TestGenerateRepoIndex_MkdirAllError(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".github"), []byte("not a dir"), 0644); err != nil {
		t.Fatal(err)
	}

	indexPath, err := GenerateRepoIndex(dir)
	if err != nil {
		t.Fatalf("index.json 生成不应被 workflow 失败影响: %v", err)
	}
	if _, statErr := os.Stat(indexPath); statErr != nil {
		t.Errorf("index.json 应已生成: %v", statErr)
	}
	if _, statErr := os.Stat(filepath.Join(dir, ".github", "workflows")); !os.IsNotExist(statErr) {
		t.Error("workflow 目录不应生成（MkdirAll 失败静默跳过）")
	}
}
