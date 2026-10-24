// ===== resolveTrashDest 越权守卫（insideRecycle 闭包重写）变更行补测 =====
// 闭包由手写 strings.HasPrefix（大小写敏感词法判定）换成 paths.IsInside
// （词法 + 大小写不敏感，与 verifyRenamedInside 的 IsInsideResolved 同源），
// 错误文案保持「路径越权: %s 不在回收站目录下: %w」且 %w 包装保留
// paths.ErrPathEscalation 分类（ErrNotInside 哨兵可 errors.Is 归类）。
// 本文件锁三件事：① 站内候选成功分支；② 越权候选失败分支（文案 + 哨兵归类）；
// ③ 冲突后缀候选逐个重过守卫仍放行。
// 注：大小写变体用例经 resolveTrashDest 不可构造——候选恒由 tm.recycleDir 字面
// Join 拼接，前缀大小写恒一致；大小写不敏感的真实收益落在 Restore 的磁盘回读
// 路径（on-disk 大小写与 tm.recycleDir 形态可能不同），不属本函数可达面。
package recycle

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/paths"
)

// 站内候选：root 下源文件 → 落点 = recycleDir/<rel>，守卫放行，父目录随之创建。
func TestResolveTrashDest_InsideCandidate(t *testing.T) {
	root := t.TempDir()
	tm := New(root)
	src := testutil.CreateTestFile(t, root, "a.ysm", "x")
	dst, err := tm.resolveTrashDest(root, src)
	testutil.NoError(t, err, "站内落点应成功, got")
	testutil.Equal(t, dst, filepath.Join(tm.RecycleDir(), "a.ysm"), "落点应为 recycleDir/源相对路径")
	testutil.FileExists(t, tm.RecycleDir(), "落点父目录（回收站）应已创建")
}

// 越权候选：root 外的源（同盘平级临时目录，rel 必含 ..）→ dst 越出回收站 →
// 守卫拒绝：文案两段保留 + %w 链可归类到 ErrNotInside 哨兵。
func TestResolveTrashDest_OutsideCandidate(t *testing.T) {
	root := t.TempDir()
	tm := New(root)
	outside := t.TempDir()
	_, err := tm.resolveTrashDest(root, filepath.Join(outside, "evil.ysm"))
	testutil.ErrorContains(t, err, "路径越权")
	testutil.ErrorContains(t, err, "不在回收站目录下")
	testutil.ErrorIs(t, err, paths.ErrNotInside, "错误应经 %%w 包装保留 ErrPathEscalation 分类（errors.Is 可归类）")
	testutil.Equal(t, strings.Contains(err.Error(), "evil.ysm"), true, "文案应携带越权候选路径, got: "+err.Error())
}

// 冲突后缀：落点已存在同名文件 → generateConflictFreeDest 生成 (1) 后缀候选，
// 每个候选重过的守卫仍是本闭包——后缀候选同样放行（重写后守卫语义不回退）。
func TestResolveTrashDest_ConflictSuffixStillInside(t *testing.T) {
	root := t.TempDir()
	tm := New(root)
	src := testutil.CreateTestFile(t, root, "b.ysm", "x")
	// 预占落点：回收站里已有 b.ysm
	existing := filepath.Join(tm.RecycleDir(), "b.ysm")
	if err := os.MkdirAll(tm.RecycleDir(), 0o755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(existing, []byte("occupied"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	dst, err := tm.resolveTrashDest(root, src)
	testutil.NoError(t, err, "冲突消解应成功, got")
	testutil.Equal(t, dst, filepath.Join(tm.RecycleDir(), "b(1).ysm"), "冲突后应让位到 (1) 后缀候选")
}
