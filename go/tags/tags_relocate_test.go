// RelocateKeys 键迁移单测（2026-10-10 锐评：桌面端补齐与 web rekeyWebModelGroup 同语义）。
// 核心不变量：
//  1. 目录迁移（subtree=true）带分隔符边界——/a/b 前缀绝不命中 /a/bc/...（防字符串前缀误伤）。
//  2. move 语义删旧键、copy 语义保旧键（对齐 web moveOrCopyWebModel 的 move 布尔）。
//  3. 无命中键时不落盘（对齐「无变化不写盘」）。
//  4. 键形态不归一——调用方须传与 SetTags 写入时同源的绝对路径（scanner entry.Path 同形）。
package tags

import (
	"path/filepath"
	"testing"
)

func TestRelocateKeys_DirMoveRekeysSubtree(t *testing.T) {
	t.Parallel()
	s := NewStore(t.TempDir())
	dirA := filepath.Join("repo", "modelA")
	kJSON := filepath.Join(dirA, "ysm.json")
	kTex := filepath.Join(dirA, "sub", "face.png")
	sib := filepath.Join("repo", "modelAbc", "ysm.json") // 字符串前缀陷阱：modelA ⊂ modelAbc
	_ = s.SetTags(kJSON, []string{"联动"})
	_ = s.SetTags(kTex, []string{"联动", "高清"})
	_ = s.SetTags(sib, []string{"无关"})

	dirB := filepath.Join("repo", "modelB")
	n, err := s.RelocateKeys(dirA, dirB, true, false)
	if err != nil {
		t.Fatalf("RelocateKeys: %v", err)
	}
	if n != 2 {
		t.Fatalf("应迁移 2 键（ysm.json + sub/face.png），实得 %d", n)
	}
	// 新键在位、旧键消失
	if got, _ := s.GetTags(filepath.Join(dirB, "ysm.json")); len(got) != 1 || got[0] != "联动" {
		t.Errorf("新键 ysm.json 标签应跟随，实得 %v", got)
	}
	if got, _ := s.GetTags(filepath.Join(dirB, "sub", "face.png")); len(got) != 2 {
		t.Errorf("新键 sub/face.png 标签应跟随，实得 %v", got)
	}
	if got, _ := s.GetTags(kJSON); len(got) != 0 {
		t.Errorf("move 语义旧键应删除，实得 %v", got)
	}
	// 兄弟目录不受影响（分隔符边界）
	if got, _ := s.GetTags(sib); len(got) != 1 || got[0] != "无关" {
		t.Errorf("modelAbc 不该被 modelA 前缀命中，实得 %v", got)
	}
	// ListByTag 跟随到新路径（联动 打在 ysm.json 与 sub/face.png 两键上）
	paths, _ := s.ListByTag("联动")
	want := []string{filepath.Join(dirB, "sub", "face.png"), filepath.Join(dirB, "ysm.json")}
	if len(paths) != len(want) || paths[0] != want[0] || paths[1] != want[1] {
		t.Errorf("ListByTag 应返回迁移后的两个新路径，实得 %v", paths)
	}
}

func TestRelocateKeys_FileRenameExactOnly(t *testing.T) {
	t.Parallel()
	s := NewStore(t.TempDir())
	old := filepath.Join("repo", "a.ysm")
	_ = s.SetTags(old, []string{"X"})
	_ = s.SetTags(filepath.Join("repo", "a.ysm.bak"), []string{"Y"}) // 以 old 为字符串前缀，subtree=false 不应命中

	newP := filepath.Join("repo", "c.ysm")
	n, err := s.RelocateKeys(old, newP, false, false)
	if err != nil {
		t.Fatalf("RelocateKeys: %v", err)
	}
	if n != 1 {
		t.Fatalf("精确迁移应只动 1 键，实得 %d", n)
	}
	if got, _ := s.GetTags(newP); len(got) != 1 || got[0] != "X" {
		t.Errorf("新键应有旧标签，实得 %v", got)
	}
	if got, _ := s.GetTags(filepath.Join("repo", "a.ysm.bak")); len(got) != 1 || got[0] != "Y" {
		t.Errorf("subtree=false 时 .bak 键不该被动，实得 %v", got)
	}
}

func TestRelocateKeys_CopyKeepsSource(t *testing.T) {
	t.Parallel()
	s := NewStore(t.TempDir())
	src := filepath.Join("repo", "m.ysm")
	_ = s.SetTags(src, []string{"复制我"})
	dst := filepath.Join("repo", "copy", "m.ysm")
	n, err := s.RelocateKeys(src, dst, false, true)
	if err != nil {
		t.Fatalf("RelocateKeys: %v", err)
	}
	if n != 1 {
		t.Fatalf("copy 迁移 1 键，实得 %d", n)
	}
	if got, _ := s.GetTags(src); len(got) != 1 {
		t.Errorf("copy=true 源标签必须保留，实得 %v", got)
	}
	if got, _ := s.GetTags(dst); len(got) != 1 {
		t.Errorf("copy=true 目标应得标签副本，实得 %v", got)
	}
}

func TestRelocateKeys_NoMatchSkipsPersist(t *testing.T) {
	t.Parallel()
	s := NewStore(t.TempDir())
	// 空库迁移任何前缀 → 0 命中，不落盘、不报错
	n, err := s.RelocateKeys(filepath.Join("a", "x"), filepath.Join("a", "y"), true, false)
	if err != nil {
		t.Fatalf("无命中不应报错: %v", err)
	}
	if n != 0 {
		t.Fatalf("空库迁移应为 0，实得 %d", n)
	}
	// from==to、空 from、空 to 全部 no-op
	for _, tc := range [][2]string{{"same", "same"}, {"", "x"}, {"x", ""}} {
		if nn, e := s.RelocateKeys(tc[0], tc[1], true, false); e != nil || nn != 0 {
			t.Errorf("退化输入 (%q,%q) 应 no-op，得 n=%d err=%v", tc[0], tc[1], nn, e)
		}
	}
}
