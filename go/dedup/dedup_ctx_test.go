package dedup

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// ctxTestDir 构造两个内容相同的文件（触发完整 collect→hash→group 管道）。
func ctxTestDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.bin"), []byte("same content"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.bin"), []byte("same content"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	return dir
}

// TestFindDuplicateFilesCtx_PreCancelled ADR-314：预取消 ctx 确定性验证取消检查点
// 生效（不依赖时序竞态）——collectFiles 首个检查点即中止，错误链可 errors.Is 判定。
func TestFindDuplicateFilesCtx_PreCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := FindDuplicateFilesCtx(ctx, ctxTestDir(t), true)
	testutil.ErrorIs(t, err, context.Canceled, "预取消 ctx 应返回 context.Canceled 链")
}

// TestCountDuplicatesCtx_PreCancelled ADR-314：计数管道同取消语义。
func TestCountDuplicatesCtx_PreCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err := CountDuplicatesCtx(ctx, ctxTestDir(t), true)
	testutil.ErrorIs(t, err, context.Canceled, "预取消 ctx 应返回 context.Canceled 链")
}

// TestFindDuplicateFilesCtx_EquivalentToShell ADR-314 + ADR-119：未取消路径的输出
// 与薄壳（原签名）逐字节一致——取消通道不得扰动确定性契约。
func TestFindDuplicateFilesCtx_EquivalentToShell(t *testing.T) {
	dir := ctxTestDir(t)

	shell, err := FindDuplicateFiles(dir, true)
	testutil.NoError(t, err, "薄壳路径失败")
	ctxPath, err := FindDuplicateFilesCtx(context.Background(), dir, true)
	testutil.NoError(t, err, "ctx 路径失败")

	// OR 型复合条件拆序贯（len 守卫在前——Equal 失败即 Goexit，下方索引解引用仅在其通过后执行）
	testutil.Equal(t, len(ctxPath), 1, "两路径应各得 1 组: shell=%d ctx=%d", len(shell), len(ctxPath))
	testutil.Equal(t, len(shell), 1, "两路径应各得 1 组: shell=%d ctx=%d", len(shell), len(ctxPath))
	for i := range shell {
		// OR 型复合条件拆序贯
		testutil.Equal(t, shell[i].Hash, ctxPath[i].Hash, "第 %d 组输出不一致: %+v vs %+v", i, shell[i], ctxPath[i])
		testutil.Equal(t, len(shell[i].Files), len(ctxPath[i].Files), "第 %d 组输出不一致: %+v vs %+v", i, shell[i], ctxPath[i])
		for j := range shell[i].Files {
			testutil.Equal(t, shell[i].Files[j].Path, ctxPath[i].Files[j].Path, "组内文件序不一致: %s vs %s",
				shell[i].Files[j].Path, ctxPath[i].Files[j].Path)
		}
	}
}
