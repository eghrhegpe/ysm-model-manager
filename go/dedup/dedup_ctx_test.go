package dedup

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// ctxTestDir 构造两个内容相同的文件（触发完整 collect→hash→group 管道）。
func ctxTestDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.bin"), []byte("same content"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.bin"), []byte("same content"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// TestFindDuplicateFilesCtx_PreCancelled ADR-314：预取消 ctx 确定性验证取消检查点
// 生效（不依赖时序竞态）——collectFiles 首个检查点即中止，错误链可 errors.Is 判定。
func TestFindDuplicateFilesCtx_PreCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := FindDuplicateFilesCtx(ctx, ctxTestDir(t), true)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("预取消 ctx 应返回 context.Canceled 链, got %v", err)
	}
}

// TestCountDuplicatesCtx_PreCancelled ADR-314：计数管道同取消语义。
func TestCountDuplicatesCtx_PreCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err := CountDuplicatesCtx(ctx, ctxTestDir(t), true)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("预取消 ctx 应返回 context.Canceled 链, got %v", err)
	}
}

// TestFindDuplicateFilesCtx_EquivalentToShell ADR-314 + ADR-119：未取消路径的输出
// 与薄壳（原签名）逐字节一致——取消通道不得扰动确定性契约。
func TestFindDuplicateFilesCtx_EquivalentToShell(t *testing.T) {
	dir := ctxTestDir(t)

	shell, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatalf("薄壳路径失败: %v", err)
	}
	ctxPath, err := FindDuplicateFilesCtx(context.Background(), dir, true)
	if err != nil {
		t.Fatalf("ctx 路径失败: %v", err)
	}

	if len(shell) != len(ctxPath) || len(shell) != 1 {
		t.Fatalf("两路径应各得 1 组: shell=%d ctx=%d", len(shell), len(ctxPath))
	}
	for i := range shell {
		if shell[i].Hash != ctxPath[i].Hash || len(shell[i].Files) != len(ctxPath[i].Files) {
			t.Fatalf("第 %d 组输出不一致: %+v vs %+v", i, shell[i], ctxPath[i])
		}
		for j := range shell[i].Files {
			if shell[i].Files[j].Path != ctxPath[i].Files[j].Path {
				t.Fatalf("组内文件序不一致: %s vs %s", shell[i].Files[j].Path, ctxPath[i].Files[j].Path)
			}
		}
	}
}
