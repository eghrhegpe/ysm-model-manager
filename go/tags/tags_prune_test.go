// PruneKeys 键清理单测（2026-10-11 锐评收口：RelocateKeys 只补了「迁移半侧」，
// 删除路径（RemoveDir / DeleteResourcePack）失效扫描缓存却不清标签键——
// 孤儿键单调累积，同名重建会复活旧标签。PruneKeys 补齐「删除半侧」）。
// 核心不变量：
//  1. subtree=true 带分隔符边界——/a/b 前缀绝不命中 /a/bc/...（与 RelocateKeys 同律）。
//  2. subtree=false 只清精确键（单文件删除）。
//  3. 无命中键时不落盘（对齐「无变化不写盘」；与 RelocateKeys 无命中 no-op 同律）。
//  4. 空 prefix no-op；NUL 前缀仍受 checkModelPath 边界保护。
package tags

import (
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

func TestPruneKeys_SubtreeBoundary(t *testing.T) {
	t.Parallel()
	s := NewStore(t.TempDir())
	dirA := filepath.Join("repo", "modelA")
	kJSON := filepath.Join(dirA, "ysm.json")
	kTex := filepath.Join(dirA, "sub", "face.png")
	sib := filepath.Join("repo", "modelAbc", "ysm.json") // 字符串前缀陷阱：modelA ⊂ modelAbc
	_ = s.SetTags(kJSON, []string{"联动"})
	_ = s.SetTags(kTex, []string{"高清"})
	_ = s.SetTags(sib, []string{"无关"})

	n, err := s.PruneKeys(dirA, true)
	testutil.NoError(t, err, "PruneKeys")
	testutil.Equal(t, n, 2, "应清 2 键（ysm.json + sub/face.png）")
	if got, _ := s.GetTags(kJSON); len(got) != 0 {
		t.Errorf("删除半侧后旧键标签应清空，实得 %v", got)
	}
	if got, _ := s.GetTags(kTex); len(got) != 0 {
		t.Errorf("subtree 下子目录键应清空，实得 %v", got)
	}
	// 兄弟目录不受影响（分隔符边界）
	if got, _ := s.GetTags(sib); len(got) != 1 || got[0] != "无关" {
		t.Errorf("modelAbc 不该被 modelA 前缀命中，实得 %v", got)
	}
}

func TestPruneKeys_ExactOnly(t *testing.T) {
	t.Parallel()
	s := NewStore(t.TempDir())
	key := filepath.Join("repo", "a.ysm")
	_ = s.SetTags(key, []string{"X"})
	_ = s.SetTags(filepath.Join("repo", "a.ysm.bak"), []string{"Y"}) // 字符串前缀，subtree=false 不命中

	n, err := s.PruneKeys(key, false)
	testutil.NoError(t, err, "PruneKeys")
	testutil.Equal(t, n, 1, "精确清理应只动 1 键")
	if got, _ := s.GetTags(key); len(got) != 0 {
		t.Errorf("精确键应清空，实得 %v", got)
	}
	if got, _ := s.GetTags(filepath.Join("repo", "a.ysm.bak")); len(got) != 1 || got[0] != "Y" {
		t.Errorf("subtree=false 时 .bak 键不该被动，实得 %v", got)
	}
}

func TestPruneKeys_NoMatchSkipsPersist(t *testing.T) {
	t.Parallel()
	s := NewStore(t.TempDir())
	_ = s.SetTags(filepath.Join("repo", "keep.ysm"), []string{"留"})

	// 空 prefix no-op
	n, err := s.PruneKeys("", true)
	testutil.NoError(t, err, "空 prefix 不应报错")
	testutil.Equal(t, n, 0, "空 prefix 应为 0")
	// 无命中：0 且不动其它键
	n, err = s.PruneKeys(filepath.Join("repo", "ghost"), true)
	testutil.NoError(t, err, "无命中不应报错")
	testutil.Equal(t, n, 0, "无命中应为 0")
	if got, _ := s.GetTags(filepath.Join("repo", "keep.ysm")); len(got) != 1 {
		t.Errorf("无关键不该被动，实得 %v", got)
	}
	// NUL 前缀受边界保护
	if _, err := s.PruneKeys(filepath.Join("repo", "a\x00b"), true); err == nil {
		t.Errorf("NUL 前缀应报错")
	}
}
