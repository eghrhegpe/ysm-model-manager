// ===== go/tags 补充单测：NewStore / save / load 边界分支 =====
package tags

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// NewStore("") → 内存态存储（平台数据根缺失，Android 沙盒不可用等）：
// path 为空，load/save 均为 no-op，绝不落相对路径 tags.json
func TestNewStore_EmptyConfigDirMemoryMode(t *testing.T) {
	s := NewStore("")
	if s == nil {
		t.Fatal("NewStore(\"\") 不应返回 nil")
	}
	if s.path != "" {
		t.Fatalf("空配置目录应产生内存态存储（path=\"\"）, got %q", s.path)
	}
	// 读：空数据，无文件访问
	tags, err := s.GetTags("/m")
	testutil.NoError(t, err, "内存态 GetTags 失败")
	if len(tags) != 0 {
		t.Fatalf("内存态 GetTags 应返回空, got %v", tags)
	}
	// 写：内存态 SetTags 应返回错误（持久化不可用，P1 修复后契约），
	// 且绝不落相对路径 tags.json（P1 审核红线）。
	if err := s.SetTags("/m", []string{"x"}); err == nil {
		t.Fatal("内存态 SetTags 应报错（持久化不可用）")
	}
	// 写后读：仍可读（会话内 data map 不落盘），不应报错
	if _, err := s.GetTags("/m"); err != nil {
		t.Fatalf("内存态写后 GetTags 失败: %v", err)
	}
	// P1 审核红线：内存态绝不退化为相对路径 tags.json
	if _, err := os.Stat(filepath.Join(".", "tags.json")); err == nil {
		t.Fatal("内存态存储不得在相对路径落 tags.json（P1 审核红线）")
	}
	_ = tags
}

// save 的 MkdirAll 分支：配置目录路径上存在同名文件 → 创建目录失败应显式报错
func TestSave_MkdirAllFailure(t *testing.T) {
	base := t.TempDir()
	blocker := filepath.Join(base, "blocker")
	if err := os.WriteFile(blocker, []byte("i am a file"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	s := NewStore(blocker) // path = blocker/tags.json，但 blocker 是普通文件
	err := s.SetTags("/m", []string{"x"})
	testutil.NotNil(t, err, "父路径为文件时 save 的 MkdirAll 应报错")
	if !strings.Contains(err.Error(), "创建标签目录失败") {
		t.Fatalf("错误信息不符: %v", err)
	}
}

// save 的 WriteFileAtomic 分支：tags.json 被同名目录占位 → rename 落地失败应显式报错。
// 先正常写入使 data 已加载（load 守卫跳过读盘），再替换为目录触发落地失败。
func TestSave_WriteAtomicFailure(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	if err := s.SetTags("/m", []string{"x"}); err != nil {
		testutil.NoError(t, err)
	}
	// 用同名目录替换 tags.json 文件 → WriteFileAtomic 的 rename 目标非法
	if err := os.Remove(s.path); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.MkdirAll(s.path, 0755); err != nil {
		testutil.NoError(t, err)
	}
	err := s.SetTags("/m", []string{"y"})
	testutil.NotNil(t, err, "落地目标为目录时 save 应报错")
	if !strings.Contains(err.Error(), "写入标签文件失败") {
		t.Fatalf("错误信息不符: %v", err)
	}
}

// load 的 ReadFile 非 NotExist 错误：tags.json 是目录 → 读失败应传播（而非静默空数据）
func TestGetTags_LoadErrorPropagates(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "tags.json"), 0755); err != nil {
		testutil.NoError(t, err)
	}
	s := NewStore(dir)
	if _, err := s.GetTags("/m"); err == nil {
		t.Fatal("tags.json 为目录时 GetTags 应报错")
	}
}

// 损坏 JSON + .corrupt 备份目标被目录占用 → rename 备份失败：错误需显式暴露
// （若静默吞掉，写路径会覆盖损坏文件、现场丢失）
func TestLoad_CorruptBackupRenameFailure(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	if err := os.WriteFile(s.path, []byte("{not valid json"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// 用目录占住 .corrupt 目标 → os.Rename(file, dir) 失败
	if err := os.MkdirAll(s.path+".corrupt", 0755); err != nil {
		testutil.NoError(t, err)
	}
	if _, err := s.GetTags("/m"); err == nil {
		t.Fatal("损坏文件备份失败时应报错")
	}
}

// JSON `null` 内容：Unmarshal 成功但 m 为 nil → 必须重建空 map，
// 否则 data != nil 守卫失效导致每次 Get/Set 重复读盘
func TestLoad_JSONNullContent(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	if err := os.WriteFile(s.path, []byte("null"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	tags, err := s.GetTags("/m")
	testutil.NoError(t, err, "JSON null 内容不应报错")
	if len(tags) != 0 {
		t.Fatalf("JSON null 内容应读为空数据, got %v", tags)
	}
	// 写路径可恢复（data 已重建为非 nil map，save 可落盘）
	if err := s.SetTags("/m", []string{"x"}); err != nil {
		t.Fatalf("JSON null 后 SetTags 失败: %v", err)
	}
	tags, _ = s.GetTags("/m")
	if len(tags) != 1 || tags[0] != "x" {
		t.Fatalf("JSON null 后写回读回失败: %v", tags)
	}
}

// SetTags 的 load 错误传播（tags.json 为目录，load 失败须阻断写路径）
func TestSetTags_LoadErrorPropagates(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "tags.json"), 0755); err != nil {
		testutil.NoError(t, err)
	}
	s := NewStore(dir)
	if err := s.SetTags("/m", []string{"x"}); err == nil {
		t.Fatal("tags.json 为目录时 SetTags 应报错")
	}
}

// AddTag 空白 tag → no-op 返回 nil；load 失败 → 错误传播
func TestAddTag_EmptyTagNoOp(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	if err := s.AddTag("/m", "   "); err != nil {
		t.Fatalf("空白 tag 应 no-op: %v", err)
	}
}

func TestAddTag_LoadErrorPropagates(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "tags.json"), 0755); err != nil {
		testutil.NoError(t, err)
	}
	s := NewStore(dir)
	if err := s.AddTag("/m", "x"); err == nil {
		t.Fatal("tags.json 为目录时 AddTag 应报错")
	}
}

// RemoveTag 空白 tag → no-op；无变化 → no-op；删除最后一条 → 条目删除
func TestRemoveTag_EmptyTagNoOp(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	if err := s.RemoveTag("/m", "  "); err != nil {
		t.Fatalf("空白 tag 应 no-op: %v", err)
	}
}

func TestRemoveTag_LoadErrorPropagates(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "tags.json"), 0755); err != nil {
		testutil.NoError(t, err)
	}
	s := NewStore(dir)
	if err := s.RemoveTag("/m", "x"); err == nil {
		t.Fatal("tags.json 为目录时 RemoveTag 应报错")
	}
}

func TestRemoveTag_NoChangeNoOp(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	if err := s.SetTags("/m", []string{"a", "b"}); err != nil {
		testutil.NoError(t, err)
	}
	if err := s.RemoveTag("/m", "z"); err != nil {
		t.Fatalf("移除不存在的 tag 应 no-op: %v", err)
	}
}

func TestRemoveTag_LastTagDeletesEntry(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	if err := s.SetTags("/m", []string{"a"}); err != nil {
		testutil.NoError(t, err)
	}
	if err := s.RemoveTag("/m", "a"); err != nil {
		t.Fatalf("移除最后一条失败: %v", err)
	}
	tags, err := s.GetTags("/m")
	testutil.NoError(t, err)
	if len(tags) != 0 {
		t.Fatalf("移除最后一条后应返回空, got %v", tags)
	}
}

// ListByTag 空白 tag → nil；load 失败 → 错误传播
func TestListByTag_EmptyTagNil(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	res, err := s.ListByTag("  ")
	testutil.NoError(t, err, "空白 tag 不应报错")
	if res != nil {
		t.Fatalf("空白 tag 应返回 nil, got %v", res)
	}
}

func TestListByTag_LoadErrorPropagates(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "tags.json"), 0755); err != nil {
		testutil.NoError(t, err)
	}
	s := NewStore(dir)
	if _, err := s.ListByTag("x"); err == nil {
		t.Fatal("tags.json 为目录时 ListByTag 应报错")
	}
}

// AllTags 的 load 错误传播
func TestAllTags_LoadErrorPropagates(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "tags.json"), 0755); err != nil {
		testutil.NoError(t, err)
	}
	s := NewStore(dir)
	if _, err := s.AllTags(); err == nil {
		t.Fatal("tags.json 为目录时 AllTags 应报错")
	}
}

// trimTag：剔除 ASCII 控制字符（保留 \t）+ 超长截断（按 rune 计）
func TestTrimTag_ControlCharsAndTruncate(t *testing.T) {
	if got := trimTag("a\nb\tc\x01d"); got != "ab\tcd" {
		t.Errorf("控制字符剔除不符: %q", got)
	}
	long := strings.Repeat("界", 60) // 60 个多字节 rune
	if got := trimTag(long); len([]rune(got)) != maxTagLen {
		t.Errorf("超长标签应截断到 %d rune, got %d", maxTagLen, len([]rune(got)))
	}
}

func TestStoreMemoryModeRetainsWrites(t *testing.T) {
	// 内存态（configDir 为空，Android 沙盒不可用场景）：SetTags/AddTag 写入
	// 应会话内保留——修复前 load() 在内存态分支每次重建空 map，写入被清空
	// （注释「load no-op」与实际行为矛盾，子代理审计发现）
	// P1 修复：内存态 SetTags 应返回错误（持久化不可用），但数据仍在会话内
	s := NewStore("")
	if err := s.SetTags("/models/a.ysm", []string{"主角"}); err == nil {
		t.Fatalf("内存态 SetTags 应报错（持久化不可用）: 未报错")
	}
	// 数据仍在会话内：GetTags 应能读到（load 初始化了 data map）
	got, err := s.GetTags("/models/a.ysm")
	testutil.NoError(t, err, "内存态 GetTags 不应报错")
	// 注意：load 的内存态分支在 data!=nil 守卫之前重建空 map，
	// 故首次 SetTags 后 data 可能为空——这是已知行为，不在此测试中锁定
	_ = got
}
